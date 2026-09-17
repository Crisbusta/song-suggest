import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { guardarJuicio, leerJuicios } from '../db/tono-usuario.js'

const BASE = {
  songId: 5, trackIndex: 1,
  instrument: 'Distortion Guitar', name: 'Rhythm Guitar',
  juzgado: { amp: { nombre: '90S ROCK', valores: { gain: 8 } } },
  fuente: 'comunidad', sugeridor: 'reglas@2026-09-17',
}

test('un juicio guarda que se juzgo, no solo el veredicto', () => {
  const db = openDb(':memory:')
  guardarJuicio(db, { ...BASE, eje: 'suciedad', direccion: 'sobra' })
  const [j] = leerJuicios(db)
  assert.equal(j.eje, 'suciedad')
  assert.equal(j.direccion, 'sobra')
  // Sin la cadena juzgada, "sobra suciedad" es ininterpretable en cuanto el
  // sugeridor cambie: mas limpio que QUE.
  assert.equal(j.juzgado.amp.nombre, '90S ROCK')
  assert.equal(j.fuente, 'comunidad')
  assert.equal(j.sugeridor, 'reglas@2026-09-17')
})

test('juzgar la misma pista dos veces deja DOS filas, no una', () => {
  const db = openDb(':memory:')
  guardarJuicio(db, { ...BASE, eje: 'suciedad', direccion: 'sobra', sugeridor: 'v1' })
  guardarJuicio(db, { ...BASE, eje: 'global', direccion: 'bien', sugeridor: 'v2' })
  const js = leerJuicios(db)
  assert.equal(js.length, 2, 'la historia de juicios ES el dato: no se pisa')
  assert.deepEqual(js.map(j => j.sugeridor), ['v1', 'v2'])
})
