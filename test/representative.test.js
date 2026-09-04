import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'

// Tracks reales de Master of Puppets (songId 455118).
const TRACKS = [
  [0, 'Baritone Sax',             'James Hetfield | Lead Vocals',  null, 1206],
  [1, 'Distortion Guitar',        'Kirk Hammett | Lead Guitar',       4, 106543],
  [2, 'Distortion Guitar',        'James Hetfield | Delay',           7, 1525],
  [3, 'Electric Guitar (clean)',  'James & Kirk | Clean Guitar',      2, 21291],
  [4, 'Distortion Guitar',        'Kirk & James | Extra Guitars',     3, 3281],
  [5, 'Electric Bass (finger)',   'Cliff Burton | Bass',              6, 318294],
]

function conMasterOfPuppets() {
  const db = openDb(':memory:')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (455118, 20, ?, ?)'
  ).run('Metallica', 'Master of Puppets')
  const ins = db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (455118, ?, ?, ?, ?, ?)'
  )
  for (const t of TRACKS) ins.run(...t)
  return db
}

test('elige el track de guitarra mas tocado, ignorando el bajo', () => {
  const db = conMasterOfPuppets()
  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 455118').get()
  assert.equal(r.name, 'Kirk Hammett | Lead Guitar')
  assert.equal(r.difficulty, 4)
  assert.equal(r.instrument, 'Distortion Guitar')
})

test('devuelve exactamente una fila por cancion', () => {
  const db = conMasterOfPuppets()
  const { c } = db.prepare('SELECT COUNT(*) c FROM representative_track').get()
  assert.equal(c, 1)
})

test('ignora tracks de guitarra sin dificultad', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (1, 1, ?, ?)')
    .run('X', 'Y')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (1, 0, ?, ?, NULL, 99999)'
  ).run('Distortion Guitar', 'Sin dificultad')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (1, 1, ?, ?, 3, 10)'
  ).run('Distortion Guitar', 'Con dificultad')

  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 1').get()
  assert.equal(r.name, 'Con dificultad')
})

test('una cancion sin guitarra no aparece', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (2, 1, ?, ?)')
    .run('X', 'Solo bajo')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, difficulty, views) VALUES (2, 0, ?, 5, 100)'
  ).run('Electric Bass (finger)')

  assert.equal(db.prepare('SELECT * FROM representative_track WHERE song_id = 2').get(), undefined)
})

test('desempata por track_index para ser determinista', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (3, 1, ?, ?)')
    .run('X', 'Empate')
  const ins = db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (3, ?, ?, ?, ?, 500)'
  )
  ins.run(1, 'Distortion Guitar', 'segundo', 6)
  ins.run(0, 'Distortion Guitar', 'primero', 2)

  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 3').get()
  assert.equal(r.name, 'primero')
})
