/* ---------------------------------------------------------------------------
   Importa la planilla de la comunidad (ver data/PROCEDENCIA.md).

   Es OPINION, no medicion: los ajustes que a alguien le funcionaron. Por eso
   cada preset conserva de donde salio y si la propia planilla lo marco como
   dudoso, y por eso nada se descarta en silencio -- auditoria() dice cuantas
   filas se leyeron, cuantas entraron y por que se cayo cada una.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'
import { parsearCsv, numeroCsv } from './csv.js'
import { resolverUnidad } from './lt25-nombres.js'

const leer = f => parsearCsv(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'))

const BLOQUES_BANDA = { amp: [3, 4, 7], stomp: [11, 12, 5], mod: [17, 18, 5], delay: [23, 24, 4], reverb: [28, 29, 3] }
const BLOQUES_TONO  = { amp: [1, 2, 5], stomp: [7, 8, 5], mod: [13, 14, 5], delay: [19, 20, 4], reverb: [24, 25, 3] }

/* El catalogo entero, para leer la unidad de medida ("units") que el propio
   equipo declara para un parametro puntual. Es lo unico que permite rescatar
   una celda como "290ms": no se adivina una unidad -- se lee la que el
   catalogo YA declaro para ese controlId exacto, y solo se acepta si el
   sufijo de texto calza letra por letra con esa unidad. Si no calza, no se
   rescata: se avisa en vez de inventar. */
const CATALOGO = JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
const catalogoPorId = new Map(CATALOGO.map(u => [u.FenderId, u]))
function unidadDeclarada(fenderId, controlId) {
  const p = catalogoPorId.get(fenderId)?.ui?.uiParameters?.find(p => p.controlId === controlId)
  return p?.units ?? null
}
const RE_NUMERO_CON_SUFIJO = /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]+)$/
function numeroConSufijoDeclarado(celda, fenderId, controlId) {
  const m = String(celda ?? '').trim().match(RE_NUMERO_CON_SUFIJO)
  if (!m) return null
  const unidad = unidadDeclarada(fenderId, controlId)
  if (!unidad || m[2].toLowerCase() !== unidad.toLowerCase()) return null
  return numeroCsv(m[1])
}

// Filas enteras que no producen ningun preset (auditoria().descartadas). Esta
// es la cuenta que tiene que cerrar exacto contra "leidas": cada fila leida
// termina en exactamente uno de los dos lados, nunca en ninguno ni en ambos.
const descartes = []

/* Anomalias que no cambian esa cuenta de filas (la fila sigue produciendo un
   preset, con al menos una ranura util) pero que tampoco se pueden callar:
     - una unidad con nombre que no resuelve (la ranura entera se omite),
     - una ranura con valores pero sin nombre de unidad (los valores se tiran,
       fila 71 "Super Clean" y otras tres),
     - una celda, dentro del rango de perillas ya resuelto, que no es un
       numero y tampoco se pudo rescatar via unidadDeclarada (la perilla queda
       en el default de la unidad).
   Cada una lleva `fila` (la clave, para que se lea), `archivo` y `linea` (que
   CSV y que numero de linea, porque ni la clave sola es unica -- "Alex
   Lifeson / Rush" aparece tres veces -- ni la linea sola: las dos hojas
   tienen su propia numeracion y pueden compartir numero de linea). */
const avisos = []

const marcaIncierta = /\{EXPERIMENTAL\}|\(INACCURATE\)|\?/i

/* Lee un bloque: la unidad y sus perillas, por POSICION en el orden que declara
   el catalogo. Solo entran los parametros que la planilla escribio; el resto se
   queda en el valor por defecto de la unidad, que es dato real del equipo.

   Del amplificador solo se leen sus cinco perillas aunque la hoja reserve siete
   columnas: las dos ultimas traen valores negativos y no sabemos que son. */
function leerBloque(fila, [iNombre, iValor, ancho], donde, ranura) {
  const crudo = (fila[iNombre] ?? '').trim()
  if (!crudo || crudo === '-') {
    // Sin nombre de unidad no hay donde poner un valor. Si la planilla dejo
    // igual numeros o texto en esas columnas, eso es dato que se esta
    // tirando -- se avisa, no se calla.
    const sueltos = []
    for (let k = 0; k < ancho; k++) {
      const v = (fila[iValor + k] ?? '').trim()
      if (v && v !== '-') sueltos.push(v)
    }
    if (sueltos.length) {
      avisos.push({ ...donde, ranura, motivo: `hay valores (${sueltos.join(', ')}) pero la columna de unidad esta vacia` })
    }
    return null
  }
  const u = resolverUnidad(crudo)
  if (!u) { avisos.push({ ...donde, ranura, motivo: `unidad no reconocida: "${crudo}"` }); return null }
  const valores = {}
  const cuantos = Math.min(ancho, u.parametros.length)
  for (let k = 0; k < cuantos; k++) {
    const clave = u.parametros[k]
    const crudoValor = fila[iValor + k]
    let v = numeroCsv(crudoValor)
    if (v === null) v = numeroConSufijoDeclarado(crudoValor, u.fenderId, clave)
    if (v !== null) { valores[clave] = v; continue }
    const texto = String(crudoValor ?? '').trim()
    if (texto && texto !== '-') {
      avisos.push({ ...donde, ranura, motivo: `"${clave}" de ${u.nombre} no es un numero en la planilla: "${texto}"` })
    }
  }
  return { fenderId: u.fenderId, nombre: u.nombre, valores }
}

function leerCadena(fila, bloques, donde) {
  const cadena = {}
  for (const [ranura, b] of Object.entries(bloques)) {
    const u = leerBloque(fila, b, donde, ranura)
    if (u) cadena[ranura] = u
  }
  return cadena
}

// "Metallica - Enter Sandman" -> artista y cancion. "Alex Lifeson / Rush" -> banda.
function partirClave(txt) {
  const limpio = txt.replace(/\{[^}]*\}|\([^)]*\)/g, '').trim()
  const porBarra = limpio.split(/\s*\/\/?\s*/).map(s => s.trim()).filter(Boolean)
  const base = porBarra.length > 1 ? porBarra[porBarra.length - 1] : porBarra[0] ?? limpio
  const m = base.match(/^(.+?)\s+-\s+(.+)$/)
  return m ? { artista: m[1].trim(), cancion: m[2].trim() } : { artista: base, cancion: null }
}

// Las filas de datos con su numero de linea real del CSV (1-indexado, +1 por
// la cabecera), calculado ANTES de filtrar filas en blanco: asi el numero de
// linea de las que quedan sigue apuntando al archivo de verdad.
const conLineas = filasCrudas => filasCrudas.slice(1)
  .map((f, i) => ({ f, linea: i + 2 }))
  .filter(({ f }) => f[0]?.trim())

const filasBanda = conLineas(leer('presets-lt25-bandas.csv'))
const filasTono  = conLineas(leer('presets-lt25-tonos.csv'))

function construirBandas() {
  const out = []
  for (const { f, linea } of filasBanda) {
    const clave = f[0].trim()
    const donde = { fila: clave, archivo: 'bandas', linea }
    const cadena = leerCadena(f, BLOQUES_BANDA, donde)
    if (Object.keys(cadena).length === 0) { descartes.push({ ...donde, motivo: 'ninguna ranura reconocible' }); continue }
    const { artista, cancion } = partirClave(clave)
    out.push({
      clave, artista, cancion,
      genero: (f[1] ?? '').trim() || null,
      epoca: (f[2] ?? '').trim().replace(/^-$/, '') || null,
      incierto: marcaIncierta.test(clave),
      cadena,
    })
  }
  return out
}

function construirTonos() {
  const out = []
  for (const { f, linea } of filasTono) {
    const clave = f[0].trim()
    const donde = { fila: clave, archivo: 'tonos', linea }
    const cadena = leerCadena(f, BLOQUES_TONO, donde)
    if (Object.keys(cadena).length === 0) { descartes.push({ ...donde, motivo: 'ninguna ranura reconocible' }); continue }
    out.push({
      clave, artista: null, cancion: null, genero: null, epoca: null,
      incierto: marcaIncierta.test(clave),
      cadena,
    })
  }
  return out
}

export const PRESETS_BANDA = construirBandas()
export const PRESETS_TONO = construirTonos()

export const auditoria = () => ({
  leidas: { bandas: filasBanda.length, tonos: filasTono.length },
  importadas: PRESETS_BANDA.length + PRESETS_TONO.length,
  descartadas: descartes,
  // Anomalias que no afectan la cuenta de filas pero tampoco se ocultan:
  // ver el comentario de `avisos` mas arriba.
  avisos,
})

/* ---------------------------------------------------------------------------
   buscarPreset: calza un preset de la planilla contra una cancion del
   catalogo. La normalizacion existe porque los dos lados escriben distinto
   ("The Rolling Stones" en el catalogo, "Keith Richards / Rolling Stones" en
   la planilla) -- NO es matching difuso. lt25-nombres.js documenta en su
   encabezado por que este proyecto no adivina nombres (un matcher por
   prefijo convirtio alguna vez "5.0" en el modelo "50S TWIN", en silencio):
   aca se normaliza mayuscula, acento, articulo inicial y puntuacion, nunca
   substring, prefijo ni distancia de edicion. Un artista sin preset
   devuelve null, nunca algo parecido.
   --------------------------------------------------------------------------- */
const norm = s => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/* Dos indices sobre PRESETS_BANDA:
     - porCancion: "artista||cancion" -> el preset de esa cancion puntual.
     - porArtista: "artista" -> los presets GENERICOS del artista, es decir
       los que la planilla no ato a una cancion (p.cancion === null).
   Un preset de cancion puntual (p.ej. "Metallica - Enter Sandman") NO entra
   en porArtista: la planilla trae ademas "James Hetfield / Metallica", que
   es el preset generico real de la banda, y si se pide otra cancion de
   Metallica corresponde ofrecer ESE, no el de Enter Sandman disfrazado de
   "el tono de Metallica". (Esto es real: verificado contra
   data/presets-lt25-bandas.csv, lineas 34 y 50.) */
const porCancion = new Map(), porArtista = new Map()
for (const p of PRESETS_BANDA) {
  const artista = norm(p.artista)
  if (p.cancion) {
    porCancion.set(`${artista}||${norm(p.cancion)}`, p)
    continue
  }
  if (artista) porArtista.set(artista, [...(porArtista.get(artista) ?? []), p])
}

// Las decadas que la planilla usa en su columna Era y que el catalogo de
// canciones ya trae como tags -- son el mismo dato en dos lugares, por eso
// sirven de desempate real (ver mas abajo) y no un heuristico inventado.
const DECADAS = ['50s', '60s', '70s', '80s', '90s', '00s', '2000s', '2010s']

/* De lo mas especifico a lo mas generico: una cancion nombrada gana; si no,
   el preset generico del artista; y si el artista tiene varios (Rush tiene
   tres: 70s, 80s, 90s; Keith Richards y Fela, dos cada uno) desempata la
   decada de la cancion contra la columna Era de la planilla -- el mismo
   campo real en los dos lados, no una adivinanza. */
export function buscarPreset({ artist, title, tags = [] }) {
  const a = norm(artist)
  if (!a) return null

  const exacta = porCancion.get(`${a}||${norm(title)}`)
  if (exacta) return { preset: exacta, motivo: 'cancion' }

  const suyos = porArtista.get(a)
  if (!suyos?.length) return null
  if (suyos.length === 1) return { preset: suyos[0], motivo: 'artista' }

  const decadas = new Set(tags.map(t => String(t).toLowerCase()).filter(t => DECADAS.includes(t)))
  const porEpoca = suyos.find(p => p.epoca && [...decadas].some(d => p.epoca.toLowerCase().includes(d.slice(0, 2))))
  return porEpoca
    ? { preset: porEpoca, motivo: 'artista' }
    // Se elige uno igual, pero se dice: la interfaz no puede presentar como
    // "el tono de Rush" algo que en realidad es "uno de los tres tonos de
    // Rush" elegido sin ningun dato real que lo respalde.
    : { preset: suyos[0], motivo: 'artista (sin desempate de epoca)' }
}
