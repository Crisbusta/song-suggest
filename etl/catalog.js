import { parseCatalogPage } from './parse.js'

export async function fetchCatalog(db, opts) {
  /* `maxFrom` no es una cifra elegida: la API topa CUALQUIER consulta en 10.000
     resultados -- `from=10000` devuelve un arreglo vacio, verificado el
     2026-09-13 contra el endpoint real, con patron y sin el. Subirlo no baja
     ni una cancion mas.

     `rankBase` desplaza el `catalog_rank` de esta pasada. Existe porque la
     forma de pasar ese techo es pedir por `pattern`, y cada pasada por patron
     numera desde 0: sin base, una cancion que solo aparece buscando su banda
     recibiria un rank de dos digitos y se colaria al principio de la cola de
     enriquecimiento, que `etl/meta.js` ordena por este campo. */
  const { fetchPage, pageSize = 200, maxFrom = 9800, rankBase = 0, onProgress } = opts

  // has_chords no se actualiza en el ON CONFLICT: la fase 2 (/api/meta, la
  // fuente mas completa) es la dueña de esa columna. Si la fase 1 la pisara
  // en cada re-run, un re-run completo revertiria lo que decidio la fase 2.
  const upsertSong = db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, has_chords, catalog_rank)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_id) DO UPDATE SET
      artist = excluded.artist,
      title = excluded.title,
      -- El MEJOR rank que le haya dado cualquier pasada, no el ultimo. Una
      -- cancion puede salir en el catalogo global Y en la busqueda por su
      -- banda; si la segunda pisara el valor, una cancion del top perderia su
      -- lugar en la cola de enriquecimiento y un Ctrl-C dejaria de
      -- garantizarte que lo popular ya esta listo.
      catalog_rank = MIN(catalog_rank, excluded.catalog_rank)
  `)
  const borrarTracks = db.prepare('DELETE FROM tracks WHERE song_id = ?')
  const insertTrack = db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument_id, instrument, name, difficulty, views, tuning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let paginas = 0
  let total = 0

  for (let from = 0; from <= maxFrom; from += pageSize) {
    const page = await fetchPage(from, pageSize)
    if (!Array.isArray(page) || page.length === 0) break

    const { songs, tracks } = parseCatalogPage(page, from)

    // Un lote por pagina: un Ctrl-C nunca deja la base a medias.
    // BEGIN queda fuera del try que hace ROLLBACK: si BEGIN falla porque ya
    // habia una transaccion abierta, ROLLBACK no lanza — revierte esa
    // transaccion externa, que no era nuestra. Eso es peor que un error mal
    // reportado: es tocar un estado que no nos pertenecia (mismo caso que se
    // protegio en etl/meta.js).
    db.exec('BEGIN')
    try {
      for (const s of songs) {
        upsertSong.run(s.songId, s.artistId, s.artist, s.title, s.hasChords, s.catalogRank + rankBase)
        borrarTracks.run(s.songId)
      }
      for (const t of tracks) {
        insertTrack.run(t.songId, t.trackIndex, t.instrumentId, t.instrument, t.name, t.difficulty, t.views, t.tuning)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    paginas++
    total += songs.length
    // Las claves del callback van en ingles y espejan el valor de retorno:
    // es superficie publica que consume el CLI de la Task 8.
    onProgress?.({ pages: paginas, songs: total, from })

    if (page.length < pageSize) break
  }

  return { pages: paginas, songs: total }
}
