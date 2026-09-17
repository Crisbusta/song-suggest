import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluarJuicio, distanciaATono, informe } from '../lib/tono/evaluador.js'

const SUCIO = { amp: { nombre: '90S ROCK', valores: { gain: 8 } } }
const LIMPIO = { amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } } }

test('"sobra suciedad" se cumple solo si el candidato es mas limpio', () => {
  const j = { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO }
  assert.equal(evaluarJuicio(j, LIMPIO), 'cumple')
  assert.equal(evaluarJuicio(j, SUCIO), 'viola', 'empatar es fallar: no cambiar nada no puede puntuar')
  assert.equal(evaluarJuicio(j, { amp: { nombre: 'SUPER HEAVY', valores: { gain: 9 } } }), 'viola')
})

test('"falta modulacion" se cumple si el candidato la trae', () => {
  const j = { eje: 'modulacion', direccion: 'falta', juzgado: LIMPIO }
  assert.equal(evaluarJuicio(j, { ...LIMPIO, mod: { nombre: 'CHORUS' } }), 'cumple')
  assert.equal(evaluarJuicio(j, LIMPIO), 'viola')
})

test('un "bien" se viola en cuanto el candidato se aleja en cualquier eje', () => {
  const j = { eje: 'global', direccion: 'bien', juzgado: LIMPIO }
  assert.equal(evaluarJuicio(j, LIMPIO), 'cumple')
  assert.equal(evaluarJuicio(j, SUCIO), 'viola', 'esto es lo que caza las regresiones')
  assert.equal(evaluarJuicio(j, { ...LIMPIO, delay: { nombre: 'ECHO' } }), 'viola')
})

test('un candidato sin sugerencia no cumple ningun juicio', () => {
  const j = { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO }
  assert.equal(evaluarJuicio(j, null), 'sin-efecto')
})

test('la distancia a un tono capturado se mide en ejes, no en perillas', () => {
  const d = distanciaATono(LIMPIO, { amp: { nombre: 'DELUXE CLN', valores: { gain: 3 } } })
  assert.equal(d.familia, true, 'DELUXE CLN y TWIN CLEAN son los dos limpios: la familia acierta')
  assert.equal(d.gain, 0)
  assert.equal(d.ranuras, 0)
  const lejos = distanciaATono(LIMPIO, SUCIO)
  assert.equal(lejos.familia, false)
})

test('el informe cuenta cumplidas, violadas y sin efecto, y guarda ejemplos', () => {
  const r = informe({
    juicios: [
      { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO, candidato: LIMPIO, songId: 1, trackIndex: 0 },
      { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO, candidato: SUCIO, songId: 2, trackIndex: 0 },
    ],
    capturas: [],
  })
  assert.equal(r.cumplidas, 1)
  assert.equal(r.violadas, 1)
  assert.equal(r.ejemplos.violadas[0].songId, 2, 'una violacion sin ejemplo no se puede revisar')
})
