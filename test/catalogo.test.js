import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RANURAS, VACIA, crearCatalogo } from '../public/catalogo-lt25.js'

const unidades = JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
const cat = crearCatalogo(unidades)

test('las cinco ranuras del equipo, en orden de cadena', () => {
  assert.deepEqual(RANURAS, ['stomp', 'mod', 'amp', 'delay', 'reverb'])
})

test('cada ranura ofrece sus unidades, y las de efecto ofrecen ademas la vacia', () => {
  assert.equal(cat.deRanura('amp').length, 20)
  assert.ok(!cat.deRanura('amp').some(u => u.fenderId === VACIA), 'el ampli nunca queda vacio')
  assert.ok(cat.deRanura('delay').some(u => u.fenderId === VACIA))
  assert.equal(cat.deRanura('delay').length, 4)   // 3 delays + EMPTY
  assert.equal(cat.deRanura('mod').length, 8)     // 7 mods + EMPTY
  assert.equal(cat.deRanura('reverb').length, 6)  // 5 reverbs + EMPTY
  assert.equal(cat.deRanura('stomp').length, 12)  // 11 stomps + EMPTY
})

test('traduce FenderId a nombre de pantalla', () => {
  assert.equal(cat.nombre('DUBS_TriangleFlanger'), 'FLANGER')
  assert.equal(cat.nombre('DUBS_Passthru'), 'EMPTY')
})

test('un FenderId desconocido no revienta: se devuelve tal cual', () => {
  assert.equal(cat.unidad('DUBS_NoExiste'), null)
  assert.equal(cat.nombre('DUBS_NoExiste'), 'DUBS_NoExiste')
})

test('los descriptores del DELAY traen rango, unidades y tipo', () => {
  const ps = cat.parametrosDe('DUBS_MonoDelay')
  const time = ps.find(p => p.id === 'time')
  assert.equal(time.tipo, 'continuo')
  assert.equal(time.nombre, 'TIME')
  assert.equal(time.unidades, 'ms')
  assert.equal(time.min, 0.03)
  assert.equal(time.max, 1)
})

test('los tres tipos de control estan cubiertos', () => {
  const tipos = new Set()
  for (const u of unidades) for (const p of cat.parametrosDe(u.FenderId)) tipos.add(p.tipo)
  assert.deepEqual([...tipos].sort(), ['continuo', 'interruptor', 'lista'])
})

test('TOUCH WAH.mode es una lista con sus valores de pantalla', () => {
  const modo = cat.parametrosDe('DUBS_EcFilter').find(p => p.id === 'mode')
  assert.equal(modo.tipo, 'lista')
  assert.deepEqual(modo.valores.map(v => v.valor), ['Low Up', 'Low Down', 'High Up', 'High Down'])
  assert.deepEqual(modo.valores.map(v => v.nombre), ['LO-UP', 'LO-DOWN', 'HI-UP', 'HI-DOWN'])
})

test('ida y vuelta: convertir a pantalla y de vuelta al cable no corre el valor', () => {
  for (const u of unidades) {
    for (const p of cat.parametrosDe(u.FenderId)) {
      if (p.tipo !== 'continuo') continue
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const cable = p.min + (p.max - p.min) * frac
        const vuelta = p.aCable(p.aPantalla(cable))
        assert.ok(Math.abs(vuelta - cable) < 1e-6,
          `${u.FenderId}.${p.id}: ${cable} -> ${p.aPantalla(cable)} -> ${vuelta}`)
      }
    }
  }
})

test('el time del DELAY se muestra en milisegundos, no en la fraccion del cable', () => {
  const time = cat.parametrosDe('DUBS_MonoDelay').find(p => p.id === 'time')
  assert.equal(Math.round(time.aPantalla(0.4)), 400)
  assert.ok(Math.abs(time.aCable(400) - 0.4) < 1e-6)
})

test('la conversion nunca devuelve algo fuera del rango del cable', () => {
  const gain = cat.parametrosDe('DUBS_Evh3').find(p => p.id === 'gain')
  assert.equal(gain.aCable(-999), gain.min)
  assert.equal(gain.aCable(999), gain.max)
})

test('sin pares medidos, un parametro de curvas distintas se muestra en crudo', () => {
  const vol = cat.parametrosDe('DUBS_Evh3').find(p => p.id === 'volume')
  assert.equal(vol.crudo, true)
  assert.equal(vol.unidades, 'dB')
  assert.equal(vol.aPantalla(-30), -30, 'el valor crudo no se traduce a una escala inventada')
})

test('un parametro de curvas coincidentes no se muestra en crudo', () => {
  const gain = cat.parametrosDe('DUBS_Evh3').find(p => p.id === 'gain')
  assert.equal(gain.crudo, false)
  assert.equal(Math.round(gain.aPantalla(1)), 10)
})
