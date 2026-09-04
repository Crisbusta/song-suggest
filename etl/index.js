import { fileURLToPath } from 'node:url'
import { openDb } from '../db/open.js'
import { fetchJson } from './http.js'
import { fetchCatalog } from './catalog.js'
import { enrichPending } from './meta.js'

const BASE = 'https://www.songsterr.com/api'

const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const valor = (n, porDefecto) => {
  const i = args.indexOf(`--${n}`)
  if (i < 0 || !args[i + 1]) return porDefecto
  const v = Number(args[i + 1])
  // Un typo no debe convertirse en "sin limite": eso dispara una corrida
  // completa de ~1 hora contra Songsterr en vez de la prueba que se pidio.
  if (!Number.isInteger(v) || v < 1) {
    console.error(`--${n} necesita un entero mayor que 0, recibi "${args[i + 1]}"`)
    process.exit(1)
  }
  return v
}

// Se resuelven AQUI, antes de abrir la base y antes de tocar la red: una
// bandera mal escrita debe morir en el primer milisegundo, no despues de
// bajar 50 paginas de catalogo. `valor` sale con exit(1) si el valor es malo.
const limite = valor('limit', Infinity)
const concurrencia = valor('concurrency', 3)

// Relativo al archivo, no al cwd: correr `node etl/index.js` desde otra
// carpeta no debe empezar una bajada nueva en un songs.db distinto.
const db = openDb(fileURLToPath(new URL('../songs.db', import.meta.url)))

if (flag('re-enriquecer')) {
  const n = db.prepare('UPDATE songs SET enriched_at = NULL').run().changes
  console.log(`Marcadas ${n} canciones para re-enriquecer.`)
}

if (!flag('solo-meta')) {
  console.log('Fase 1: bajando el catalogo...')
  try {
    const r = await fetchCatalog(db, {
      fetchPage: (from, size) => fetchJson(`${BASE}/songs?pattern=&size=${size}&from=${from}`),
      onProgress: p => process.stdout.write(`\r  ${p.songs} canciones (${p.pages} paginas)`),
    })
    console.log(`\n  Listo: ${r.songs} canciones.`)
  } catch (err) {
    // Que la fase 1 falle no debe impedir enriquecer lo que ya hay en la base.
    console.error(`\n  Fase 1 fallo: ${err.message}`)
    console.error('  Sigo con la fase 2 sobre lo que ya esta en la base.')
  }
}

if (!flag('solo-catalogo')) {
  const pendientes = db.prepare('SELECT COUNT(*) c FROM songs WHERE enriched_at IS NULL').get().c
  console.log(`Fase 2: enriqueciendo (${pendientes} pendientes). Ctrl-C es seguro, se retoma.`)

  const r = await enrichPending(db, {
    fetchMeta: songId => fetchJson(`${BASE}/meta/${songId}`),
    concurrency: concurrencia,
    limit: limite,
    onProgress: p => process.stdout.write(`\r  ${p.ok}/${p.total} ok, ${p.failed} fallidas`),
  })
  console.log(`\n  Listo: ${r.ok} enriquecidas, ${r.failed} fallidas.`)
  if (r.failed > 0) {
    console.log(`  IDs fallidos: ${r.failures.slice(0, 20).join(', ')}`)
    for (const [motivo, n] of r.motivos) console.log(`    ${n}x  ${motivo}`)
  }
}

const stats = db.prepare(`
  SELECT COUNT(*) total, SUM(enriched_at IS NOT NULL) enriched FROM songs
`).get()
console.log(`\nBase: ${stats.enriched}/${stats.total} canciones listas para sortear.`)
