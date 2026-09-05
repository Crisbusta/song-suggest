import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll, mark, getList } from '../db/queries.js'

let siguienteId = 1

// Inserta una cancion enriquecida con un solo track de guitarra.
function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, ?, ?, ?, ?, ?, ?, '2026-09-03')
  `).run(
    songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId,
    o.fingerstyle ?? 0, o.isJunk ?? 0, o.aiGenerated ?? 0, o.isBlank ?? 0, o.isPublished ?? 1,
    o.videos ?? '[]'
  )
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (?, 0, ?, ?, ?, 1000, ?)
  `).run(
    songId, o.instrument ?? 'Distortion Guitar', o.trackName ?? 'Rhythm Guitar',
    o.difficulty ?? 3, o.tuning ?? '[64,59,55,50,45,40]'
  )
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

test('devuelve una cancion que calza', () => {
  const db = base()
  agregar(db, { title: 'Unica' })
  const r = roll(db, {})
  assert.equal(r.song.title, 'Unica')
  assert.equal(r.matching, 1)
})

test('arma la url de Songsterr desde el id', () => {
  const db = base()
  agregar(db, { songId: 455118 })
  assert.equal(roll(db, {}).song.url, 'https://www.songsterr.com/a/wa/song?id=455118')
})

test('formatea la afinacion y calla cuando es estandar', () => {
  const db = base()
  agregar(db, { songId: 1, tuning: '[64,59,55,50,45,38]' })
  assert.equal(roll(db, {}).song.tuning, 'Drop D')

  const db2 = base()
  agregar(db2, { tuning: '[64,59,55,50,45,40]' })
  assert.equal(roll(db2, {}).song.tuning, null)
})

test('filtra por rango de dificultad', () => {
  const db = base()
  agregar(db, { difficulty: 2, title: 'Facil' })
  agregar(db, { difficulty: 8, title: 'Dificil' })

  const r = roll(db, { minDifficulty: 1, maxDifficulty: 3 })
  assert.equal(r.matching, 1)
  assert.equal(r.song.title, 'Facil')
})

test('modo riffs exige guitarra electrica distorsionada y no fingerstyle', () => {
  const db = base()
  agregar(db, { instrument: 'Distortion Guitar', title: 'Riff' })
  agregar(db, { instrument: 'Acoustic Guitar (steel)', title: 'Acustica' })
  agregar(db, { instrument: 'Distortion Guitar', fingerstyle: 1, title: 'Fingerstyle distorsionada' })

  const r = roll(db, { mode: 'riffs' })
  assert.equal(r.matching, 1)
  assert.equal(r.song.title, 'Riff')
})

test('modo acoustic acepta fingerstyle o instrumento acustico', () => {
  const db = base()
  agregar(db, { instrument: 'Acoustic Guitar (nylon)', title: 'Nylon' })
  agregar(db, { instrument: 'Distortion Guitar', fingerstyle: 1, title: 'Fingerstyle' })
  agregar(db, { instrument: 'Distortion Guitar', title: 'Electrica' })

  const r = roll(db, { mode: 'acoustic' })
  assert.equal(r.matching, 2)
  assert.notEqual(r.song.title, 'Electrica')
})

test('modo solos busca Lead o Solo en el nombre del track', () => {
  const db = base()
  agregar(db, { trackName: 'Kirk Hammett | Lead Guitar', title: 'Con solo' })
  agregar(db, { trackName: 'Guitar Solo', title: 'Solo tambien' })
  agregar(db, { trackName: 'Rhythm Guitar', title: 'Sin solo' })

  const r = roll(db, { mode: 'solos' })
  assert.equal(r.matching, 2)
  assert.notEqual(r.song.title, 'Sin solo')
})

test('modo solos sortea entre las mas dificiles cuando hay muchas', () => {
  const db = base()
  // 60 canciones de dificultad 1..6 repartidas parejo.
  for (let i = 0; i < 60; i++) {
    agregar(db, { trackName: 'Lead Guitar', difficulty: (i % 6) + 1 })
  }
  const vistas = new Set()
  for (let i = 0; i < 60; i++) vistas.add(roll(db, { mode: 'solos' }).song.difficulty)

  // El tercio superior de 60 son 20 canciones: las de dificultad 6 y 5.
  assert.ok(Math.min(...vistas) >= 5, `salieron dificultades ${[...vistas].sort()}`)
})

test('modo solos con pocas candidatas no restringe el sorteo', () => {
  const db = base()
  for (let i = 0; i < 6; i++) agregar(db, { trackName: 'Lead Guitar', difficulty: i + 1 })

  const vistas = new Set()
  for (let i = 0; i < 200; i++) vistas.add(roll(db, { mode: 'solos' }).song.difficulty)
  assert.ok(vistas.size > 3, 'con menos de 20 candidatas deben poder salir todas')
})

test('una cancion descartada no vuelve a salir nunca', () => {
  const db = base()
  const id = agregar(db)
  db.prepare("INSERT INTO song_state (song_id, status, updated_at) VALUES (?, 'skipped', 'x')").run(id)

  const r = roll(db, {})
  assert.equal(r.song, null)
  assert.equal(r.matching, 0)
})

test('una cancion solo marcada como gustada si puede salir', () => {
  const db = base()
  const id = agregar(db)
  db.prepare('INSERT INTO song_state (song_id, liked, updated_at) VALUES (?, 1, ?)').run(id, 'x')

  assert.notEqual(roll(db, {}).song, null)
})

test('excluye basura del catalogo', () => {
  const db = base()
  agregar(db, { isJunk: 1 })
  agregar(db, { aiGenerated: 1 })
  agregar(db, { isBlank: 1 })
  agregar(db, { isPublished: 0 })

  assert.equal(roll(db, {}).matching, 0)
})

test('excluye lo que aun no se enriquece', () => {
  const db = base()
  const id = agregar(db)
  db.prepare('UPDATE songs SET enriched_at = NULL WHERE song_id = ?').run(id)

  assert.equal(roll(db, {}).matching, 0)
})

test('sin resultados devuelve un hint que dice cuanto se gana ampliando', () => {
  const db = base()
  agregar(db, { difficulty: 7 })

  const r = roll(db, { minDifficulty: 1, maxDifficulty: 2 })
  assert.equal(r.song, null)
  assert.match(r.hint, /1/)
})

test('con pocas restantes avisa, con hartas no molesta', () => {
  const db = base()
  for (let i = 0; i < 3; i++) agregar(db, { difficulty: 3 })
  assert.ok(roll(db, {}).hint, 'con 3 restantes deberia avisar')

  const db2 = base()
  for (let i = 0; i < 50; i++) agregar(db2, { difficulty: 3 })
  assert.equal(roll(db2, {}).hint, null)
})

test('trae los tags de la cancion', () => {
  const db = base()
  const id = agregar(db)
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'metal')").run(id)
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, '80s')").run(id)

  assert.deepEqual(roll(db, {}).song.tags.sort(), ['80s', 'metal'])
})

test('un modo desconocido es rechazado', () => {
  const db = base()
  agregar(db)
  assert.throws(() => roll(db, { mode: 'inventado' }), /modo/i)
})

// --- Seleccion de videos para el preview -------------------------------------
// Los 'feature' salen del catalogo real: null es el video oficial (canal
// "Artista - Topic"), backing es un karaoke, y alternative/solo/playthrough son
// re-subidas y pistas aisladas.

// El oficial va DELIBERADAMENTE al final: un videos[0] ingenuo no debe pasar.
const VIDEOS_REALES = JSON.stringify([
  { videoId: 'karaoke1111', feature: 'backing' },
  { videoId: 'resubida222', feature: 'alternative' },
  { videoId: 'soloaislado', feature: 'solo' },
  { videoId: 'basssolo333', feature: 'playthrough' },
  { videoId: 'oficial4444', feature: null },
])

test('officialVideo es el de feature null, no el primero del arreglo', () => {
  const db = base()
  agregar(db, { videos: VIDEOS_REALES })
  assert.equal(roll(db, {}).song.officialVideo, 'oficial4444')
})

test('backingVideo es el backing, no cualquier otro', () => {
  const db = base()
  agregar(db, { videos: VIDEOS_REALES })
  assert.equal(roll(db, {}).song.backingVideo, 'karaoke1111')
})

test('sin videos, ambos quedan en null', () => {
  const db = base()
  agregar(db, { videos: '[]' })
  const s = roll(db, {}).song
  assert.equal(s.officialVideo, null)
  assert.equal(s.backingVideo, null)
})

test('con videos pero sin oficial, officialVideo es null y backingVideo sigue', () => {
  const db = base()
  agregar(db, { videos: JSON.stringify([
    { videoId: 'karaoke1111', feature: 'backing' },
    { videoId: 'resubida222', feature: 'alternative' },
  ]) })
  const s = roll(db, {}).song
  assert.equal(s.officialVideo, null, 'no debe caer en el alternative como si fuera oficial')
  assert.equal(s.backingVideo, 'karaoke1111')
})

test('el arreglo crudo de videos ya no viaja al front', () => {
  const db = base()
  agregar(db, { videos: VIDEOS_REALES })
  const s = roll(db, {}).song
  assert.equal(s.videos, undefined, 'hasta 5,3 KB por cancion que no hacen falta')
})

test('las listas tambien traen los videos elegidos', () => {
  const db = base()
  const id = agregar(db, { videos: VIDEOS_REALES })
  mark(db, { songId: id, status: 'queued' })
  const fila = getList(db, 'queued')[0]
  assert.equal(fila.officialVideo, 'oficial4444')
  assert.equal(fila.backingVideo, 'karaoke1111')
})

// --- Ajustes de amplificador en el payload ----------------------------------

test('roll incluye los ajustes de ampli cuando hay senal util', () => {
  const db = base()
  const id = agregar(db, { instrument: 'Distortion Guitar', tuning: '[64,59,55,50,45,38]' })
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'thrash metal')").run(id)
  const s = roll(db, {}).song
  assert.equal(s.ampli.modelo, 'METAL 2000')
  assert.ok(s.ampli.gain >= 1 && s.ampli.gain <= 10)
  assert.ok(s.ampli.motivos.includes('thrash metal'))
  assert.ok(s.ampli.motivos.includes('Drop D'), 'debe usar la afinacion ya descrita')
})

test('roll deja ampli en null cuando los tags no dicen nada', () => {
  const db = base()
  const id = agregar(db)
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'rock')").run(id)
  assert.equal(roll(db, {}).song.ampli, null)
})

test('las listas tambien traen los ajustes', () => {
  const db = base()
  const id = agregar(db, { instrument: 'Acoustic Guitar (steel)' })
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'folk')").run(id)
  mark(db, { songId: id, status: 'queued' })
  assert.equal(getList(db, 'queued')[0].ampli.modelo, 'CHAMPION')
})

test('el payload trae los valores ya convertidos para el amplificador', () => {
  const db = base()
  const id = agregar(db, { instrument: 'Distortion Guitar' })
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'thrash metal')").run(id)
  const a = roll(db, {}).song.ampli
  assert.ok(a.paraElAmpli, 'deberia venir listo para mandar')
  assert.ok(a.paraElAmpli.gain > 0 && a.paraElAmpli.gain <= 1)
  assert.equal(a.paraElAmpli.volume, undefined, 'el volumen no se manda')
})
