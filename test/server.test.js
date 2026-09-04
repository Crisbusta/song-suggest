import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { createApp } from '../server.js'

function conApp(fn) {
  const db = openDb(':memory:')
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_published, videos, enriched_at)
    VALUES (1, 1, 'Metallica', 'One', 100, 0, 0, 1, '[]', '2026-09-03')
  `).run()
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (1, 0, 'Distortion Guitar', 'Lead Guitar', 4, 1000, '[64,59,55,50,45,40]')
  `).run()

  const server = createApp(db)
  return new Promise((resolve, reject) => {
    server.listen(0, async () => {
      const url = `http://127.0.0.1:${server.address().port}`
      try { resolve(await fn(url, db)) } catch (e) { reject(e) } finally { server.close() }
    })
  })
}

test('GET /api/roll devuelve song, matching y hint', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.song.title, 'One')
  assert.equal(body.matching, 1)
  assert.ok('hint' in body)
}))

test('GET /api/roll respeta los filtros del query string', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll?minDifficulty=1&maxDifficulty=2`)
  const body = await res.json()
  assert.equal(body.song, null)
  assert.equal(body.matching, 0)
}))

test('un modo invalido devuelve 400, no 500', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll?mode=inventado`)
  assert.equal(res.status, 400)
  assert.ok((await res.json()).error)
}))

test('POST /api/mark guarda el estado', () => conApp(async (url, db) => {
  const res = await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: 1, status: 'learned', liked: true }),
  })
  assert.equal(res.status, 200)
  const s = db.prepare('SELECT * FROM song_state WHERE song_id = 1').get()
  assert.equal(s.status, 'learned')
  assert.equal(s.liked, 1)
}))

test('POST /api/mark sin songId devuelve 400', () => conApp(async url => {
  const res = await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'learned' }),
  })
  assert.equal(res.status, 400)
}))

test('GET /api/lists devuelve la lista pedida', () => conApp(async url => {
  await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: 1, status: 'queued' }),
  })
  const body = await (await fetch(`${url}/api/lists?list=queued`)).json()
  assert.equal(body.songs.length, 1)
  assert.equal(body.songs[0].title, 'One')
}))

test('GET /api/stats responde los cuatro contadores', () => conApp(async url => {
  const body = await (await fetch(`${url}/api/stats`)).json()
  assert.deepEqual(Object.keys(body).sort(), ['available', 'enriched', 'pending', 'total'])
}))

test('una ruta desconocida devuelve 404', () => conApp(async url => {
  assert.equal((await fetch(`${url}/api/nada`)).status, 404)
}))

test('sirve index.html en la raiz', () => conApp(async url => {
  const res = await fetch(`${url}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
}))
