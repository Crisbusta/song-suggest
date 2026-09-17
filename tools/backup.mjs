/* Copia songs.db a songs-<fecha>.db.bak.

   El checkpoint NO es opcional, y por eso este script existe en vez de un `cp`
   suelto: la base corre en WAL (ver db/open.js) y un `cp` del archivo
   principal se lleva la base tal como estaba en el ultimo checkpoint. Medido
   el 2026-09-17 sobre la base real: 31.281.152 bytes en songs.db y 5.302.472
   en songs.db-wal sin volcar. Perder eso no era grave mientras solo fueran
   sorteos; con user_tone y tone_judgment ahi dentro seria perder tonos que
   costaron minutos de dialar cada uno, y que el ETL no puede reconstruir. */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'

/* TRUNCATE y no PASSIVE: PASSIVE se rinde en silencio si hay otro proceso
   leyendo -- y `npm start` y `npm run etl` pueden convivir sobre la misma
   base, que es justo el caso en el que un backup a medias enganaria. */
export const volcarWal = db => db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

if (import.meta.filename === process.argv[1]) {
  const origen = process.argv[2] ?? 'songs.db'
  const sello = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const destino = `songs-${sello}.db.bak`
  const db = new DatabaseSync(origen)
  volcarWal(db)
  db.close()
  copyFileSync(origen, destino)
  console.log(`copiado ${origen} -> ${destino}`)
}
