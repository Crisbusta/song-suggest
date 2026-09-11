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

// Exclusiones permanentes: ya decidido, basura del catalogo, o sin enriquecer.
const BASE_FROM = `
  FROM songs s
  JOIN representative_track r ON r.song_id = s.song_id
  LEFT JOIN song_state st ON st.song_id = s.song_id
  WHERE s.enriched_at IS NOT NULL
    AND s.is_junk = 0 AND s.ai_generated = 0 AND s.is_blank = 0 AND s.is_published = 1
    AND st.status IS NULL
    AND r.difficulty BETWEEN ? AND ?
`

const MODE_SQL = {
  surprise: '',
  riffs: ` AND r.instrument IN ('Distortion Guitar','Overdriven Guitar') AND s.fingerstyle = 0`,
  acoustic: ` AND (s.fingerstyle = 1 OR r.instrument IN ('Acoustic Guitar (nylon)','Acoustic Guitar (steel)'))`,
  solos: ` AND (r.name LIKE '%Lead%' OR r.name LIKE '%Solo%')`,
}

const COLUMNS = `
  s.song_id, s.artist, s.title, s.videos,
  r.difficulty, r.instrument, r.name AS track_name, r.tuning,
  COALESCE(st.liked, 0) AS liked
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
    SELECT s.artist, COUNT(*) c ${BASE_FROM} GROUP BY s.artist ORDER BY c DESC
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
  return db.prepare(`SELECT COUNT(*) c ${BASE_FROM}${MODE_SQL[mode]}${fa.sql}`)
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

function hidratar(db, fila) {
  if (!fila) return null
  const tags = db.prepare('SELECT tag FROM tags WHERE song_id = ?')
    .all(fila.song_id).map(r => r.tag)
  const tuning = describeTuning(fila.tuning ? JSON.parse(fila.tuning) : null)
  /* `artist` y `title` no son opcionales aunque el parametro lo sea: son lo
     unico con lo que sugerirAjustes puede buscar un preset de la comunidad.
     Sin ellos la busqueda nunca recibe un artista, jamas encuentra nada, y
     todo el camino de los presets queda inerte -- con la suite entera en
     verde, porque los tests de sugerirAjustes la llaman directo y no pasan por
     aqui. Ese es exactamente el agujero que cubre el test de roll.test.js que
     sortea una cancion de Metallica y exige fuente 'comunidad'. */
  const sugerencia = sugerirAjustes({
    tags, instrument: fila.instrument, tuning,
    artist: fila.artist, title: fila.title,
  })
  return {
    songId: fila.song_id,
    artist: fila.artist,
    title: fila.title,
    difficulty: fila.difficulty,
    instrument: fila.instrument,
    trackName: fila.track_name,
    tuning,
    // Punto de partida para el ampli, o null si los tags no dan senal util.
    // paraElAmpli son los mismos valores en la escala que espera el equipo.
    ampli: sugerencia && { ...sugerencia, paraElAmpli: paraElAmpli(sugerencia) },
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
    // para que un rango angosto no deje el sorteo entre dos canciones.
    const pool = Math.max(20, Math.ceil(matching / 3))
    fila = db.prepare(`
      SELECT * FROM (
        SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL.solos}${fa.sql}
        ORDER BY r.difficulty DESC, s.song_id ASC LIMIT ?
      ) ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params, pool)
  } else {
    fila = db.prepare(`
      SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL[mode]}${fa.sql} ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params)
  }

  if (fila) {
    asegurarFila(db, fila.song_id)
    db.prepare('UPDATE song_state SET shown_count = shown_count + 1 WHERE song_id = ?')
      .run(fila.song_id)
  }

  return { song: hidratar(db, fila), matching, hint }
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
    JOIN representative_track r ON r.song_id = s.song_id
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
  const available = db.prepare(`SELECT COUNT(*) c ${BASE_FROM}`).get(1, 10).c
  return {
    total: s.total,
    enriched: s.enriched ?? 0,
    pending: s.total - (s.enriched ?? 0),
    available,
  }
}
