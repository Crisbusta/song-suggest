import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  esc, parametrosAmpQueViajan, NOMBRE_PERILLA_AMPLI, nombrePerillaAmpli,
  conjuncion, resumenEnvioAmpli,
} from '../public/tarjeta.js'

// --- esc ---------------------------------------------------------------

test('esc escapa los cinco caracteres que rompen HTML', () => {
  assert.equal(esc(`<a href="x">M&M's</a>`), '&lt;a href=&quot;x&quot;&gt;M&amp;M&#39;s&lt;/a&gt;')
})

test('esc no toca lo que no necesita escape', () => {
  assert.equal(esc('Rage Against The Machine'), 'Rage Against The Machine')
})

// --- parametrosAmpQueViajan ----------------------------------------------

test('parametrosAmpQueViajan: las ya convertidas son las claves de paraElAmpli', () => {
  const { yaConvertidas } = parametrosAmpQueViajan({}, { gain: 0.5, treb: 0.4, bass: 0.6 })
  assert.deepEqual([...yaConvertidas].sort(), ['bass', 'gain', 'treb'])
})

test('parametrosAmpQueViajan: extra es lo que trae la cadena y paraElAmpli no cubre, sin volume', () => {
  const cadena = { amp: { valores: { gain: 5, mid: 7, volume: 3 } } }
  const { extra } = parametrosAmpQueViajan(cadena, { gain: 0.4 })
  // gain ya esta en paraElAmpli (no se duplica), volume se excluye siempre
  // (viaja aparte, en decibeles), mid es lo unico que queda.
  assert.deepEqual(extra, ['mid'])
})

test('parametrosAmpQueViajan: sin cadena ni paraElAmpli, ninguna de las dos listas revienta', () => {
  const { yaConvertidas, extra } = parametrosAmpQueViajan(undefined, undefined)
  assert.deepEqual([...yaConvertidas], [])
  assert.deepEqual(extra, [])
})

// --- nombrePerillaAmpli ----------------------------------------------------

test('nombrePerillaAmpli nombra las cuatro perillas conocidas', () => {
  assert.equal(nombrePerillaAmpli('gain'), 'Gain')
  assert.equal(nombrePerillaAmpli('treb'), 'Treble')
  assert.equal(nombrePerillaAmpli('bass'), 'Bass')
  assert.equal(nombrePerillaAmpli('mid'), 'Mid')
})

test('una clave sin nombre visible se nota con su propio nombre crudo, no desaparece', () => {
  assert.equal(nombrePerillaAmpli('presence'), 'presence')
  assert.ok(!('presence' in NOMBRE_PERILLA_AMPLI), 'este test asume que "presence" no esta mapeada')
})

// --- conjuncion ------------------------------------------------------------

test('conjuncion: vacia, una, dos y tres piezas', () => {
  assert.equal(conjuncion([]), '')
  assert.equal(conjuncion(['a']), 'a')
  assert.equal(conjuncion(['a', 'b']), 'a y b')
  assert.equal(conjuncion(['a', 'b', 'c']), 'a, b y c')
})

// --- resumenEnvioAmpli ------------------------------------------------------

test('sin sugerencia de ampli, no hay efectos y la frase dice que no se manda nada', () => {
  const r = resumenEnvioAmpli(null)
  assert.deepEqual(r.ranurasDeEfectos, [])
  assert.equal(r.hayEfectos, false)
  assert.equal(r.queSeManda, 'Sin modelo declarado, esta canción no manda nada al ampli por sí sola.')
})

test('sin modelo ni efectos ni perillas, el mensaje es el de "no manda nada", sin conjuncion vacia', () => {
  const r = resumenEnvioAmpli({ modelo: null, cadena: {}, paraElAmpli: {} })
  assert.equal(r.queSeManda, 'Sin modelo declarado, esta canción no manda nada al ampli por sí sola.')
})

test('sin modelo declarado, la frase NO promete perillas aunque paraElAmpli traiga valores', () => {
  // Adversario a proposito, igual que el punto 4 del brief con esc(): esta
  // combinacion (modelo null con paraElAmpli poblado) no la produce hoy
  // ningun origen real de sugerencia -- en los dos, modelo y las perillas
  // nacen del mismo `cadena.amp` -- pero en public/app.js, `objetivo('amp')`
  // cae al `fenderId` de la sugerencia cuando la cadena no trae uno propio, y
  // sin ninguno de los dos el Step 1 nunca entra a la ranura `amp`:
  // `conUnidad.has('amp')` queda falso y el Step 2 (las perillas ya
  // convertidas) no escribe ni una. Prometer perillas aca cuando el boton no
  // las va a escribir seria la interfaz desmintiendo al boton.
  const r = resumenEnvioAmpli({
    modelo: null,
    cadena: {},
    paraElAmpli: { gain: 0.5, treb: 0.4, bass: 0.6 },
  })
  assert.ok(!/perillas/.test(r.queSeManda), `no deberia prometer perillas: "${r.queSeManda}"`)
  assert.equal(r.queSeManda, 'Sin modelo declarado, esta canción no manda nada al ampli por sí sola.')
})

test('sin modelo pero con efectos propios, la frase promete los efectos y nada mas', () => {
  // Un preset que solo declara efectos (sin bloque de amp, ver el comentario
  // de `objetivo` en app.js): modelo sale null, pero los efectos SI se
  // escriben -- `cambiarEfecto` no depende de si el ampli cargo un modelo.
  const r = resumenEnvioAmpli({
    modelo: null,
    cadena: { stomp: { fenderId: 'DUBS_SimpleCompressor', nombre: 'COMPRESSOR', valores: {} } },
    paraElAmpli: {},
  })
  assert.equal(r.hayEfectos, true)
  assert.equal(r.queSeManda, 'Al ampli se mandan los <strong>efectos</strong>.')
})

test('la frase nombra exactamente las perillas que paraElAmpli emite, ni una mas ni una menos', () => {
  const r = resumenEnvioAmpli({
    modelo: 'DELUXE CLN',
    cadena: { amp: { valores: { gain: 5, treb: 4, bass: 6 } } },
    paraElAmpli: { gain: 0.44, treb: 0.33, bass: 0.55 },
  })
  assert.match(r.queSeManda, /las perillas de <strong>Gain<\/strong>, <strong>Treble<\/strong> y <strong>Bass<\/strong>/)
  assert.ok(!/Mid/.test(r.queSeManda))
})

test('mid aparece en la frase cuando el preset lo declara, aunque paraElAmpli no lo convierta', () => {
  // paraElAmpli() (lib/ampli.js) nunca emite mid -- viaja por la cadena
  // cruda de la planilla, y es exactamente lo que parametrosAmpQueViajan
  // rescata como "extra".
  const r = resumenEnvioAmpli({
    modelo: 'DELUXE CLN',
    cadena: { amp: { valores: { gain: 5, mid: 7 } } },
    paraElAmpli: { gain: 0.44 },
  })
  assert.match(r.queSeManda, /las perillas de <strong>Gain<\/strong> y <strong>Mid<\/strong>/)
})

test('una clave de amp sin nombre visible se nota en la frase, no desaparece', () => {
  const r = resumenEnvioAmpli({
    modelo: 'DELUXE CLN',
    cadena: { amp: { valores: { presence: 3 } } },
    paraElAmpli: {},
  })
  assert.match(r.queSeManda, /las perillas de <strong>presence<\/strong>/)
})

test('paraElAmpli vacio, sin efectos y con modelo: una sola pieza, sin conjuncion coja', () => {
  const r = resumenEnvioAmpli({ modelo: 'DELUXE CLN', cadena: {}, paraElAmpli: {} })
  assert.equal(r.queSeManda, 'Al ampli se mandan el <strong>modelo</strong>.')
})

test('modelo, efectos y perillas juntos se unen con conjuncion, no se listan sueltos', () => {
  const r = resumenEnvioAmpli({
    modelo: 'DELUXE CLN',
    cadena: { amp: { valores: { gain: 5 } }, stomp: { nombre: 'COMPRESSOR', valores: {} } },
    paraElAmpli: { gain: 0.44 },
  })
  assert.deepEqual(r.ranurasDeEfectos, ['stomp'])
  assert.equal(r.hayEfectos, true)
  assert.equal(
    r.queSeManda,
    'Al ampli se mandan el <strong>modelo</strong>, los <strong>efectos</strong> y las perillas de <strong>Gain</strong>.',
  )
})
