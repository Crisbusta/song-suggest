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

  const failures = new Set()
  let ok = 0

  // Un onProgress del llamador que lance no puede tumbar el ETL entero.
  const notificar = () => {
    try {
      onProgress?.({ ok, failed: failures.size, total: pendientes.length })
    } catch { /* callback roto: se ignora, no es asunto del ETL */ }
  }

  await runPool(pendientes, concurrency, async songId => {
    // Red de seguridad: el worker no deja escapar NINGUNA excepcion. runPool
    // propaga la primera que reciba y con eso se acaba la corrida, y la spec
    // exige que una cancion que falla no detenga a las otras 9.999.
    try {
      let m
      try {
        m = parseMeta(await fetchMeta(songId))
      } catch {
        failures.add(songId)
        notificar()
        return
      }

      try {
        db.exec('BEGIN')
      } catch {
        // Si BEGIN falla (ej: transaccion ya abierta), no hay transaccion que rollback.
        // No llamamos ROLLBACK para evitar cerrar una transaccion externa.
        failures.add(songId)
        notificar()
        return
      }

      try {
        actualizar.run(
          m.views, m.fingerstyle, m.hasChords, m.aiGenerated,
          m.isJunk, m.isBlank, m.isPublished, m.videos,
          new Date().toISOString(), songId
        )
        borrarTags.run(songId)
        for (const tag of m.tags) insertTag.run(songId, tag)
        db.exec('COMMIT')
      } catch {
        // Si los updates fallan, si hay transaccion que rollback. Si el propio ROLLBACK
        // falla (ej: sin transaccion abierta tras un error previo), se ignora.
        try { db.exec('ROLLBACK') } catch { /* sin transaccion abierta */ }
        failures.add(songId)
        notificar()
        return
      }

      ok++
      notificar()
    } catch {
      failures.add(songId)
    }
  })

  return {
    ok,
    failed: failures.size,
    failures: [...failures].sort((a, b) => a - b),
  }
}
