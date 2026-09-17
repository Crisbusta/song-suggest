import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/open.js'
import { roll, mark, getList, getStats, listarArtistas, buscarCanciones, getSong } from './db/queries.js'
import { guardarTono, leerTono, borrarTono, guardarJuicio } from './db/tono-usuario.js'

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))
const RAIZ = realpathSync(PUBLIC)   // sin barra final: realpath la quita
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
        /* Las bandas llegan repetidas en la query (`?artist=Rush&artist=Tool`)
           y no separadas por coma. No es estilo: medido sobre las canciones
           sorteables, 21 artistas traen una coma en el nombre -- "Crosby,
           Stills, Nash & Young", "Earth, Wind & Fire", "Emerson, Lake &
           Palmer" -- y partir por coma cortaria cada uno en varias bandas que
           no existen, dejando al usuario sin ninguna de sus canciones. */
        /* El sorteo de todo: ignora modo, dificultad y bandas sin tocar los
           controles, para que al volver la configuracion siga donde se dejo.
           No es un modo nuevo en MODES: los modos son criterios de filtrado y
           este es su ausencia, que es exactamente lo que roll() hace con sus
           parametros por defecto. */
        if (url.searchParams.get('todo') === '1') return json(res, 200, roll(db, {}))

        return json(res, 200, roll(db, {
          mode: url.searchParams.get('mode') ?? 'surprise',
          minDifficulty: entero('minDifficulty', 1),
          maxDifficulty: entero('maxDifficulty', 10),
          artists: url.searchParams.getAll('artist').filter(Boolean),
        }))
      }

      if (ruta === '/api/artists') return json(res, 200, { artists: listarArtistas(db) })

      /* Buscar es una CONSULTA, no un sorteo: no toca song_state y encuentra
         tambien lo que ya descartaste (ver buscarCanciones en db/queries.js).
         Sin `q` devuelve la lista vacia en vez de un 400: la caja arranca
         vacia y preguntar con nada escrito no es un error del cliente. */
      if (ruta === '/api/buscar') {
        return json(res, 200, { songs: buscarCanciones(db, url.searchParams.get('q') ?? '') })
      }

      if (ruta === '/api/song') {
        /* `Number(null)` es 0 y 0 es un entero, asi que mirar solo el numero
           dejaba pasar la peticion SIN songId y la contestaba con un 404 de
           "no existe esa cancion" -- que es mentira: no se pidio ninguna. */
        const crudo = url.searchParams.get('songId')
        const songId = Number(crudo)
        if (crudo === null || !Number.isInteger(songId) || songId < 1) {
          return json(res, 400, { error: 'falta songId' })
        }
        const song = getSong(db, songId)
        // 404 y no `song: null`, que se confundiria con "el sorteo no encontro
        // nada": pedir una cancion por id que no existe es otra cosa.
        if (!song) return json(res, 404, { error: 'no existe esa cancion' })
        return json(res, 200, { song })
      }

      if (ruta === '/api/mark' && req.method === 'POST') {
        const body = await leerCuerpo(req)
        if (!body || !Number.isInteger(body.songId)) {
          return json(res, 400, { error: 'falta songId' })
        }
        mark(db, body)
        return json(res, 200, { ok: true })
      }

      /* El tono del usuario. `instrument` y `name` viajan tambien en el GET
         porque `leerTono` los necesita para decidir si la fila quedo
         desfasada -- sin ellos habria que confiar en el track_index a secas,
         que es justo lo que la firma existe para no hacer. */
      if (ruta === '/api/tono') {
        if (req.method === 'GET') {
          const songId = Number(url.searchParams.get('songId'))
          const trackIndex = Number(url.searchParams.get('trackIndex'))
          if (!Number.isInteger(songId) || !Number.isInteger(trackIndex)) {
            return json(res, 400, { error: 'falta songId o trackIndex' })
          }
          return json(res, 200, { tono: leerTono(db, {
            songId, trackIndex,
            instrument: url.searchParams.get('instrument'),
            name: url.searchParams.get('name'),
          }) })
        }
        if (req.method === 'PUT') {
          const body = await leerCuerpo(req)
          if (!body || !Number.isInteger(body.songId) || !Number.isInteger(body.trackIndex) || !body.cadena) {
            return json(res, 400, { error: 'falta songId, trackIndex o cadena' })
          }
          guardarTono(db, body)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          const body = await leerCuerpo(req)
          if (!body || !Number.isInteger(body.songId) || !Number.isInteger(body.trackIndex)) {
            return json(res, 400, { error: 'falta songId o trackIndex' })
          }
          borrarTono(db, body)
          return json(res, 200, { ok: true })
        }
      }

      if (ruta === '/api/juicio' && req.method === 'POST') {
        const body = await leerCuerpo(req)
        if (!body || !Number.isInteger(body.songId) || !body.eje || !body.direccion) {
          return json(res, 400, { error: 'falta songId, eje o direccion' })
        }
        guardarJuicio(db, body)
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
      // startsWith es lexico: un symlink dentro de public/ apuntando afuera lo
      // pasaria igual. realpath resuelve el destino real antes de servir nada.
      // Se compara contra RAIZ + sep para que un hermano llamado "publicfoo"
      // tampoco cuele.
      const real = realpathSync(archivo)
      if (real !== RAIZ && !real.startsWith(RAIZ + sep)) {
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
  // Relativo al archivo, no al cwd: correr `node server.js` desde otra
  // carpeta no debe apuntar a un songs.db distinto del real.
  const SONGS_DB = new URL('./songs.db', import.meta.url)
  if (!existsSync(SONGS_DB)) {
    console.error('No existe songs.db. Corre primero:  npm run etl')
    process.exit(1)
  }
  const db = openDb(SONGS_DB)
  const { enriched, available } = getStats(db)
  if (enriched === 0) {
    console.error('La base esta vacia. Corre primero:  npm run etl')
    process.exit(1)
  }
  createApp(db).listen(3000, () => {
    console.log(`song-suggest en http://localhost:3000  (${available} canciones disponibles)`)
  })
}
