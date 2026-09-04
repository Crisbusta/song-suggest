import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchJson, runPool } from '../etl/http.js'

// Levanta un servidor local cuyo comportamiento define `handler`.
async function conServidor(handler, fn) {
  const server = createServer(handler)
  await new Promise(r => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  try { return await fn(url) } finally { server.close() }
}

const sinEspera = () => Promise.resolve()

test('devuelve el JSON cuando responde bien', async () => {
  const r = await conServidor(
    (req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') },
    url => fetchJson(url, { sleep: sinEspera })
  )
  assert.deepEqual(r, { ok: true })
})

test('reintenta ante un 500 y termina saliendo bien', async () => {
  let intentos = 0
  const r = await conServidor(
    (req, res) => {
      intentos++
      if (intentos < 3) { res.statusCode = 500; return res.end('boom') }
      res.end('{"ok":true}')
    },
    url => fetchJson(url, { sleep: sinEspera })
  )
  assert.deepEqual(r, { ok: true })
  assert.equal(intentos, 3)
})

test('ante 429 espera mas que ante un 500', async () => {
  const esperas = []
  const sleep = ms => { esperas.push(ms); return Promise.resolve() }
  await conServidor(
    (req, res) => { res.statusCode = 429; res.end('slow down') },
    url => fetchJson(url, { retries: 2, baseDelayMs: 100, sleep }).catch(() => {})
  )
  assert.ok(esperas.length > 0, 'deberia haber esperado')
  assert.ok(esperas[0] >= 400, `un 429 debe esperar harto, espero ${esperas[0]}ms`)
})

test('el backoff crece entre intentos', async () => {
  const esperas = []
  const sleep = ms => { esperas.push(ms); return Promise.resolve() }
  await conServidor(
    (req, res) => { res.statusCode = 500; res.end('boom') },
    url => fetchJson(url, { retries: 3, baseDelayMs: 100, sleep }).catch(() => {})
  )
  assert.equal(esperas.length, 2)
  assert.ok(esperas[1] > esperas[0], 'la segunda espera debe ser mayor')
})

test('lanza error cuando se agotan los reintentos', async () => {
  await conServidor(
    (req, res) => { res.statusCode = 500; res.end('boom') },
    async url => {
      await assert.rejects(
        () => fetchJson(url, { retries: 2, sleep: sinEspera }),
        /500/
      )
    }
  )
})

test('un 404 no se reintenta', async () => {
  let intentos = 0
  await conServidor(
    (req, res) => { intentos++; res.statusCode = 404; res.end('nope') },
    async url => { await assert.rejects(() => fetchJson(url, { sleep: sinEspera })) }
  )
  assert.equal(intentos, 1)
})

test('runPool respeta el limite de concurrencia', async () => {
  let enVuelo = 0
  let maximo = 0
  await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    enVuelo++
    maximo = Math.max(maximo, enVuelo)
    await new Promise(r => setTimeout(r, 5))
    enVuelo--
  })
  assert.ok(maximo <= 3, `llego a ${maximo} en vuelo`)
  assert.ok(maximo > 1, 'deberia haber paralelismo real')
})

test('runPool procesa todos los elementos', async () => {
  const vistos = []
  await runPool(['a', 'b', 'c'], 2, async x => { vistos.push(x) })
  assert.deepEqual(vistos.sort(), ['a', 'b', 'c'])
})
