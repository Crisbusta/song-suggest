const ESTANDAR = [64, 59, 55, 50, 45, 40]
const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const nombre = midi => NOTAS[((midi % 12) + 12) % 12]

export function describeTuning(notas) {
  if (!Array.isArray(notas) || notas.length === 0) return null
  if (notas.length !== 6) {
    return `Afinación de ${notas.length} cuerdas: ${notas.map(nombre).join('-')}`
  }

  const offsets = notas.map((n, i) => n - ESTANDAR[i])

  if (offsets.every(o => o === 0)) return null

  // Todas las cuerdas movidas lo mismo: afinacion trasladada.
  if (offsets.every(o => o === offsets[0])) {
    const o = offsets[0]
    const abajo = o < 0
    const semis = Math.abs(o)
    if (semis === 1) return abajo ? 'Medio tono abajo (Eb)' : 'Medio tono arriba'
    if (semis === 2) return abajo ? 'Un tono abajo (D)' : 'Un tono arriba'
    return `${semis} semitonos ${abajo ? 'abajo' : 'arriba'}`
  }

  // Familia Drop: las cinco primeras cuerdas movidas todas lo mismo (no
  // necesariamente cero) y la sexta mas grave todavia. El caso n != 0 no es
  // exotico: Drop C (bajar un tono Y soltar la sexta) es la quinta afinacion
  // mas comun del catalogo. Exigir n == 0 dejaria fuera Drop C, C#, B, A# y A.
  const arriba = offsets.slice(0, 5)
  const sextaSuelta = arriba.every(o => o === arriba[0]) && offsets[5] < arriba[0]
  if (sextaSuelta) return `Drop ${nombre(notas[5])}`

  return `Afinación abierta: ${notas.map(nombre).join('-')}`
}
