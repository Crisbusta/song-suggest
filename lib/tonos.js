/* ---------------------------------------------------------------------------
   La paleta de tonos que se pueden elegir a mano.

   Existe porque la sugerencia automatica se equivoca, y se equivoca por una
   razon estructural que no se puede arreglar con mas reglas: los datos que la
   alimentan son de la CANCION (sus etiquetas) o de la BANDA, nunca de lo que
   esa pista toca de verdad. Una balada de una banda de thrash recibe el tono de
   thrash de esa banda, y suena a lo que no es.

   Asi que aqui no se adivina nada: son doce tonos con nombre, y los eliges tu.

   Diez salen de la hoja 2 de la planilla de la comunidad del Mustang LT --
   `data/presets-lt25-tonos.csv`, ver `data/PROCEDENCIA.md` -- y dos son de este
   proyecto, porque la planilla no trae ninguno acustico ni ninguno con wah.
   Los propios llevan `fuente: 'propio'` para que la tarjeta no repita sobre
   ellos la frase de "es lo que a alguien le funciono": nadie ajeno los ajusto.

   Todos salen con la MISMA forma que la sugerencia de una pista (`desdeElPreset`
   + `paraElAmpli`), asi que el panel y el boton de enviar los tratan igual, sin
   un solo caso especial.
   --------------------------------------------------------------------------- */
import { PRESETS_TONO } from './presets-comunidad.js'
import { desdeElPreset, paraElAmpli } from './ampli.js'

/* Los dos propios, con unidades y parametros reales del catalogo del firmware
   (`public/lt25-unidades.json`). Los nombres de parametro y los valores de los
   que son de texto salen de ahi, no de la cabeza: el amplificador descarta EN
   SILENCIO lo que no entiende, asi que un nombre inventado no falla, solo no
   hace nada. */
const PROPIOS = [
  {
    clave: 'Acústico',
    /* CHAMPION con poca ganancia. Los valores son los que la regla acustica de
       lib/ampli.js ya usa desde hace tiempo -- no se inventan aqui -- mas una
       sala pequeña para que respire. */
    cadena: {
      amp: {
        fenderId: 'DUBS_Champ57', nombre: 'CHAMPION',
        valores: { gain: 1, volume: 6, treb: 5, mid: 5, bass: 5 },
      },
      stomp: {
        // Un compresor suave empareja el fingerpicking, que es lo que se toca
        // en una acustica. `type` es de texto: low | medium | high | super.
        fenderId: 'DUBS_SimpleCompressor', nombre: 'COMPRESSOR',
        valores: { type: 'low' },
      },
      reverb: {
        fenderId: 'DUBS_SmallRoomReverb', nombre: 'SMALL ROOM',
        valores: { level: 4, decay: 4, tone: 6 },
      },
    },
  },
  {
    clave: 'Wah',
    /* La planilla no trae ni un tono con wah, y el TOUCH WAH del equipo se
       queda sin usar. Va sobre un 70S ROCK con la ganancia bajada: el wah
       necesita algo de grano para hablar, pero con la ganancia de fabrica de
       ese ampli (casi 9 de 10) se come el barrido. */
    cadena: {
      amp: {
        fenderId: 'DUBS_Plexi87', nombre: '70S ROCK',
        valores: { gain: 4, volume: 5, treb: 6, mid: 6, bass: 4 },
      },
      mod: {
        /* `mode` y `type` son de TEXTO y solo aceptan lo que el catalogo
           declara: mode entre "Low Up" | "Low Down" | "High Up" | "High Down",
           y type entre "Low Pass" | "Band Pass" | "High Pass". "Low Up" es el
           barrido de abajo hacia arriba, el de funk; cambiarlo a "High Up" es
           cuestion de gusto y de un caracter. */
        fenderId: 'DUBS_EcFilter', nombre: 'TOUCH WAH',
        valores: { level: 7, thresh: 5, q: 5, mode: 'Low Up', type: 'Band Pass' },
      },
      reverb: {
        fenderId: 'DUBS_SmallRoomReverb', nombre: 'SMALL ROOM',
        valores: { level: 3, decay: 4, tone: 5 },
      },
    },
  },
]

const conEnvio = tono => ({ ...tono, paraElAmpli: paraElAmpli(tono) })

/* La paleta entera, lista para mandar al navegador.

   Los de la comunidad conservan su procedencia tal cual la escribe
   `desdeElPreset`. Los propios la sobrescriben: decir de ellos "es lo que a
   alguien le funciono" seria falso, y esta app no dice cosas falsas sobre de
   donde sale un tono. */
export const TONOS = [
  ...PRESETS_TONO.map(preset => conEnvio({
    ...desdeElPreset({ preset, motivo: 'tono' }),
    clave: preset.clave,
  })),
  ...PROPIOS.map(preset => conEnvio({
    ...desdeElPreset({ preset, motivo: 'tono' }),
    clave: preset.clave,
    fuente: 'propio',
    incierto: false,
    procedencia: 'Tono de esta app, no de la planilla',
    motivos: ['elegido a mano'],
  })),
]
