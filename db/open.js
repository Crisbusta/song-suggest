import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')

export function openDb(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  // La spec §5 invita a usar la app mientras el ETL sigue corriendo, o sea dos
  // procesos sobre el mismo archivo — y roll() escribe (shown_count). Sin WAL
  // eso da "database is locked" casi siempre; medido: 43 fallos de 44 intentos.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}
