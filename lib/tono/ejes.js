/* ---------------------------------------------------------------------------
   De una cadena del LT25 a los ejes con los que se juzga un tono.

   Es el germen del vocabulario cerrado de la fase 2 (§4.2 de la spec), y
   existe ya porque el marcador de la fase 0 lo necesita: para preguntar "este
   candidato es mas limpio que el que rechace" hace falta un eje en el que
   comparar, y las perillas crudas no sirven -- DELUXE CLN contra TWIN CLEAN
   son los dos limpios, y penalizar esa diferencia igual que confundir limpio
   con metal seria ruido.

   Puro: no toca la base, ni el DOM, ni el catalogo del equipo.
   --------------------------------------------------------------------------- */
import { MODELOS_LT25 } from '../ampli.js'

/* Juicio musical, igual que las 24 filas de REGLAS: cambiar una fila es
   cambiar una opinion, no corregir un hecho.

   Dos tests la sujetan: que sea TOTAL sobre los veinte modelos -- un modelo
   sin familia haria que el marcador lo ignorara en silencio -- y que no
   contradiga a AMPLIS_LIMPIOS, que es la otra lista del proyecto que opina
   sobre lo mismo. */
export const FAMILIAS_AMP = {
  '50S TWIN': 'limpio',
  '60S UK CLEAN': 'limpio',
  '70S UK CLEAN': 'limpio',
  CHAMPION: 'limpio',
  'DELUXE CLN': 'limpio',
  PRINCETON: 'limpio',
  'SUPER CLEAN': 'limpio',
  'TWIN CLEAN': 'limpio',

  '70S ROCK': 'crunch',
  BASSMAN: 'crunch',
  BURN: 'crunch',
  'DELUXE DIRT': 'crunch',
  EXCELSIOR: 'crunch',
  SMALLTONE: 'crunch',

  '80S ROCK': 'alta-ganancia',
  '90S ROCK': 'alta-ganancia',
  'ALT METAL': 'alta-ganancia',
  'DOOM METAL': 'alta-ganancia',
  'METAL 2000': 'alta-ganancia',
  'SUPER HEAVY': 'alta-ganancia',
}

const RANGO_FAMILIA = { limpio: 0, crunch: 1, 'alta-ganancia': 2 }
const EJES_DE_RANURA = { modulacion: true, delay: true, reverb: true }

/* Sin ampli en la cadena no hay familia ni ganancia, y viajan como null: no se
   inventa un 'limpio' por defecto, que es la clase de suposicion que haria que
   el marcador puntuara una cadena rota como si fuera buena. */
export function ejesDe(cadena) {
  const amp = cadena?.amp ?? null
  const familia = amp?.nombre ? (FAMILIAS_AMP[amp.nombre] ?? null) : null
  const gain = amp?.valores?.gain ?? null
  return {
    familia,
    gain,
    /* Lexicografico: primero la VOZ del modelo, y la ganancia solo desempata.
       Un 90S ROCK con el gain recortado a 3 sigue siendo mas sucio que un TWIN
       CLEAN con el gain arriba, que es exactamente el caso de Weird Fishes --
       recortar la ganancia de un modelo saturado no lo vuelve limpio. */
    suciedad: [familia ? RANGO_FAMILIA[familia] : -1, gain ?? -1],
    modulacion: !!cadena?.mod?.nombre,
    delay: !!cadena?.delay?.nombre,
    reverb: !!cadena?.reverb?.nombre,
  }
}

const signo = n => (n > 0 ? 1 : n < 0 ? -1 : 0)

/* Cuanto mas "a" que "b" en ese eje: 1 si a tiene mas, -1 si menos, 0 si
   igual. Es lo unico que el marcador necesita, porque un veredicto es una
   DIRECCION, no una nota. */
export function comparar(a, b, eje) {
  if (eje === 'suciedad') {
    return signo(a.suciedad[0] - b.suciedad[0]) || signo(a.suciedad[1] - b.suciedad[1])
  }
  // Un eje que no existe es un error de programacion, no un caso a tolerar:
  // devolver 0 en silencio haria que un juicio no se cumpliera nunca y nadie
  // sabria por que.
  if (!(eje in EJES_DE_RANURA)) throw new Error(`eje desconocido: ${eje}`)
  return signo(Number(a[eje]) - Number(b[eje]))
}
