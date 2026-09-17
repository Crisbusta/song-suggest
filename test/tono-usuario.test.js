import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { volcarWal } from '../tools/backup.mjs'
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firmaDePista, guardarTono, leerTono, borrarTono } from '../db/tono-usuario.js'

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

const PISTA = { songId: 10, trackIndex: 3, instrument: 'Electric Guitar (clean)', name: 'Rhythm Guitar' }
const CADENA = { amp: { fenderId: 'DUBS_Twin', nombre: 'TWIN CLEAN', valores: { gain: 3 } } }

test('un tono guardado se lee igual que se escribio', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  const t = leerTono(db, PISTA)
  assert.deepEqual(t.cadena, CADENA)
  assert.equal(t.origen, 'leido')
  assert.equal(t.desfasada, false)
})

test('guardar dos veces la misma pista deja UN tono, el ultimo', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  guardarTono(db, { ...PISTA, cadena: { amp: { nombre: 'OTRO' } }, origen: 'editado' })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_tone').get().n, 1)
  assert.equal(leerTono(db, PISTA).cadena.amp.nombre, 'OTRO')
})

test('si la pista cambio de identidad, el tono no se aplica: se avisa', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  // Songsterr reordeno y en ese track_index hay ahora otra pista.
  const t = leerTono(db, { ...PISTA, name: 'Lead Guitar' })
  assert.equal(t.desfasada, true, 'una firma que no calza tiene que avisarse')
  assert.deepEqual(t.cadena, CADENA, 'y no se borra: sigue ahi por si la pista vuelve')
})

test('borrar un tono devuelve la pista a no tener ninguno', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  borrarTono(db, PISTA)
  assert.equal(leerTono(db, PISTA), null)
})

test('la firma separa instrumento y nombre con un caracter que no aparece en el catalogo', () => {
  // Sin separador, {instrument:'ab', name:'c'} y {instrument:'a', name:'bc'}
  // darian la misma firma.
  assert.notEqual(
    firmaDePista({ instrument: 'ab', name: 'c' }),
    firmaDePista({ instrument: 'a', name: 'bc' }),
  )
})
