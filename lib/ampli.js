/* ---------------------------------------------------------------------------
   Sugerencia de ajustes para un Fender Mustang LT25.

   ADVERTENCIA DE HONESTIDAD, y es el punto central de este modulo: esto NO es
   el tono de la grabacion. Es un punto de partida deducido de tres datos que
   ya tenemos en el catalogo (tags de genero, instrumento del track
   representativo, afinacion), y la interfaz lo dice asi.

   No existe fuente accesible de ajustes verificados por cancion: los tres
   servicios que hacen esto (TonesMatch, ToneAdapt, ToneTwin) no tienen API, y
   sus datos salen de foros y rig rundowns sin verificacion declarada.
   Verificado el 2026-09-04.

   La alternativa habria sido que un modelo invente los valores cancion por
   cancion. Se descarto: acierta a veces y no hay forma de saber cuando, y un
   numero inventado que parece plausible es peor que no tener el dato.
   --------------------------------------------------------------------------- */

import { readFileSync } from 'node:fs'
import { buscarPreset, presetDeGenero } from './presets-comunidad.js'

// Los 20 modelos de ampli del LT25, con el nombre EXACTO que muestra el equipo.
//
// Procedencia: el catalogo de unidades DSP del propio amplificador, no el
// manual en PDF. La primera version salio de extraer texto del manual y tres
// nombres quedaron mal ('80s METAL en vez de 80S ROCK, CHAMP en vez de
// CHAMPION, '60s UK CLN en vez de 60S UK CLEAN), afectando el 36% de las
// sugerencias. El test que debia cazarlo comparaba contra esta misma lista
// equivocada, asi que pasaba en verde. Cualquier cambio aqui tiene que
// verificarse contra el equipo, no contra el manual.
export const MODELOS_LT25 = [
  '50S TWIN', '60S UK CLEAN', '70S ROCK', '70S UK CLEAN', '80S ROCK', '90S ROCK',
  'ALT METAL', 'BASSMAN', 'BURN', 'CHAMPION', 'DELUXE CLN', 'DELUXE DIRT',
  'DOOM METAL', 'EXCELSIOR', 'METAL 2000', 'PRINCETON', 'SMALLTONE',
  'SUPER CLEAN', 'SUPER HEAVY', 'TWIN CLEAN',
]

/* El nombre que ve el usuario ("METAL 2000") y el identificador que entiende el
   equipo ("DUBS_Evh3") son cosas distintas, y la traduccion la manda el
   catalogo de unidades del propio amplificador -- el mismo archivo que usa el
   editor. No se escribe a mano una segunda lista: una lista escrita a mano fue
   exactamente el error que hizo que tres de estos veinte nombres estuvieran
   mal, afectando al 36% de las sugerencias, sin que ningun test lo cazara.

   Se lee del disco una sola vez, al cargar el modulo. Este archivo corre solo
   en el servidor (lo importa db/queries.js); el front nunca lo carga. */
const AMPS_POR_NOMBRE = new Map(
  JSON.parse(readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))
    .filter(u => u.info?.subcategory === 'amp')
    .map(u => [u.info.displayName, u.FenderId]),
)

/* Devuelve null, nunca un identificador inventado: mandarle al amplificador un
   FenderId que no existe seria pedirle algo que va a ignorar en silencio. */
export const fenderIdDeModelo = modelo => AMPS_POR_NOMBRE.get(modelo) ?? null

/* Tabla de reglas, ORDENADA DE LO ESPECIFICO A LO GENERICO. Gana la primera
   que calza. El orden es la parte importante: "rock" lo tienen 7.335 canciones
   del catalogo que no comparten ningun tono, asi que los tags demasiado
   amplios ("rock", "pop/rock", "album rock") NO estan aqui a proposito.

   Esto es juicio musical, no un hecho medido. Cambiar una fila es cambiar una
   opinion; la logica de abajo no se toca. */
const REGLAS = [
  // --- Metal moderno y extremo -------------------------------------------
  { tags: ['thrash metal', 'death metal', 'speed metal', 'black metal'],
    modelo: 'METAL 2000', base: { gain: 8, volume: 4, treble: 7, bass: 5, reverb: 1 } },
  { tags: ['metalcore', 'deathcore', 'post-hardcore'],
    modelo: 'ALT METAL', base: { gain: 8, volume: 4, treble: 6, bass: 5, reverb: 1 } },
  { tags: ['nu metal', 'nu-metal', 'rap metal'],
    modelo: 'ALT METAL', base: { gain: 7, volume: 4, treble: 5, bass: 6, reverb: 1 } },
  { tags: ['doom metal', 'sludge', 'sludge metal', 'stoner rock', 'stoner metal'],
    modelo: 'DOOM METAL', base: { gain: 7, volume: 4, treble: 4, bass: 7, reverb: 2 } },
  { tags: ['progressive metal', 'djent', 'technical death metal'],
    modelo: 'METAL 2000', base: { gain: 7, volume: 4, treble: 6, bass: 5, reverb: 2 } },
  { tags: ['heavy metal', 'power metal', 'metal'],
    modelo: '80S ROCK', base: { gain: 7, volume: 4, treble: 6, bass: 5, reverb: 2 } },
  // --- Hard rock y alternativo pesado ------------------------------------
  { tags: ['grunge'],
    modelo: '90S ROCK', base: { gain: 6, volume: 5, treble: 5, bass: 6, reverb: 2 } },
  { tags: ['alternative metal', 'industrial metal', 'industrial'],
    modelo: '90S ROCK', base: { gain: 7, volume: 4, treble: 6, bass: 5, reverb: 2 } },
  { tags: ['punk', 'hardcore punk', 'pop punk', 'skate punk', 'punk rock'],
    modelo: '80S ROCK', base: { gain: 6, volume: 5, treble: 7, bass: 4, reverb: 1 } },
  { tags: ['hard rock', 'glam metal', 'glam rock', 'arena rock'],
    modelo: '80S ROCK', base: { gain: 6, volume: 5, treble: 6, bass: 5, reverb: 2 } },
  // --- Blues y raices ----------------------------------------------------
  { tags: ['blues rock', 'southern rock'],
    modelo: 'DELUXE DIRT', base: { gain: 5, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['blues', 'delta blues', 'electric blues'],
    modelo: 'BASSMAN', base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['rockabilly', 'surf', 'surf rock'],
    modelo: '50S TWIN', base: { gain: 3, volume: 6, treble: 7, bass: 5, reverb: 6 } },
  { tags: ['country', 'folk rock', 'americana', 'folk'],
    modelo: 'DELUXE CLN', base: { gain: 2, volume: 6, treble: 6, bass: 5, reverb: 4 } },
  // --- Britanico, 60s y 70s ----------------------------------------------
  { tags: ['britpop', 'british invasion', 'psychedelic rock', 'acid rock', 'mod'],
    modelo: '60S UK CLEAN', base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['progressive rock', 'art rock', 'krautrock'],
    modelo: 'BURN', base: { gain: 5, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['classic rock', '70s'],
    modelo: 'BASSMAN', base: { gain: 5, volume: 5, treble: 6, bass: 5, reverb: 2 } },
  // --- Indie, pop y limpios ----------------------------------------------
  { tags: ['shoegaze', 'dream pop', 'post-rock'],
    modelo: 'TWIN CLEAN', base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 7 } },
  { tags: ['indie rock', 'indie', 'indie pop'],
    modelo: 'TWIN CLEAN', base: { gain: 3, volume: 5, treble: 6, bass: 5, reverb: 4 } },
  { tags: ['funk', 'soul', 'r&b', 'disco', 'reggae', 'ska', 'motown'],
    modelo: 'TWIN CLEAN', base: { gain: 2, volume: 6, treble: 6, bass: 5, reverb: 2 } },
  { tags: ['jazz', 'bossa nova', 'fusion', 'jazz fusion'],
    modelo: 'PRINCETON', base: { gain: 2, volume: 6, treble: 5, bass: 6, reverb: 3 } },
  { tags: ['new wave', 'post-punk', 'gothic rock'],
    modelo: 'DELUXE CLN', base: { gain: 4, volume: 5, treble: 7, bass: 4, reverb: 4 } },
  { tags: ['alternative rock', 'alternative', 'alternative/indie rock'],
    modelo: 'DELUXE CLN', base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['pop', 'synthpop', 'pop rock', '80s'],
    modelo: 'DELUXE CLN', base: { gain: 3, volume: 5, treble: 6, bass: 5, reverb: 3 } },
]

/* Todos los tags que disparan una regla. Se exporta para que los tests deriven
   su cobertura de aqui en vez de mantener una lista a mano: una lista a mano
   dejaba filas sin ejercitar, y una fila sin ejercitar puede nombrar un modelo
   inexistente sin que nada lo cace. */
export const TAGS_CON_REGLA = REGLAS.flatMap(r => r.tags)

const ACUSTICOS = ['Acoustic Guitar (steel)', 'Acoustic Guitar (nylon)']
const LIMPIOS = ['Electric Guitar (clean)', 'Electric Guitar (jazz)']
const acotar = v => Math.max(1, Math.min(10, Math.round(v)))

export function sugerirAjustes({ tags = [], instrument = '', tuning = null, artist = '', title = '' } = {}) {
  /* Precedencia: lo especifico gana. Un preset que alguien dialo para esta
     banda vale mas que lo que deducimos de una etiqueta de genero -- pero es
     OPINION de esa persona, no medicion, asi que viaja diciendo de donde salio
     y si la propia planilla lo marco como dudoso.

     Lo que la planilla trae NO se corrige con el instrumento ni con la
     afinacion, al reves que la tabla de reglas de mas abajo: esas correcciones
     existen para enderezar una DEDUCCION nuestra a partir de un tag de genero.
     Aqui no hay deduccion que enderezar, hay una cadena que alguien dialo, y
     moverle una perilla seria inventar un valor sobre datos de otro. Se usa
     entera o no se usa. */
  /* Con UNA excepcion, y es categorica, sin umbral que calibrar: si el track
     representativo es acustico, el preset de la comunidad no aplica y se cae a
     la tabla de reglas, que ya tiene su sustitucion acustica y la hace bien.
     Esto bloquea las DOS rutas del `??` de abajo, cada una por su propia razon:

     - buscarPreset(): estos presets estan indexados POR BANDA, y el tono de
       una banda es el de su equipo electrico; un track acustico de esa misma
       banda es otro instrumento, no otra cancion.
     - presetDeGenero(): este tono no lo dialo nadie para ESTA cancion -- es
       un mapeo de tags a un tono de la hoja 2 (MAPEO_TONO_GENERO, en
       presets-comunidad.js), el JUICIO de esta rama mirando equipo electrico,
       no un dato que alguien haya escrito junto a un genero. Sobre un
       instrumento distinto ese juicio no se sostiene igual que el preset de
       banda no se sostiene: un tono de genero con distorsion sobre una
       guitarra de nylon tampoco sirve.

     La invariante que este modulo ya tenia escrita -- el ajuste tiene que
     servir para lo que vas a tocar -- es mas especifica que la procedencia
     del dato (venga de una banda o de un mapeo de generos), asi que gana.

     Medido sobre las 9.736 canciones sorteables (BASE_FROM de db/queries.js
     en dificultad 1-10, al 2026-09-07; ese universo se encoge con el uso,
     porque cada cancion descartada sale del denominador): sin esta excepcion, 504
     canciones de track acustico recibian algo del preset de comunidad -- 119
     de banda y 385 de tono de genero -- y 116 de ellas con gain >= 6 (de esas
     116, solo 33 venian de preset de banda). Rush "Closer To The Heart" con
     guitarra de NYLON recibia BURN a gain 10; Metallica "Mama Said" y
     Megadeth "Set The World Afire", lo mismo -- estos tres son del 24% de
     preset de banda, no del 76% de tono de genero, pero la razon que cubre
     ese 76% es la de arriba, no una extrapolacion de estos casos.

     El track electrico LIMPIO no entra aqui a proposito: sigue siendo una
     guitarra electrica y el modelo de ampli de esa banda es plausible, asi que
     conserva su preset (la tabla, cuando le toca, le recorta la ganancia a 3). */
  const hallado = ACUSTICOS.includes(instrument)
    ? null
    : buscarPreset({ artist, title, tags }) ?? presetDeGenero(tags)
  if (hallado) return desdeElPreset(hallado)

  const presentes = new Set(tags.map(t => String(t).toLowerCase()))

  const regla = REGLAS.find(r => r.tags.some(t => presentes.has(t)))
  if (!regla) return null   // Sin senal util: no se inventa nada.

  const tagQueDisparo = regla.tags.find(t => presentes.has(t))
  const motivos = [tagQueDisparo]
  let { modelo } = regla
  const p = { ...regla.base }

  // Un track acustico manda sobre el genero: da igual que la cancion este
  // etiquetada como thrash, el ajuste tiene que servir para lo que vas a tocar.
  if (ACUSTICOS.includes(instrument)) {
    modelo = 'CHAMPION'
    Object.assign(p, { gain: 1, volume: 6, treble: 5, bass: 5, reverb: 4 })
    motivos.push('track acustico')
  } else if (LIMPIOS.includes(instrument)) {
    // Un modelo de alta ganancia no sirve para un track limpio.
    if (p.gain > 3) modelo = 'DELUXE CLN'
    p.gain = Math.min(p.gain, 3)
    motivos.push('track de guitarra limpia')
  }

  // Epoca. "hard rock" lo comparten 2.694 canciones que van de 1968 a hoy, asi
  // que por si solo no distingue una Marshall de los 80 de un tweed de los 60.
  // Si la cancion se declara de los 60 o 70 y la regla eligio un modelo que no
  // existia entonces, se cambia por el equivalente de la epoca y baja la
  // ganancia. Caso que lo destapo: Iron Butterfly, "In-A-Gadda-Da-Vida" (1968),
  // que salia con '80s METAL.
  const MODERNOS = ['80S ROCK', '90S ROCK', 'ALT METAL', 'METAL 2000', 'SUPER HEAVY']
  const epoca = ['60s', '70s'].find(e => presentes.has(e))
  if (epoca && MODERNOS.includes(modelo)) {
    modelo = epoca === '60s' ? '60S UK CLEAN' : 'BASSMAN'
    p.gain = Math.max(1, p.gain - 2)
    motivos.push(epoca)
  }

  // Afinacion no estandar: las cuerdas graves ya aportan ese peso, y dejar el
  // bass arriba embarra. `tuning` viene ya descrito por describeTuning, que
  // devuelve null justamente cuando es Mi estandar.
  if (tuning) {
    p.bass -= 1
    motivos.push(tuning)
  }

  for (const k of ['gain', 'volume', 'treble', 'bass', 'reverb']) p[k] = acotar(p[k])
  return { modelo, fenderId: fenderIdDeModelo(modelo), ...p, motivos,
           cadena: null, fuente: 'reglas', incierto: false,
           procedencia: 'deducido de tus tags de genero' }
}

/* Traduce un preset de la comunidad a la forma que ya devolvia sugerirAjustes,
   sin perder de donde salio. La escala de la planilla es la misma que la
   nuestra: 1-10 de pantalla (no se acota ni se redondea: 3,3 es lo que esa
   persona escribio, y redondearlo a 3 seria cambiarle el dato).

   Lo que la planilla NO dice queda en null, nunca en un valor por descarte: un
   5 inventado se veria igual que un 5 que alguien eligio, y es justo la mentira
   que este modulo se niega a contar desde su primera linea. Casos reales, no
   hipoteticos: "Curtis Mayfield" no trae gain, "James Hetfield / Metallica" no
   trae bass, "Eddie Van Halen / Van Halen" no trae volume. La interfaz no
   dibuja las perillas que vienen en null y paraElAmpli no las manda. */
/* Exportada para que lib/tonos.js arme la paleta con la MISMA conversion que
   usa el sorteo. Duplicarla seria que un tono elegido a mano y el mismo tono
   sugerido se vieran distintos sin motivo. Los tonos propios sobrescriben
   `fuente` y `procedencia` sobre el resultado; el resto es identico. */
export function desdeElPreset({ preset, motivo }) {
  const amp = preset.cadena.amp
  const v = amp?.valores ?? {}
  return {
    modelo: amp?.nombre ?? null,
    fenderId: amp?.fenderId ?? null,
    gain: v.gain ?? null, volume: v.volume ?? null,
    treble: v.treb ?? null, bass: v.bass ?? null,
    mid: v.mid ?? null,
    reverb: null,   // la planilla no trae el reverb del panel
    cadena: preset.cadena,
    fuente: 'comunidad',
    incierto: preset.incierto,
    procedencia: procedenciaDe(preset, motivo),
    motivos: [motivo === 'genero' ? 'tono de la comunidad' : 'preset de la comunidad'],
  }
}

/* La planilla marca lo dudoso pegando el signo o la etiqueta AL NOMBRE mismo
   ("GUNS N ROSES?", "Yellow Ledbetter {EXPERIMENTAL}") -- marcaIncierta, en
   presets-comunidad.js, es el mismo patron que decide `preset.incierto`. Esa
   incertidumbre YA viaja estructurada en ese campo (Step 3 de la tarjeta la
   dice con una frase explicita), asi que dejarla ademas pegada al nombre es
   redundante y, peor, enganosa: un lector ve "GUNS N ROSES?" y lo lee como un
   typo nuestro, no como la advertencia de la planilla que es.

   Se limpia aqui, en el NOMBRE, antes de armar la frase -- no con una regex
   sobre la frase ya armada, que se comeria un "?" legitimo si alguna vez
   apareciera en otro lugar del texto. Y solo para prosa: el nombre que usa
   buscarPreset para calzar (normalizado con `norm()`, en presets-comunidad.js)
   no pasa por aqui, asi que el calce no cambia. */
const MARCAS_INCERTIDUMBRE = /\s*\{EXPERIMENTAL\}|\s*\(INACCURATE\)|\?/gi
export const limpiarMarcaDeNombre = nombre =>
  nombre == null ? nombre : String(nombre).replace(MARCAS_INCERTIDUMBRE, '').trim()

/* El texto que ve el usuario. Cada motivo de buscarPreset tiene el suyo: si la
   fila era de otra cancion del mismo artista, hay que DECIRLO. presets-comunidad.js
   acepta ese respaldo justamente a condicion de no callarlo ("usarla callando que
   es de otra cancion seria la unica opcion deshonesta de las tres"), asi que
   presentarlo como "el preset de The Police" a secas rompe el trato con el modulo
   que produjo el dato. */
function procedenciaDe(preset, motivo) {
  const artista = limpiarMarcaDeNombre(preset.artista)
  const clave = limpiarMarcaDeNombre(preset.clave)
  const cancion = limpiarMarcaDeNombre(preset.cancion)
  switch (motivo) {
    case 'cancion':
      return `preset de la comunidad para ${clave}`
    case 'genero':
      return `tono "${clave}" de la comunidad, que elegimos nosotros para este genero`
    case 'artista':
      return `preset de la comunidad para ${artista}`
    case 'artista (sin desempate de epoca)':
      return `preset de la comunidad para ${artista}, uno de varios`
    case 'artista (desde el preset de otra cancion)':
      return `preset de la comunidad para ${artista}, tomado de otra cancion suya (${cancion})`
    default:
      // Un motivo nuevo en presets-comunidad.js no puede colarse como si fuera
      // uno conocido: se dice tal cual antes que describirlo mal.
      return `preset de la comunidad para ${artista ?? clave} (${motivo})`
  }
}

/* Convierte la sugerencia (escala 1-10, pensada para leerse) a lo que el
   amplificador espera de verdad: flotantes continuos de 0 a 1.

   Solo tres parametros, y los que faltan NO son un olvido:
   - volume esta en decibeles, no en 0-1: la escala real, sacada del catalogo,
     es -60..0 dB con curva t20r, y es la MISMA en los veinte modelos. Mandar
     0.4 creyendo que es "4 de 10" seria un salto brutal. No se manda porque su
     curva es una de las que todavia no sabemos convertir de la escala 1-10, y
     porque el volumen depende de la pieza y no de la cancion. (Los defaults de
     los veinte van de -15.88 dB en SUPER HEAVY a 0 en SUPER CLEAN; una version
     anterior de este comentario citaba -1.17 a -13.88, que eran dos modelos
     sueltos presentados como si fueran el rango.)
   - mid no lo produce la tabla de reglas: se queda en el default del modelo.
   - reverb no es un parametro del amplificador, vive en otro nodo DSP.

   Una perilla que no se puede convertir se OMITE del objeto; no sale en 0.
   Esto dejo de ser teorico cuando entraron los presets de la comunidad: la
   planilla declara solo las perillas que declara, y las que no vienen llegan
   aqui en null. `Number(null)` es 0, `(0 - 1) / 9` es finito, y la version
   anterior lo acotaba a 0 -- o sea que un preset sin gain declarado le habria
   mandado al amplificador el GAIN AL MINIMO, presentado como un valor elegido
   (caso real: "Curtis Mayfield", que no trae gain). Omitirla deja esa perilla
   en el valor por defecto de la unidad, que es dato real del equipo. El bucle
   de envio recorre solo las claves presentes, asi que omitir es todo lo que
   hace falta.

   Lo mismo vale para la basura no numerica ('abc'): mandarla como 0 seria
   afirmar un valor que nadie eligio. Antes salia 0 para no dejar escapar un
   NaN -- que JSON.stringify convierte en null y el amplificador ignora en
   silencio --; omitirla resuelve el NaN igual de bien y sin mentir. */
export function paraElAmpli(sugerencia) {
  if (!sugerencia) return null
  // Math.min/max PROPAGAN NaN en vez de acotarlo, asi que el finito se
  // comprueba antes de acotar y no despues.
  const a01 = v => {
    if (v === null || v === undefined) return null
    const n = (Number(v) - 1) / 9
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
  }
  const salida = {}
  for (const [destino, origen] of [['gain', 'gain'], ['treb', 'treble'], ['bass', 'bass']]) {
    const n = a01(sugerencia[origen])
    if (n !== null) salida[destino] = n
  }
  return salida
}
