import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  esc, parametrosAmpQueViajan, NOMBRE_PERILLA_AMPLI, nombrePerillaAmpli,
  conjuncion, resumenEnvioAmpli, etiquetaDePista, selectorDePistas,
  urlUltimateGuitar, etiquetasDePistas, listaDePistas,
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

// --- etiquetaDePista --------------------------------------------------------

test('etiquetaDePista nombra la pista, su dificultad y su afinacion', () => {
  assert.equal(
    etiquetaDePista({
      name: 'Kirk Hammett | Lead Guitar', instrument: 'Distortion Guitar',
      difficulty: 2, tuning: null,
    }),
    'Kirk Hammett | Lead Guitar · dificultad 2'
  )
  assert.equal(
    etiquetaDePista({
      name: 'Rhythm', instrument: 'Distortion Guitar', difficulty: 4, tuning: 'Drop D',
    }),
    'Rhythm · dificultad 4 · Drop D'
  )
})

/* El catalogo trae nombres vacios y nombres en otros alfabetos ('Дорожка 1').
   Sin nombre, el instrumento es lo unico que queda para distinguir la pista:
   una opcion en blanco en el selector no se puede elegir a proposito. */
test('sin nombre, la pista se identifica por su instrumento', () => {
  assert.equal(
    etiquetaDePista({ name: '', instrument: 'Acoustic Guitar (steel)', difficulty: 3, tuning: null }),
    'Acoustic Guitar (steel) · dificultad 3'
  )
  assert.equal(
    etiquetaDePista({ name: null, instrument: 'Drums', difficulty: 5, tuning: null }),
    'Drums · dificultad 5'
  )
})

// --- selectorDePistas -------------------------------------------------------

const pistaDe = (o = {}) => ({
  name: 'Rhythm', instrument: 'Distortion Guitar', difficulty: 3, tuning: null,
  califica: true, ...o,
})

/* Con una sola pista no hay nada que elegir: el bloque entero no se dibuja.
   Es lo que separa "la cancion tiene una pista" de "la cancion tiene una
   pista y te la ofrezco como si pudieras cambiarla". */
test('con una sola pista no hay selector', () => {
  assert.equal(selectorDePistas([pistaDe()], 0), '')
  assert.equal(selectorDePistas([], 0), '')
})

test('con dos pistas o mas, el selector marca selected SOLO en la elegida', () => {
  const html = selectorDePistas([pistaDe({ name: 'A' }), pistaDe({ name: 'B' }), pistaDe({ name: 'C' })], 1)
  assert.match(html, /<select id="pista">/)
  assert.match(html, /<option value="1" selected/)
  assert.equal(html.match(/ selected/g).length, 1, 'una sola opcion puede venir seleccionada')
  assert.match(html, /<option value="0"[^>]*>\s*A · dificultad 3\s*<\/option>/)
})

/* Las que no cumplen el filtro se listan igual y se dicen: quien mira tiene
   que poder ver por que salio esta cancion y cual pista no fue el motivo. */
test('las pistas que no califican se marcan, y las que califican no', () => {
  const html = selectorDePistas([
    pistaDe({ name: 'Sirve', califica: true }),
    pistaDe({ name: 'No sirve', califica: false }),
  ], 0)
  assert.match(html, /<option value="1"[^>]*class="no-califica"[^>]*>\s*No sirve · dificultad 3 — fuera del filtro\s*<\/option>/)
  assert.match(html, /<option value="0"[^>]*>\s*Sirve · dificultad 3\s*<\/option>/)
  assert.equal(html.match(/no-califica/g).length, 1)
  assert.equal(html.match(/fuera del filtro/g).length, 1)
})

// El nombre de la pista es texto de terceros: sale del catalogo y entra a HTML.
test('el nombre de la pista se escapa', () => {
  const html = selectorDePistas([
    pistaDe({ name: '<img src=x onerror="alert(1)">' }), pistaDe({ name: 'M&M' }),
  ], 0)
  assert.ok(!html.includes('<img'), 'no puede quedar una etiqueta cruda del catalogo')
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
  assert.match(html, /M&amp;M/)
})

const pistaEtiqueta = (name, instrument = 'Distortion Guitar') => ({ name, instrument })
test('etiquetasDePistas quita segmentos comunes y prefiere rol', () => {
  assert.deepEqual(etiquetasDePistas([
    pistaEtiqueta('Eric Clapton | Lead Nylon Guitar | C.F. Martin 000-42'),
    pistaEtiqueta('Eric Clapton | Rhythm Nylon Guitar | C.F. Martin 000-42'),
  ]), ['Lead Nylon Guitar', 'Rhythm Nylon Guitar'])
})
/* El paso 3 de la regla, que es el unico sin cubrir: cuando dos pistas quedan
   con la misma etiqueta, se les antepone el primer segmento que LA HERMANA con
   la que chocan no tiene. Caso real de Tears In Heaven -- las dos pistas de
   pedal steel comparten musico y equipo, y solo las separa "1st"/"2nd". Sin
   este paso caerian al ultimo recurso (el numero) y se perderia el dato util. */
test('etiquetasDePistas desempata con el segmento que la hermana no tiene', () => {
  const r = etiquetasDePistas([
    pistaEtiqueta('JayDee Maness | 1st Guitar | Pedal Steel Guitar'),
    pistaEtiqueta('JayDee Maness | 2nd Guitar | Pedal Steel Guitar'),
  ])
  assert.notEqual(r[0], r[1])
  assert.match(r[0], /1st Guitar/)
  assert.match(r[1], /2nd Guitar/)
  assert.ok(!/ · \d+$/.test(r[0]), 'no debe caer al numero habiendo un segmento que las separa')
})

test('etiquetasDePistas usa instrumento vacio y nunca colisiona', () => {
  assert.deepEqual(etiquetasDePistas([pistaEtiqueta(null, 'Acoustic Guitar (steel)')]), ['Acoustic Guitar (steel)'])
  const etiquetas = etiquetasDePistas([pistaEtiqueta('Guitar'), pistaEtiqueta('Guitar')])
  assert.equal(new Set(etiquetas).size, 2)
})
test('listaDePistas agrupa, marca y escapa datos del catalogo', () => {
  const html = listaDePistas([
    pistaDe({ name: '<img onerror=1>', tuning: null }),
    pistaDe({ name: 'Otra', instrument: 'Acoustic Guitar (steel)', califica: false }),
  ], 0)
  assert.match(html, /DISTORSIÓN/)
  assert.match(html, /ACÚSTICA/)
  assert.match(html, /elegida/)
  assert.match(html, /fuera del filtro/)
  assert.match(html, /E estándar/)
  assert.ok(!html.includes('<img onerror'))
  assert.equal(listaDePistas([pistaDe()], 0), '')
})

/* La busqueda de Ultimate Guitar lleva banda y titulo juntos: en este catalogo
   hay artistas oscuros donde el titulo solo no alcanza. Verificado contra su
   buscador real -- "iron maiden fear of the dark" y "metallica one" ponen la
   correcta primera. */
test('urlUltimateGuitar arma la busqueda con banda y titulo', () => {
  assert.equal(
    urlUltimateGuitar('Iron Maiden', 'Fear of the Dark'),
    'https://www.ultimate-guitar.com/search.php?search_type=title&value=Iron%20Maiden%20Fear%20of%20the%20Dark'
  )
})

/* El titulo va TAL CUAL, sin limpiar. Los 944 titulos con parentesis del
   catalogo son casi todos parentesis de verdad -- "Welcome Home (Sanitarium)",
   "Snow (Hey Oh)" -- y quitarlos empeoraria la busqueda en vez de mejorarla. */
test('urlUltimateGuitar no toca los parentesis del titulo', () => {
  const url = urlUltimateGuitar('Metallica', 'Welcome Home (Sanitarium)')
  assert.ok(url.includes('Welcome%20Home%20(Sanitarium)'), url)
})

test('urlUltimateGuitar escapa lo que romperia la URL', () => {
  const url = urlUltimateGuitar('AC/DC', 'Rock & Roll Ain\'t Noise Pollution')
  assert.ok(url.includes('AC%2FDC'), 'la barra no puede quedar cruda: ' + url)
  assert.ok(url.includes('%26'), 'el ampersand tampoco, partiria el query: ' + url)
})

test('urlUltimateGuitar conserva los acentos escapados, no los borra', () => {
  const url = urlUltimateGuitar('Maná', 'Corazón Espinado')
  assert.ok(url.includes('Man%C3%A1'), url)
  assert.ok(!url.includes('Mana&'), 'no se transliteran: es lo que el buscador espera')
})

/* Sin uno de los dos no hay busqueda util que ofrecer. Devolver una URL a medias
   mandaria al usuario a una pagina de resultados vacia con su nombre encima. */
test('urlUltimateGuitar devuelve null si falta la banda o el titulo', () => {
  assert.equal(urlUltimateGuitar('', 'One'), null)
  assert.equal(urlUltimateGuitar('Metallica', ''), null)
  assert.equal(urlUltimateGuitar(null, null), null)
})
