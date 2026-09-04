import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/open.js'
import { roll, mark, getList, getStats } from './db/queries.js'

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function leerCuerpo(req) {
  const trozos = []
  for await (const t of req) trozos.push(t)
  try { return JSON.parse(Buffer.concat(trozos).toString() || '{}') } catch { return null }
}

export function createApp(db) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const ruta = url.pathname

    try {
      if (ruta === '/api/roll') {
        const entero = (n, def) => {
          const v = Number(url.searchParams.get(n))
          return Number.isInteger(v) && v >= 1 && v <= 10 ? v : def
        }
        return json(res, 200, roll(db, {
          mode: url.searchParams.get('mode') ?? 'surprise',
          minDifficulty: entero('minDifficulty', 1),
          maxDifficulty: entero('maxDifficulty', 10),
        }))
      }

      if (ruta === '/api/mark' && req.method === 'POST') {
        const body = await leerCuerpo(req)
        if (!body || !Number.isInteger(body.songId)) {
          return json(res, 400, { error: 'falta songId' })
        }
        mark(db, body)
        return json(res, 200, { ok: true })
      }

      if (ruta === '/api/lists') {
        return json(res, 200, { songs: getList(db, url.searchParams.get('list')) })
      }

      if (ruta === '/api/stats') return json(res, 200, getStats(db))

      if (ruta.startsWith('/api/')) return json(res, 404, { error: 'no existe' })

      // Estaticos, con normalize para no salir de public/.
      const rel = normalize(ruta === '/' ? 'index.html' : ruta).replace(/^(\.\.[/\\])+/, '')
      const archivo = join(PUBLIC, rel)
      if (!archivo.startsWith(PUBLIC) || !existsSync(archivo)) {
        res.writeHead(404); return res.end('no existe')
      }
      res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
      return res.end(await readFile(archivo))
    } catch (err) {
      // Un modo o una lista invalida es culpa del cliente, no del servidor.
      const esValidacion = /desconocid[oa]/i.test(err.message)
      return json(res, esValidacion ? 400 : 500, { error: err.message })
    }
  })
}

// Arranque solo cuando se ejecuta directo, no cuando lo importa un test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync('songs.db')) {
    console.error('No existe songs.db. Corre primero:  npm run etl')
    process.exit(1)
  }
  const db = openDb('songs.db')
  const { enriched, available } = getStats(db)
  if (enriched === 0) {
    console.error('La base esta vacia. Corre primero:  npm run etl')
    process.exit(1)
  }
  createApp(db).listen(3000, () => {
    console.log(`song-suggest en http://localhost:3000  (${available} canciones disponibles)`)
  })
}
