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

// Filas enteras que no producen ningun preset (auditoria().descartadas). Esta
// es la cuenta que tiene que cerrar exacto contra "leidas": cada fila leida
// termina en exactamente uno de los dos lados, nunca en ninguno ni en ambos.
const descartes = []

// Anomalias parciales: la FILA si se importa (le queda al menos una ranura
// util), pero una de sus unidades no se pudo leer y esa ranura se omite. No
// cuenta como fila descartada -- contarla ahi duplicaria la fila en ambos
// lados de la cuenta -- pero tampoco se pierde en silencio: queda aca, con la
// ranura y el motivo. Es el caso real de "80s" en una columna de delay,
// documentado tambien en test/lt25-nombres.test.js.
const avisos = []

const marcaIncierta = /\{EXPERIMENTAL\}|\(INACCURATE\)|\?/i

/* Lee un bloque: la unidad y sus perillas, por POSICION en el orden que declara
   el catalogo. Solo entran los parametros que la planilla escribio; el resto se
   queda en el valor por defecto de la unidad, que es dato real del equipo.

   Del amplificador solo se leen sus cinco perillas aunque la hoja reserve siete
   columnas: las dos ultimas traen valores negativos y no sabemos que son. */
function leerBloque(fila, [iNombre, iValor, ancho], donde, ranura) {
  const crudo = (fila[iNombre] ?? '').trim()
  if (!crudo || crudo === '-') return null
  const u = resolverUnidad(crudo)
  if (!u) { avisos.push({ fila: donde, ranura, motivo: `unidad no reconocida: "${crudo}"` }); return null }
  const valores = {}
  const cuantos = Math.min(ancho, u.parametros.length)
  for (let k = 0; k < cuantos; k++) {
    const v = numeroCsv(fila[iValor + k])
    if (v !== null) valores[u.parametros[k]] = v
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

const filasBanda = leer('presets-lt25-bandas.csv').slice(1).filter(f => f[0]?.trim())
const filasTono  = leer('presets-lt25-tonos.csv').slice(1).filter(f => f[0]?.trim())

export const PRESETS_BANDA = filasBanda.map(f => {
  const clave = f[0].trim()
  const { artista, cancion } = partirClave(clave)
  return {
    clave, artista, cancion,
    genero: (f[1] ?? '').trim() || null,
    epoca: (f[2] ?? '').trim().replace(/^-$/, '') || null,
    incierto: marcaIncierta.test(clave),
    cadena: leerCadena(f, BLOQUES_BANDA, clave),
  }
}).filter(p => Object.keys(p.cadena).length > 0 ||
    (descartes.push({ fila: p.clave, motivo: 'ninguna ranura reconocible' }), false))

export const PRESETS_TONO = filasTono.map(f => ({
  clave: f[0].trim(), artista: null, cancion: null, genero: null, epoca: null,
  incierto: marcaIncierta.test(f[0]),
  cadena: leerCadena(f, BLOQUES_TONO, f[0].trim()),
})).filter(p => Object.keys(p.cadena).length > 0 ||
    (descartes.push({ fila: p.clave, motivo: 'ninguna ranura reconocible' }), false))

export const auditoria = () => ({
  leidas: { bandas: filasBanda.length, tonos: filasTono.length },
  importadas: PRESETS_BANDA.length + PRESETS_TONO.length,
  descartadas: descartes,
  // Anomalias que no afectan la cuenta de filas pero tampoco se ocultan:
  // ver el comentario de `avisos` mas arriba.
  avisos,
})
