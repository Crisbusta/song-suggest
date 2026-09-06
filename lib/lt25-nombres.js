/* ---------------------------------------------------------------------------
   Traduce los nombres que usa la planilla de la comunidad a las unidades reales
   del amplificador.

   La regla, y no es pedanteria: EXACTO o alias explicito. Nada de prefijos, ni
   distancia de edicion, ni parecido. Al explorar, un resolvedor por prefijo
   convirtio el valor "5.0" en el modelo "50S TWIN" sin decir nada; y este
   proyecto ya tuvo una vez tres nombres de modelo mal por confiar en una fuente
   que no era el equipo. Un nombre que no calza no se aproxima: se descarta.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'

const UNIDADES = JSON.parse(
  readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))

const clave = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/* Las abreviaturas de la planilla. Cada una se escribe a mano una vez, y el
   ultimo test de este archivo garantiza que no falte ninguna. */
const ALIAS = {
  CHAMP: 'CHAMPION',
  '60SUKCLN': '60S UK CLEAN', '70SUKCLN': '70S UK CLEAN', '60SUK': '60S UK CLEAN',
  DELUXECLEAN: 'DELUXE CLN', '50S': '50S TWIN',
  COMP: 'COMPRESSOR', MYTH: 'MYTHIC DRIVE', MYTHDRIVE: 'MYTHIC DRIVE',
  MYTHEDITFORPERSONALTASTE: 'MYTHIC DRIVE',
  BLUES: 'BLUES DRIVE', DIRT: 'ROCK DIRT', GATE: 'METAL GATE',
  EQ: '5-BAND EQ', '5BANDEQ': '5-BAND EQ',
  WAH: 'TOUCH WAH',
  SMROOM: 'SMALL ROOM', LRGHALL: 'LARGE HALL', LGHALL: 'LARGE HALL',
}

const porClave = new Map()
for (const u of UNIDADES) {
  const n = u.info?.displayName
  if (!n) continue
  porClave.set(clave(n), {
    fenderId: u.FenderId,
    nombre: n,
    ranura: u.info?.subcategory ?? null,
    // El ORDEN importa: es el de la pantalla del amplificador, y es lo que
    // permite leer las columnas sin nombre de la planilla.
    parametros: (u.ui?.uiParameters ?? []).map(p => p.controlId),
  })
}

export function resolverUnidad(nombre) {
  const k = clave(nombre)
  if (!k) return null
  return porClave.get(k) ?? porClave.get(clave(ALIAS[k] ?? '')) ?? null
}
