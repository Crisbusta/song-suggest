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

/* El dialogo de guardado vive FUERA de contEditor, insertado una sola vez a
   nivel de modulo: a diferencia del resto del editor, dibujar() lo dejaria
   destruido cada vez que redibuja (al montar, al "Releer", al cambiar de
   unidad), y el dialogo tiene que sobrevivir a eso si el usuario lo tiene
   abierto -- nada en el flujo de guardado dispara un redibujado mientras
   esta abierto, pero que sobreviva no depende de esa garantia. */
document.body.insertAdjacentHTML('beforeend', `
  <dialog id="dialogo-guardar">
    <form method="dialog">
      <h3>Guardar en el ampli</h3>
      <p class="dialogo-riesgo">Es la unica operacion irreversible de esta app: pisa lo que haya en la ranura elegida y no se puede deshacer.</p>
      <label>Ranura de destino
        <input type="number" id="guardar-indice" min="0" step="1" inputmode="numeric">
      </label>
      <p id="aviso-guardar" class="aviso"></p>
      <menu>
        <button type="button" id="guardar-cancelar">Cancelar</button>
        <button type="button" id="guardar-confirmar" disabled>Guardar y pisar</button>
      </menu>
    </form>
  </dialog>`)
const contDialogoGuardar = $('#dialogo-guardar')
const campoIndiceGuardar = $('#guardar-indice')
const botonConfirmarGuardar = $('#guardar-confirmar')
const avisoGuardar = $('#aviso-guardar')

let catalogo = null
let confirmados = {}   // "nodo.parametro" -> ultimo valor que el equipo confirmo
let presetActivo = null   // el preset que devolvio el ultimo leerPreset(): de ahi sale el nombre a guardar
let ranuraActiva = null   // la ranura de la que se cargo ese preset: solo un valor de partida para el dialogo

// Hay una lectura (leerPreset, leerRanura), un reemplazo de unidad
// (reemplazarUnidad) o un guardado (guardarEn) vivo. Las cuatro funciones
// documentan en ampli-usb.js que comparten el reensamblador y que no toleran
// superposicion -- ni entre ellas ni consigo mismas -- y todas nombran a
// este editor como el llamador que tiene que imponer esa serializacion.
// Mientras esta activo, activarOcupado() deshabilita todos los controles del
// editor Y los del dialogo de guardado: eso es lo que de verdad impide que
// una escritura NUEVA se encole durante la ventana (el usuario no puede
// disparar un 'input'/'change' sobre un control deshabilitado), y sin eso
// una escritura que llama a reensamblador.reiniciar() a mitad de la
// transferencia multi-paquete de leerPreset() le destruye lo que llevaba
// acumulado. El dialogo necesita la misma guarda que el resto: es la misma
// razon de fondo, y ademas es el paso previo a la unica operacion
// irreversible del proyecto -- una lectura de ranura a medio hacer no puede
// dejar pasar un guardado sobre datos que todavia no llegaron.
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

// Claves de controles continuos con un puntero activo (el usuario todavia
// tiene el dedo o el mouse encima, arrastrando). Un ACK que se confirma o
// vence mientras dura el arrastre queda casi siempre desactualizado -- el
// usuario ya siguio de largo -- y pintarlo encima de la posicion real del
// puntero se ve como un tembleque que antes no existia. Se resuelve solo:
// el listener de 'input' ya repinta en cada movimiento, y el ultimo ACK que
// llegue DESPUES de soltar (arrastrando ya vacio) sigue pintando lo que
// corresponda.
const arrastrando = new Set()
contEditor.addEventListener('pointerdown', e => {
  const campo = e.target.closest('[data-clave]')
  if (campo?.__descriptor?.tipo === 'continuo') arrastrando.add(campo.dataset.clave)
})
const soltarArrastre = () => arrastrando.clear()
window.addEventListener('pointerup', soltarArrastre)
window.addEventListener('pointercancel', soltarArrastre)

const despachador = crearDespachador(async (clave, valor) => {
  const [nodo, parametro] = clave.split('.')
  await ampli.ponerParametro(nodo, parametro, valor)
})

// Si una escritura no se confirma, el control vuelve a lo ultimo confirmado: la
// pantalla no puede afirmar un valor que el equipo no aplico. Si se confirma,
// tambien hay que pintarlo: el despachador solo manda el ultimo valor de un
// arrastre, asi que puede llegar aqui bastante despues de que el usuario haya
// seguido moviendo el control (incluso despues de que otra escritura, ya
// vencida, lo haya hecho volver a un valor viejo) -- salvo que el arrastre
// siga en curso, ver `arrastrando` arriba.
despachador.alTerminar((clave, valor, error) => {
  try {
    if (generacionDe[clave] !== generacion) return   // el render que la origino ya no existe
    const campo = document.querySelector(`[data-clave="${clave}"]`)
    const enVivo = arrastrando.has(clave)
    if (!error) {
      confirmados[clave] = valor
      if (campo && !enVivo) pintarControl(campo, valor)
      marcar(campo, '')
    } else {
      if (campo && !enVivo && confirmados[clave] != null) pintarControl(campo, confirmados[clave])
      marcar(campo, 'sin confirmar')
    }
  } finally {
    /* El chequeo de drenado va en un finally, no despues del `if` de arriba:
       si el `return` temprano de la guarda de generacion se ejecutara antes,
       una escritura de un render superado saldria sin agendar este chequeo,
       y el sync se quedaria abierto sin ningun disparador futuro que lo
       cierre.

       El drenado de la cola sigue corriendo, sincronicamente, despues de
       este callback (vaciar() recien revisa si queda algo pendiente al
       volver de el): en un microtask posterior enVuelo() ya refleja bien si
       de verdad no queda nada por mandar. Se exige ademas `!operando`: un
       ACK que llega mientras hay una lectura o un reemplazo en curso no
       debe cerrar el sync -- esa ventana ya tiene su propio cierre en
       desactivarOcupado(), y cerrar aca podria mandar un SYNC_END justo en
       el hueco entre el SYNC_BEGIN habilitador de esa operacion y su
       pedido real, haciendola vencer sobre algo que el usuario hizo bien. */
    queueMicrotask(() => {
      if (!operando && !despachador.enVuelo()) ampli.cerrarSync().catch(() => {})
    })
  }
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

// Entra y sale de la ventana en la que hay una lectura, un reemplazo de
// unidad o un guardado en curso. Deshabilitar los controles no es solo
// cosmetico: es lo que impide que el usuario encole una escritura nueva
// mientras dura -- ver el comentario de `operando` mas arriba. El boton
// "Releer" queda deshabilitado igual que el resto: sin esto, quedaba visible
// y clickeable durante los varios segundos que dura un cambio de unidad, y
// pulsarlo sin que pase nada se ve igual que un boton roto (mismo motivo que
// la guarda de `enviando` en app.js).
//
// Los controles del DIALOGO de guardado se incluyen aca, aunque viven fuera
// de contEditor (ver el comentario de su creacion mas arriba): son parte del
// mismo flujo serializado -- leer una ranura y guardar comparten el
// reensamblador con leerPreset/reemplazarUnidad -- y sin deshabilitarlos el
// usuario podria disparar una segunda lectura de ranura, o confirmar un
// guardado, mientras otra operacion ya esta en vuelo.
function elementosControlables() {
  return [...contEditor.querySelectorAll('input, select, button'), ...contDialogoGuardar.querySelectorAll('input, select, button')]
}

function activarOcupado() {
  operando = true
  contEditor.classList.add('ocupado')
  for (const el of elementosControlables()) el.disabled = true
}

function desactivarOcupado() {
  operando = false
  contEditor.classList.remove('ocupado')
  for (const el of elementosControlables()) el.disabled = false
  // Mientras `operando` estuvo activo no pudo encolarse ninguna escritura
  // nueva (los controles estaban deshabilitados), asi que si la cola tambien
  // esta vacia ahora, no queda nada pendiente: es el punto correcto para
  // cerrar el sync si el chequeo de alTerminar lo salto por `operando`.
  if (!despachador.enVuelo()) ampli.cerrarSync().catch(() => {})
}

function mostrarAvisoCabecera(mensaje) {
  const cabecera = contEditor.querySelector('.editor-cabecera')
  if (!cabecera) return
  // Sin este remove(), cada rechazo agrega OTRO <span>: los avisos de
  // cambios de unidad fallidos se acumulan uno detras de otro para siempre.
  cabecera.querySelector('.aviso')?.remove()
  cabecera.insertAdjacentHTML('beforeend', `<span class="aviso">${esc(mensaje)}</span>`)
}

// Espera a que el despachador termine de drenar antes de leer o reemplazar.
// Si una escritura ya en vuelo cae justo DENTRO de la transferencia
// multi-paquete de leerPreset(), el reensamblador la trata como el cierre
// de esa secuencia: le pega la carga del ACK a lo que llevaba juntado del
// preset y entrega ese pegote como si fuera un mensaje completo. Eso no
// parsea como un preset valido, asi que la lectura no miente -- termina
// fallando por su propio timeout -- pero falla por una razon que nadie va
// a poder explicar mirando la pantalla.
//
// Se llama DESPUES de deshabilitar los controles (activarOcupado ya lo
// hizo antes de esto): si se llamara con los controles todavia vivos, el
// usuario podria seguir encolando escrituras y la espera no terminaria
// nunca. En el caso normal (nada en vuelo, o la escritura en curso
// confirma en ~120 ms) esta espera no se nota; en el peor -- una escritura
// que va camino a su propio timeout -- son los mismos 2 s que esa
// escritura ya iba a tardar de todos modos, y la interfaz lo dice mientras
// tanto en vez de quedarse muda.
async function esperarDespachadorVacio() {
  if (!despachador.enVuelo()) return
  mostrarAvisoCabecera('Esperando una escritura pendiente…')
  while (despachador.enVuelo()) {
    await new Promise(resolver => setTimeout(resolver, 50))
  }
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
  let preset, ranura, editado
  try {
    ({ preset, ranura, editado } = await ampli.leerPreset())
  } catch (err) {
    contEditor.innerHTML = `<p class="vacio">${esc(err.message)}</p>`
    return
  }
  confirmados = {}
  dibujar(cat, preset, ranura, editado)
}

export async function montarEditor() {
  if (!ampli.conectado()) {
    contEditor.innerHTML = '<p class="vacio">Conecta el amplificador para editarlo.</p>'
    return
  }
  if (operando) return
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    await releerYRedibujar()
  } finally {
    desactivarOcupado()
  }
}

function dibujar(cat, preset, ranura, editado) {
  generacion++
  // Se guardan a nivel de modulo para que el dialogo de guardado -- que vive
  // fuera de este redibujado, ver su comentario de creacion -- pueda leer el
  // nombre a guardar (presetActivo) y ofrecer una ranura de partida
  // (ranuraActiva) sin depender de que dibujar() siga en el stack.
  presetActivo = preset
  ranuraActiva = ranura
  const nodos = Object.fromEntries((preset.audioGraph?.nodes ?? []).map(n => [n.nodeId, n]))
  contEditor.innerHTML = `
    <div class="editor-cabecera">
      <h2>${esc(preset.info?.displayName?.trim() ?? 'Preset activo')}</h2>
      ${editado ? '<span class="editado">editado sin guardar</span>' : ''}
      <button type="button" id="releer">Releer del ampli</button>
      <button type="button" id="abrir-guardar">Guardar en el ampli</button>
    </div>
    ${RANURAS.map(r => bloqueRanura(cat, r, nodos[r])).join('')}`

  $('#releer').addEventListener('click', montarEditor)
  $('#abrir-guardar').addEventListener('click', abrirDialogoGuardar)

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
  // `operando` deja los controles deshabilitados, asi que un usuario real no
  // puede disparar este evento mientras dura -- se chequea igual, en forma
  // defensiva, para no encolar una escritura si de algun modo llega.
  if (!campo || operando) return
  const valor = valorDe(campo)
  if (campo.__descriptor?.tipo === 'continuo') pintarValor(campo, valor)
  generacionDe[campo.dataset.clave] = generacion
  despachador.poner(campo.dataset.clave, valor)
})

contEditor.addEventListener('change', async e => {
  const selector = e.target.closest('[data-ranura]')
  // Mismo motivo que en 'input': con los controles deshabilitados durante
  // `operando`, un <select> no puede recibir esta interaccion del usuario.
  if (!selector || operando) return
  const ranura = selector.dataset.ranura
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    await ampli.reemplazarUnidad(ranura, selector.value)
    await releerYRedibujar()   // la unidad nueva tiene otras perillas: se redibuja
  } catch (err) {
    mostrarAvisoCabecera(err.message)
  } finally {
    desactivarOcupado()
  }
})

/* --- Dialogo "Guardar en el ampli" -----------------------------------------
   Es la unica operacion irreversible del proyecto, y el flujo esta pensado
   para obligar a mirar antes de pisar: el usuario elige una ranura, la app
   LEE esa ranura primero (leerRanura) y muestra que preset hay ahi ahora
   mismo, y el boton de confirmar queda deshabilitado hasta que esa lectura
   vuelva. No hay un guardado de un clic.
   --------------------------------------------------------------------------- */

// Se limpia cada vez que el campo de ranura cambia: cualquier cambio invalida
// la lectura anterior, y el boton de confirmar no puede quedar habilitado
// para una ranura que ya no es la escrita en el campo.
function resetearAvisoGuardar() {
  avisoGuardar.innerHTML = ''
  botonConfirmarGuardar.disabled = true
}

function abrirDialogoGuardar() {
  campoIndiceGuardar.value = ranuraActiva ?? ''
  resetearAvisoGuardar()
  contDialogoGuardar.showModal()
  // Si hay una ranura de partida (la que ocupa el preset activo), se lee de
  // entrada: el usuario ve de inmediato que hay ahi sin tener que tocar el
  // campo primero. Sigue siendo solo un valor de partida -- `ranuraActiva`
  // nunca sustituye esta lectura, es lo que la dispara.
  if (campoIndiceGuardar.value !== '') leerYMostrarDestino(Number(campoIndiceGuardar.value))
}

// Lee la ranura destino y pinta en el dialogo el nombre del preset que hay
// ahi ahora mismo. Sin guarda propia sobre `operando` sostenido por otra
// funcion -- a diferencia de releerYRedibujar(), esta es la unica que abre y
// cierra su propia ventana, porque no tiene un llamador comun con otra
// operacion (el 'input' de mas abajo es el unico punto que la invoca).
async function leerYMostrarDestino(indice) {
  if (operando || !Number.isInteger(indice) || indice < 0) return
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    const destino = await ampli.leerRanura(indice)
    // El nombre viene del equipo: pasa por esc() antes de entrar al innerHTML,
    // igual que cualquier otro texto del amplificador en este archivo.
    const nombre = esc(destino.preset?.info?.displayName?.trim() || '(sin nombre)')
    avisoGuardar.innerHTML = `La ranura ${indice} tiene ahora «${nombre}». Guardar la pisa y no se puede deshacer.`
    botonConfirmarGuardar.disabled = false
  } catch (err) {
    avisoGuardar.innerHTML = esc(err.message)
  } finally {
    desactivarOcupado()
  }
}

// Debounce: cada digito que el usuario escribe dispara este listener, y no
// tiene sentido lanzar una lectura de ranura por cada uno -- ademas de
// inutil, activarOcupado() deshabilitaria el campo a mitad de tipeo. Se
// espera una pausa antes de leer.
let temporizadorLecturaDestino = null
campoIndiceGuardar.addEventListener('input', () => {
  clearTimeout(temporizadorLecturaDestino)
  resetearAvisoGuardar()
  const valor = campoIndiceGuardar.value
  temporizadorLecturaDestino = setTimeout(() => {
    const indice = Number(valor)
    if (valor !== '' && Number.isInteger(indice) && indice >= 0) leerYMostrarDestino(indice)
  }, 400)
})

$('#guardar-cancelar').addEventListener('click', () => contDialogoGuardar.close())

botonConfirmarGuardar.addEventListener('click', async () => {
  // Defensiva, como el resto de los listeners de este archivo: con
  // `operando` los controles del dialogo quedan deshabilitados, asi que un
  // usuario real no puede disparar este click mientras dura.
  if (operando) return
  const indice = Number(campoIndiceGuardar.value)
  if (!Number.isInteger(indice) || indice < 0) return
  // El nombre bajo el que se guarda es el del preset activo: renombrar
  // presets esta fuera de alcance (ver la spec), asi que se guarda tal cual
  // se llama ahora, no un nombre nuevo que el usuario no pidio poder elegir.
  const nombre = presetActivo?.info?.displayName?.trim()
  if (!nombre) {
    avisoGuardar.innerHTML = 'No hay un preset activo con nombre para guardar.'
    return
  }
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    await ampli.guardarEn(indice, nombre)
    contDialogoGuardar.close()
    // El guardado puede cambiar el estado "editado sin guardar" del preset
    // activo (si la ranura pisada es la misma de la que se cargo): se relee
    // para que la pantalla no siga afirmando algo que el equipo ya cambio.
    await releerYRedibujar()
  } catch (err) {
    avisoGuardar.innerHTML = esc(err.message)
  } finally {
    desactivarOcupado()
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
