import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { enrichPending } from '../etl/meta.js'

function conCatalogo(n) {
  const db = openDb(':memory:')
  const ins = db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title, catalog_rank) VALUES (?, 1, ?, ?, ?)'
  )
  for (let i = 0; i < n; i++) ins.run(i + 1, `A${i}`, `T${i}`, i)
  return db
}

const metaFalsa = songId => Promise.resolve({
  songId, views: 1000 + songId, fingerstyle: songId % 2 === 0,
  hasChords: true, aiGenerated: false, isJunk: false, isBlank: false, isPublished: true,
  tags: ['rock', 'metal'],
  videos: [{ id: 1, status: 'done', feature: 'backing', videoId: 'abc123' }],
})

test('enriquece las canciones pendientes', async () => {
  const db = conCatalogo(5)
  const r = await enrichPending(db, { fetchMeta: metaFalsa })

  assert.equal(r.ok, 5)
  assert.equal(r.failed, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs WHERE enriched_at IS NOT NULL').get().c, 5)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 10)

  const s = db.prepare('SELECT * FROM songs WHERE song_id = 2').get()
  assert.equal(s.views, 1002)
  assert.equal(s.fingerstyle, 1)
  assert.deepEqual(JSON.parse(s.videos), [{ videoId: 'abc123', feature: 'backing' }])
})

test('es reanudable: no re-pide lo ya enriquecido', async () => {
  const db = conCatalogo(5)
  await enrichPending(db, { fetchMeta: metaFalsa })

  const pedidos = []
  const r = await enrichPending(db, {
    fetchMeta: id => { pedidos.push(id); return metaFalsa(id) },
  })
  assert.deepEqual(pedidos, [])
  assert.equal(r.ok, 0)
})

test('procesa en orden de popularidad', async () => {
  const db = conCatalogo(5)
  const pedidos = []
  await enrichPending(db, {
    fetchMeta: id => { pedidos.push(id); return metaFalsa(id) },
    concurrency: 1,
    limit: 3,
  })
  assert.deepEqual(pedidos, [1, 2, 3])
})

test('una cancion que falla no detiene el resto', async () => {
  const db = conCatalogo(5)
  const r = await enrichPending(db, {
    fetchMeta: id => (id === 3 ? Promise.reject(new Error('HTTP 500')) : metaFalsa(id)),
  })

  assert.equal(r.ok, 4)
  assert.equal(r.failed, 1)
  assert.deepEqual(r.failures, [3])
  assert.equal(db.prepare('SELECT enriched_at FROM songs WHERE song_id = 3').get().enriched_at, null)
})

test('re-enriquecer reemplaza los tags viejos en vez de acumularlos', async () => {
  const db = conCatalogo(1)
  await enrichPending(db, { fetchMeta: metaFalsa })
  db.prepare('UPDATE songs SET enriched_at = NULL').run()
  await enrichPending(db, { fetchMeta: metaFalsa })

  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags WHERE song_id = 1').get().c, 2)
})

test('respeta el limite', async () => {
  const db = conCatalogo(10)
  const r = await enrichPending(db, { fetchMeta: metaFalsa, limit: 4 })
  assert.equal(r.ok, 4)
})
