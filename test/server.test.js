import { test } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync, unlinkSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
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

/* La cancion que conApp siembra es dificultad 4 y con distorsion, asi que un
   filtro de acustico 1-2 la deja fuera. Es exactamente el par que hace falta:
   una consulta que no devuelve nada, y la misma con todo=1 que si. */
test('/api/roll?todo=1 ignora los filtros que vengan en la query', () => conApp(async url => {
  const filtrado = await (await fetch(`${url}/api/roll?mode=acoustic&maxDifficulty=2`)).json()
  assert.equal(filtrado.song, null)
  assert.equal(filtrado.matching, 0)

  const todo = await (await fetch(`${url}/api/roll?mode=acoustic&maxDifficulty=2&todo=1`)).json()
  assert.equal(todo.song.title, 'One')
  assert.equal(todo.matching, 1)
}))

test('una ruta desconocida devuelve 404', () => conApp(async url => {
  assert.equal((await fetch(`${url}/api/nada`)).status, 404)
}))

test('sirve index.html en la raiz', () => conApp(async url => {
  const res = await fetch(`${url}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
}))

test('rechaza intentos de salir de public/', () => conApp(async url => {
  for (const ruta of ['/../package.json', '/../../etc/hosts', '/..%2fpackage.json', '/public/../server.js']) {
    const res = await fetch(`${url}${ruta}`, { redirect: 'manual' })
    assert.equal(res.status, 404, `${ruta} no debe servirse`)
  }
}))

test('un directorio hermano con nombre parecido no cuela', async () => {
  // RAIZ viene de realpath, que quita la barra final. Comparar con
  // startsWith(RAIZ) a secas dejaria pasar "publicfoo": este test lo fija.
  const hermano = fileURLToPath(new URL('../publicfoo', import.meta.url))
  mkdirSync(hermano, { recursive: true })
  writeFileSync(join(hermano, 'x.html'), 'secreto')
  try {
    await conApp(async url => {
      const res = await fetch(`${url}/../publicfoo/x.html`, { redirect: 'manual' })
      assert.equal(res.status, 404)
    })
  } finally {
    rmSync(hermano, { recursive: true, force: true })
  }
})

test('no sirve un symlink que apunta fuera de public/', async () => {
  const enlace = fileURLToPath(new URL('../public/fuga.html', import.meta.url))
  const afuera = fileURLToPath(new URL('../package.json', import.meta.url))
  symlinkSync(afuera, enlace)
  try {
    await conApp(async url => {
      const res = await fetch(`${url}/fuga.html`)
      assert.equal(res.status, 404, 'el symlink no debe servir el archivo de afuera')
    })
  } finally {
    unlinkSync(enlace)
  }
})

test('GET /api/buscar encuentra la cancion por nombre', () => conApp(async url => {
  const { songs } = await (await fetch(`${url}/api/buscar?q=one`)).json()
  assert.equal(songs.length, 1)
  assert.deepEqual(songs[0], { songId: 1, artist: 'Metallica', title: 'One' })
}))

test('GET /api/buscar sin q no devuelve nada, y no revienta', () => conApp(async url => {
  const res = await fetch(`${url}/api/buscar`)
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).songs, [])
}))

test('GET /api/song devuelve la tarjeta entera de esa cancion', () => conApp(async url => {
  const { song } = await (await fetch(`${url}/api/song?songId=1`)).json()
  assert.equal(song.title, 'One')
  assert.ok(song.pistas.length > 0, 'trae sus pistas')
  assert.ok(song.pistas.every(p => p.califica), 'sin filtro, todas califican')
}))

/* Pedir una cancion que no existe es un error del cliente, no una tarjeta
   vacia: `song: null` se confundiria con "el sorteo no encontro nada". */
test('GET /api/song con un id que no existe da 404', () => conApp(async url => {
  const res = await fetch(`${url}/api/song?songId=99999`)
  assert.equal(res.status, 404)
  // Su propio mensaje, no el 404 generico de /api/: sin esto el test pasaria
  // sin que la ruta exista siquiera.
  assert.match((await res.json()).error, /cancion/)
}))

test('GET /api/song sin songId da 400', () => conApp(async url => {
  const res = await fetch(`${url}/api/song`)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /songId/)
}))

test('PUT /api/tono guarda y GET lo devuelve', () => conApp(async (url, db) => {
  const put = await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      cadena: { amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } } },
      origen: 'leido',
    }),
  })
  assert.equal(put.status, 200)

  const q = new URLSearchParams({
    songId: '1', trackIndex: '0',
    instrument: 'Distortion Guitar', name: 'Lead Guitar',
  })
  const leido = await (await fetch(`${url}/api/tono?${q}`)).json()
  assert.equal(leido.tono.cadena.amp.nombre, 'TWIN CLEAN')
  assert.equal(leido.tono.desfasada, false)
}))

test('GET /api/tono avisa cuando la pista ya no es la que se guardo', () => conApp(async url => {
  await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      cadena: { amp: { nombre: 'TWIN CLEAN', valores: {} } }, origen: 'leido',
    }),
  })
  const q = new URLSearchParams({
    songId: '1', trackIndex: '0',
    instrument: 'Distortion Guitar', name: 'OTRA PISTA',
  })
  const leido = await (await fetch(`${url}/api/tono?${q}`)).json()
  assert.equal(leido.tono.desfasada, true)
}))

test('PUT /api/tono sin songId entero responde 400', () => conApp(async url => {
  const r = await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trackIndex: 0 }),
  })
  assert.equal(r.status, 400)
}))

test('DELETE /api/tono devuelve la pista a no tener tono propio', () => conApp(async url => {
  const cuerpo = {
    songId: 1, trackIndex: 0,
    instrument: 'Distortion Guitar', name: 'Lead Guitar',
    cadena: { amp: { nombre: 'TWIN CLEAN', valores: {} } }, origen: 'leido',
  }
  await fetch(`${url}/api/tono`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const del = await fetch(`${url}/api/tono`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: 1, trackIndex: 0 }),
  })
  assert.equal(del.status, 200)
  const q = new URLSearchParams({ songId: '1', trackIndex: '0', instrument: 'Distortion Guitar', name: 'Lead Guitar' })
  assert.equal((await (await fetch(`${url}/api/tono?${q}`)).json()).tono, null)
}))

test('POST /api/juicio guarda el veredicto', () => conApp(async (url, db) => {
  const r = await fetch(`${url}/api/juicio`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      eje: 'suciedad', direccion: 'sobra',
      juzgado: { amp: { nombre: '90S ROCK' } },
      fuente: 'comunidad', sugeridor: 'v1',
    }),
  })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tone_judgment').get().n, 1)
}))
