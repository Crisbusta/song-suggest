/* ---------------------------------------------------------------------------
   El UNICO modulo que traduce una sugerencia a lo que el Mustang LT25 espera.

   Hoy hace dos cosas: resolver el nombre de un modelo a su FenderId, y
   convertir las perillas de la escala de pantalla (1-10) a la del cable. La
   fase 2 de la spec le dara el trabajo completo -- descriptor entero a cadena
   validada --; por ahora es una mudanza, no una decision nueva.

   La regla que sostiene el diseño de la spec y que empieza aqui: el LT25
   entra en escena UNA sola vez, al final. Nada aguas arriba deberia nombrar
   un modelo, un FenderId ni un numero de perilla.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'
import { crearCatalogo } from '../../public/catalogo-lt25.js'

const UNIDADES = JSON.parse(readFileSync(new URL('../../public/lt25-unidades.json', import.meta.url), 'utf8'))
const CATALOGO = crearCatalogo(UNIDADES)

/* El nombre que ve el usuario ("METAL 2000") y el identificador que entiende
   el equipo ("DUBS_Evh3") son cosas distintas, y la traduccion la manda el
   catalogo de unidades del propio amplificador. No se escribe a mano una
   segunda lista: una lista escrita a mano fue exactamente el error que hizo
   que tres de veinte nombres de modelo estuvieran mal, afectando al 36% de
   las sugerencias, sin que ningun test lo cazara. */
const AMPS_POR_NOMBRE = new Map(
  UNIDADES.filter(u => u.info?.subcategory === 'amp').map(u => [u.info.displayName, u.FenderId]),
)

/* Devuelve null, nunca un identificador inventado: mandarle al amplificador
   un FenderId que no existe seria pedirle algo que va a ignorar en silencio,
   y el sintoma es identico a "no contesta". */
export const fenderIdDeModelo = modelo => AMPS_POR_NOMBRE.get(modelo) ?? null

/* Las perillas del nodo `amp` que VIAJAN. `volume` no esta, y no es un
   olvido: el equipo lo recibe en decibelios y el volumen depende de la pieza
   y de la sala, no de la cancion. `mid` tampoco lo produce la tabla de
   reglas, y `reverb` no es un parametro del amplificador -- vive en otro nodo
   DSP. La pareja es [clave que espera el equipo, clave de la sugerencia]. */
export const PERILLAS_QUE_VIAJAN = ['gain', 'treb', 'bass']
const DESDE_LA_SUGERENCIA = [['gain', 'gain'], ['treb', 'treble'], ['bass', 'bass']]

/* La conversion se LEE del catalogo en vez de calcularse con un (v-1)/9
   escrito a mano. El numero que sale es el mismo -- medido: los veinte
   modelos por las cuatro perillas por cinco puntos de la escala, 400
   comparaciones y 0 diferencias --, pero deja de ser una formula nuestra que
   podria quedarse atras si el equipo cambiara su declaracion.

   Y por esa misma medicion no hace falta saber QUE modelo es: los veinte
   declaran la misma conversion para estas perillas. Un test lo comprueba, y
   si algun dia deja de ser cierto ese test falla y habra que pasar el modelo,
   que es justo el aviso que se quiere. */
const DESCRIPTOR = Object.fromEntries(
  PERILLAS_QUE_VIAJAN.map(pid => [
    pid,
    CATALOGO.parametrosDe(AMPS_POR_NOMBRE.values().next().value).find(p => p.id === pid),
  ]),
)

export function paraElAmpli(sugerencia) {
  if (!sugerencia) return null
  const salida = {}
  for (const [destino, origen] of DESDE_LA_SUGERENCIA) {
    const v = sugerencia[origen]
    if (v === null || v === undefined) continue
    const n = Number(v)
    // Un valor no finito se OMITE: JSON.stringify convierte NaN en null y el
    // equipo lo ignora en silencio, que es lo que no queremos.
    if (!Number.isFinite(n)) continue
    const cable = DESCRIPTOR[destino]?.aCable(n)
    if (Number.isFinite(cable)) salida[destino] = cable
  }
  return salida
}
