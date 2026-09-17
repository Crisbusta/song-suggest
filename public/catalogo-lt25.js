/* ---------------------------------------------------------------------------
   Lógica pura sobre el catálogo de unidades del Mustang LT25
   (public/lt25-unidades.json, copiado tal cual del volcado del equipo).

   Puro a propósito, igual que fender-protocolo.js: vive en public/ porque el
   navegador lo carga como módulo servido, pero test/ lo importa directo desde
   disco. El resto del front no tiene tests automatizados por decisión de
   diseño; este módulo es la excepción, y por algo: es donde está el riesgo
   real de esta función — un valor mal convertido llega al amplificador como
   un número plausible y equivocado, sin que nada avise.
   --------------------------------------------------------------------------- */

// El orden es el de la cadena de audio del equipo.
export const RANURAS = ['stomp', 'mod', 'amp', 'delay', 'reverb']

// La unidad que deja una ranura en bypass. El equipo la llama EMPTY.
export const VACIA = 'DUBS_Passthru'

const RANURAS_DE_EFECTO = ['stomp', 'mod', 'delay', 'reverb']

/* Pares [cable, pantalla] MEDIDOS contra el amplificador real el 2026-09-17.
   Se interpola linealmente entre puntos consecutivos en vez de aplicar una
   formula: la formula es una hipotesis, los pares son lo que el equipo hizo.

   Como se midieron: se escribio el valor de cable por USB (`ponerParametro`),
   se releyo del equipo para confirmar que la escritura habia aterrizado, y se
   leyo a mano el numero de la pantalla del amplificador. La unidad usada para
   cada curva va anotada en su fila.

   Las cinco son monotonas y clavan los dos extremos (cable minimo -> pantalla
   1, cable maximo -> pantalla 10). Ademas `t30r/t30ri` resulto ser el reverso
   de `t30/t30i` dentro de 0,044 en escala 0..1 -- y se midieron en unidades
   DISTINTAS, sin conocerse: dos mediciones independientes que se confirman.

   Lo que NO se hizo, a proposito: extrapolar. El par `t10` no cumple esa misma
   relacion de reverso (se desvia 0,145), asi que cada curva esta medida
   aparte. Antes aqui habia un ejemplo con pinta de dato bueno
   ([-45, 3.2], [-30, 5.1], [-15, 7.4]...) que resulto falso: para -8,57 dB
   predecia 8,54 y el equipo marca 6,5. Un numero plausible en un comentario es
   igual de peligroso que uno inventado en el codigo. */
const CURVAS = {
  // volume de los 20 modelos de ampli. Medido en TWIN CLEAN, dB -60..0.
  't20r/t20ri': [[-60, 1], [-48, 1.3], [-36, 2], [-30, 2.5], [-24, 3.2], [-18, 4.1], [-12, 5.5], [-8.573037, 6.5], [-6, 7.4], [-3, 8.6], [0, 10]],
  // level de CHORUS, TREMOLO, FLANGER, VIBRATONE y FUZZ, y un gain. Medido en CHORUS.level, 0..1.
  't30/t30i': [[0, 1], [0.1, 3], [0.2, 4.4], [0.3, 5.5], [0.4, 6.4], [0.5, 7.2], [0.65, 8.2], [0.8, 8.8], [0.85, 9.3], [0.9, 9.5], [0.95, 9.8], [1, 10]],
  // gain del OVERDRIVE. Medido en OVERDRIVE.gain, 0..1.
  't30r/t30ri': [[0, 1], [0.1, 1.4], [0.2, 1.8], [0.3, 2.3], [0.35, 2.6], [0.4, 2.9], [0.45, 3.2], [0.5, 3.6], [0.55, 4], [0.65, 5], [0.8, 6.7], [1, 10]],
  // rate de CHORUS, PHASER, STEP FILTER y FLANGER. Medido en CHORUS.rateHz, 0,08..10 Hz (la pantalla lo llama SPEED).
  't10/t10i': [[0.08, 1], [0.3, 3.1], [0.6, 4.4], [1, 5.4], [1.5, 6.2], [2, 6.7], [2.5, 7.2], [4.5, 8.4], [6, 9], [8, 9.5], [10, 10]],
  /* rotor del VIBRATONE. Medido en VIBRATONE.rotor, 0,67..5,67 Hz (pantalla:
     SPEED). Tiene TRAMOS PLANOS: la pantalla marca 1.0 para todo el rango
     0,67..2 Hz. No es un error de medida -- el equipo de verdad no distingue
     ahi --, pero significa que la vuelta pantalla -> cable pierde resolucion
     en ese tramo y no puede ser exacta. Ver el test de ida y vuelta. */
  't10r/t10ri': [[0.67, 1], [1, 1], [1.5, 1], [2, 1], [2.5, 1.1], [3, 1.2], [3.5, 1.4], [4, 1.9], [4.5, 2.8], [5, 4.6], [5.67, 10]],
}

const interpolar = (pares, i, j, v) => {
  if (v <= pares[0][i]) return pares[0][j]
  for (let k = 1; k < pares.length; k++) {
    const [a, b] = [pares[k - 1], pares[k]]
    if (v <= b[i]) {
      const t = (v - a[i]) / (b[i] - a[i])
      return a[j] + t * (b[j] - a[j])
    }
  }
  return pares[pares.length - 1][j]
}

const acotar = (v, min, max) => Math.min(Math.max(v, min), max)

/* ¿Coinciden la curva del cable y la de pantalla? El catálogo declara un
   `taper` (la curva del cable) y, adentro de `remap`, opcionalmente OTRO
   `taper` (la curva de pantalla). Cuando `remap.taper` falta, la pantalla usa
   la MISMA curva que el cable — sólo cambia el rango numérico — y la relación
   entre ambos es una recta aunque la curva en sí no lo sea, porque los dos
   lados aplican la misma función no lineal sobre la misma posición del knob.
   Cuando `remap.taper` está declarado y es distinto del `taper` del cable
   (p.ej. 't20r' contra 't20ri'), cada lado aplica una curva DIFERENTE sobre
   esa posición, y la relación entre cable y pantalla ya no se puede derivar:
   hace falta medirla.

   El `taper` del cable tiene que EXISTIR para que haya dos curvas que
   comparar. Sin él no hay curva de cable, así que el cable es lineal y sólo
   cambia el rango: es el caso de recta de arriba. Esta guarda faltaba, y por
   eso el `level` del OVERDRIVE y el del REVERSE pasaban por raros
   (`undefined !== 't50'`) y se mostraban en crudo — cuando medirlos contra el
   equipo dio una recta perfecta, error 0,0177 sobre nueve puntos. Verificado contra el catálogo: exactamente 34 de los
   183 parámetros continuos caen en este segundo caso, entre ellos el `volume`
   de los veinte modelos de amplificador; los otros 149 son rectas. */
const curvasDistintas = p => !!(p.taper && p.remap?.taper && p.taper !== p.remap.taper)

function conversores(p) {
  const dMin = p.remap?.min ?? p.min
  const dMax = p.remap?.max ?? p.max
  const pares = CURVAS[`${p.taper}/${p.remap?.taper}`]
  if (pares) return {
    aPantalla: c => interpolar(pares, 0, 1, acotar(c, p.min, p.max)),
    aCable: d => acotar(interpolar(pares, 1, 0, d), p.min, p.max),
  }
  /* Sin pares medidos hay dos situaciones muy distintas, y confundirlas sería
     inventar un número:

     - Si la curva del cable y la de pantalla COINCIDEN, la relación entre
       ambos es una recta entre extremos (ver comentario de curvasDistintas).
       Es el caso de 149 de los 183 controles continuos, y no hace falta medir
       nada.
     - Si NO coinciden y todavía no hay pares medidos, no sabemos convertir.
       Se devuelve el valor crudo del cable, marcado como tal, para que la
       interfaz lo muestre en su unidad real en vez de una escala 1-10
       aproximada. Es la salida que fija la spec: un número honesto y feo es
       preferible a uno bonito y falso. Al cargar los pares medidos, estos
       parámetros pasan solos a mostrarse en la escala de pantalla. */
  if (curvasDistintas(p)) return {
    crudo: true,
    aPantalla: c => acotar(c, p.min, p.max),
    aCable: d => acotar(d, p.min, p.max),
  }
  const span = (p.max - p.min) || 1
  return {
    aPantalla: c => dMin + (acotar(c, p.min, p.max) - p.min) * (dMax - dMin) / span,
    aCable: d => acotar(p.min + (d - dMin) * span / ((dMax - dMin) || 1), p.min, p.max),
  }
}

// `%2.1f` -> 1 decimal; `%0.0f` -> 0. Sin formato declarado, un decimal.
const decimalesDe = fmt => {
  const m = /^%\d*\.(\d+)f$/.exec(fmt ?? '')
  return m ? Number(m[1]) : 1
}

function descriptor(p) {
  const base = { id: p.controlId, nombre: p.displayName ?? p.controlId }
  if (p.controlType === 'list' || p.controlType === 'listBool') {
    const valores = p.listItems ?? []
    const nombres = p.remap?.listItems ?? valores
    return {
      ...base,
      tipo: p.controlType === 'listBool' ? 'interruptor' : 'lista',
      unidades: '',
      valores: valores.map((valor, i) => ({ valor, nombre: String(nombres[i] ?? valor) })),
    }
  }
  const conv = conversores(p)
  return {
    ...base,
    tipo: 'continuo',
    min: p.min, max: p.max,
    /* La unidad que corresponde es la del valor que `aPantalla` realmente
       devuelve, no siempre la misma a los dos lados de la curva:
       - En crudo, `aPantalla` devuelve el valor del cable sin tocar, así que
         la unidad es la del cable (`p.units`, p.ej. 'dB' en el volume).
       - Si no, `aPantalla` devuelve el valor de pantalla. Casos como el
         `level` de BigFuzz declaran `units: 'dB'` en el cable pero
         `remap.units: ''`: la pantalla es un dial 1-10 sin unidad, y ponerle
         'dB' sería el mismo error que la spec prohíbe para el crudo, sólo que
         al revés (una unidad real pegada a un número inventado). Por eso
         `remap.units`, cuando está declarado, manda sobre `p.units`. */
    unidades: conv.crudo ? (p.units ?? '') : (p.remap?.units ?? p.units ?? ''),
    // Un parámetro en crudo se muestra con más decimales porque su rango de
    // cable puede ser chico (p.ej. un rate en Hz) frente al rango de pantalla
    // para el que está pensado el formato declarado.
    decimales: conv.crudo ? 2 : decimalesDe(p.remap?.format),
    crudo: !!conv.crudo,
    ...conv,
  }
}

export function crearCatalogo(unidades) {
  const porId = new Map(unidades.map(u => [u.FenderId, u]))
  const vacia = porId.get(VACIA)

  const entrada = u => ({ fenderId: u.FenderId, nombre: u.info?.displayName ?? u.FenderId })

  return {
    unidad: id => porId.get(id) ?? null,

    // Un FenderId que no está en el catálogo se muestra tal cual en vez de
    // desaparecer: si el equipo trae una unidad que no conocemos, el usuario
    // tiene que poder verla.
    nombre: id => porId.get(id)?.info?.displayName ?? id,

    deRanura(ranura) {
      const propias = unidades
        .filter(u => u.info?.subcategory === ranura)
        .map(entrada)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      // El ampli nunca queda vacío: la ranura siempre tiene un modelo.
      return RANURAS_DE_EFECTO.includes(ranura) && vacia ? [entrada(vacia), ...propias] : propias
    },

    parametrosDe(id) {
      return (porId.get(id)?.ui?.uiParameters ?? []).map(descriptor)
    },
  }
}
