import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { volcarWal } from '../tools/backup.mjs'
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('el esquema crea las dos tablas del corpus de tono', () => {
  const db = openDb(':memory:')
  const tablas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_tone','tone_judgment')"
  ).all().map(r => r.name).sort()
  assert.deepEqual(tablas, ['tone_judgment', 'user_tone'])
})

test('un juicio solo admite las dos formas con sentido', () => {
  const db = openDb(':memory:')
  const poner = (eje, direccion) => db.prepare(`
    INSERT INTO tone_judgment (song_id, track_index, track_sig, eje, direccion, juzgado, fuente, sugeridor, creado_en)
    VALUES (1, 0, 'sig', ?, ?, '{}', 'reglas', 'v1', '2026-09-17')
  `).run(eje, direccion)

  poner('global', 'bien')
  poner('suciedad', 'sobra')
  // "global" solo se combina con "bien", y un eje concreto nunca con "bien":
  // un "bien" por eje no dice nada que el global no diga mejor.
  assert.throws(() => poner('global', 'sobra'), /CHECK/)
  assert.throws(() => poner('suciedad', 'bien'), /CHECK/)
})

test('volcar el WAL deja la base copiable con un cp del archivo principal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tono-'))
  try {
    const ruta = join(dir, 'x.db')
    const db = openDb(ruta)
    db.prepare(`
      INSERT INTO user_tone (song_id, track_index, track_sig, cadena, origen, updated_at)
      VALUES (7, 2, 'sig', '{"amp":1}', 'leido', '2026-09-17')
    `).run()

    volcarWal(db)
    // Un cp del archivo principal, sin -wal: es lo que hace `npm run backup`.
    copyFileSync(ruta, join(dir, 'copia.db'))
    db.close()

    const copia = openDb(join(dir, 'copia.db'))
    const fila = copia.prepare('SELECT song_id, cadena FROM user_tone').get()
    assert.equal(fila?.song_id, 7, 'el tono guardado no llego a la copia')
    assert.equal(fila.cadena, '{"amp":1}')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
