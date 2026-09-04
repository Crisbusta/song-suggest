import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeTuning } from '../lib/tuning.js'

// Songsterr entrega las cuerdas de la mas aguda a la mas grave.
const ESTANDAR = [64, 59, 55, 50, 45, 40]

test('Mi estandar no genera aviso', () => {
  assert.equal(describeTuning(ESTANDAR), null)
})

test('sin datos de afinacion no inventa nada', () => {
  assert.equal(describeTuning(null), null)
  assert.equal(describeTuning([]), null)
})

test('todo un semitono abajo', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 1)), 'Medio tono abajo (Eb)')
})

test('todo un tono abajo', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 2)), 'Un tono abajo (D)')
})

test('tres semitonos abajo se describe en semitonos', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 3)), '3 semitonos abajo')
})

test('afinado arriba tambien se avisa', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n + 1)), 'Medio tono arriba')
})

test('Drop D: solo la sexta baja un tono', () => {
  assert.equal(describeTuning([64, 59, 55, 50, 45, 38]), 'Drop D')
})

test('Drop C#', () => {
  assert.equal(describeTuning([64, 59, 55, 50, 45, 37]), 'Drop C#')
})

test('una afinacion rara muestra las notas', () => {
  // Afinacion abierta cualquiera: ni trasladada ni de la familia Drop.
  assert.equal(describeTuning([50, 45, 43, 38, 33, 26]), 'Afinacion abierta: D-A-G-D-A-D')
})

test('una guitarra de siete cuerdas no revienta', () => {
  const r = describeTuning([64, 59, 55, 50, 45, 40, 35])
  assert.equal(typeof r, 'string')
})
