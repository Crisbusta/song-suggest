import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { fetchCatalog } from '../etl/catalog.js'

// Genera un catalogo falso de `total` canciones, paginado.
function catalogoFalso(total) {
  return (from, size) =>
    Promise.resolve(
      Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => ({
        songId: from + i + 1,
        artistId: 7,
        artist: `Artista ${from + i}`,
        title: `Cancion ${from + i}`,
        hasChords: true,
        tracks: [{ instrumentId: 30, instrument: 'Distortion Guitar', views: 100, difficulty: 3, tuning: [64, 59, 55, 50, 45, 40], name: 'Lead Guitar' }],
      }))
    )
}

test('guarda todas las canciones y sus tracks', async () => {
  const db = openDb(':memory:')
  const r = await fetchCatalog(db, { fetchPage: catalogoFalso(450), pageSize: 200 })

  assert.equal(r.songs, 450)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 450)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 450)
})

test('corta apenas llega una pagina incompleta', async () => {
  const db = openDb(':memory:')
  let llamadas = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => { llamadas++; return catalogoFalso(300)(from, size) },
    pageSize: 200,
  })
  // 200 llenas + 100: la pagina corta ya dice que no hay mas, no se pide otra.
  assert.equal(llamadas, 2)
})

test('para cuando una pagina viene vacia', async () => {
  const db = openDb(':memory:')
  let llamadas = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => { llamadas++; return catalogoFalso(400)(from, size) },
    pageSize: 200,
  })
  // 200 + 200 justas, asi que hace falta una tercera pagina vacia para saber que se acabo.
  assert.equal(llamadas, 3)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 400)
})

test('no pasa del tope de paginacion de la API', async () => {
  const db = openDb(':memory:')
  let maxFromVisto = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => {
      maxFromVisto = Math.max(maxFromVisto, from)
      return catalogoFalso(100000)(from, size)
    },
    pageSize: 200,
    maxFrom: 800,
  })
  assert.ok(maxFromVisto <= 800, `pidio from=${maxFromVisto}, sobre el tope`)
})

test('asigna catalog_rank segun la posicion global', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(300), pageSize: 200 })

  const primera = db.prepare('SELECT catalog_rank FROM songs ORDER BY song_id LIMIT 1').get()
  const ultima = db.prepare('SELECT catalog_rank FROM songs ORDER BY song_id DESC LIMIT 1').get()
  assert.equal(primera.catalog_rank, 0)
  assert.equal(ultima.catalog_rank, 299)
})

test('re-correr el ETL no duplica ni pierde el historial', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(200), pageSize: 200 })
  db.prepare(
    "INSERT INTO song_state (song_id, status, updated_at) VALUES (1, 'learned', '2026-09-03')"
  ).run()

  await fetchCatalog(db, { fetchPage: catalogoFalso(200), pageSize: 200 })

  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 200)
  assert.equal(db.prepare('SELECT status FROM song_state WHERE song_id = 1').get().status, 'learned')
})

test('no borra enriched_at de una cancion ya enriquecida', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(1), pageSize: 200 })
  db.prepare("UPDATE songs SET enriched_at = '2026-09-01' WHERE song_id = 1").run()

  await fetchCatalog(db, { fetchPage: catalogoFalso(1), pageSize: 200 })

  assert.equal(db.prepare('SELECT enriched_at FROM songs WHERE song_id = 1').get().enriched_at, '2026-09-01')
})

/* --- Buscar por patron: canciones que el top 10.000 no alcanza --------------

   El catalogo global (`pattern=` vacio) topa en 10.000 resultados -- la API
   devuelve vacio en `from=10000`, verificado -- y ese top esta ordenado por
   popularidad global. Medido contra Songsterr el 2026-09-13: de Los
   Prisioneros entran 7 de sus 98 canciones, de Gustavo Cerati 3 de 96, y de
   Victor Jara ninguna de 37.

   `pattern` es busqueda de texto de verdad, asi que se puede pedir por banda.
   Lo que eso rompe es el `catalog_rank`, que `etl/meta.js` usa para enriquecer
   lo popular primero: una pasada por "prisioneros" numera desde 0, y sin
   `rankBase` "Paramar" quedaria con rank 2 -- por delante de medio catalogo
   real. Con base, las canciones que solo aparecen por patron se ordenan
   DESPUES del top global, que es donde les corresponde. */

test('rankBase desplaza el rango sin tocar el catalogo global', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(5), pageSize: 200, rankBase: 1_000_000 })
  const r = db.prepare('SELECT MIN(catalog_rank) lo, MAX(catalog_rank) hi FROM songs').get()
  assert.equal(r.lo, 1_000_000)
  assert.equal(r.hi, 1_000_004)
})

test('un rank peor no pisa uno mejor que ya estaba', async () => {
  /* La misma cancion puede salir en las dos pasadas. Si la segunda pisara el
     rank, una cancion del top global recibiria el numero alto de su pasada por
     banda y perderia su lugar en la cola de enriquecimiento -- que es lo unico
     que garantiza que un Ctrl-C te deje lo popular ya listo. */
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(5), pageSize: 200 })
  await fetchCatalog(db, { fetchPage: catalogoFalso(5), pageSize: 200, rankBase: 1_000_000 })
  assert.equal(db.prepare('SELECT catalog_rank FROM songs WHERE song_id = 1').get().catalog_rank, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 5, 'y no duplica')
})

test('y al reves: un rank mejor si mejora al que estaba', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(5), pageSize: 200, rankBase: 1_000_000 })
  await fetchCatalog(db, { fetchPage: catalogoFalso(5), pageSize: 200 })
  assert.equal(db.prepare('SELECT catalog_rank FROM songs WHERE song_id = 1').get().catalog_rank, 0)
})
