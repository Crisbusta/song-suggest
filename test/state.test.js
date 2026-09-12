import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll, mark, getList, getStats } from '../db/queries.js'

let siguienteId = 1

function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, 0, 0, 0, 0, 1, '[]', ?)
  `).run(songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId,
         o.enriched === false ? null : '2026-09-03')
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (?, 0, 'Distortion Guitar', 'Rhythm Guitar', ?, 1000, '[64,59,55,50,45,40]')
  `).run(songId, o.difficulty ?? 3)
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

test('marcar crea la fila si no existia', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'learned' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.status, 'learned')
  assert.equal(s.liked, 0)
})

test('status y liked son independientes', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, liked: true })
  mark(db, { songId: id, status: 'skipped' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.status, 'skipped')
  assert.equal(s.liked, 1, 'marcar status no debe borrar el like')
})

test('marcar solo status no pisa el like, y viceversa', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'learned', liked: true })
  mark(db, { songId: id, status: 'queued' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.liked, 1)
  assert.equal(s.status, 'queued')
})

test('status null devuelve la cancion al sorteo', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(roll(db, {}).matching, 0)

  mark(db, { songId: id, status: null })
  assert.equal(roll(db, {}).matching, 1)
})

test('sortear incrementa shown_count', () => {
  const db = base()
  const id = agregar(db)
  roll(db, {})
  roll(db, {})

  assert.equal(db.prepare('SELECT shown_count FROM song_state WHERE song_id = ?').get(id).shown_count, 2)
})

test('shown_count no saca la cancion del sorteo', () => {
  const db = base()
  agregar(db)
  roll(db, {})
  assert.equal(roll(db, {}).matching, 1)
})

test('las listas devuelven lo marcado, con forma de cancion', () => {
  const db = base()
  const a = agregar(db, { title: 'Aprendida' })
  const b = agregar(db, { title: 'Descartada' })
  const c = agregar(db, { title: 'Para despues' })
  mark(db, { songId: a, status: 'learned', liked: true })
  mark(db, { songId: b, status: 'skipped' })
  mark(db, { songId: c, status: 'queued' })

  assert.deepEqual(getList(db, 'learned').map(s => s.title), ['Aprendida'])
  assert.deepEqual(getList(db, 'skipped').map(s => s.title), ['Descartada'])
  assert.deepEqual(getList(db, 'queued').map(s => s.title), ['Para despues'])
  assert.deepEqual(getList(db, 'liked').map(s => s.title), ['Aprendida'])

  const fila = getList(db, 'learned')[0]
  assert.equal(fila.pistas[fila.pistaPorDefecto].difficulty, 3)
  assert.match(fila.url, /songsterr/)
})

test('una lista vacia devuelve arreglo vacio', () => {
  const db = base()
  assert.deepEqual(getList(db, 'queued'), [])
})

test('una lista desconocida es rechazada', () => {
  const db = base()
  assert.throws(() => getList(db, 'inventada'), /lista/i)
})

test('stats cuenta total, enriquecidas y disponibles', () => {
  const db = base()
  agregar(db)
  agregar(db)
  const c = agregar(db, { enriched: false })
  const d = agregar(db)
  mark(db, { songId: d, status: 'skipped' })

  const s = getStats(db)
  assert.equal(s.total, 4)
  assert.equal(s.enriched, 3)
  assert.equal(s.pending, 1)
  assert.equal(s.available, 2, 'enriquecidas menos las ya decididas')
})
