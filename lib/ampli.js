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

// Los 17 modelos que el LT25 trae de verdad, sacados del manual oficial.
// Nombrar uno que no existe manda al usuario a buscar algo que no tiene.
export const MODELOS_LT25 = [
  "'50s TWIN", "'60s UK CLN", "'80s METAL", "'90s ROCK", 'ALT METAL', 'BASSMAN',
  'BURN', 'CHAMP', 'DELUXE CLN', 'DELUXE DIRT', 'DOOM METAL', 'EXCELSIOR',
  'METAL 2000', 'PRINCETON', 'SMALL TONE', 'SUPER CLEAN', 'SUPER HEAVY', 'TWIN CLEAN',
]

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
    modelo: "'80s METAL", base: { gain: 7, volume: 4, treble: 6, bass: 5, reverb: 2 } },
  // --- Hard rock y alternativo pesado ------------------------------------
  { tags: ['grunge'],
    modelo: "'90s ROCK", base: { gain: 6, volume: 5, treble: 5, bass: 6, reverb: 2 } },
  { tags: ['alternative metal', 'industrial metal', 'industrial'],
    modelo: "'90s ROCK", base: { gain: 7, volume: 4, treble: 6, bass: 5, reverb: 2 } },
  { tags: ['punk', 'hardcore punk', 'pop punk', 'skate punk', 'punk rock'],
    modelo: "'80s METAL", base: { gain: 6, volume: 5, treble: 7, bass: 4, reverb: 1 } },
  { tags: ['hard rock', 'glam metal', 'glam rock', 'arena rock'],
    modelo: "'80s METAL", base: { gain: 6, volume: 5, treble: 6, bass: 5, reverb: 2 } },
  // --- Blues y raices ----------------------------------------------------
  { tags: ['blues rock', 'southern rock'],
    modelo: 'DELUXE DIRT', base: { gain: 5, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['blues', 'delta blues', 'electric blues'],
    modelo: 'BASSMAN', base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 3 } },
  { tags: ['rockabilly', 'surf', 'surf rock'],
    modelo: "'50s TWIN", base: { gain: 3, volume: 6, treble: 7, bass: 5, reverb: 6 } },
  { tags: ['country', 'folk rock', 'americana', 'folk'],
    modelo: 'DELUXE CLN', base: { gain: 2, volume: 6, treble: 6, bass: 5, reverb: 4 } },
  // --- Britanico, 60s y 70s ----------------------------------------------
  { tags: ['britpop', 'british invasion', 'psychedelic rock', 'acid rock', 'mod'],
    modelo: "'60s UK CLN", base: { gain: 4, volume: 5, treble: 6, bass: 5, reverb: 3 } },
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

const ACUSTICOS = ['Acoustic Guitar (steel)', 'Acoustic Guitar (nylon)']
const LIMPIOS = ['Electric Guitar (clean)', 'Electric Guitar (jazz)']
const acotar = v => Math.max(1, Math.min(10, Math.round(v)))

export function sugerirAjustes({ tags = [], instrument = '', tuning = null } = {}) {
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
    modelo = 'CHAMP'
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
  const MODERNOS = ["'80s METAL", "'90s ROCK", 'ALT METAL', 'METAL 2000', 'SUPER HEAVY']
  const epoca = ['60s', '70s'].find(e => presentes.has(e))
  if (epoca && MODERNOS.includes(modelo)) {
    modelo = epoca === '60s' ? "'60s UK CLN" : 'BASSMAN'
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
  return { modelo, ...p, motivos }
}
