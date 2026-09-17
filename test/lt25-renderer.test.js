import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crearCatalogo } from '../public/catalogo-lt25.js'
import { MODELOS_LT25 } from '../lib/ampli.js'
import { fenderIdDeModelo, paraElAmpli, PERILLAS_QUE_VIAJAN } from '../lib/tono/lt25-renderer.js'

const unidades = JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
const cat = crearCatalogo(unidades)

/* Este test es el que LICENCIA que `paraElAmpli` no necesite saber el modelo.
   Si algun dia Fender publica un modelo cuya conversion difiera, esto falla y
   habra que pasarle el modelo -- que es justo el aviso que queremos. */
test('los veinte modelos declaran la MISMA conversion para las perillas que viajan', () => {
  const referencia = {}
  for (const modelo of MODELOS_LT25) {
    const id = fenderIdDeModelo(modelo)
    assert.ok(id, `${modelo} no resuelve a FenderId`)
    for (const pid of PERILLAS_QUE_VIAJAN) {
      const p = cat.parametrosDe(id).find(x => x.id === pid)
      assert.ok(p, `${modelo} no declara ${pid}`)
      const firma = [1, 3.3, 5, 7, 10].map(d => p.aCable(d)).join(',')
      referencia[pid] ??= firma
      assert.equal(firma, referencia[pid], `${modelo}.${pid} convierte distinto que el resto`)
    }
  }
})

test('paraElAmpli convierte los extremos de la escala de pantalla al cable', () => {
  assert.deepEqual(paraElAmpli({ gain: 1, treble: 1, bass: 1 }), { gain: 0, treb: 0, bass: 0 })
  assert.deepEqual(paraElAmpli({ gain: 10, treble: 10, bass: 10 }), { gain: 1, treb: 1, bass: 1 })
})

test('una perilla que la sugerencia no declara no sale en cero: no sale', () => {
  const r = paraElAmpli({ gain: 5, volume: 9, treble: 5, mid: 7, bass: 5, reverb: 9 })
  assert.deepEqual(Object.keys(r).sort(), ['bass', 'gain', 'treb'])
  assert.ok(!('volume' in r), 'el volumen no viaja')
  assert.ok(!('mid' in r), 'mid no lo produce la tabla de reglas')
})

test('sin sugerencia no hay nada que renderizar', () => {
  assert.equal(paraElAmpli(null), null)
})

test('un valor que no es finito se omite en vez de viajar como NaN', () => {
  // JSON.stringify convierte NaN en null y el equipo lo ignora en silencio,
  // que es exactamente el fallo que este proyecto no se perdona.
  const r = paraElAmpli({ gain: 'ocho', treble: 5 })
  assert.ok(!('gain' in r))
  assert.ok('treb' in r)
})

test('fenderIdDeModelo solo devuelve identificadores que el catalogo conoce', () => {
  const conocidos = new Set(unidades.map(u => u.FenderId))
  for (const modelo of MODELOS_LT25) {
    assert.ok(conocidos.has(fenderIdDeModelo(modelo)), `${modelo} resuelve a un id que no existe`)
  }
  assert.equal(fenderIdDeModelo('NO EXISTE'), null, 'nunca un identificador inventado')
})
