import { openDb } from '../db/open.js'
import { fetchJson } from './http.js'
import { fetchCatalog } from './catalog.js'
import { enrichPending } from './meta.js'

const BASE = 'https://www.songsterr.com/api'

const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const valor = (n, porDefecto) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : porDefecto
}

const db = openDb('songs.db')

if (!flag('solo-meta')) {
  console.log('Fase 1: bajando el catalogo...')
  const r = await fetchCatalog(db, {
    fetchPage: (from, size) => fetchJson(`${BASE}/songs?pattern=&size=${size}&from=${from}`),
    onProgress: p => process.stdout.write(`\r  ${p.songs} canciones (${p.pages} paginas)`),
  })
  console.log(`\n  Listo: ${r.songs} canciones.`)
}

if (!flag('solo-catalogo')) {
  const pendientes = db.prepare('SELECT COUNT(*) c FROM songs WHERE enriched_at IS NULL').get().c
  const limite = valor('limit', Infinity)
  console.log(`Fase 2: enriqueciendo (${pendientes} pendientes). Ctrl-C es seguro, se retoma.`)

  const r = await enrichPending(db, {
    fetchMeta: songId => fetchJson(`${BASE}/meta/${songId}`),
    concurrency: valor('concurrency', 3),
    limit: limite,
    onProgress: p => process.stdout.write(`\r  ${p.ok}/${p.total} ok, ${p.failed} fallidas`),
  })
  console.log(`\n  Listo: ${r.ok} enriquecidas, ${r.failed} fallidas.`)
  if (r.failed > 0) console.log(`  IDs fallidos: ${r.failures.slice(0, 20).join(', ')}`)
}

const stats = db.prepare(`
  SELECT COUNT(*) total, SUM(enriched_at IS NOT NULL) enriched FROM songs
`).get()
console.log(`\nBase: ${stats.enriched}/${stats.total} canciones listas para sortear.`)
