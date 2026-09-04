const ESTANDAR = [64, 59, 55, 50, 45, 40]
const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const nombre = midi => NOTAS[((midi % 12) + 12) % 12]

export function describeTuning(notas) {
  if (!Array.isArray(notas) || notas.length === 0) return null
  if (notas.length !== 6) {
    return `Afinacion de ${notas.length} cuerdas: ${notas.map(nombre).join('-')}`
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

  // Solo la sexta (la ultima del arreglo) movida hacia abajo: familia Drop.
  const sextaSuelta = offsets.slice(0, 5).every(o => o === 0) && offsets[5] < 0
  if (sextaSuelta) return `Drop ${nombre(notas[5])}`

  return `Afinacion abierta: ${notas.map(nombre).join('-')}`
}
