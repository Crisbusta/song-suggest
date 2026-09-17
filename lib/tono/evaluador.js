/* ---------------------------------------------------------------------------
   Puntuar un sugeridor candidato contra el corpus del usuario.

   Dos verdades, dos reglas:

   - Un TONO CAPTURADO es un objetivo exacto, y se mide la distancia en ejes.
   - Un VEREDICTO es una restriccion direccional, y se cumple o no se cumple.

   Lo que esto NO demuestra, y conviene tenerlo escrito aqui y no solo en la
   spec: que un tono suene como el disco. Demuestra que coincide mas con lo
   que el usuario aprobo. Son dos frases distintas y la diferencia entre ellas
   es todo lo que este modulo defiende. Ver §10 de la spec.
   --------------------------------------------------------------------------- */
import { ejesDe, comparar } from './ejes.js'

const EJES_DE_RANURA = ['modulacion', 'delay', 'reverb']

/* `sin-efecto` no es un aprobado: es "este juicio no dice nada sobre este
   candidato". Un candidato sin sugerencia no puede cumplir nada, pero tampoco
   es justo contarlo como violacion -- se cuenta aparte y el informe lo
   muestra, para que un sugeridor que deja pistas sin tono no pueda subir la
   nota simplemente callandose. */
export function evaluarJuicio({ eje, direccion, juzgado }, candidato) {
  if (!candidato) return 'sin-efecto'
  const antes = ejesDe(juzgado)
  const ahora = ejesDe(candidato)

  if (direccion === 'bien') {
    const igual = comparar(ahora, antes, 'suciedad') === 0
      && EJES_DE_RANURA.every(e => comparar(ahora, antes, e) === 0)
    return igual ? 'cumple' : 'viola'
  }

  /* "sobra" pide bajar, "falta" pide subir, y se exige ESTRICTAMENTE: empatar
     es fallar. Si empatar contara como cumplir, un candidato que no cambia
     nada sacaria nota perfecta, que es la forma mas facil de enganarse con un
     marcador. */
  const querido = direccion === 'sobra' ? -1 : 1
  return comparar(ahora, antes, eje) === querido ? 'cumple' : 'viola'
}

/* En ejes y no en perillas crudas: DELUXE CLN contra TWIN CLEAN son los dos
   limpios, y penalizar esa diferencia igual que confundir limpio con metal
   seria ruido. `gain` viaja null cuando alguno de los dos no lo declara --
   no se rellena con un cero, que seria inventar un numero. */
export function distanciaATono(objetivo, candidato) {
  const o = ejesDe(objetivo)
  const c = ejesDe(candidato)
  return {
    familia: o.familia === c.familia,
    gain: o.gain == null || c.gain == null ? null : Math.abs(o.gain - c.gain),
    ranuras: EJES_DE_RANURA.filter(e => o[e] !== c[e]).length,
  }
}

/* El informe es un informe y no una nota: una nota sola escondria las
   regresiones, que son lo que venimos a cazar. Por eso cada bolsa guarda
   ejemplos -- una violacion que no se puede mirar no se puede arreglar. */
export function informe({ juicios, capturas }) {
  const r = {
    cumplidas: 0,
    violadas: 0,
    sinEfecto: 0,
    ejemplos: { cumplidas: [], violadas: [], sinEfecto: [] },
    capturas: { total: capturas.length, familiaOk: 0, ranurasMal: 0 },
  }
  for (const j of juicios) {
    const veredicto = evaluarJuicio(j, j.candidato)
    const bolsa = veredicto === 'cumple' ? 'cumplidas' : veredicto === 'viola' ? 'violadas' : 'sinEfecto'
    r[bolsa]++
    if (r.ejemplos[bolsa].length < 5) {
      r.ejemplos[bolsa].push({ songId: j.songId, trackIndex: j.trackIndex, eje: j.eje, direccion: j.direccion })
    }
  }
  for (const c of capturas) {
    const d = distanciaATono(c.objetivo, c.candidato)
    if (d.familia) r.capturas.familiaOk++
    r.capturas.ranurasMal += d.ranuras
  }
  return r
}
