/* ---------------------------------------------------------------------------
   Editor del amplificador: las cinco ranuras del preset activo, con su unidad
   y sus perillas. Se genera del catalogo -- no hay una pantalla escrita a mano
   por unidad.

   Escribe en vivo, a traves del despachador. La regla de siempre: el control
   muestra donde lo puso el usuario, pero si el equipo no confirma, vuelve al
   ultimo valor confirmado y lo dice.
   --------------------------------------------------------------------------- */
import { ampli } from './ampli-usb.js'
import { crearCatalogo, RANURAS } from './catalogo-lt25.js'
import { crearDespachador } from './despachador.js'

const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// El contenedor es el <main> estatico de index.html: no se reemplaza nunca a
// si mismo, solo su innerHTML. Se toma una sola vez a nivel de modulo porque
// los listeners de mas abajo tambien se enganchan una sola vez sobre el (ver
// el comentario de esos listeners).
const contEditor = $('#vista-editor')

let catalogo = null
let confirmados = {}   // "nodo.parametro" -> ultimo valor que el equipo confirmo

// Hay una lectura (leerPreset) o un reemplazo de unidad (reemplazarUnidad)
// vivo. Las dos funciones documentan en ampli-usb.js que comparten el
// reensamblador y que no toleran superposicion -- ni entre ellas ni consigo
// mismas -- y las dos nombran a este editor como el llamador que tiene que
// imponer esa serializacion. Sin esta guarda: dos clics en "Releer", o
// cambiar una segunda ranura mientras la primera sigue en su ventana de
// varios segundos (los demas selectores quedan habilitados), pisan el
// reensamblador de la otra llamada y hacen vencer una operacion que si
// funciono.
let operando = false

// Numero de render. Cada vez que dibujar() reemplaza las ranuras, sube en
// uno. Una escritura que sigue en vuelo cuando eso pasa (releer, cambiar de
// unidad) puede confirmarse o vencer despues, y su "data-clave" -- el mismo
// nodo, el mismo id de parametro -- puede coincidir por pura casualidad con
// un control de la unidad NUEVA (todos los modelos de ampli tienen gain,
// volume, treb...). Sin esta marca, ese callback tardio actuaria sobre un
// control que no tiene nada que ver con la escritura que lo origino.
let generacion = 0
const generacionDe = {}   // "nodo.parametro" -> generacion en la que se encolo su ultima escritura

const despachador = crearDespachador(async (clave, valor) => {
  const [nodo, parametro] = clave.split('.')
  await ampli.ponerParametro(nodo, parametro, valor)
})

// Si una escritura no se confirma, el control vuelve a lo ultimo confirmado: la
// pantalla no puede afirmar un valor que el equipo no aplico. Si se confirma,
// tambien hay que pintarlo: el despachador solo manda el ultimo valor de un
// arrastre, asi que puede llegar aqui bastante despues de que el usuario haya
// seguido moviendo el control (incluso despues de que otra escritura, ya
// vencida, lo haya hecho volver a un valor viejo).
despachador.alTerminar((clave, valor, error) => {
  if (generacionDe[clave] !== generacion) return   // el render que la origino ya no existe
  const campo = document.querySelector(`[data-clave="${clave}"]`)
  if (!error) {
    confirmados[clave] = valor
    if (campo) pintarControl(campo, valor)
    marcar(campo, '')
  } else {
    if (campo && confirmados[clave] != null) pintarControl(campo, confirmados[clave])
    marcar(campo, 'sin confirmar')
  }
  // El drenado de la cola sigue corriendo, sincronicamente, despues de este
  // callback (vaciar() recien revisa si queda algo pendiente al volver de
  // el): en un microtask posterior enVuelo() ya refleja bien si de verdad no
  // queda nada por mandar. Sin cerrar el sync la pantalla del ampli se queda
  // en "sync with Fender Tone" en vez de volver al preset -- lo mismo que
  // app.js ya resuelve para el envio de la tarjeta, pero alla es una sola
  // tanda con su propio finally; aqui las escrituras son continuas y el
  // drenado de la cola es el unico punto donde "termine" tiene sentido.
  queueMicrotask(() => { if (!despachador.enVuelo()) ampli.cerrarSync().catch(() => {}) })
})

function marcar(campo, texto) {
  const aviso = campo?.closest('.perilla-editor')?.querySelector('.aviso')
  if (aviso) aviso.textContent = texto
}

// Pinta un control con un valor que el equipo ya confirmo -- sea porque una
// escritura tuvo exito o porque hay que revertir tras un rechazo. Cada tipo
// de control guarda su valor en un lugar distinto del DOM: no hay una sola
// forma de "pintar" que sirva para los tres.
function pintarControl(campo, valor) {
  const p = campo.__descriptor
  if (p?.tipo === 'interruptor') { campo.checked = !!valor; return }
  if (p?.tipo === 'lista') { campo.value = valor; return }
  pintarValor(campo, valor)
}

function pintarValor(campo, cable) {
  const p = campo.__descriptor
  campo.value = String(cable)
  const salida = campo.closest('.perilla-editor').querySelector('output')
  salida.textContent = `${p.aPantalla(cable).toFixed(p.decimales)}${p.unidades ? ' ' + p.unidades : ''}`
}

// Lee el valor de un control segun su tipo: un `lista` trae un string, un
// `interruptor` un booleano de `checked`, y solo un `continuo` es un numero.
// `Number(campo.value)` es correcto solo para el tercero -- para los otros dos
// da NaN o el string tal cual, y ponerParametro() rechazaria en silencio ese
// valor mal tipado en vez de escribir lo que el usuario eligio.
function valorDe(campo) {
  const tipo = campo.__descriptor?.tipo
  if (tipo === 'interruptor') return campo.checked
  if (tipo === 'lista') return campo.value
  return Number(campo.value)
}

function mostrarAvisoCabecera(mensaje) {
  const cabecera = contEditor.querySelector('.editor-cabecera')
  if (!cabecera) return
  // Sin este remove(), cada rechazo agrega OTRO <span>: los avisos de
  // cambios de unidad fallidos se acumulan uno detras de otro para siempre.
  cabecera.querySelector('.aviso')?.remove()
  cabecera.insertAdjacentHTML('beforeend', `<span class="aviso">${esc(mensaje)}</span>`)
}

async function cargarCatalogo() {
  if (catalogo) return catalogo
  const r = await fetch('/lt25-unidades.json')
  // Un error del servidor no debe dibujarse como si el ampli no tuviera
  // nada que mostrar: eso afirmaria algo falso. (Mismo motivo que el
  // comentario de `api()` en app.js; distinta forma, porque esto no es una
  // respuesta JSON de nuestro propio servidor con un campo `error`.)
  if (!r.ok) throw new Error(`No pude cargar el catálogo de unidades (HTTP ${r.status})`)
  catalogo = crearCatalogo(await r.json())
  return catalogo
}

// Lee el preset y redibuja. Sin guarda propia: quien la llama (montarEditor,
// o el cambio de unidad que ya tiene la suya) es responsable de sostener
// `operando` mientras esto corre.
async function releerYRedibujar() {
  contEditor.innerHTML = '<p class="vacio">Leyendo el amplificador…</p>'
  let cat
  try {
    cat = await cargarCatalogo()
  } catch (err) {
    contEditor.innerHTML = `<p class="vacio">${esc(err.message)}</p>`
    return
  }
  let preset, editado
  try {
    ({ preset, editado } = await ampli.leerPreset())
  } catch (err) {
    contEditor.innerHTML = `<p class="vacio">${esc(err.message)}</p>`
    return
  }
  confirmados = {}
  dibujar(cat, preset, editado)
}

export async function montarEditor() {
  if (!ampli.conectado()) {
    contEditor.innerHTML = '<p class="vacio">Conecta el amplificador para editarlo.</p>'
    return
  }
  if (operando) return
  operando = true
  try {
    await releerYRedibujar()
  } finally {
    operando = false
  }
}

function dibujar(cat, preset, editado) {
  generacion++
  const nodos = Object.fromEntries((preset.audioGraph?.nodes ?? []).map(n => [n.nodeId, n]))
  contEditor.innerHTML = `
    <div class="editor-cabecera">
      <h2>${esc(preset.info?.displayName?.trim() ?? 'Preset activo')}</h2>
      ${editado ? '<span class="editado">editado sin guardar</span>' : ''}
      <button type="button" id="releer">Releer del ampli</button>
    </div>
    ${RANURAS.map(r => bloqueRanura(cat, r, nodos[r])).join('')}`

  $('#releer').addEventListener('click', montarEditor)

  for (const campo of contEditor.querySelectorAll('[data-clave]')) {
    const [nodo, parametro] = campo.dataset.clave.split('.')
    const fenderId = nodos[nodo]?.FenderId
    campo.__descriptor = cat.parametrosDe(fenderId).find(p => p.id === parametro)
    // Para un continuo, el valor de partida sale del preset, no de
    // campo.value: un <input type="range"> ajusta su value al paso mas
    // cercano de la grilla (100 pasos entre min y max) apenas se lo asigna,
    // y ese redondeo no es lo que el equipo realmente tiene guardado --
    // mostrarlo y registrarlo como si lo fuera es la misma mentira que la
    // spec prohibe para un valor crudo, solo que autoinfligida.
    const real = nodos[nodo]?.dspUnitParameters?.[parametro]
    const tipo = campo.__descriptor?.tipo
    const valor = tipo === 'continuo' && real != null ? real : valorDe(campo)
    confirmados[campo.dataset.clave] = valor
    if (tipo === 'continuo') pintarValor(campo, valor)
  }
}

/* Los dos listeners de mas abajo son delegacion pura sobre `contEditor`, que
   nunca se reemplaza a si mismo (solo su innerHTML) -- asi que se enganchan
   una sola vez, a nivel de modulo. Si vivieran dentro de dibujar(), que corre
   en cada montaje, cada "Releer" y cada cambio de unidad, se acumularian: la
   segunda visita ya dejaria dos de cada uno, y cada gesto sobre una perilla
   dispararia N escrituras -- ademas de N leerPreset()/reemplazarUnidad()
   concurrentes, que es justo lo que la guarda `operando` de arriba existe
   para impedir. */
contEditor.addEventListener('input', e => {
  const campo = e.target.closest('[data-clave]')
  if (!campo) return
  const valor = valorDe(campo)
  if (campo.__descriptor?.tipo === 'continuo') pintarValor(campo, valor)
  generacionDe[campo.dataset.clave] = generacion
  despachador.poner(campo.dataset.clave, valor)
})

contEditor.addEventListener('change', async e => {
  const selector = e.target.closest('[data-ranura]')
  if (!selector) return
  if (operando) {
    // Hay una lectura u otro reemplazo en curso: este cambio no puede
    // mandarse ahora sin arriesgar la misma superposicion que `operando`
    // existe para evitar. Se revierte la seleccion visible -- ya cambio
    // sola, antes de este handler -- y se avisa en vez de quedar mudo.
    const anterior = selector.querySelector('option[selected]')
    if (anterior) selector.value = anterior.value
    mostrarAvisoCabecera('Hay una operación en curso; esperá a que termine.')
    return
  }
  const ranura = selector.dataset.ranura
  operando = true
  selector.disabled = true
  try {
    await ampli.reemplazarUnidad(ranura, selector.value)
    await releerYRedibujar()   // la unidad nueva tiene otras perillas: se redibuja
  } catch (err) {
    mostrarAvisoCabecera(err.message)
    selector.disabled = false
  } finally {
    operando = false
  }
})

function bloqueRanura(cat, ranura, nodo) {
  const fenderId = nodo?.FenderId ?? ''
  const unidades = cat.deRanura(ranura)
  let opciones = unidades
    .map(u => `<option value="${esc(u.fenderId)}"${u.fenderId === fenderId ? ' selected' : ''}>${esc(u.nombre)}</option>`)
    .join('')
  // Un FenderId que el catalogo no conoce no calza con ninguna <option> de
  // arriba: sin esto el <select> mostraria la primera de la lista como si
  // esa unidad estuviera cargada, que es peor que mostrar un nombre que no
  // se pudo resolver. cat.nombre() existe justo para este caso: devuelve el
  // id tal cual cuando no lo conoce.
  if (fenderId && !unidades.some(u => u.fenderId === fenderId)) {
    opciones += `<option value="${esc(fenderId)}" selected>${esc(cat.nombre(fenderId))}</option>`
  }
  const params = cat.parametrosDe(fenderId)
    .map(p => control(ranura, p, nodo?.dspUnitParameters?.[p.id]))
    .join('')
  return `
    <section class="ranura">
      <header>
        <span class="nombre-ranura">${esc(ranura)}</span>
        <select data-ranura="${esc(ranura)}">${opciones}</select>
      </header>
      <div class="perillas">${params || '<p class="vacio-ranura">Sin perillas.</p>'}</div>
    </section>`
}

function control(ranura, p, actual) {
  const clave = `${ranura}.${p.id}`
  if (p.tipo === 'continuo') {
    const paso = (p.max - p.min) / 100
    return `
      <label class="perilla-editor">
        <span class="nombre">${esc(p.nombre)}</span>
        <input type="range" data-clave="${esc(clave)}"
               min="${p.min}" max="${p.max}" step="${paso}" value="${actual ?? p.min}">
        <output></output><span class="aviso"></span>
      </label>`
  }
  if (p.tipo === 'interruptor') {
    return `
      <label class="perilla-editor">
        <span class="nombre">${esc(p.nombre)}</span>
        <input type="checkbox" data-clave="${esc(clave)}" ${actual ? 'checked' : ''}>
        <span class="aviso"></span>
      </label>`
  }
  const opciones = p.valores
    .map(v => `<option value="${esc(v.valor)}"${v.valor === actual ? ' selected' : ''}>${esc(v.nombre)}</option>`)
    .join('')
  return `
    <label class="perilla-editor">
      <span class="nombre">${esc(p.nombre)}</span>
      <select data-clave="${esc(clave)}">${opciones}</select>
      <span class="aviso"></span>
    </label>`
}
