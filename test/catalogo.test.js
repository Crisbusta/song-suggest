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

/* La unica excepcion conocida, y es del equipo, no del codigo: la pantalla
   del VIBRATONE marca 1.0 para todo el rango 0,67..2 Hz de `rotor`, asi que
   esos valores no se pueden recuperar desde la pantalla. Medido, no supuesto
   -- ver CURVAS en catalogo-lt25.js y el test de mas abajo. Va como lista
   explicita para que un parametro NUEVO que pierda la ida y vuelta falle aqui
   en vez de colarse. */
const SIN_VUELTA_EXACTA = new Set(['DUBS_Vibratone.rotor'])

test('ida y vuelta: convertir a pantalla y de vuelta al cable no corre el valor', () => {
  for (const u of unidades) {
    for (const p of cat.parametrosDe(u.FenderId)) {
      if (p.tipo !== 'continuo') continue
      if (SIN_VUELTA_EXACTA.has(`${u.FenderId}.${p.id}`)) continue
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const cable = p.min + (p.max - p.min) * frac
        const vuelta = p.aCable(p.aPantalla(cable))
        assert.ok(Math.abs(vuelta - cable) < 1e-6,
          `${u.FenderId}.${p.id}: ${cable} -> ${p.aPantalla(cable)} -> ${vuelta}`)
      }
    }
  }
})

/* Lo que SI vale siempre, incluida la excepcion de arriba: dar la vuelta no
   cambia lo que el usuario ve. El valor del cable puede moverse dentro del
   tramo que la pantalla no distingue, pero la pantalla no. */
test('dar la vuelta nunca cambia el numero que muestra la pantalla', () => {
  for (const u of unidades) {
    for (const p of cat.parametrosDe(u.FenderId)) {
      if (p.tipo !== 'continuo') continue
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const cable = p.min + (p.max - p.min) * frac
        const pantalla = p.aPantalla(cable)
        assert.ok(Math.abs(p.aPantalla(p.aCable(pantalla)) - pantalla) < 1e-6,
          `${u.FenderId}.${p.id}: la pantalla se movio de ${pantalla}`)
      }
    }
  }
})

test('el rotor del VIBRATONE no distingue por debajo de 2 Hz, y eso es del equipo', () => {
  const rotor = cat.parametrosDe('DUBS_Vibratone').find(p => p.id === 'rotor')
  // Medido: 0,67 / 1 / 1,5 / 2 Hz dan todos 1.0 en la pantalla del ampli.
  for (const hz of [0.67, 1, 1.5, 2]) {
    assert.equal(rotor.aPantalla(hz), 1, `${hz} Hz deberia marcar 1.0`)
  }
  // Y a partir de ahi si separa.
  assert.ok(rotor.aPantalla(3) > 1, 'a 3 Hz la pantalla ya despega')
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

/* Hoy ningun parametro del catalogo real cae aqui -- las seis curvas estan
   medidas --, asi que esto solo se puede ejercitar con una unidad inventada.
   Se mantiene porque es la salida correcta el dia que Fender publique un
   taper que no hayamos medido: mostrar el cable pelado en su unidad real, no
   una escala 1-10 aproximada. */
test('sin pares medidos, un parametro de curvas distintas se muestra en crudo', () => {
  const inventada = {
    FenderId: 'DUBS_Inventado',
    nodeType: 'dspUnit',
    info: { displayName: 'INVENTADO', category: 'effect', subcategory: 'stomp' },
    ui: { uiParameters: [{
      controlType: 'continuous', controlId: 'x', displayName: 'X',
      units: 'dB', min: -60, max: 0, taper: 'tZZ',
      remap: { min: 1, max: 10, taper: 'tZZi' },
    }] },
  }
  const otro = crearCatalogo([...unidades, inventada])
  const x = otro.parametrosDe('DUBS_Inventado').find(p => p.id === 'x')
  assert.equal(x.crudo, true)
  assert.equal(x.unidades, 'dB')
  assert.equal(x.aPantalla(-30), -30, 'el valor crudo no se traduce a una escala inventada')
})

test('un parametro de curvas coincidentes no se muestra en crudo', () => {
  const gain = cat.parametrosDe('DUBS_Evh3').find(p => p.id === 'gain')
  assert.equal(gain.crudo, false)
  assert.equal(Math.round(gain.aPantalla(1)), 10)
})

/* --- Curvas medidas contra el equipo real (2026-09-17) -------------------

   Los pares estan en `CURVAS`, en public/catalogo-lt25.js, con la procedencia
   de cada medicion. Estos tests fijan que se usen. */

test('el volume del ampli se convierte con la curva medida, no en crudo', () => {
  const vol = cat.parametrosDe('DUBS_Evh3').find(p => p.id === 'volume')
  assert.equal(vol.crudo, false, 'con pares medidos ya no hay que mostrar el cable pelado')
  // Medido: TWIN CLEAN de fabrica esta en -8.573037 dB y la pantalla marca 6.5.
  assert.ok(Math.abs(vol.aPantalla(-8.573037) - 6.5) < 0.05,
    `-8.573037 dB deberia dar 6.5 en pantalla, dio ${vol.aPantalla(-8.573037)}`)
  assert.ok(Math.abs(vol.aCable(6.5) - (-8.573037)) < 0.05,
    `6.5 de pantalla deberia dar -8.573037 dB, dio ${vol.aCable(6.5)}`)
  // Y los dos extremos, que son los que mas se notan si la curva se invierte.
  assert.ok(Math.abs(vol.aPantalla(0) - 10) < 0.05)
  assert.ok(Math.abs(vol.aPantalla(-60) - 1) < 0.05)
})

test('un parametro sin taper de cable declarado es lineal, no desconocido', () => {
  /* El `level` del OVERDRIVE declara `remap.taper` pero no `taper`. Eso hacia
     que `curvasDistintas()` lo diera por raro (undefined !== 't50') y lo
     mandara a la rama de "no sabemos convertir". Medido contra el equipo: es
     exactamente lineal, error 0,0177 sobre nueve puntos. */
  const level = cat.parametrosDe('DUBS_Overdrive').find(p => p.id === 'level')
  assert.equal(level.crudo, false)
  assert.ok(Math.abs(level.aPantalla(0.5) - 5.5) < 0.05,
    `0.5 deberia dar 5.5 en pantalla, dio ${level.aPantalla(0.5)}`)
  assert.ok(Math.abs(level.aPantalla(0.2) - 2.8) < 0.05)
  assert.ok(Math.abs(level.aCable(10) - 1) < 1e-6)
})

test('ya no queda ningun parametro continuo sin poder convertir', () => {
  const crudos = []
  for (const u of unidades) {
    for (const p of cat.parametrosDe(u.FenderId)) {
      if (p.tipo === 'continuo' && p.crudo) crudos.push(`${u.info?.displayName}.${p.id}`)
    }
  }
  assert.deepEqual(crudos, [], `siguen en crudo: ${crudos.join(', ')}`)
})
