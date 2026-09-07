import { describeTuning } from '../lib/tuning.js'
import { sugerirAjustes, paraElAmpli } from '../lib/ampli.js'

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

function contar(db, mode, min, max) {
  return db.prepare(`SELECT COUNT(*) c ${BASE_FROM}${MODE_SQL[mode]}`).get(min, max).c
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
function construirHint(db, mode, min, max, matching) {
  if (matching >= 10) return null
  const ampliado = contar(db, mode, 1, 10)
  if (matching === 0) {
    return ampliado > 0
      ? `No queda ninguna con esos filtros. Ampliando la dificultad a 1-10 hay ${ampliado}.`
      : 'No queda ninguna con este modo. Prueba otro.'
  }
  return ampliado > matching
    ? `Quedan ${matching}. Ampliando la dificultad a 1-10 serian ${ampliado}.`
    : `Quedan ${matching} con este modo.`
}

export function roll(db, opts = {}) {
  const { mode = 'surprise', minDifficulty = 1, maxDifficulty = 10 } = opts
  if (!MODES.includes(mode)) throw new Error(`modo desconocido: ${mode}`)

  const matching = contar(db, mode, minDifficulty, maxDifficulty)
  const hint = construirHint(db, mode, minDifficulty, maxDifficulty, matching)
  if (matching === 0) return { song: null, matching: 0, hint }

  let fila
  if (mode === 'solos') {
    // Sesgo al extremo alto: el tercio superior por dificultad, minimo 20,
    // para que un rango angosto no deje el sorteo entre dos canciones.
    const pool = Math.max(20, Math.ceil(matching / 3))
    fila = db.prepare(`
      SELECT * FROM (
        SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL.solos}
        ORDER BY r.difficulty DESC, s.song_id ASC LIMIT ?
      ) ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, pool)
  } else {
    fila = db.prepare(`
      SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL[mode]} ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty)
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
