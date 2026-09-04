import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'

test('crea las cuatro tablas', () => {
  const db = openDb(':memory:')
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name)
  for (const t of ['songs', 'song_state', 'tags', 'tracks']) {
    assert.ok(names.includes(t), `falta la tabla ${t}`)
  }
})

test('borrar el catalogo no borra el historial', () => {
  const db = openDb(':memory:')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (?, ?, ?, ?)'
  ).run(1, 10, 'Metallica', 'One')
  db.prepare(
    "INSERT INTO song_state (song_id, status, updated_at) VALUES (?, 'skipped', '2026-09-03')"
  ).run(1)

  db.exec('DELETE FROM songs')

  const state = db.prepare('SELECT status FROM song_state WHERE song_id = 1').get()
  assert.equal(state.status, 'skipped')
})

test('borrar una cancion si borra sus tracks y tags', () => {
  const db = openDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (1, 10, ?, ?)'
  ).run('Metallica', 'One')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument) VALUES (1, 0, ?)'
  ).run('Distortion Guitar')
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (1, 'metal')").run()

  db.exec('DELETE FROM songs WHERE song_id = 1')

  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 0)
})

test('rechaza un status invalido', () => {
  const db = openDb(':memory:')
  assert.throws(() => {
    db.prepare(
      "INSERT INTO song_state (song_id, status, updated_at) VALUES (1, 'inventado', '2026-09-03')"
    ).run()
  })
})
