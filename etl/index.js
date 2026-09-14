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

/* `--patron` se puede repetir: `--patron "los prisioneros" --patron "victor jara"`.
   No usa `valor` porque eso exige un entero. Un `--patron` sin texto detras es
   un typo y muere aca, igual que los demas. */
const textos = n => args.flatMap((a, i) => {
  if (a !== `--${n}`) return []
  const v = args[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`--${n} necesita un texto detras`)
    process.exit(1)
  }
  return [v]
})
const patrones = textos('patron')

/* El catalogo global ocupa los rank 0..9.999. Lo que solo aparece buscando por
   patron va despues, y cada patron en su propio tramo para no pisarse entre
   ellos: asi la cola de enriquecimiento sigue siendo "lo popular primero" y un
   Ctrl-C conserva ese significado. */
const BASE_PATRON = 1_000_000
const TRAMO_PATRON = 10_000

// Relativo al archivo, no al cwd: correr `node etl/index.js` desde otra
// carpeta no debe empezar una bajada nueva en un songs.db distinto.
const db = openDb(fileURLToPath(new URL('../songs.db', import.meta.url)))

if (flag('re-enriquecer')) {
  const n = db.prepare('UPDATE songs SET enriched_at = NULL').run().changes
  console.log(`Marcadas ${n} canciones para re-enriquecer.`)
}

if (!flag('solo-meta')) {
  /* Con `--patron` se bajan ESOS y no el catalogo global: el global ya lo
     tienes, y son 50 paginas para volver a traer lo mismo. Sin patrones, el
     comportamiento de siempre. */
  const pasadas = patrones.length
    ? patrones.map((patron, i) => ({ patron, rankBase: BASE_PATRON + i * TRAMO_PATRON }))
    : [{ patron: '', rankBase: 0 }]

  for (const { patron, rankBase } of pasadas) {
    console.log(patron ? `Fase 1: bajando "${patron}"...` : 'Fase 1: bajando el catalogo...')
    try {
      const r = await fetchCatalog(db, {
        fetchPage: (from, size) =>
          fetchJson(`${BASE}/songs?pattern=${encodeURIComponent(patron)}&size=${size}&from=${from}`),
        rankBase,
        onProgress: p => process.stdout.write(`\r  ${p.songs} canciones (${p.pages} paginas)`),
      })
      console.log(`\n  Listo: ${r.songs} canciones.`)
    } catch (err) {
      // Que una pasada falle no debe impedir las demas ni la fase 2.
      console.error(`\n  Fase 1${patron ? ` ("${patron}")` : ''} fallo: ${err.message}`)
    }
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
