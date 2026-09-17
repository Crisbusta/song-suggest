import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODELOS_LT25, AMPLIS_LIMPIOS } from '../lib/ampli.js'
import { FAMILIAS_AMP, ejesDe, comparar } from '../lib/tono/ejes.js'

test('la tabla de familias cubre los veinte modelos y ninguno mas', () => {
  assert.deepEqual(Object.keys(FAMILIAS_AMP).sort(), [...MODELOS_LT25].sort())
})

test('la familia limpia no contradice a la lista que ya usa lib/ampli.js', () => {
  // Dos listas sobre lo mismo se desvian. Esta no puede decir "crunch" de un
  // modelo que el resto del proyecto trata como limpio.
  for (const m of AMPLIS_LIMPIOS) {
    assert.equal(FAMILIAS_AMP[m], 'limpio', `${m} esta en AMPLIS_LIMPIOS pero aqui es ${FAMILIAS_AMP[m]}`)
  }
})

test('los ejes salen de la cadena: familia, ganancia y que ranuras estan ocupadas', () => {
  const e = ejesDe({
    amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } },
    mod: { nombre: 'CHORUS', valores: {} },
    reverb: { nombre: 'PLATE', valores: {} },
  })
  assert.equal(e.familia, 'limpio')
  assert.equal(e.gain, 3)
  assert.equal(e.modulacion, true)
  assert.equal(e.delay, false)
  assert.equal(e.reverb, true)
})

test('una cadena sin ampli no inventa una familia', () => {
  const e = ejesDe({ mod: { nombre: 'CHORUS' } })
  assert.equal(e.familia, null)
  assert.equal(e.gain, null)
})

test('la suciedad ordena primero por familia y luego por ganancia', () => {
  const limpioAlto = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: { gain: 9 } } })
  const sucioBajo = ejesDe({ amp: { nombre: 'METAL 2000', valores: { gain: 1 } } })
  // Un modelo de alta ganancia con el gain abajo sigue siendo mas sucio que
  // un limpio con el gain arriba: la voz del modelo manda. Es justo el caso
  // de Weird Fishes -- 90S ROCK a gain 3 suena saturado.
  assert.equal(comparar(sucioBajo, limpioAlto, 'suciedad'), 1)
  assert.equal(comparar(limpioAlto, sucioBajo, 'suciedad'), -1)
})

test('en las ranuras, comparar dice si una tiene efecto y la otra no', () => {
  const con = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: {} }, mod: { nombre: 'CHORUS' } })
  const sin = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: {} } })
  assert.equal(comparar(con, sin, 'modulacion'), 1)
  assert.equal(comparar(sin, con, 'modulacion'), -1)
  assert.equal(comparar(con, con, 'modulacion'), 0)
})
