import { parseCatalogPage } from './parse.js'

export async function fetchCatalog(db, opts) {
  const { fetchPage, pageSize = 200, maxFrom = 9800, onProgress } = opts

  // has_chords no se actualiza en el ON CONFLICT: la fase 2 (/api/meta, la
  // fuente mas completa) es la dueña de esa columna. Si la fase 1 la pisara
  // en cada re-run, un re-run completo revertiria lo que decidio la fase 2.
  const upsertSong = db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, has_chords, catalog_rank)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_id) DO UPDATE SET
      artist = excluded.artist,
      title = excluded.title,
      catalog_rank = excluded.catalog_rank
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
        upsertSong.run(s.songId, s.artistId, s.artist, s.title, s.hasChords, s.catalogRank)
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
