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

/* Pares [cable, pantalla] medidos contra el equipo (Task 1, docs/lt25-curvas.md
   cuando exista). Se interpola linealmente entre puntos consecutivos en vez de
   aplicar una fórmula: la fórmula es una hipótesis, los pares son lo que el
   equipo hizo.

   Arranca vacía a propósito, y eso no es un pendiente: es el estado correcto
   hasta que se midan curvas contra el equipo real. Cargar pares acá no cambia
   nada del código de más abajo, sólo agrega filas — los parámetros afectados
   pasan solos a mostrarse en la escala de pantalla en vez de en crudo.
   Formato, con el volume de los veinte modelos de amplificador como ejemplo:
     't20r/t20ri': [[-60, 1], [-45, 3.2], [-30, 5.1], [-15, 7.4], [-6, 9.0], [0, 10]],
*/
const CURVAS = {}

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
   hace falta medirla. Verificado contra el catálogo: exactamente 34 de los
   183 parámetros continuos caen en este segundo caso, entre ellos el `volume`
   de los veinte modelos de amplificador; los otros 149 son rectas. */
const curvasDistintas = p => !!(p.remap?.taper && p.taper !== p.remap.taper)

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
