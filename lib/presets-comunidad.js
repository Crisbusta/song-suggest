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
