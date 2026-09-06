import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sugerirAjustes, MODELOS_LT25, fenderIdDeModelo, TAGS_CON_REGLA } from '../lib/ampli.js'
import { PRESETS_BANDA, auditoria } from '../lib/presets-comunidad.js'
import { readFileSync } from 'node:fs'

// Los nombres de modelo de estos tests salen del catalogo de unidades DSP del
// amplificador, no del manual. La primera version usaba nombres extraidos de
// un PDF mal parseado ('80s METAL, CHAMP) que el equipo no reconoce.

const PERILLAS = ['gain', 'volume', 'treble', 'bass', 'reverb']

/* NOTA sobre los tags de estos tests de la tabla de reglas: quince tags
   ('blues', 'blues rock', 'doom metal', 'jazz', 'nu metal', 'new wave',
   'indie rock'...) tienen ademas un tono de la comunidad en
   MAPEO_TONO_GENERO, y ese tono gana antes de llegar a la tabla -- tambien
   cuando la llamada no trae artista, porque un tono de genero no necesita
   saber quien toca. Los tests que ejercitan la TABLA usan por eso un tag
   hermano de la MISMA fila de REGLAS que no esta mapeado: la regla bajo prueba
   es identica y el camino es el que se quiere probar. Si se usara el tag
   mapeado, el test seguiria pasando o fallando por razones que no son las
   suyas. */

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
  // 'rap metal', misma fila de REGLAS que 'nu metal', sin tono de la comunidad.
  const estandar = sugerirAjustes({ tags: ['rap metal'], instrument: 'Distortion Guitar', tuning: null })
  const bajada = sugerirAjustes({ tags: ['rap metal'], instrument: 'Distortion Guitar', tuning: 'Drop C' })
  assert.ok(bajada.bass < estandar.bass, `bajada ${bajada.bass} deberia ser menor que estandar ${estandar.bass}`)
  assert.ok(bajada.motivos.includes('Drop C'))
})

test('las cinco perillas siempre quedan entre 1 y 10', () => {
  const casos = [
    { tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: 'Drop A' },
    { tags: ['jazz fusion'], instrument: 'Electric Guitar (jazz)', tuning: null },
    { tags: ['stoner metal'], instrument: 'Overdriven Guitar', tuning: '5 semitonos abajo' },
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
  const r = sugerirAjustes({ tags: ['southern rock', 'rock'], instrument: 'Overdriven Guitar', tuning: 'Medio tono abajo (Eb)' })
  assert.ok(r.motivos.includes('southern rock'))
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
  const r = sugerirAjustes({ tags: ['delta blues', '60s'], instrument: 'Overdriven Guitar', tuning: null })
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

// --- Los presets de la comunidad ---------------------------------------------
//
// Lo que la planilla trae le gana a lo que nosotros deducimos de un tag, pero
// es OPINION de alguien y no medicion: por eso cada sugerencia viaja diciendo
// de donde salio (`fuente`, `procedencia`) y si la fuente misma se declaro
// dudosa (`incierto`). Los artistas y canciones de estos tests son filas reales
// de data/presets-lt25-bandas.csv, no inventos: si una fila cambia, el test
// tiene que romperse y no seguir en verde sobre un dato que ya no existe.

test('una cancion con preset de la comunidad lo usa, y lo dice', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.fuente, 'comunidad')
  assert.match(r.procedencia, /Enter Sandman/i)
  assert.ok(r.cadena.amp)
})

test('el preset le gana a la tabla de reglas, no al reves', () => {
  // La misma cancion, con el mismo tag que dispararia METAL 2000. Si el preset
  // no manda, esto pasa en verde igual con `fuente` puesta a mano: por eso se
  // comprueba el MODELO, que es lo unico que distingue las dos fuentes.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.modelo, '90S ROCK', 'es el amp que la planilla escribio para esa fila')
  assert.notEqual(r.modelo, 'METAL 2000', 'METAL 2000 es lo que dirian las reglas de genero')
  assert.deepEqual(r.motivos, ['preset de la comunidad'])
})

test('sin preset, la tabla de reglas sigue mandando y se dice tambien', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Banda Que No Existe', title: 'x' })
  assert.equal(r.fuente, 'reglas')
  assert.equal(r.modelo, 'METAL 2000')
  assert.match(r.procedencia, /tags/i)
  assert.equal(r.cadena, null)
})

test('llamarla sin artista sigue funcionando igual que antes', () => {
  // Toda la suite anterior la llama asi: no puede romperse.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(r.modelo, 'METAL 2000')
  assert.equal(r.fuente, 'reglas')
})

test('un artista sin preset propio cae en el tono de genero antes que en las reglas', () => {
  const r = sugerirAjustes({ tags: ['doom metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Banda Que No Existe', title: 'x' })
  assert.equal(r.fuente, 'comunidad')
  assert.match(r.procedencia, /Doom Wizard/)
  // El mapeo tono->genero es juicio nuestro, no un dato que alguien escribio
  // junto a un genero, y el texto tiene que decirlo.
  assert.match(r.procedencia, /elegimos nosotros/i)
  assert.deepEqual(r.motivos, ['tono de la comunidad'])
})

test('un preset marcado como dudoso por la planilla llega marcado', () => {
  const r = sugerirAjustes({ tags: [], instrument: 'Distortion Guitar', tuning: null,
    artist: 'Radiohead', title: 'Creep' })
  assert.ok(r.incierto, 'la planilla marco esa fila como experimental')
  // Y lo que sale de las reglas no puede llegar marcado como dudoso.
  assert.equal(sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: null }).incierto, false)
})

test('lo que la planilla no dice queda en null, no en un valor inventado', () => {
  /* El corazon de este modulo: un numero inventado que parece plausible es peor
     que no tener el dato. La fila "Curtis Mayfield" no declara gain -- se
     comprueba sobre ESA fila y no sobre una que declare las cinco perillas,
     porque un test que solo mira filas completas pasa en verde aunque el codigo
     rellene los huecos con un 5. */
  const r = sugerirAjustes({ tags: ['soul'], instrument: 'Electric Guitar (clean)',
    tuning: null, artist: 'Curtis Mayfield', title: 'Move On Up' })
  assert.equal(r.fuente, 'comunidad')
  assert.equal(r.gain, null, 'la planilla no escribio gain en esa fila')
  // Y las que si escribio llegan tal cual, sin redondear: 9,5 es lo que dice.
  assert.equal(r.volume, 9.5)
  assert.equal(r.bass, 9.5)

  // Otra fila real, con el hueco en otra perilla: no es un caso aislado.
  const m = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Cancion Que No Esta En La Planilla' })
  assert.equal(m.bass, null, '"James Hetfield / Metallica" no declara bass')
  assert.equal(m.gain, 10)
})

test('el reverb del panel nunca se inventa: la planilla no lo trae', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.reverb, null)
  // El reverb del preset vive en su propia ranura, que es otra cosa.
  assert.ok(r.cadena.reverb, 'la ranura reverb del preset si viaja')
})

test('el modelo del preset de la comunidad tambien viaja con su FenderId', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.ok(r.fenderId.startsWith('DUBS_'))
  assert.equal(r.fenderId, r.cadena.amp.fenderId)
  assert.ok(MODELOS_LT25.includes(r.modelo), `"${r.modelo}" no es un modelo del LT25`)
})

test('un preset tomado de otra cancion del artista lo dice', () => {
  /* presets-comunidad.js acepta ese respaldo justamente a condicion de no
     callarlo: "usarla callando que es de otra cancion seria la unica opcion
     deshonesta de las tres". Presentarlo como "el preset de The Police" a secas
     rompe ese trato. The Police solo tiene "Every Breath You Take" en la
     planilla, y 15 de sus 16 canciones del catalogo pasan por aqui. */
  const r = sugerirAjustes({ tags: ['new wave'], instrument: 'Electric Guitar (clean)',
    tuning: null, artist: 'The Police', title: 'Roxanne' })
  assert.equal(r.fuente, 'comunidad')
  assert.match(r.procedencia, /otra cancion/i)
  assert.match(r.procedencia, /Every Breath You Take/i)
})

test('un artista con varios presets y sin desempate de epoca lo dice', () => {
  // Rush tiene tres filas (70s, 80s, 90s) y esta llamada no trae tag de decada.
  const r = sugerirAjustes({ tags: ['progressive rock'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Rush', title: 'YYZ' })
  assert.match(r.procedencia, /uno de varios/i)
})

test('todo preset alcanzable llega con un modelo y un identificador que el equipo acepta', () => {
  // Barrido sobre las filas reales: una fila cuyo amp no resuelva viajaria sin
  // identificador y el envio la ignoraria en silencio.
  for (const p of PRESETS_BANDA) {
    if (!p.artista) continue
    const r = sugerirAjustes({ tags: [], instrument: 'Distortion Guitar', tuning: null,
      artist: p.artista, title: p.cancion ?? '' })
    assert.ok(r, `"${p.clave}" no produjo sugerencia`)
    assert.equal(r.fuente, 'comunidad')
    if (r.modelo === null) continue   // una cadena sin ranura amp es legitima
    assert.ok(MODELOS_LT25.includes(r.modelo), `"${r.modelo}" (${p.clave}) no es un modelo del LT25`)
    assert.equal(r.fenderId, fenderIdDeModelo(r.modelo), `"${p.clave}" viajaria con otro identificador`)
    for (const k of ['gain', 'volume', 'treble', 'bass']) {
      // La escala de la planilla es la nuestra, pero el rango NO se asume: hay
      // una fila real fuera de rango (ver el test siguiente). Lo que si se
      // exige es que sea un numero o el null explicito de "no lo dijo".
      assert.ok(r[k] === null || Number.isFinite(r[k]), `${p.clave}: ${k} = ${r[k]}`)
    }
    const enviable = paraElAmpli(r)
    for (const [k, v] of Object.entries(enviable)) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${p.clave}: ${k} viajaria como ${v}`)
    }
  }
})

test('ninguna perilla llega fuera del rango que el equipo declara', () => {
  /* "Custom User - Horse N Buggy" (bandas.csv linea 18) escribio bass 44,2 en un
     DELUXE CLN, cuya perilla va de 1 a 10. No es un ajuste, es un dedazo, y
     dejarlo pasar no era neutral: la conversion lo habria acotado y le habria
     mandado al amplificador el bass AL TOPE por un error de otra persona. Se
     descarta en la importacion, con aviso, y la perilla queda en el valor por
     defecto de la unidad, que es dato real del equipo. */
  const UNIDADES_JSON = JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
  const rango = (fenderId, controlId) => {
    const d = UNIDADES_JSON.find(u => u.FenderId === fenderId)?.ui?.uiParameters?.find(p => p.controlId === controlId)
    const escalas = [d?.remap, d].filter(e => typeof e?.min === 'number' && typeof e?.max === 'number')
    return escalas.length ? { min: Math.min(...escalas.map(e => e.min)), max: Math.max(...escalas.map(e => e.max)) } : null
  }
  const fuera = []
  for (const p of PRESETS_BANDA) {
    for (const [ranura, u] of Object.entries(p.cadena)) {
      for (const [k, v] of Object.entries(u.valores)) {
        // El rango sale del catalogo del equipo, no de un 0-10 escrito a mano:
        // el time del delay va de 30 a 1000 ms y un 0-10 lo daria por malo.
        const r = rango(u.fenderId, k)
        if (r && (v < r.min || v > r.max)) fuera.push(`${p.clave} ${ranura}: ${k} = ${v} (${r.min}..${r.max})`)
      }
    }
  }
  assert.deepEqual(fuera, [])

  // Y no se descarto en silencio: el aviso dice fila, archivo, linea y ranura.
  const aviso = auditoria().avisos.find(a => a.fila === 'Custom User - Horse N Buggy' && /fuera del rango/.test(a.motivo))
  assert.ok(aviso, 'el valor descartado tiene que quedar anotado, no desaparecer')
  assert.equal(aviso.ranura, 'amp')
  assert.equal(aviso.linea, 18)
  assert.match(aviso.motivo, /44\.2/)
})

test('un track acustico no recibe el preset electrico de la banda', () => {
  /* Estos presets estan indexados por banda, y el tono de una banda es el de su
     equipo electrico. Casos reales del catalogo: sin esta regla, Rush "Closer To
     The Heart" con guitarra de NYLON recibia BURN a gain 10, y Metallica
     "Mama Said" en acustica de acero, 70S UK CLEAN a gain 10. */
  for (const instr of ['Acoustic Guitar (steel)', 'Acoustic Guitar (nylon)']) {
    const r = sugerirAjustes({ tags: ['thrash metal'], instrument: instr,
      tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
    assert.equal(r.fuente, 'reglas', `${instr} no deberia recibir el preset de la banda`)
    assert.equal(r.modelo, 'CHAMPION')
    assert.ok(r.gain <= 2, `un acustico no lleva ganancia, dio ${r.gain}`)
    assert.equal(r.cadena, null, 'tampoco la cadena de pedales electricos')
  }
  // Y el tono de genero cae por lo mismo: tambien es un tono de guitarra electrica.
  const g = sugerirAjustes({ tags: ['doom metal'], instrument: 'Acoustic Guitar (steel)',
    tuning: null, artist: 'Banda Que No Existe', title: 'x' })
  assert.equal(g.fuente, 'reglas')
  assert.equal(g.modelo, 'CHAMPION')
})

test('un track electrico limpio SI conserva el preset de la banda', () => {
  // Decision explicita y del lado contrario: sigue siendo una guitarra
  // electrica, asi que el modelo de ampli de esa banda es plausible. Si esto
  // cambia alguna vez, que cambie a la vista y no por arrastre del caso acustico.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Electric Guitar (clean)',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.fuente, 'comunidad')
  assert.equal(r.modelo, '90S ROCK')
})

// --- Lo que NO se manda al amplificador --------------------------------------

test('una perilla que la planilla no declaro no se manda como 0', () => {
  /* Este es el test que cierra el agujero que abrio la correccion anterior.
     `Number(null)` es 0 y `(0 - 1) / 9` es finito, asi que acotar dejaba un
     gain: 0 -- el MINIMO -- presentado como un valor elegido. Es la misma
     mentira que este modulo se niega a contar, solo que del otro lado del
     cable: el usuario veria la perilla en null en pantalla y el ampli quedaria
     con el gain al piso. */
  const r = paraElAmpli({ gain: null, treble: 7, bass: 5 })
  assert.ok(!('gain' in r), `gain no deberia viajar, vino ${r.gain}`)
  assert.equal(r.treb, 6 / 9)
  assert.equal(r.bass, 4 / 9)
})

test('el camino completo tampoco manda esa perilla', () => {
  const r = sugerirAjustes({ tags: ['soul'], instrument: 'Electric Guitar (clean)',
    tuning: null, artist: 'Curtis Mayfield', title: 'Move On Up' })
  assert.equal(r.gain, null)
  const enviable = paraElAmpli(r)
  assert.ok(!('gain' in enviable), `gain no deberia viajar, vino ${enviable.gain}`)
  assert.ok('treb' in enviable && 'bass' in enviable, 'las que si declaro tienen que viajar')
})

test('una perilla ausente o con basura se omite, no se manda como 0', () => {
  assert.deepEqual(paraElAmpli({ bass: 5 }), { bass: 4 / 9 })
  assert.deepEqual(paraElAmpli({ gain: 'abc', bass: 5 }), { bass: 4 / 9 })
  assert.deepEqual(paraElAmpli({ gain: undefined, treble: null, bass: 5 }), { bass: 4 / 9 })
  // Un preset que no declara ninguna de las tres no manda ninguna: las tres
  // quedan en el valor por defecto de la unidad, que es dato real del equipo.
  assert.deepEqual(paraElAmpli({ volume: 7 }), {})
})

test('un 0 de verdad no se confunde con una perilla ausente', () => {
  // 0 esta fuera de la escala 1-10 y se acota a 0; lo que importa es que VIAJE,
  // porque es un valor que alguien escribio y no un hueco.
  const r = paraElAmpli({ gain: 0, treble: 5, bass: 5 })
  assert.ok('gain' in r)
  assert.equal(r.gain, 0)
})
