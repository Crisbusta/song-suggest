/* ---------------------------------------------------------------------------
   El ROL de una pista, leido de su nombre.

   Songsterr escribe en `tracks.name` cosas como "Kirk Hammett | Gibson Flying
   V | Lead Guitar": musico, equipo y papel, en cualquier orden. Mas de la
   mitad del catalogo trae ahi escrito el rol y hasta ahora solo se usaba para
   elegir una etiqueta legible, nunca para decidir un tono.

   Vive en `public/` y no en `lib/` por la misma razon que `artistas.js`
   (CLAUDE.md, "`lib/` vs `public/`"): `tarjeta.js` ya necesitaba clasificar
   roles para sus etiquetas, y dos vocabularios de rol en dos archivos se
   desviarian. Este es el unico, y `tarjeta.js` lo importa.

   Puro: sin catalogo del equipo, sin LT25, sin DOM. `test/` lo importa
   directo desde disco.
   --------------------------------------------------------------------------- */

/* El vocabulario. Un test comprueba que la expresion regular de abajo
   reconoce cada uno de estos terminos: sin el, uno se puede colar en la lista
   sin que nada lo recoja, y el sintoma seria solo que una etiqueta sale peor
   -- nadie lo notaria. */
export const TERMINOS_DE_ROL = [
  'lead', 'rhythm', 'solo', 'clean', 'acoustic', 'electric', 'harmon', 'extra',
  'overdub', 'intro', 'outro', 'slide', 'fingerstyle', 'nylon', 'steel',
  'riff', 'melody', 'arpegg', 'chord',
]

const RE_ROL = new RegExp(`\\b(${TERMINOS_DE_ROL.join('|')})`, 'i')

/* Se conserva tal cual estaba en tarjeta.js, con el mismo orden de terminos y
   la misma forma (`\b` al principio y nada al final, para que "harmon" pille
   "harmonies" y "arpegg" pille "arpeggios"). Cambiarla aqui cambiaria las
   etiquetas de pista de todo el catalogo. */
export const esRol = texto => RE_ROL.test(String(texto ?? ''))

/* De los terminos a las familias de rol. El orden importa y es la unica
   decision de este archivo: lo mas ESPECIFICO gana. "Acoustic Rhythm Guitar"
   es antes acustica que ritmica, porque el instrumento decide mas del tono
   que el papel que cumple dentro de la cancion.

   Es juicio musical, como la tabla de REGLAS: cambiar una fila es cambiar una
   opinion. */
const FAMILIAS_DE_ROL = [
  ['acustica', /\b(acoustic|nylon|steel|fingerstyle)/i],
  ['limpia', /\bclean/i],
  ['lead', /\b(lead|solo|harmon|melody|slide)/i],
  ['ritmica', /\b(rhythm|riff|chord|arpegg)/i],
]

/* `null` y no una suposicion: 44% de las pistas del catalogo no traen ninguna
   senal de rol en el nombre, y adivinarles una seria inventar un dato. Quien
   lo consuma decide que hacer sin el. */
export function rolDe(nombre) {
  const texto = String(nombre ?? '')
  if (!texto.trim()) return null
  return FAMILIAS_DE_ROL.find(([, re]) => re.test(texto))?.[0] ?? null
}
