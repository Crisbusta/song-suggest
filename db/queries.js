import { describeTuning } from '../lib/tuning.js'
import { sugerirAjustes, paraElAmpli } from '../lib/ampli.js'
/* Vive en `public/` y no en `lib/` porque el navegador tambien lo necesita
   -- el buscador de bandas filtra la lista en el cliente -- y el servidor
   estatico solo sirve desde ahi. Tener una copia en cada lado seria peor:
   agrupar escrituras y buscar tienen que coincidir exactamente entre lo que se
   ofrece y lo que se filtra, y dos copias se desvian. Mismo criterio que
   `public/catalogo-lt25.js`, que tambien es puro y lo importan los tests. */
import { construirIndice, expandirArtistas, claveDeArtista } from '../public/artistas.js'

export const MODES = ['surprise', 'riffs', 'acoustic', 'solos']

/* Exclusiones permanentes: ya decidido, basura del catalogo, o sin enriquecer.

   El predicado vive en la PISTA (`g`), no en la cancion. Modo y dificultad se
   evaluan sobre la MISMA fila `g` a proposito: escribirlo como dos
   existenciales sueltos -- "existe una acustica y existe una facil" -- deja
   entrar canciones donde ninguna sola pista sirve. Medido sobre el universo
   sorteable al 2026-09-11: 178 canciones fantasma en acustico + 1-2 (1.881
   correctas contra 2.059). Ver test/pistas.test.js. */
const BASE_FROM = `
  FROM songs s
  JOIN guitar_tracks g ON g.song_id = s.song_id
  LEFT JOIN song_state st ON st.song_id = s.song_id
  WHERE s.enriched_at IS NOT NULL
    AND s.is_junk = 0 AND s.ai_generated = 0 AND s.is_blank = 0 AND s.is_published = 1
    AND st.status IS NULL
    AND g.difficulty BETWEEN ? AND ?
`

const MODE_SQL = {
  surprise: '',
  riffs: ` AND g.instrument IN ('Distortion Guitar','Overdriven Guitar') AND s.fingerstyle = 0`,
  acoustic: ` AND (s.fingerstyle = 1 OR g.instrument IN ('Acoustic Guitar (nylon)','Acoustic Guitar (steel)'))`,
  solos: ` AND (g.name LIKE '%Lead%' OR g.name LIKE '%Solo%')`,
}

// g.instrument, g.name y g.tuning no viajan: hidratar() no los lee, saca los
// datos de cada pista de nuevo desde guitar_tracks (pistasDeLaCancion). Queda
// g.difficulty porque el ORDER BY difficulty de la busqueda en modo solos
// mas abajo lo necesita.
const COLUMNS = `
  s.song_id, s.artist, s.title, s.videos,
  g.track_index, g.difficulty,
  COALESCE(st.liked, 0) AS liked
`

/* Una fila por cancion: la pista mas vista DE LAS QUE CALIFICAN.

   Cumple dos cosas a la vez, y las dos importan:

   1. Elige la pista por defecto. Que sea la mas vista de las que CALIFICAN --
      y no la mas vista a secas -- es lo que evita que pidas "facil" y la
      tarjeta abra en una pista de dificultad 5.
   2. Deduplica. Sin esto, una cancion con tres pistas que califican aparece
      tres veces y `ORDER BY RANDOM()` la elige tres veces mas seguido que a
      una de una sola pista. El sorteo tiene que ser uniforme por CANCION.

   Desempate por track_index para ser determinista, igual que
   representative_track. */
const unaPorCancion = cuerpo => `
  SELECT * FROM (
    SELECT ${COLUMNS},
           ROW_NUMBER() OVER (
             PARTITION BY s.song_id ORDER BY g.views DESC, g.track_index ASC
           ) AS rn
    ${cuerpo}
  ) WHERE rn = 1
`

/* La lista que alimenta el buscador de bandas.

   Cuenta sobre el MISMO universo que el sorteo -- `BASE_FROM` con la
   dificultad entera -- y no sobre `songs`. Si contara canciones que el sorteo
   nunca va a devolver, el numero al lado de cada banda seria una promesa que
   el boton no cumple: un artista con todas sus canciones ya descartadas
   aparaceria ofreciendo temas que no existen. Por eso tambien desaparece de la
   lista cuando se queda sin canciones sorteables. */
export function listarArtistas(db) {
  return construirIndice(db.prepare(`
    SELECT s.artist, COUNT(DISTINCT s.song_id) c ${BASE_FROM} GROUP BY s.artist ORDER BY c DESC
  `).all(1, 10))
}

/* Traduce las bandas elegidas al fragmento de SQL que las filtra.

   `sql` se concatena despues de `MODE_SQL`, asi que sus parametros van
   despues de min/max y antes de cualquier LIMIT.

   Elegir bandas que no estan en el catalogo da `1 = 0` y no un filtro vacio:
   sin bandas reconocidas el sorteo no puede devolver nada, y devolver
   cualquier cancion seria lo contrario de lo que se pidio. `desconocidas`
   existe para que el aviso pueda decir cual fue. */
function filtroArtistas(indice, elegidas) {
  if (!elegidas?.length) return { sql: '', params: [], desconocidas: [] }

  const escrituras = expandirArtistas(indice, elegidas)
  const conocidas = new Set(indice.map(g => g.clave))
  const desconocidas = elegidas.filter(n => !conocidas.has(claveDeArtista(n)))

  return escrituras.length
    ? { sql: ` AND s.artist IN (${escrituras.map(() => '?').join(', ')})`, params: escrituras, desconocidas }
    : { sql: ' AND 1 = 0', params: [], desconocidas }
}

function contar(db, mode, min, max, fa = { sql: '', params: [] }) {
  return db.prepare(`SELECT COUNT(DISTINCT s.song_id) c ${BASE_FROM}${MODE_SQL[mode]}${fa.sql}`)
    .get(min, max, ...fa.params).c
}

// El catalogo etiqueta cada video con un `feature`: `null` es el oficial (viene
// del canal automatico "Artista - Topic"), `backing` es un karaoke para tocar
// encima, y alternative/solo/playthrough son re-subidas y pistas aisladas.
// Medido sobre el catalogo completo: el 99,8% de las canciones sorteables
// traen el oficial, asi que elegir por feature es fiable. Ojo: el oficial NO
// suele ser el primero del arreglo, asi que no sirve un videos[0].
const elegirVideo = (json, feature) =>
  JSON.parse(json ?? '[]').find(v => v.feature === feature)?.videoId ?? null

/* Los track_index que cumplen el filtro con el que se sorteo esta cancion.

   Se pregunta al MISMO SQL que decidio el sorteo -- BASE_FROM + MODE_SQL --
   en vez de reimplementar el predicado en JavaScript. Dos copias de esta
   regla se desviarian, y la tarjeta terminaria marcando como "califica" una
   pista por la que el sorteo jamas habria devuelto la cancion. */
function pistasQueCalifican(db, songId, mode, min, max) {
  const filas = db.prepare(`
    SELECT g.track_index ${BASE_FROM}${MODE_SQL[mode]} AND s.song_id = ?
  `).all(min, max, songId)
  return new Set(filas.map(f => f.track_index))
}

/* Todas las pistas de guitarra de una cancion, ordenadas por views, cada una
   con su propio tono.

   No hay corte de ruido, y es una decision medida, no un olvido: la
   distribucion de views esta dominada por una pista desbocada, asi que
   cualquier corte relativo castiga pistas legitimas. Con un corte al 10% del
   maximo, Fade to Black pierde la ritmica de Hetfield (287.234 views contra
   los 2.984.809 de Kirk) -- justo lo que alguien querria aprender. Peor: en
   cada corte evaluado, miles de las pistas cortadas son la mas facil de su
   cancion, o sea exactamente las que hacen que la cancion entre al filtro.
   Cortar haria entrar canciones por una pista que despues no se muestra.
   Ordenar por views hace solo el trabajo: el ruido se hunde al fondo, y el
   94% de las canciones tiene cuatro pistas o menos.

   `califican` es el conjunto de track_index que cumplen el filtro, o null
   cuando no hubo filtro (getList): ahi todas califican. */
function pistasDeLaCancion(db, fila, tags, califican) {
  const filas = db.prepare(`
    SELECT track_index, instrument, name, difficulty, views, tuning
    FROM guitar_tracks WHERE song_id = ?
    ORDER BY views DESC, track_index ASC
  `).all(fila.song_id)

  return filas.map(p => {
    const tuning = describeTuning(p.tuning ? JSON.parse(p.tuning) : null)
    /* `artist` y `title` no son opcionales: son lo unico con lo que
       sugerirAjustes puede buscar un preset de la comunidad. Sin ellos la
       busqueda nunca recibe un artista y todo el camino de los presets queda
       inerte, con la suite en verde. */
    const sugerencia = sugerirAjustes({
      tags, instrument: p.instrument, tuning,
      artist: fila.artist, title: fila.title,
    })
    return {
      trackIndex: p.track_index,
      instrument: p.instrument,
      name: p.name,
      difficulty: p.difficulty,
      tuning,
      califica: califican ? califican.has(p.track_index) : true,
      // Punto de partida para el ampli, o null si los tags no dan senal util.
      // paraElAmpli son los mismos valores en la escala que espera el equipo.
      ampli: sugerencia && { ...sugerencia, paraElAmpli: paraElAmpli(sugerencia) },
    }
  })
}

/* `califican` viene del sorteo (los track_index que cumplen el filtro) o es
   null desde getList, que no filtra por nada.

   Los campos de la PISTA -- difficulty, instrument, trackName, tuning, ampli
   -- ya NO viven al nivel de la cancion. Tenerlos en los dos lados serian dos
   fuentes de verdad para el mismo dato, y la primera vez que el selector y la
   cabecera se desincronicen no habria forma de saber cual miente. La tarjeta
   lee siempre de pistas[elegida]. */
function hidratar(db, fila, califican = null) {
  if (!fila) return null
  const tags = db.prepare('SELECT tag FROM tags WHERE song_id = ?')
    .all(fila.song_id).map(r => r.tag)
  const pistas = pistasDeLaCancion(db, fila, tags, califican)
  return {
    songId: fila.song_id,
    artist: fila.artist,
    title: fila.title,
    pistas,
    // Cual viene elegida. El SQL ya decidio cual es (la mas vista de las que
    // califican); aca solo se traduce ese track_index a su posicion en el
    // arreglo ya ordenado.
    pistaPorDefecto: Math.max(0, pistas.findIndex(p => p.trackIndex === fila.track_index)),
    tags,
    officialVideo: elegirVideo(fila.videos, null),
    backingVideo: elegirVideo(fila.videos, 'backing'),
    url: `https://www.songsterr.com/a/wa/song?id=${fila.song_id}`,
    liked: !!fila.liked,
  }
}

// Solo aparece cuando hay algo util que sugerir.
function construirHint(db, mode, min, max, matching, fa = { sql: '', params: [], desconocidas: [] }, elegidas = []) {
  /* Una banda que el usuario escribio y el catalogo no tiene se dice SIEMPRE,
     aunque queden canciones de las otras: si no, el filtro se aplica mas
     angosto de lo que el usuario cree y nada se lo indica. */
  const faltan = fa.desconocidas.length
    ? `${listar(fa.desconocidas)} no ${fa.desconocidas.length === 1 ? 'está' : 'están'} en el catálogo.`
    : null

  if (matching >= 10) return faltan
  const ampliado = contar(db, mode, 1, 10, fa)

  if (matching === 0) {
    if (ampliado > 0) {
      return unir(faltan, `No queda ninguna con esos filtros. Ampliando la dificultad a 1-10 hay ${ampliado}.`)
    }
    /* Con la dificultad entera y aun cero: lo que vacia la lista no es el
       rango. Nombrar el filtro culpable es la diferencia entre un aviso util y
       un cero sin explicacion. */
    if (elegidas.length) {
      const conocidas = elegidas.filter(n => !fa.desconocidas.includes(n))
      return unir(faltan, conocidas.length
        ? `${listar(conocidas)} no ${conocidas.length === 1 ? 'tiene' : 'tienen'} ninguna con este modo.`
        : 'Prueba con otra banda.')
    }
    return 'No queda ninguna con este modo. Prueba otro.'
  }

  const cola = ampliado > matching
    ? `Quedan ${matching}. Ampliando la dificultad a 1-10 serian ${ampliado}.`
    : elegidas.length
      ? `Quedan ${matching} de ${listar(elegidas.filter(n => !fa.desconocidas.includes(n)))} con este modo.`
      : `Quedan ${matching} con este modo.`
  return unir(faltan, cola)
}

const unir = (...partes) => partes.filter(Boolean).join(' ') || null

// "Rush", "Rush y Tool", "Rush, Tool y Kyuss", "las 5 bandas elegidas".
function listar(nombres) {
  if (nombres.length > 4) return `las ${nombres.length} bandas elegidas`
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

export function roll(db, opts = {}) {
  const { mode = 'surprise', minDifficulty = 1, maxDifficulty = 10, artists = [] } = opts
  if (!MODES.includes(mode)) throw new Error(`modo desconocido: ${mode}`)

  /* El indice se arma UNA vez y se pasa a todo lo que lo necesita. `contar`,
     el aviso y el sorteo tienen que ver exactamente las mismas bandas: si cada
     uno lo recalculara, un descarte a mitad de la peticion podria darles
     universos distintos y la cuenta dejaria de describir el sorteo. */
  const fa = filtroArtistas(artists.length ? listarArtistas(db) : [], artists)

  const matching = contar(db, mode, minDifficulty, maxDifficulty, fa)
  const hint = construirHint(db, mode, minDifficulty, maxDifficulty, matching, fa, artists)
  if (matching === 0) return { song: null, matching: 0, hint }

  let fila
  if (mode === 'solos') {
    // Sesgo al extremo alto: el tercio superior por dificultad, minimo 20,
    // para que un rango angosto no deje el sorteo entre dos canciones. La
    // dificultad que ordena es la de la PISTA ELEGIDA, ya resuelta por
    // unaPorCancion.
    const pool = Math.max(20, Math.ceil(matching / 3))
    fila = db.prepare(`
      SELECT * FROM (
        ${unaPorCancion(`${BASE_FROM}${MODE_SQL.solos}${fa.sql}`)}
        ORDER BY difficulty DESC, song_id ASC LIMIT ?
      ) ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params, pool)
  } else {
    fila = db.prepare(`
      ${unaPorCancion(`${BASE_FROM}${MODE_SQL[mode]}${fa.sql}`)}
      ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params)
  }

  if (fila) {
    asegurarFila(db, fila.song_id)
    db.prepare('UPDATE song_state SET shown_count = shown_count + 1 WHERE song_id = ?')
      .run(fila.song_id)
  }

  return {
    song: hidratar(db, fila, fila && pistasQueCalifican(db, fila.song_id, mode, minDifficulty, maxDifficulty)),
    matching,
    hint,
  }
}

export const LISTS = ['learned', 'skipped', 'queued', 'liked']

function asegurarFila(db, songId) {
  db.prepare(`
    INSERT INTO song_state (song_id, updated_at) VALUES (?, ?)
    ON CONFLICT(song_id) DO NOTHING
  `).run(songId, new Date().toISOString())
}

export function mark(db, { songId, status, liked }) {
  asegurarFila(db, songId)
  // `undefined` significa "no tocar"; `null` en status borra la disposicion.
  if (status !== undefined) {
    db.prepare('UPDATE song_state SET status = ?, updated_at = ? WHERE song_id = ?')
      .run(status, new Date().toISOString(), songId)
  }
  if (liked !== undefined) {
    db.prepare('UPDATE song_state SET liked = ?, updated_at = ? WHERE song_id = ?')
      .run(liked ? 1 : 0, new Date().toISOString(), songId)
  }
}

export function getList(db, list) {
  if (!LISTS.includes(list)) throw new Error(`lista desconocida: ${list}`)
  const filtro = list === 'liked' ? 'st.liked = 1' : 'st.status = ?'
  const params = list === 'liked' ? [] : [list]

  const filas = db.prepare(`
    SELECT ${COLUMNS}
    FROM songs s
    JOIN representative_track g ON g.song_id = s.song_id
    JOIN song_state st ON st.song_id = s.song_id
    WHERE ${filtro}
    ORDER BY st.updated_at DESC
  `).all(...params)

  return filas.map(f => hidratar(db, f))
}

export function getStats(db) {
  const s = db.prepare(`
    SELECT COUNT(*) total, SUM(enriched_at IS NOT NULL) enriched FROM songs
  `).get()
  const available = db.prepare(`SELECT COUNT(DISTINCT s.song_id) c ${BASE_FROM}`).get(1, 10).c
  return {
    total: s.total,
    enriched: s.enriched ?? 0,
    pending: s.total - (s.enriched ?? 0),
    available,
  }
}
