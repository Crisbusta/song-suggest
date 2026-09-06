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
      <p class="dialogo-riesgo">Es la única operación irreversible de esta app: pisa lo que haya en la ranura elegida y no se puede deshacer.</p>
      <label>Ranura de destino
        <input type="number" id="guardar-indice" min="0" step="1" inputmode="numeric" placeholder="número de ranura">
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

/* Foto del tono ACTIVO del equipo -- { ranura, nombre, editado } -- tal como
   se le MOSTRO al usuario en el dialogo de guardado, o null si no hay ninguna
   mostrada. guardarEn() escribe lo que este vivo en el amplificador en ese
   momento, no lo que el editor tenga dibujado, y las dos cosas se separan con
   un gesto que la spec llama normal: girar la rueda del equipo (§5.3, §6).
   Sin esto, la ranura elegida quedaba escrita con el tono de OTRO preset bajo
   el nombre del que el editor mostraba, y el dialogo lo anunciaba como un
   exito. Se toma junto con la lectura de la ranura destino y se vuelve a
   verificar contra el equipo justo antes de escribir -- ver el listener de
   "Guardar y pisar". El "mirar antes de pisar" de la spec §7 vale para el
   destino y tambien para el origen. */
let origenLeido = null

// Ranura para la que YA LLEGO una lectura valida de leerRanura() -- ver el
// comentario largo junto a actualizarBotonGuardar(), mas abajo. null si no
// hay ninguna, si la ultima lectura fallo, o si el campo cambio despues de
// la ultima lectura buena. Esto es lo unico que decide si el boton de
// confirmar puede quedar habilitado: es un estado de SEGURIDAD (el paso
// previo a la unica operacion irreversible del proyecto), no un estado de
// "ocupado", y por eso no lo toca desactivarOcupado() a ciegas -- ronda de
// revision de esta tarea: sin esto, una lectura que FALLA (ranura invalida,
// timeout, equipo desconectado) dejaba el boton "Guardar y pisar" habilitado
// de todos modos, porque desactivarOcupado() rehabilitaba TODOS los
// controles en bloque al salir del `finally` de la lectura fallida.
let ranuraLeida = null

// Hay una lectura (leerPreset, leerRanura), un reemplazo de unidad
// (reemplazarUnidad) o un guardado (guardarEn) vivo. Esto YA NO es lo que
// impide que dos operaciones se pisen sobre el estado compartido de
// ampli-usb.js: de eso se ocupa ahora el turno de ese modulo (ver `enTurno`
// alla), porque esta guarda nunca pudo ver la del envio de la tarjeta en
// app.js ni al reves. Lo que sigue haciendo, y por eso se queda, es lo de la
// INTERFAZ: activarOcupado() deshabilita todos los controles del editor Y los
// del dialogo de guardado, asi que el usuario no encola gestos que despues
// van a salir tarde y no ve controles que parecen vivos mientras el equipo
// esta ocupado varios segundos. El dialogo necesita la misma guarda que el
// resto: es el paso previo a la unica operacion irreversible del proyecto --
// una lectura de ranura a medio hacer no puede dejar pasar un guardado sobre
// datos que todavia no llegaron.
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
       tiene por que cerrar el sync -- esa ventana ya tiene su propio cierre
       en desactivarOcupado(). Que ese SYNC_END pudiera caer en el hueco entre
       el SYNC_BEGIN habilitador de esa operacion y su pedido real, haciendola
       vencer sobre algo que el usuario hizo bien, ya no depende de esta
       guarda: cerrarSync() tambien pasa por el turno de ampli-usb.js, que es
       lo unico que puede impedir el mismo SYNC_END viniendo de app.js. */
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
  // El barrido de arriba acaba de rehabilitar TODOS los controles, incluido
  // "Guardar y pisar" -- pero ese boton no es un estado de "ocupado", es un
  // estado de seguridad (ver el comentario de `ranuraLeida`), y esta funcion
  // se llama tambien cuando la operacion que terminó fue una lectura de
  // ranura que FALLO. Sin esto, el boton quedaba habilitado al lado de un
  // aviso de error. Se recalcula, no se asume.
  actualizarBotonGuardar()
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
// El motivo original -- que un ACK en vuelo cayera DENTRO de la transferencia
// multi-paquete de leerPreset() y el reensamblador se lo pegara al preset --
// ya no depende de esta espera: el turno de ampli-usb.js serializa las dos
// operaciones, asi que la escritura pendiente termina antes de que la lectura
// mande su pedido. Se queda por lo que sigue siendo suyo: el despachador
// puede tener ademas valores ENCOLADOS que todavia no salieron, y arrancar una
// lectura de varios segundos dejandolos para despues es peor que mandarlos
// primero; y esta espera es la unica que puede decirlo en pantalla, mientras
// que la del turno es invisible.
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
//
// `noticia` es un hecho que YA ocurrio antes de esta relectura y que el
// usuario tiene que leer pase lo que pase con ella -- hoy, que la unidad de
// una ranura cambio y el equipo lo confirmo. Los dos caminos de fallo de mas
// abajo reemplazan contEditor entero por un parrafo de error sin cabecera, asi
// que un aviso que se enganchara DESPUES en `.editor-cabecera` se perderia
// justo cuando mas importa: un cambio que si ocurrio, seguido de un equipo que
// se va. Se pinta junto al error, no en vez de el. (Mismo defecto que la ronda
// 2 de la Task 8 arreglo para el guardado, misma solucion.)
async function releerYRedibujar(noticia = '') {
  const conNoticia = mensaje => noticia
    ? `<p class="vacio">${esc(noticia)}</p><p class="vacio">${esc(mensaje)}</p>`
    : `<p class="vacio">${esc(mensaje)}</p>`
  contEditor.innerHTML = '<p class="vacio">Leyendo el amplificador…</p>'
  let cat
  try {
    cat = await cargarCatalogo()
  } catch (err) {
    contEditor.innerHTML = conNoticia(err.message)
    return
  }
  let preset, editado
  try {
    ({ preset, editado } = await ampli.leerPreset())
  } catch (err) {
    contEditor.innerHTML = conNoticia(err.message)
    return
  }
  confirmados = {}
  dibujar(cat, preset, editado)
  if (noticia) mostrarAvisoCabecera(noticia)
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

function dibujar(cat, preset, editado) {
  generacion++
  // Nada de este preset queda guardado a nivel de modulo para el dialogo de
  // guardado: lo que se va a escribir y sobre que se va a escribir se leen del
  // equipo en el momento, no de este redibujado -- ver `origenLeido`.
  const nodos = Object.fromEntries((preset.audioGraph?.nodes ?? []).map(n => [n.nodeId, n]))
  // El nombre del preset se resuelve con `||` y no con `??`: un displayName
  // vacio ('') pasa por `??` sin activar el respaldo, y dejaba un <h2> vacio
  // justo donde el usuario busca de que preset se trata.
  contEditor.innerHTML = `
    <div class="editor-cabecera">
      <h2>${esc(preset.info?.displayName?.trim() || 'Preset activo')}</h2>
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
    const puesta = await ampli.reemplazarUnidad(ranura, selector.value)
    /* A partir de aca el cambio YA ocurrio y el equipo lo confirmo, asi que
       tiene que quedar dicho aunque la relectura de la linea siguiente falle
       -- ver el comentario de `noticia` en releerYRedibujar(). El nombre sale
       del FenderId que EL EQUIPO dice que quedo puesto, no del que se pidio:
       reemplazarUnidad() devuelve el suyo justamente para esto. */
    const noticia = `La unidad de ${ranura} quedó en «${catalogo?.nombre(puesta) ?? puesta}».`
    await releerYRedibujar(noticia)   // la unidad nueva tiene otras perillas: se redibuja
  } catch (err) {
    mostrarAvisoCabecera(err.message)
  } finally {
    desactivarOcupado()
  }
})

/* --- Dialogo "Guardar en el ampli" -----------------------------------------
   Es la unica operacion irreversible del proyecto, y el flujo esta pensado
   para obligar a mirar antes de pisar, de los DOS lados:

   - el destino: el usuario escribe una ranura, la app LEE esa ranura
     (leerRanura) y muestra que preset hay ahi ahora mismo;
   - el origen: guardarEn() escribe lo que este vivo en el amplificador, que no
     tiene por que ser lo que el editor dibujo hace rato, asi que la app LEE
     tambien el preset activo (leerPreset) y muestra con que se va a pisar.

   El boton de confirmar queda deshabilitado hasta que las dos lecturas
   vuelvan, y justo antes de escribir se relee el origen y se compara con lo
   que se mostro: si cambio, no se guarda. No hay un guardado de un clic, y no
   hay ninguna ranura prellenada.
   --------------------------------------------------------------------------- */

// Como describir el tono activo del equipo en el dialogo. El nombre viene del
// amplificador: pasa por esc() antes de entrar a innerHTML, igual que
// cualquier otro texto del equipo en este archivo.
const descripcionOrigen = o =>
  `«${esc(o.nombre)}»${o.ranura != null ? `, de la ranura ${o.ranura}` : ''}${o.editado ? ', editado sin guardar' : ''}`

// Numero valido de ranura escrito AHORA en el campo, o null si esta vacio,
// no es entero, o es negativo. No se le pone techo (`max`): cuantas ranuras
// tiene el equipo es exactamente lo que el Step 4 de esta tarea tiene que
// medir con hardware, y a proposito no se inventa un numero. Un indice fuera
// de rango no es un caso especial: simplemente la lectura correspondiente
// falla (el equipo no contesta esa ranura, o contesta con un timeout), y
// ranuraLeida se queda en null -- el mismo camino que cualquier otra lectura
// fallida, sin necesitar saber de antemano cual es el rango real.
function indiceEnCampo() {
  const v = campoIndiceGuardar.value
  const n = Number(v)
  return v !== '' && Number.isInteger(n) && n >= 0 ? n : null
}

// Unica fuente de verdad para si "Guardar y pisar" puede estar habilitado:
// solo si hay una lectura valida (`ranuraLeida` no nula) Y coincide con la
// ranura que hay escrita ahora en el campo. Se llama tanto tras una lectura
// como desde desactivarOcupado() -- ver el comentario de esa funcion --
// porque ese es un barrido generico de "termino una operacion, reactivar
// todo" que no puede decidir por si solo si ESTE boton, en particular, tiene
// permiso para quedar habilitado.
function actualizarBotonGuardar() {
  const indice = indiceEnCampo()
  botonConfirmarGuardar.disabled = ranuraLeida === null || indice === null || indice !== ranuraLeida
}

// Se limpia cada vez que el campo de ranura cambia, al abrir el dialogo, y al
// cerrarlo (ver el listener de 'close' mas abajo): cualquiera de esas cosas
// invalida la ultima lectura, y el boton de confirmar no puede quedar
// habilitado para una ranura que ya no es la que el usuario esta mirando.
function resetearAvisoGuardar() {
  avisoGuardar.innerHTML = ''
  ranuraLeida = null
  origenLeido = null
  actualizarBotonGuardar()
}

function abrirDialogoGuardar() {
  /* La ranura de destino arranca VACIA, a proposito. Prellenarla con la del
     preset activo dejaba una ranura VIVA -- justo la que el usuario acababa de
     estar editando -- a un clic de la unica operacion irreversible del
     proyecto, y ademas se leia como una recomendacion de la app. Que la
     escriba: el gesto de escribir el numero es parte de la confirmacion. */
  campoIndiceGuardar.value = ''
  resetearAvisoGuardar()
  contDialogoGuardar.showModal()
}

// Lee la ranura destino Y el preset activo, y pinta en el dialogo que hay en
// la ranura ahora mismo y con que se va a pisar. Sin guarda propia sobre
// `operando` sostenido por otra funcion -- a diferencia de releerYRedibujar(),
// esta es la unica que abre y cierra su propia ventana, porque no tiene un
// llamador comun con otra operacion (el 'input' de mas abajo es el unico punto
// que la invoca).
async function leerYMostrarDestino(indice) {
  if (!Number.isInteger(indice) || indice < 0) return
  if (operando) {
    // Puede pasar: el debounce de 'input' dispara este callback en un
    // momento arbitrario, y para entonces pudo haber arrancado OTRA
    // operacion del editor (un "Releer" general, un cambio de unidad) que
    // tambien usa `operando` y deshabilita el campo -- pero deshabilitar no
    // cancela un setTimeout ya programado. Esto NO se re-arma solo cuando la
    // otra operacion termina -- ronda de revision de esta tarea senalo que
    // un aviso que prometiera un reintento automatico mentiria, porque nada
    // lo dispara -- asi que el texto dice que hacer, no que ya esta hecho.
    avisoGuardar.innerHTML = 'Hay otra operación en curso. Vuelve a escribir la ranura cuando termine.'
    return
  }
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    const destino = await ampli.leerRanura(indice)
    // Defensa en profundidad ademas de la correlacion por ranura que ya
    // hace ampli-usb.js (ver el comentario de pendientesRanura ahi): si por
    // lo que sea la respuesta no es la de la ranura pedida, esto NO se
    // muestra como si lo fuera. Alimenta la unica operacion irreversible
    // del proyecto -- sin confirmacion no se afirma nada, tampoco aca.
    if (destino.ranura !== indice) {
      throw new Error(`El amplificador contestó con la ranura ${destino.ranura ?? '(desconocida)'} en vez de la ${indice}.`)
    }
    // El nombre viene del equipo: pasa por esc() antes de entrar al innerHTML,
    // igual que cualquier otro texto del amplificador en este archivo.
    const nombre = esc(destino.preset?.info?.displayName?.trim() || '(sin nombre)')
    /* Y ahora el ORIGEN, que es la mitad que faltaba: que tono va a quedar
       escrito. No se saca del ultimo redibujado del editor -- eso es
       exactamente lo que puede estar desactualizado, porque girar la rueda del
       equipo cambia el preset activo y nada obliga a releer -- sino del
       amplificador, aca y ahora. Va en la misma ventana de `operando` que la
       lectura del destino: el turno de ampli-usb.js las serializa igual, y
       cobrarle al usuario las dos esperas juntas es mas honesto que armar una
       segunda ventana de ocupado. */
    const origen = await ampli.leerPreset()
    const nombreOrigen = origen.preset?.info?.displayName?.trim()
    // Sin nombre no hay nada que guardar: guardarEn() manda el nombre junto al
    // pedido, y renombrar presets esta fuera de alcance (ver la spec).
    if (!nombreOrigen) throw new Error('El preset activo del equipo no tiene nombre, y este flujo guarda con el nombre que ya tiene.')
    origenLeido = { ranura: origen.ranura, nombre: nombreOrigen, editado: !!origen.editado }
    avisoGuardar.innerHTML = `La ranura ${indice} tiene ahora «${nombre}». Vas a pisarla con el tono activo del equipo: ${descripcionOrigen(origenLeido)}. No se puede deshacer.`
    ranuraLeida = indice
  } catch (err) {
    ranuraLeida = null
    origenLeido = null
    avisoGuardar.innerHTML = esc(err.message)
  } finally {
    desactivarOcupado()   // tambien recalcula el boton de confirmar -- ver actualizarBotonGuardar()
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
  temporizadorLecturaDestino = setTimeout(() => {
    const indice = indiceEnCampo()
    if (indice !== null) leerYMostrarDestino(indice)
  }, 400)
})

// El evento nativo 'close' cubre los tres caminos por los que el dialogo
// puede cerrarse -- el boton Cancelar, Escape (que ademas dispara 'cancel'
// antes), y el .close() que el propio guardado exitoso llama mas abajo --
// asi que es el unico lugar que hace falta para invalidar lo que quedaba
// pendiente. Sin esto, cancelar o Escape a mitad de la pausa del debounce
// dejaba el temporizador vivo: la lectura disparaba igual unos cientos de ms
// despues, con el dialogo ya cerrado -- `operando` deshabilitaba el editor
// entero hasta por ESPERA_RANURA (los mismos 4 s que leerPreset) sin ninguna
// causa visible para el usuario, y el aviso resultante caia en un dialogo
// que nadie estaba mirando.
contDialogoGuardar.addEventListener('close', () => {
  clearTimeout(temporizadorLecturaDestino)
  resetearAvisoGuardar()
})

// Escape dispara 'cancel' (y despues 'close') AUNQUE todos los botones del
// dialogo esten deshabilitados -- a diferencia de un clic, que un control
// disabled ya bloquea. Preexistente, encontrado en la ronda de revision de
// esta tarea: sin esto, el usuario podia cerrar el dialogo con Escape a
// mitad de una lectura o de un guardado, y la operacion seguia reteniendo
// `operando` -- hasta ESPERA_RANURA/ESPERA_GUARDAR -- con el dialogo ya
// invisible. Mismo criterio que el resto del editor (ver `operando` y
// activarOcupado() mas arriba): mientras hay una operacion en vuelo, no se
// sale por ningun camino, ni siquiera Escape.
contDialogoGuardar.addEventListener('cancel', e => {
  if (operando) e.preventDefault()
})

$('#guardar-cancelar').addEventListener('click', () => contDialogoGuardar.close())

botonConfirmarGuardar.addEventListener('click', async () => {
  // Defensiva, como el resto de los listeners de este archivo: con
  // `operando` los controles del dialogo quedan deshabilitados, asi que un
  // usuario real no puede disparar este click mientras dura.
  if (operando) return
  const indice = indiceEnCampo()
  // Ademas de la validacion de forma, esto exige que haya una lectura VALIDA
  // de esta misma ranura -- botonConfirmarGuardar.disabled ya lo impide en
  // la practica (ver actualizarBotonGuardar()), pero un handler de click no
  // deberia confiar solo en el atributo `disabled` del elemento que lo
  // disparo para la unica operacion irreversible del proyecto.
  if (indice === null || ranuraLeida !== indice) return
  // Lo que se le MOSTRO al usuario sobre el tono a escribir. Sin eso no hay
  // nada que confirmar: el boton no deberia estar habilitado (leerYMostrar-
  // Destino los pone juntos), pero esta es la unica operacion irreversible
  // del proyecto y no se confia en un `disabled`.
  const mostrado = origenLeido
  if (!mostrado) return
  activarOcupado()
  try {
    await esperarDespachadorVacio()
    /* Releer el tono ACTIVO justo antes de escribirlo, y no guardar si esa
       relectura falla: guardarEn() manda saveCurrentPresetTo, que graba lo que
       este vivo en el amplificador en ese instante -- no lo que el editor
       dibujo, ni lo que este dialogo mostro hace unos segundos. Entre una cosa
       y la otra alcanza con girar la rueda del equipo, que la spec §5.3 y §6
       llaman normal (y §6 lo vuelve EL mecanismo de reversibilidad). Sin
       saber que se va a escribir no hay confirmacion posible, asi que un fallo
       aca no se guarda: se dice y se corta. */
    let ahora
    try {
      ahora = await ampli.leerPreset()
    } catch (err) {
      ranuraLeida = null
      origenLeido = null
      avisoGuardar.innerHTML = `No se guardó nada: no pude releer el tono activo del equipo (${esc(err.message)}). Vuelve a escribir la ranura para mirar de nuevo.`
      return
    }
    const nombre = ahora.preset?.info?.displayName?.trim()
    /* Y se compara con lo mostrado. Si el tono activo cambio -- otra ranura,
       otro nombre, o el equipo lo marca editado y antes no --, lo que se
       escribiria no es lo que el usuario aprobo: se corta, se desarma el boton
       y el texto dice que hacer en vez de prometer un reintento que nada
       dispara. Es lo mismo que ya se hace con el destino cuando el equipo
       contesta otra ranura. Es todo lo que el protocolo permite comparar: dos
       tonos distintos con el mismo nombre, la misma ranura y el mismo estado
       de editado son indistinguibles desde aca. */
    const actual = { ranura: ahora.ranura, nombre, editado: !!ahora.editado }
    if (!nombre || actual.ranura !== mostrado.ranura || actual.nombre !== mostrado.nombre || actual.editado !== mostrado.editado) {
      ranuraLeida = null
      origenLeido = null
      avisoGuardar.innerHTML = nombre
        ? `No se guardó nada: el tono activo del equipo cambió desde que lo miraste (ahora es ${descripcionOrigen(actual)}). Vuelve a escribir la ranura para mirar de nuevo.`
        : 'No se guardó nada: el preset activo del equipo ya no tiene nombre, y este flujo guarda con el nombre que ya tiene.'
      return
    }
    const confirmado = await ampli.guardarEn(indice, nombre)
    // Se pinta ACA, antes de intentar releer, y en el dialogo -- no en la
    // cabecera de contEditor -- y el dialogo NO se cierra solo. Ronda de
    // revision de esta tarea: releerYRedibujar(), mas abajo, tiene dos
    // caminos de fallo (el catalogo no carga, o el equipo no manda el
    // preset) y en los dos reemplaza contEditor entero por un parrafo de
    // error SIN `.editor-cabecera` -- si el aviso de exito dependiera de
    // engancharse ahi despues, un equipo que se desconecta justo despues de
    // confirmar el guardado (o una relectura que vence) se tragaria la
    // noticia de una escritura que ya no se puede deshacer. Pintandolo aca
    // primero, en un elemento que no toca la relectura, queda dicho pase lo
    // que pase con ella. El nombre es el que EL EQUIPO confirmo -- si vino
    // nulo (mensaje truncado), se dice explicitamente en vez de mostrar en
    // silencio el que se pidio, que se leeria como si fuera la confirmacion.
    const nombreTxt = confirmado.nombre != null
      ? `como «${esc(confirmado.nombre)}»`
      : '(el amplificador no dijo con qué nombre)'
    avisoGuardar.innerHTML = `Guardado en la ranura ${confirmado.ranura} ${nombreTxt}.`
    // Ya no hay nada mas que confirmar aca: un guardado nuevo exige escribir
    // la ranura de nuevo, y con eso volver a mirar las dos puntas.
    ranuraLeida = null
    origenLeido = null
    // El guardado puede cambiar el estado "editado sin guardar" del preset
    // activo (si la ranura pisada es la misma de la que se cargo): se relee
    // igual, en el fondo, pero su resultado -- exito o fallo -- no toca el
    // aviso de arriba, que ya quedo dicho.
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
  let opciones = p.valores
    .map(v => `<option value="${esc(v.valor)}"${v.valor === actual ? ' selected' : ''}>${esc(v.nombre)}</option>`)
    .join('')
  /* Mismo arreglo que el <select> de unidades de bloqueRanura(), que lo tiene
     desde antes: un valor que el catalogo no lista para este parametro no
     calza con ninguna <option> de arriba, y sin esto el <select> mostraria la
     PRIMERA de la lista como si fuera la que el equipo tiene cargada. No es
     cosmetico: dibujar() siembra `confirmados` con lo que el control muestre,
     asi que una escritura fallida despues "revertiria" la perilla a un valor
     inventado que el amplificador nunca tuvo -- exactamente la mentira que
     este archivo existe para no decir. Se muestra el valor crudo: para un
     valor de lista no hay nada como cat.nombre() que lo resuelva. */
  if (actual != null && !p.valores.some(v => v.valor === actual)) {
    opciones += `<option value="${esc(actual)}" selected>${esc(actual)}</option>`
  }
  return `
    <label class="perilla-editor">
      <span class="nombre">${esc(p.nombre)}</span>
      <select data-clave="${esc(clave)}">${opciones}</select>
      <span class="aviso"></span>
    </label>`
}
