import { parseMeta } from './parse.js'
import { runPool } from './http.js'

export async function enrichPending(db, opts) {
  const { fetchMeta, concurrency = 3, limit = Infinity, onProgress } = opts

  const pendientes = db.prepare(`
    SELECT song_id FROM songs
    WHERE enriched_at IS NULL
    ORDER BY catalog_rank ASC
    LIMIT ?
  `).all(Number.isFinite(limit) ? limit : -1).map(r => r.song_id)

  const actualizar = db.prepare(`
    UPDATE songs SET
      views = ?, fingerstyle = ?, has_chords = ?, ai_generated = ?,
      is_junk = ?, is_blank = ?, is_published = ?, videos = ?, enriched_at = ?
    WHERE song_id = ?
  `)
  const borrarTags = db.prepare('DELETE FROM tags WHERE song_id = ?')
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (song_id, tag) VALUES (?, ?)')

  const failures = []
  let ok = 0

  await runPool(pendientes, concurrency, async songId => {
    let m
    try {
      m = parseMeta(await fetchMeta(songId))
    } catch {
      // Una que falla se anota y seguimos: no abortamos 10.000 por una.
      failures.push(songId)
      onProgress?.({ ok, failed: failures.length, total: pendientes.length })
      return
    }

    db.exec('BEGIN')
    try {
      actualizar.run(
        m.views, m.fingerstyle, m.hasChords, m.aiGenerated,
        m.isJunk, m.isBlank, m.isPublished, m.videos,
        new Date().toISOString(), songId
      )
      borrarTags.run(songId)
      for (const tag of m.tags) insertTag.run(songId, tag)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      failures.push(songId)
      return
    }

    ok++
    onProgress?.({ ok, failed: failures.length, total: pendientes.length })
  })

  return { ok, failed: failures.length, failures: failures.sort((a, b) => a - b) }
}
