import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sugerirAjustes, MODELOS_LT25, fenderIdDeModelo, TAGS_CON_REGLA } from '../lib/ampli.js'
import { readFileSync } from 'node:fs'

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
  // Fuera de rango: se acota.
  const fuera = paraElAmpli({ gain: 99, treble: -5, bass: 5 })
  assert.ok(fuera.gain <= 1 && fuera.gain >= 0, `gain ${fuera.gain}`)
  assert.ok(fuera.treb <= 1 && fuera.treb >= 0, `treb ${fuera.treb}`)

  // Clave ausente y valor no numerico: Math.min/max propagan NaN, asi que
  // esto no se acota solo. NaN sobreviviria como null tras JSON.stringify.
  const raro = paraElAmpli({ gain: 'abc', bass: 5 })   // treble ausente
  for (const [k, v] of Object.entries(raro)) {
    assert.ok(Number.isFinite(v), `${k} no es finito: ${v}`)
    assert.ok(v >= 0 && v <= 1, `${k} fuera de rango: ${v}`)
  }
})

// --- El modelo que se manda al amplificador ---------------------------------

const UNIDADES = JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
const AMPS_DEL_CATALOGO = UNIDADES.filter(u => u.info?.subcategory === 'amp')

/* Este es el test que cierra un agujero real de este proyecto. Los veinte
   nombres de MODELOS_LT25 salieron una vez de extraer texto de un PDF; tres
   estaban mal y afectaban al 36% de las sugerencias, y el test que debia
   cazarlo comparaba la tabla contra esa MISMA lista equivocada, asi que pasaba
   en verde. Ahora la lista se valida contra el catalogo de unidades del propio
   equipo, que es lo que el amplificador acepta de verdad. */
test('los veinte modelos que nombramos existen en el catalogo del equipo', () => {
  for (const m of MODELOS_LT25) {
    // No se comprueba ademas que el id este en AMPS_DEL_CATALOGO: el mapa se
    // construye con ese mismo filtro, asi que esa asercion no puede fallar.
    assert.ok(fenderIdDeModelo(m), `"${m}" no existe en el catalogo del LT25`)
  }
})

test('y no sobra ninguno: la lista y el catalogo dicen lo mismo', () => {
  // Un modelo del catalogo que no esta en la lista es una sugerencia que nunca
  // vamos a poder hacer; uno de la lista que no esta en el catalogo es una que
  // el equipo va a ignorar en silencio.
  const enCatalogo = AMPS_DEL_CATALOGO.map(u => u.info.displayName).sort()
  assert.deepEqual([...MODELOS_LT25].sort(), enCatalogo)
})

test('un modelo que no existe no se inventa un identificador', () => {
  assert.equal(fenderIdDeModelo('80s METAL'), null)   // uno de los tres nombres malos de aquella vez
  assert.equal(fenderIdDeModelo(''), null)
  assert.equal(fenderIdDeModelo(undefined), null)
})

test('la sugerencia viaja con el identificador que el equipo entiende', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(r.modelo, 'METAL 2000')
  assert.equal(r.fenderId, fenderIdDeModelo('METAL 2000'))
  assert.ok(r.fenderId.startsWith('DUBS_'), 'un FenderId del LT25 siempre empieza con DUBS_')
})

test('todo modelo alcanzable por la tabla trae su identificador', () => {
  // La cobertura sale de REGLAS, no de una lista escrita a mano: con una lista
  // a mano, la fila de 'new wave'/'post-punk'/'gothic rock' quedaba sin
  // ejercitar, y ponerle un modelo inexistente pasaba en verde.
  for (const tag of TAGS_CON_REGLA) {
    for (const instr of ['Distortion Guitar', 'Electric Guitar (clean)', 'Acoustic Guitar (steel)']) {
      for (const tags of [[tag], [tag, '60s'], [tag, '70s']]) {
        const r = sugerirAjustes({ tags, instrument: instr, tuning: null })
        if (!r) continue
        assert.ok(MODELOS_LT25.includes(r.modelo), `"${r.modelo}" no es un modelo del LT25`)
        assert.ok(r.fenderId, `"${r.modelo}" viajaria sin identificador`)
      }
    }
  }
})

/* Las tres sustituciones se comprueban DIRECTAMENTE. Comprobarlas viendo si su
   modelo aparece en el conjunto de los alcanzados no prueba nada: dos de los
   tres modelos sustitutos tambien salen de reglas directas, asi que el
   conjunto los contiene aunque la sustitucion no corra. */
test('la sustitucion por instrumento acustico apunta a un modelo real', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Acoustic Guitar (steel)', tuning: null })
  assert.equal(r.modelo, 'CHAMPION')
  assert.ok(r.fenderId)
})

test('la sustitucion por track limpio apunta a un modelo real', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Electric Guitar (clean)', tuning: null })
  assert.equal(r.modelo, 'DELUXE CLN')
  assert.ok(r.fenderId)
})

test('las dos sustituciones por epoca apuntan a modelos reales', () => {
  const sesenta = sugerirAjustes({ tags: ['heavy metal', '60s'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(sesenta.modelo, '60S UK CLEAN')
  assert.ok(sesenta.fenderId)
  const setenta = sugerirAjustes({ tags: ['heavy metal', '70s'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(setenta.modelo, 'BASSMAN')
  assert.ok(setenta.fenderId)
})
