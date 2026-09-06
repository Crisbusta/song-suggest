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

/* El rango que el propio catalogo declara para ese parametro. Cada perilla trae
   DOS escalas: la del DSP (`min`/`max`, casi siempre 0..1) y la de pantalla
   (`remap.min`/`remap.max`, casi siempre 1..10), y la planilla escribe unas
   veces en una y otras en otra -- un "290ms" rescatado por la unidad declarada
   viene en la escala cruda, un "5.5" viene en la de pantalla. Por eso se acepta
   cualquiera de las dos: no se adivina en cual esta escrita la celda, se exige
   que este dentro de alguna que el equipo haya declarado.

   Igual que unidadDeclarada, esto no inventa un rango: si el catalogo no
   declara uno numerico para ese controlId, no hay contra que comparar y el
   valor pasa. */
function rangoDeclarado(fenderId, controlId) {
  const d = catalogoPorId.get(fenderId)?.ui?.uiParameters?.find(p => p.controlId === controlId)
  if (!d) return null
  const escalas = [d.remap, d].filter(e => typeof e?.min === 'number' && typeof e?.max === 'number')
  if (!escalas.length) return null
  return {
    min: Math.min(...escalas.map(e => e.min)),
    max: Math.max(...escalas.map(e => e.max)),
  }
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
    if (v !== null) {
      /* Un numero fuera del rango que el catalogo declara para esa perilla no
         es un ajuste, es un dedazo de la planilla, y se descarta igual que una
         celda que no es numero: la perilla queda en el valor por defecto de la
         unidad, que es dato real del equipo. Aceptarlo seria peor que tirarlo
         -- el unico caso real, "Custom User - Horse N Buggy" con bass 44,2 en
         un DELUXE CLN (bandas.csv linea 18), se acotaria al convertir y le
         mandaria al amplificador el bass AL TOPE por un error de otro. */
      const rango = rangoDeclarado(u.fenderId, clave)
      if (!rango || (v >= rango.min && v <= rango.max)) { valores[clave] = v; continue }
      avisos.push({ ...donde, ranura, motivo: `"${clave}" de ${u.nombre} queda fuera del rango que el catalogo declara (${rango.min} a ${rango.max}): ${v}` })
      continue
    }
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

/* Tres indices sobre PRESETS_BANDA:
     - porCancion: "artista||cancion" -> el preset de esa cancion puntual.
     - porArtista: "artista" -> los presets GENERICOS del artista, es decir
       los que la planilla no ato a una cancion (p.cancion === null).
     - porArtistaDeOtraCancion: "artista" -> los presets de cancion puntual
       de ese artista, para usarlos de RESPALDO cuando no hay fila generica
       (ver mas abajo por que).
   Un preset de cancion puntual (p.ej. "Metallica - Enter Sandman") NO entra
   en porArtista: la planilla trae ademas "James Hetfield / Metallica", que
   es el preset generico real de la banda, y si se pide otra cancion de
   Metallica corresponde ofrecer ESE, no el de Enter Sandman disfrazado de
   "el tono de Metallica". (Esto es real: verificado contra
   data/presets-lt25-bandas.csv, lineas 34 y 50.) */
const porCancion = new Map(), porArtista = new Map(), porArtistaDeOtraCancion = new Map()
for (const p of PRESETS_BANDA) {
  const artista = norm(p.artista)
  if (p.cancion) {
    porCancion.set(`${artista}||${norm(p.cancion)}`, p)
    if (artista) porArtistaDeOtraCancion.set(artista, [...(porArtistaDeOtraCancion.get(artista) ?? []), p])
    continue
  }
  if (artista) porArtista.set(artista, [...(porArtista.get(artista) ?? []), p])
}

// Las decadas que la planilla usa en su columna Era y que el catalogo de
// canciones ya trae como tags -- son el mismo dato en dos lugares, por eso
// sirven de desempate real (ver mas abajo) y no un heuristico inventado.
const DECADAS = ['50s', '60s', '70s', '80s', '90s', '00s', '2000s', '2010s']

/* La planilla escribe la decada 2000-2009 de dos formas ("00s" y "2000s") y
   lo mismo para 2010-2019 ("10s"/"2010s" en teoria, aunque hoy solo se ve la
   forma corta) -- mismo dato, dos escrituras. Sin canonicalizar, un tag
   "2000s" comparado por sus dos primeros caracteres da "20" y no calzaria
   contra una Era escrita "00s" (ni al reves). Se reduce todo a los dos
   digitos que de verdad distinguen la decada. */
const decadaCorta = d => (d.match(/^20(\d\d)s$/)?.[1]) ?? d.slice(0, 2)

/* De lo mas especifico a lo mas generico:
     1. una cancion nombrada gana siempre;
     2. si no, el preset generico del artista -- y si tiene varios (Rush
        tiene tres: 70s, 80s, 90s; Keith Richards y Fela, dos cada uno)
        desempata la decada de la cancion contra la columna Era, el mismo
        campo real en los dos lados, no una adivinanza;
     3. si el artista no tiene NINGUNA fila generica pero si una o mas de
        cancion puntual (The Police solo tiene "Every Breath You Take": 15
        de sus 16 canciones en el catalogo quedarian sin nada), se usa una
        de esas como respaldo. Es peor pista que una fila generica -- por
        eso el motivo lo dice -- pero mejor que las reglas de genero: mismo
        guitarrista, misma banda, misma epoca, probablemente el mismo
        equipo de gira. Descartarla seria perder cobertura sin necesidad;
        usarla callando que es de otra cancion seria la unica opcion
        deshonesta de las tres.
   Si hay varias filas de cancion puntual para el mismo artista, se elige la
   primera en el orden de la planilla -- deterministico, igual que el
   "sin desempate de epoca" del paso 2 -- y se dice igual que no hubo mas
   criterio que ese. */
export function buscarPreset({ artist, title, tags = [] }) {
  const a = norm(artist)
  if (!a) return null

  const exacta = porCancion.get(`${a}||${norm(title)}`)
  if (exacta) return { preset: exacta, motivo: 'cancion' }

  const suyos = porArtista.get(a)
  if (suyos?.length) {
    if (suyos.length === 1) return { preset: suyos[0], motivo: 'artista' }

    const decadas = new Set(tags.map(t => String(t).toLowerCase()).filter(t => DECADAS.includes(t)).map(decadaCorta))
    const porEpoca = suyos.find(p => p.epoca && [...decadas].some(d => p.epoca.toLowerCase().includes(d)))
    return porEpoca
      ? { preset: porEpoca, motivo: 'artista' }
      // Se elige uno igual, pero se dice: la interfaz no puede presentar como
      // "el tono de Rush" algo que en realidad es "uno de los tres tonos de
      // Rush" elegido sin ningun dato real que lo respalde.
      : { preset: suyos[0], motivo: 'artista (sin desempate de epoca)' }
  }

  const deOtraCancion = porArtistaDeOtraCancion.get(a)
  if (deOtraCancion?.length) {
    return { preset: deOtraCancion[0], motivo: 'artista (desde el preset de otra cancion)' }
  }

  return null
}

/* ---------------------------------------------------------------------------
   presetDeGenero: el ultimo respaldo, cuando ni la cancion ni el artista
   tienen preset propio en la planilla. Cae sobre los diez tonos de la hoja
   2, que NO vienen atados a ningun genero en el CSV -- ese vinculo es un
   JUICIO de quien escribio esta tabla, mirando el nombre de cada tono y las
   unidades que trae, no un dato que alguien haya escrito junto a un genero.
   A diferencia de los presets por banda (donde alguien realmente dijo "este
   es el tono de tal artista"), aqui nadie dijo "Texas Blues es para blues":
   se puede discutir fila por fila, y motivo: 'genero' se lo dice a quien
   use el resultado, para que no se confunda con un dato real.

   Los tonos sin fila aqui no se usan a proposito: "Goated Solo Tone",
   "Heavy Distortion" e "Iommi/Sabbath" no son generos (el ultimo es un
   homenaje a un guitarrista/banda, no una etiqueta que una cancion traiga
   en sus tags), asi que quedan fuera del mapeo. */
export const MAPEO_TONO_GENERO = {
  'blues': 'Texas Blues',
  'blues rock': 'Texas Blues',
  'electric blues': 'Texas Blues',
  'doom metal': 'Doom Wizard',
  'sludge': 'Doom Wizard',
  'stoner rock': 'Doom Wizard',
  'alternative metal': 'Alt Metal ish',
  'nu metal': 'Alt Metal ish',
  'jazz': 'Clean Jazz Amp',
  'bossa nova': 'Clean Jazz Amp',
  'new wave': 'Bright Chorus',
  'post-punk': 'Bright Chorus',
  'indie rock': 'Chorus + Drive',
  'shoegaze': 'Sexy Flanger',
  'dream pop': 'Sexy Flanger',
}

// Del tag mas especifico al mas generico, igual que el orden de prioridad de
// buscarPreset: gana el primero que calza en ESTE orden (el orden en que se
// escribio el mapeo), no el orden en que la cancion trae sus propios tags --
// asi ['rock', 'doom metal'] tiene que dar el tono de doom metal, aunque
// 'rock' ni siquiera este en el mapeo y 'doom metal' venga segundo en la
// lista de la cancion.
const ORDEN_TONOS = Object.keys(MAPEO_TONO_GENERO)

export function presetDeGenero(tags = []) {
  const presentes = new Set(tags.map(t => String(t).toLowerCase()))
  const tag = ORDEN_TONOS.find(t => presentes.has(t))
  if (!tag) return null
  const preset = PRESETS_TONO.find(p => p.clave === MAPEO_TONO_GENERO[tag])
  return preset ? { preset, motivo: 'genero' } : null
}
