import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sugerirAjustes, MODELOS_LT25 } from '../lib/ampli.js'

// Los nombres de modelo de estos tests salen del catalogo de unidades DSP del
// amplificador, no del manual. La primera version usaba nombres extraidos de
// un PDF mal parseado ('80s METAL, CHAMP) que el equipo no reconoce.

const PERILLAS = ['gain', 'volume', 'treble', 'bass', 'reverb']

test('un tag especifico le gana a uno generico', () => {
  // "rock" lo tienen 7.335 canciones que no comparten ningun tono: no debe decidir.
  const r = sugerirAjustes({ tags: ['rock', 'thrash metal'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(r.modelo, 'METAL 2000')
  assert.ok(r.motivos.includes('thrash metal'))
  assert.ok(!r.motivos.includes('rock'), 'no debe atribuirse al tag generico')
})

test('sin ninguna senal util devuelve null, no una sugerencia inventada', () => {
  const r = sugerirAjustes({ tags: ['rock', 'pop/rock', 'awesome', 'favorites'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(r, null)
})

test('sin tags tampoco inventa', () => {
  assert.equal(sugerirAjustes({ tags: [], instrument: 'Distortion Guitar', tuning: null }), null)
})

test('un instrumento acustico manda sobre el genero', () => {
  // Da igual que este etiquetada como thrash: si el track es acustico, el
  // ajuste tiene que servir para lo que vas a tocar de verdad.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Acoustic Guitar (steel)', tuning: null })
  assert.equal(r.modelo, 'CHAMPION')
  assert.ok(r.gain <= 2, `un acustico no lleva ganancia, dio ${r.gain}`)
  assert.ok(r.motivos.some(m => m.toLowerCase().includes('acust')))
})

test('un instrumento limpio baja la ganancia y cambia el modelo', () => {
  const sucio = sugerirAjustes({ tags: ['heavy metal'], instrument: 'Distortion Guitar', tuning: null })
  const limpio = sugerirAjustes({ tags: ['heavy metal'], instrument: 'Electric Guitar (clean)', tuning: null })
  assert.ok(sucio.gain >= 6, 'con distorsion la ganancia debe ser alta')
  assert.ok(limpio.gain <= 3, `con guitarra limpia la ganancia debe bajar, dio ${limpio.gain}`)
  assert.notEqual(limpio.modelo, sucio.modelo, 'un modelo de alta ganancia no sirve para un track limpio')
})

test('una afinacion bajada recorta el bass', () => {
  // Las cuerdas graves ya aportan ese peso; dejar el bass alto embarra.
  const estandar = sugerirAjustes({ tags: ['nu metal'], instrument: 'Distortion Guitar', tuning: null })
  const bajada = sugerirAjustes({ tags: ['nu metal'], instrument: 'Distortion Guitar', tuning: 'Drop C' })
  assert.ok(bajada.bass < estandar.bass, `bajada ${bajada.bass} deberia ser menor que estandar ${estandar.bass}`)
  assert.ok(bajada.motivos.includes('Drop C'))
})

test('las cinco perillas siempre quedan entre 1 y 10', () => {
  const casos = [
    { tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: 'Drop A' },
    { tags: ['jazz'], instrument: 'Electric Guitar (jazz)', tuning: null },
    { tags: ['doom metal'], instrument: 'Overdriven Guitar', tuning: '5 semitonos abajo' },
    { tags: ['surf'], instrument: 'Electric Guitar (clean)', tuning: null },
    { tags: ['funk'], instrument: 'Acoustic Guitar (nylon)', tuning: 'Drop D' },
  ]
  for (const c of casos) {
    const r = sugerirAjustes(c)
    assert.ok(r, 'estos casos deberian dar sugerencia')
    for (const p of PERILLAS) {
      assert.ok(Number.isInteger(r[p]) && r[p] >= 1 && r[p] <= 10,
        `${p} = ${r[p]} fuera de rango para ${JSON.stringify(c.tags)}`)
    }
  }
})

test('todo modelo que la tabla nombra existe de verdad en el LT25', () => {
  // Una regla que apunta a un modelo inexistente es peor que no tener regla:
  // manda al usuario a buscar algo que su ampli no tiene.
  const usados = new Set()
  const generos = [
    'thrash metal','metalcore','nu metal','doom metal','progressive metal','heavy metal',
    'grunge','alternative metal','punk','hard rock','blues rock','blues','rockabilly',
    'country','britpop','progressive rock','classic rock','indie rock','funk','jazz',
    'alternative rock','pop','surf','soul','ska','post-rock','power metal','shoegaze',
  ]
  for (const g of generos) {
    for (const instr of ['Distortion Guitar','Electric Guitar (clean)','Acoustic Guitar (steel)']) {
      const r = sugerirAjustes({ tags: [g], instrument: instr, tuning: null })
      if (r) usados.add(r.modelo)
    }
  }
  assert.ok(usados.size > 5, 'la tabla deberia usar varios modelos distintos, no uno solo')
  for (const m of usados) {
    assert.ok(MODELOS_LT25.includes(m), `"${m}" no es un modelo del Mustang LT25`)
  }
})

test('motivos nombra las senales que realmente se usaron', () => {
  const r = sugerirAjustes({ tags: ['blues rock', 'rock'], instrument: 'Overdriven Guitar', tuning: 'Medio tono abajo (Eb)' })
  assert.ok(r.motivos.includes('blues rock'))
  assert.ok(r.motivos.includes('Medio tono abajo (Eb)'))
  assert.ok(r.motivos.length >= 2)
})

test('una cancion de los 60 o 70 no recibe un Marshall de los 80', () => {
  // Caso real del catalogo: Iron Butterfly, "In-A-Gadda-Da-Vida" (1968) traia
  // el tag "hard rock" y salia con '80s METAL. El tag de epoca debe pesar.
  const sesentas = sugerirAjustes({
    tags: ['hard rock', '60s', 'acid rock', 'classic rock', 'progressive rock'],
    instrument: 'Overdriven Guitar', tuning: null,
  })
  assert.notEqual(sesentas.modelo, '80S ROCK')
  assert.ok(sesentas.motivos.some(m => m === '60s' || m === '70s'),
    'el motivo debe declarar que la epoca influyo')

  // Y la misma cancion sin tag de epoca sigue en el modelo de los 80.
  const sinEpoca = sugerirAjustes({ tags: ['hard rock'], instrument: 'Overdriven Guitar', tuning: null })
  assert.equal(sinEpoca.modelo, '80S ROCK')
})

test('la epoca baja la ganancia respecto al equivalente moderno', () => {
  const moderno = sugerirAjustes({ tags: ['hard rock'], instrument: 'Distortion Guitar', tuning: null })
  const vintage = sugerirAjustes({ tags: ['hard rock', '70s'], instrument: 'Distortion Guitar', tuning: null })
  assert.ok(vintage.gain < moderno.gain, `vintage ${vintage.gain} deberia ser menor que ${moderno.gain}`)
})

test('un tag de epoca no altera lo que ya era de esa epoca', () => {
  // Un blues de los 60 ya apunta a BASSMAN: la epoca no debe moverlo.
  const r = sugerirAjustes({ tags: ['blues', '60s'], instrument: 'Overdriven Guitar', tuning: null })
  assert.equal(r.modelo, 'BASSMAN')
})

// --- Conversión de escala para el amplificador ----------------------------------

import { paraElAmpli } from '../lib/ampli.js'

test('la escala 1-10 se convierte a los flotantes 0-1 del amplificador', () => {
  assert.deepEqual(paraElAmpli({ gain: 1, treble: 1, bass: 1 }), { gain: 0, treb: 0, bass: 0 })
  assert.deepEqual(paraElAmpli({ gain: 10, treble: 10, bass: 10 }), { gain: 1, treb: 1, bass: 1 })
})

test('un valor intermedio cae donde corresponde', () => {
  const r = paraElAmpli({ gain: 8, treble: 5, bass: 4 })
  assert.ok(Math.abs(r.gain - 7 / 9) < 1e-9, `gain 8/10 -> ${r.gain}`)
  assert.ok(Math.abs(r.treb - 4 / 9) < 1e-9)
  assert.ok(Math.abs(r.bass - 3 / 9) < 1e-9)
})

test('NO manda volumen, medios ni reverb', () => {
  // volume esta en decibeles con rango desconocido: mandarlo como 0-1 puede
  // ser un salto de volumen brutal. mid no lo produce la tabla. reverb vive
  // en otro nodo. Los tres estan fuera por decision de diseno, no por olvido.
  const r = paraElAmpli({ gain: 5, volume: 9, treble: 5, bass: 5, reverb: 9 })
  assert.deepEqual(Object.keys(r).sort(), ['bass', 'gain', 'treb'])
})

test('sin sugerencia no hay nada que convertir', () => {
  assert.equal(paraElAmpli(null), null)
  assert.equal(paraElAmpli(undefined), null)
})

test('los valores quedan acotados aunque entre basura', () => {
  const r = paraElAmpli({ gain: 99, treble: -5, bass: 5 })
  assert.ok(r.gain <= 1 && r.gain >= 0, `gain ${r.gain}`)
  assert.ok(r.treb <= 1 && r.treb >= 0, `treb ${r.treb}`)
})
