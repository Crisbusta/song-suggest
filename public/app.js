import { ampli } from './ampli-usb.js'
import { montarEditor } from './editor.js'
import { crearCatalogo, RANURAS, VACIA } from './catalogo-lt25.js'
import {
  esc, parametrosAmpQueViajan,
} from './tarjeta.js'
import { buscarArtistas, claveDeArtista } from './artistas.js'
import { pintarSortear, pintarPistas, iframePreviewHtml } from './vista-sortear.js'
import { pintarPanelAmpli } from './panel-ampli.js'

const $ = s => document.querySelector(s)

/* Estado del filtro por bandas. Vive aca arriba y no junto a su bloque de mas
   abajo por una razon concreta: la lista de artistas se pide con un `fetch`, y
   durante esa espera los listeners de los sliders ya estan registrados. Si
   `bandas` se declarara despues, mover un slider en ese instante entraria a
   `sortear()` con la variable en su zona muerta y reventaria. Declarada aca,
   ese sorteo temprano simplemente no manda ninguna banda, que es lo correcto. */
let indiceArtistas = []
let bandas = []          // los nombres visibles elegidos, en orden de eleccion

const api = async (ruta, opts) => {
  const r = await fetch(ruta, opts)
  if (!r.ok) {
    // Un error del servidor NO debe dibujarse como "no hay canciones": eso
    // seria afirmar algo falso sobre el catalogo.
    const cuerpo = await r.json().catch(() => ({}))
    throw new Error(cuerpo.error ?? `HTTP ${r.status}`)
  }
  return r.json()
}

let actual = null

/* Cual pista se esta mirando. Se reinicia en cada sorteo -- igual que el modo,
   la dificultad y las bandas, la eleccion no se recuerda entre sorteos ni
   entre recargas. */
let pistaElegida = 0

/* Escribe lo que describe al FILTRO (el contador y el aviso) y delega la
   tarjeta. Separadas porque hay dos caminos que quieren dibujar la tarjeta sin
   tocar el contador: cambiar de pista (la cancion es la misma, el filtro no se
   movio) y el sorteo de todo (la cancion no salio de los controles). */
function pintar({ song, matching, hint }) {
  // El aviso rojo del ampli (ver `abandonar()`) vive en este mismo nodo, que
  // es permanente: sin reponer la clase, un `mal` pegado teñiria de rojo el
  // conteo de canciones de la tirada siguiente.
  $('#hint').className = 'hint'
  $('#hint').textContent = hint ?? ''
  // matching describe el filtro, no la cancion: se muestra con los controles.
  $('#calzan').textContent = matching === 1
    ? '1 calza'
    : `${matching.toLocaleString('es-CL')} calzan`
  pintarCancion(song)
}

/* Dibuja una cancion DISTINTA. Por aca tiene que entrar todo camino que cambie
   de cancion sin pasar por los controles -- el sorteo de todo de la Task 4 --
   y no por `pintarTarjeta` directo: `pistaElegida` es un indice dentro de ESTA
   cancion, y heredarlo de la anterior no es solo un indice fuera de rango, es
   la tarjeta describiendo una pista mientras el selector marca otra. Cada
   tirada abre en la pista que eligio el servidor: la mas vista de las que
   califican. */
function pintarCancion(song, sinFiltros = false) {
  pistaElegida = song?.pistaPorDefecto ?? 0
  pintarTarjeta(song, sinFiltros)
}

/* La vista v2 separa la practica del ampli. La cancion y la pista ya viven
   completas en memoria: cambiar fila no consulta al servidor. */
function pintarTarjeta(song, sinFiltros = false) {
  const mismaCancion = song != null && actual === song
  actual = song
  const tarjeta = $('#tarjeta')
  if (!song) {
    tarjeta.innerHTML = sinFiltros
      ? '<p class="vacio">No queda ninguna canción por sortear.</p>'
      : '<p class="vacio">Nada que sortear con estos filtros.</p>'
    $('#col-pistas').innerHTML = ''
    $('#panel-ampli').innerHTML = ''
    $('#pie-sorteo').hidden = true
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
    return
  }
  for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = false
  /* Solo la clase: el corazon es un SVG que vive en el HTML, y el relleno lo
     pone `#like.marcado svg` desde el CSS. Reescribir el innerHTML aqui lo
     borraba y dejaba un caracter de texto que no cabe en el boton de icono. */
  $('#like').classList.toggle('marcado', !!song.liked)
  /* Cambiar de PISTA solo redibuja la segunda columna. La primera -- donde
     vive el iframe de YouTube -- no se toca, asi que un video sonando
     sobrevive al cambio sin ningun truco de reemplazo parcial. */
  if (!mismaCancion) {
    tarjeta.className = 'tarjeta entra'
    tarjeta.innerHTML = pintarSortear(song, pistaElegida)
  }
  $('#col-pistas').innerHTML = pintarPistas(song, pistaElegida)
  const pista = song.pistas[pistaElegida]
  const detallesAbiertos = mismaCancion && $('#panel-ampli details')?.open
  $('#panel-ampli').innerHTML = pintarPanelAmpli(pista, {
    soportado: ampli.soportado(), conectado: ampli.conectado(),
    puedeEnviar: ampli.conectado() && hayQueEnviar(song),
    posicion: Math.max(1, [...document.querySelectorAll('.fila-pista')].findIndex(f => Number(f.dataset.pista) === pistaElegida) + 1),
  })
  if (detallesAbiertos && $('#panel-ampli details')) $('#panel-ampli details').open = true
  pintarBotonEnviar()
  pintarSelectorPistas()
  $('#pie-sorteo').hidden = false
  pintarPistaNav()
  ajustarDensidadEstable()
  verPistaElegida()
}

/* Las tres fichas miden lo mismo y ese alto no se estira. Para la identidad y
   el ampli lo que sobra no puede resolverse con una barra de scroll: son dos
   bloques de datos sueltos, sin orden que seguir, y uno partido por la mitad
   se lee como si la ficha estuviera rota. Asi que la columna que no cabe BAJA
   DE DENSIDAD hasta caber -- solo esa, y solo en la cancion que lo pide.
   Cuatro niveles, del mas barato al mas caro (en el CSS, `[data-densidad]`):

   - Identidad: primero se aprietan los espacios y baja el titulo; despues
     las etiquetas, que ya eran un recorte (5 de 9,6 de promedio).
   - Ampli: primero los espacios; despues la nota del volumen, que tambien
     esta dentro de "Qué se manda y qué se pisa"; por ultimo el rotulo
     "Efectos", que las cuatro ranuras de abajo ya nombran.

   LA COLUMNA DE PISTAS NO ENTRA AQUI, a proposito. Es una lista: tiene orden,
   tiene numeros, y scrollearla es el gesto que cualquiera espera de ella. Con
   9 u 11 pistas la densidad la apretaba hasta dejar las filas ilegibles para
   ahorrar un scroll que nadie estaba pidiendo. Ahora scrollea, con la
   cabecera fija arriba -- ver `.pistas-titulo` en el CSS.

   Se mide, no se adivina: si cabe no se toca nada. Sorteando 80 canciones del
   catalogo real en cada tamaño, ninguna de las dos desbordo nunca, y lo que
   pidieron fue:

     1728x960   las dos en 0, las 160 veces, y la lista de pistas no scrolleo
                ni una. En la pantalla de trabajo nada de esto se enciende.
     1280x800   el ampli al 3 en 75 de 80; la identidad al 1 en 18; la lista
                scrolleo en 2.
     1440x720   lo mas apretado que se probo: el ampli al 4 en 71 de 80, la
                identidad en 0 solo 4 veces, la lista scrolleo en 3.

   Por debajo de 68rem de ancho no hay tres columnas ni alto fijo: la pagina
   scrollea entera y la densidad no se usa. */
const DENSIDAD_MAXIMA = 4
function ajustarDensidad() {
  const columnas = [...document.querySelectorAll('.columnas > .ficha:not(#col-pistas)')]
  for (const col of columnas) delete col.dataset.densidad
  /* Las tres fichas comparten el alto de la fila, asi que apretar UNA encoge
     la fila y puede desbordar a otra que ya habia medido bien -- pasaba: el
     ampli bajaba a densidad 3, la fila se encogia 45px y la identidad se
     salia con densidad 0. Por eso se repasan todas en cada vuelta y se para
     cuando ninguna pide mas, en vez de resolver cada columna una sola vez. */
  for (let vuelta = 0; vuelta < DENSIDAD_MAXIMA * columnas.length; vuelta++) {
    let cambio = false
    for (const col of columnas) {
      const nivel = Number(col.dataset.densidad ?? 0)
      if (nivel >= DENSIDAD_MAXIMA || col.scrollHeight <= col.clientHeight) continue
      col.dataset.densidad = nivel + 1
      cambio = true
    }
    if (!cambio) break
  }
}
/* Y una segunda pasada en el cuadro siguiente, porque la primera puede medir
   un alto que todavia no es el definitivo. Repasar cuesta una lectura de
   `scrollHeight` por columna y, si ya cabe, no cambia nada. */
const ajustarDensidadEstable = () => {
  ajustarDensidad()
  requestAnimationFrame(ajustarDensidad)
}
/* Inter llega de Google Fonts con `display: swap`, asi que el primer dibujo
   se mide con la tipografia de respaldo y el alto cambia cuando la real
   aterriza. Una sola remedida al terminar la carga, no en cada sorteo. */
document.fonts?.ready.then(() => { if (actual) ajustarDensidad() })
/* Al cambiar el tamaño de la ventana cambia cuanto cabe: se vuelve a medir
   desde cero (las clases se quitan al empezar) en vez de quedarse con la
   densidad de un alto que ya no existe. */
window.addEventListener('resize', () => { if (actual) ajustarDensidad() })
/* Desplegar "Qué se manda y qué se pisa" cambia el alto del panel tanto como
   cambiarlo de cancion, asi que se vuelve a medir igual. `toggle` no burbujea,
   por eso se escucha en captura. */
document.addEventListener('toggle', e => {
  if (actual && e.target.matches?.('.panel-detalles')) ajustarDensidadEstable()
}, true)

/* La navegacion "‹ pista N de M ›" del pie: lee el MISMO orden visible que ya
   usan los atajos 1-9 (querySelectorAll('.fila-pista'), no `song.pistas`
   crudo), asi que "siguiente" es exactamente la fila de abajo en la lista
   que el usuario esta mirando. Con una sola pista no hay nada que navegar. */
function pintarPistaNav() {
  const nav = $('#pista-nav')
  const filas = [...document.querySelectorAll('.fila-pista')]
  if (filas.length <= 1) { nav.innerHTML = ''; return }
  const indice = filas.findIndex(f => Number(f.dataset.pista) === pistaElegida)
  const etiqueta = filas[indice]?.querySelector('.nombre-pista')?.textContent ?? ''
  nav.innerHTML = `
    <button type="button" id="pista-prev" class="btn btn-icon btn-secondary" aria-label="Pista anterior" ${indice <= 0 ? 'disabled' : ''}>‹</button>
    <span class="pista-nav-actual">Pista <b>${indice + 1}</b> de ${filas.length} · ${esc(etiqueta)}</span>
    <button type="button" id="pista-siguiente" class="btn btn-icon btn-secondary" aria-label="Pista siguiente" ${indice >= filas.length - 1 ? 'disabled' : ''}>›</button>
  `
}

// Delegado porque el contenido de #pista-nav se reescribe entero en cada
// redibujado: un listener puesto sobre los botones de arriba moriria con
// ellos. Reusa el click de la fila -- el mismo camino que ya usan los
// atajos 1-9 -- asi que no hay una segunda forma de "elegir pista".
$('#pista-nav').addEventListener('click', e => {
  const boton = e.target.closest('button')
  if (!boton || boton.disabled) return
  const filas = [...document.querySelectorAll('.fila-pista')]
  const indice = filas.findIndex(f => Number(f.dataset.pista) === pistaElegida)
  if (boton.id === 'pista-prev') filas[indice - 1]?.click()
  else if (boton.id === 'pista-siguiente') filas[indice + 1]?.click()
})

/* El selector se bloquea mientras hay un envio EN CURSO SOBRE ESTA TARJETA,
   igual que el boton de enviar. No es cosmetico: cambiar de pista redibuja la
   tarjeta, y el envio que sigue corriendo (hasta 64 s en el peor caso, ver mas
   abajo) escribiria su resultado -- incluidos los avisos en rojo, que este
   proyecto se niega a tragarse -- en un `#envio-estado` que ya no esta en
   pantalla, dejando el ampli con un tono que la tarjeta no muestra y sin decir
   nada. El sorteo se salva solo, porque `actual` cambia y `abandonar()` lo
   detecta; el cambio de pista no, porque la cancion es la misma.

   Ojo con `enviando` a secas: es cierto mientras CUALQUIER envio esta en
   curso, y un envio fijo su propia cancion al arrancar (`cancionEnviando`,
   ver mas abajo) -- si mientras tanto se sortea una cancion nueva, ese envio
   ya no puede tocarla (`abandonar()` corta apenas `actual !== cancion`). Sin
   distinguir esto, la tarjeta NUEVA quedaria con el selector deshabilitado
   hasta 64 s por un envio que no la afecta. Se compara contra `actual`, que
   ya es la cancion de ESTA tarjeta en el momento en que esto se llama. */
function pintarSelectorPistas() {
  for (const fila of document.querySelectorAll('.fila-pista')) {
    fila.disabled = enviando && actual === cancionEnviando
  }
}

/* Con la lista scrolleada, la pista elegida puede quedar fuera de la vista:
   pasa al cambiar de pista con los atajos o con "‹ pista N de M ›" del pie,
   donde no hay un click que traiga el foco. `nearest` no mueve nada si ya se
   ve. Solo se llama cuando la COLUMNA scrollea: por debajo de 68rem quien
   scrollea es la pagina entera, y ahi esto daria un salto en cada tirada. */
function verPistaElegida() {
  const col = $('#col-pistas')
  if (!col || col.scrollHeight <= col.clientHeight) return
  col.querySelector('.fila-pista.elegida')?.scrollIntoView({ block: 'nearest' })
}

// Al pulsar la miniatura se reemplaza por el reproductor y suena. Delegado en la
// tarjeta porque el bloque se redibuja completo en cada tirada; y como se
// redibuja, el iframe anterior muere solo y la canción anterior deja de sonar.
$('#vista-sorteo').addEventListener('click', e => {
  const fila = e.target.closest('[data-pista]')
  if (fila) {
    pistaElegida = Number(fila.dataset.pista)
    pintarTarjeta(actual)
    $(`[data-pista="${pistaElegida}"]`)?.focus()
    return
  }
  const bloque = e.target.closest('[data-escuchar]')
  if (!bloque) return
  const id = bloque.dataset.escuchar
  bloque.outerHTML = iframePreviewHtml(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`)
})

async function pintarStats() {
  try {
    const s = await api('/api/stats')
    const n = v => v.toLocaleString('es-CL')
    $('#stats').textContent = `${n(s.available)} disponibles de ${n(s.enriched)} listas`
  } catch { $('#stats').textContent = '' }
}

async function sortear() {
  const params = new URLSearchParams({
    mode: $('#modo').value,
    minDifficulty: $('#min').value,
    maxDifficulty: $('#max').value,
  })
  for (const b of bandas) params.append('artist', b)
  try {
    pintar(await api(`/api/roll?${params}`))
  } catch (err) {
    actual = null
    $('#tarjeta').innerHTML = '<p class="vacio">No pude hablar con el servidor.</p>'
    $('#hint').className = 'hint'
    $('#hint').textContent = `Error: ${err.message}. ¿Sigue corriendo \`npm start\`?`
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
  }
}

// Arrastrar un slider dispara varios `input` seguidos; sin espera, cada uno
// sortea y le suma un shown_count fantasma a canciones que nunca se vieron.
let temporizador
const sortearConEspera = () => {
  clearTimeout(temporizador)
  temporizador = setTimeout(sortear, 250)
}

const marcar = async cuerpo => {
  await api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: actual.songId, ...cuerpo }),
  })
  pintarStats()
  /* Descartar una cancion la saca del universo sorteable, asi que el numero
     que el buscador muestra al lado de cada banda deja de ser cierto -- y ese
     numero existe justamente para ser una promesa que el boton puede cumplir.
     Se refresca sin esperar: la lista es para la proxima vez que escribas, no
     para el sorteo que viene en curso. */
  refrescarArtistas()
}

/* El rango de dificultad son dos selectores, uno por extremo.

   El maximo lista de 10 a 1 a proposito, igual que el diseño: el valor que mas
   se toca en ese control esta arriba del todo en vez de al final de la lista. */
function llenarDificultad() {
  const opciones = (valores, puesto) => valores
    .map(v => `<option value="${v}"${v === puesto ? ' selected' : ''}>${v}</option>`).join('')
  const arriba = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  $('#min').innerHTML = opciones(arriba, Number($('#min').dataset.valor ?? 1))
  $('#max').innerHTML = opciones([...arriba].reverse(), Number($('#max').dataset.valor ?? 10))
}

// Ninguno de los dos extremos puede cruzar al otro.
function sincronizarRangos(cambiado) {
  const min = $('#min'), max = $('#max')
  if (Number(min.value) > Number(max.value)) {
    if (cambiado === 'min') max.value = min.value
    else min.value = max.value
  }
}

llenarDificultad()

for (const cual of ['min', 'max']) {
  $(`#${cual}`).addEventListener('change', () => { sincronizarRangos(cual); sortear() })
}
$('#modo').addEventListener('change', sortear)
$('#otra').addEventListener('click', sortear)

// El chip de perfil: mismo patron de disclosure de siempre, para el
// estado de conexion del ampli y el boton real de conectar (que sigue siendo
// el mismo elemento de siempre, solo que ahora vive aca dentro).
$('#perfil-abrir').addEventListener('click', () => {
  const panel = $('#perfil-panel'), abrir = panel.hidden
  panel.hidden = !abrir
  $('#perfil-abrir').setAttribute('aria-expanded', String(abrir))
})
document.addEventListener('click', e => {
  if (!$('#perfil-panel').hidden && !e.target.closest('.perfil')) {
    $('#perfil-panel').hidden = true
    $('#perfil-abrir').setAttribute('aria-expanded', 'false')
  }
})

$('#atajos-abrir').addEventListener('click', () => {
  const panel = $('#atajos-panel'), abrir = panel.hidden
  panel.hidden = !abrir
  $('#atajos-abrir').setAttribute('aria-expanded', String(abrir))
})

document.addEventListener('keydown', e => {
  const editable = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)
  if (e.key === 'Escape') {
    const perfil = $('#perfil-panel')
    if (!perfil.hidden) { perfil.hidden = true; $('#perfil-abrir').setAttribute('aria-expanded', 'false') }
    const atajos = $('#atajos-panel')
    if (!atajos.hidden) { atajos.hidden = true; $('#atajos-abrir').setAttribute('aria-expanded', 'false') }
    return
  }
  if ($('#vista-sorteo').hidden || editable || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
  if (e.key === '/') { e.preventDefault(); $('#cancion-q').focus(); return }
  if (/^[1-9]$/.test(e.key) && actual) {
    const fila = [...document.querySelectorAll('.fila-pista')][Number(e.key) - 1]
    if (fila) { e.preventDefault(); fila.click() }
    return
  }
  const tecla = e.key.toLowerCase()
  const acciones = { a: 'aprendida', n: 'descartada', d: 'despues', l: 'like', e: 'enviar-ampli' }
  if (e.key === ' ') { e.preventDefault(); $('#otra').click() }
  else if (acciones[tecla]) { e.preventDefault(); document.getElementById(acciones[tecla])?.click() }
})

/* Sortea ignorando los filtros SIN tocar los controles: los sliders, el modo y
   las fichas de bandas quedan donde estan para el proximo sorteo normal.

   Y NO pisa la linea de "cuantas calzan": esa linea describe lo que los
   controles prometen, y este sorteo no salio de los controles. Pisarla la
   dejaria describiendo un universo que la proxima vez que pulses Sortear ya no
   es el tuyo. Por eso se llama a pintarCancion (no a pintar): dibuja la
   tarjeta y reinicia la pista elegida, pero no toca el TEXTO de #calzan ni de
   #hint -- #hint describe el filtro y este camino no tiene uno.

   La CLASE de #hint es otra historia: un click anterior que fallo pudo haber
   dejado `hint mal` puesto, y ese rojo sobrevive a un click exitoso si nadie
   lo repone. Se reponen solo cuando el click SI tuvo error -- el texto que ya
   estaba (el aviso del filtro) sigue siendo cierto y no se toca. */
$('#todo').addEventListener('click', async () => {
  try {
    const r = await api('/api/roll?todo=1')
    $('#hint').classList.remove('mal')
    pintarCancion(r.song, true)
  } catch (err) {
    $('#hint').className = 'hint mal'
    $('#hint').textContent = `Error: ${err.message}. ¿Sigue corriendo \`npm start\`?`
  }
})

for (const [id, status] of [['aprendida', 'learned'], ['descartada', 'skipped'], ['despues', 'queued']]) {
  $(`#${id}`).addEventListener('click', async () => { await marcar({ status }); sortear() })
}

$('#like').addEventListener('click', async () => {
  const marcado = $('#like').classList.toggle('marcado')
  actual.liked = marcado
  await marcar({ liked: marcado })
})

// --- Conexion con el amplificador -------------------------------------------
const $botonAmpli = $('#ampli-conectar')

/* El catalogo de unidades, para el envio. Hace falta por dos cosas distintas:
   convertir cada perilla de la escala de pantalla (la de la planilla) a la del
   cable, y saber cuales NO se saben convertir todavia -- que es informacion
   que hay que decir, no callar.

   Perezoso y cacheado, igual que en editor.js: son ~135 kB de JSON que no
   sirven de nada hasta que alguien pulsa "Enviar al ampli". Se duplica ese
   cargador a proposito y no se comparte con editor.js: importar el modulo del
   editor desde aqui para esto ataria el envio de la tarjeta al ciclo de vida
   de una vista que puede no abrirse nunca, y el costo real de la duplicacion
   es una descarga de localhost.

   Lo que se cachea es la PROMESA, no el resultado: dos llamadas casi
   simultaneas comparten la misma descarga en vez de pedir el JSON dos veces.
   Un fallo NO se cachea -- se limpia la promesa antes de relanzar -- porque un
   servidor caido un segundo no puede dejar el envio roto para toda la sesion. */
let promesaCatalogo = null
function catalogo() {
  promesaCatalogo ??= fetch('/lt25-unidades.json')
    .then(async r => {
      // Mismo motivo que `api()`: un error del servidor no se dibuja como si
      // el catalogo estuviera vacio, porque eso afirmaria algo falso.
      if (!r.ok) throw new Error(`No pude cargar el catálogo de unidades (HTTP ${r.status})`)
      return crearCatalogo(await r.json())
    })
    .catch(err => { promesaCatalogo = null; throw err })
  return promesaCatalogo
}

/* ¿Queda algo que mandarle al ampli? La pregunta no es si `paraElAmpli`
   existe: puede venir vacio (`{}`) y seguir habiendo tono que mandar. Un
   preset de la comunidad sin bloque de amplificador -- caso real, uno de los
   87 -- declara solo efectos, y esa cadena ES el tono de esa cancion. Al
   reves, `{}` tambien es truthy, asi que preguntar por el objeto dejaba el
   boton habilitado para envios que no escribian nada. */
function hayQueEnviar(cancion) {
  const a = cancion?.pistas[pistaElegida]?.ampli
  if (!a) return false
  return !!a.fenderId || !!a.cadena || Object.keys(a.paraElAmpli ?? {}).length > 0
}

// Refleja en el boton de envio si hay conexion. Vive aqui porque el callback
// de estado la llama; tolera que el boton aun no exista (lo crea la tarea
// siguiente) y que la cancion no traiga sugerencia.
function pintarBotonEnviar() {
  const b = $('#enviar-ampli')
  if (!b) return
  b.disabled = enviando || !(ampli.conectado() && hayQueEnviar(actual))
  b.innerHTML = `${ampli.conectado() ? 'Enviar al ampli' : ampli.soportado() ? 'Conecta el ampli primero' : 'Requiere Chrome o Edge'} <kbd>E</kbd>`
  const conexion = $('#panel-conexion')
  if (conexion) {
    conexion.textContent = ampli.conectado() ? 'Ampli conectado' : 'Sin conectar'
    conexion.classList.toggle('conectado', ampli.conectado())
  }
}

// Si el navegador no soporta WebHID el boton no aparece: un control inerte es
// peor que ninguno.
if (ampli.soportado()) {
  $botonAmpli.hidden = false
  $('#ver-editor').hidden = false
  ampli.alCambiarEstado(conectado => {
    // En el SPAN, no en el boton: el boton lleva ademas el punto de estado,
    // y un textContent sobre el entero lo borraria.
    $('#ampli-estado').textContent = conectado ? 'Ampli conectado' : 'Conectar ampli'
    $botonAmpli.classList.toggle('conectado', conectado)
    $botonAmpli.title = conectado ? 'Pulsa para desconectar' : 'Conectar el Mustang LT25 por USB'
    // El boton de arriba desaparece conectado (ver su comentario en el CSS);
    // sin esto el desplegable quedaba vacio, sin decir nada.
    $('#perfil-conectado').hidden = !conectado
    pintarBotonEnviar()
  })
  $botonAmpli.addEventListener('click', async () => {
    /* El boton se deshabilita antes de cualquier await, en las dos ramas. Sin
       eso, desconectar tenia una ventana real: pone `dispositivo` en null de
       forma sincrona y recien despues manda SYNC_END y cierra el equipo, asi
       que un segundo clic durante esa cola veia `conectado()` en false, se iba
       por la rama de conectar y le abria al usuario el selector de Chrome en
       medio de una desconexion a medio terminar. */
    $botonAmpli.disabled = true
    try {
      if (ampli.conectado()) await ampli.desconectar()
      else await ampli.conectar()
    } catch (err) {
      $('#hint').className = 'hint'
      $('#hint').textContent = err.message
    } finally {
      $botonAmpli.disabled = false
    }
  })
  // El permiso queda recordado por origen: si ya se dio, reconecta sin selector.
  // El silencio del catch es a proposito: esto corre solo al cargar la pagina,
  // sin que nadie lo haya pedido. Si no se puede reconectar (getDevices()
  // rechaza, el equipo esta tomado, no esta enchufado), el usuario todavia
  // tiene el boton; molestarlo con un error que no provoco no aporta nada. Sin
  // el catch, ademas, ese rechazo saldria como unhandled rejection.
  ampli.reconectarSiSePuede().catch(() => {})
}

// Envia los ajustes de la tarjeta actual al ampli. Delegado en #tarjeta, que
// ya tiene el listener del preview de YouTube: conviven porque cada uno
// filtra por su propio objetivo.
let enviando = false
// La cancion que ese envio en curso puede afectar. Se compara contra `actual`
// en `pintarSelectorPistas()` para que una tarjeta nueva, sorteada mientras
// otro envio sigue corriendo, no herede su bloqueo -- ver el docblock de ahi.
let cancionEnviando = null

/* Se guarda lo que el equipo TIENE, no lo que se le mando. El LT25 descarta
   en silencio lo que no entiende, asi que registrar lo enviado seria anotar
   un tono que pudo no haberse aceptado -- y el corpus entero se apoya en que
   lo guardado sea cierto. Por eso se relee con leerPreset(). */
async function guardarMiTono() {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista) return
  const estado = $('#envio-estado')
  estado.className = 'envio-estado'
  estado.textContent = 'leyendo del ampli...'
  try {
    const { preset } = await ampli.leerPreset()
    const cadena = Object.fromEntries((preset.audioGraph?.nodes ?? [])
      .map(n => [n.nodeId, { fenderId: n.FenderId, valores: n.dspUnitParameters ?? {} }]))
    const r = await fetch('/api/tono', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        songId: actual.songId, trackIndex: pista.trackIndex,
        instrument: pista.instrument, name: pista.name,
        cadena, origen: 'leido',
      }),
    })
    if (!r.ok) throw new Error(`el servidor respondio ${r.status}`)
    estado.className = 'envio-estado ok'
    estado.textContent = 'tono guardado: esta pista ya sale asi'
  } catch (err) {
    estado.className = 'envio-estado mal'
    estado.textContent = `no pude guardar el tono: ${err.message}`
  }
}

/* El veredicto se AÑADE al estado del envio, no lo reemplaza: ese texto dice
   que llego de verdad al equipo y perderlo seria cambiar informacion por una
   pregunta. Y solo aparece cuando el envio salio bien -- pedir una opinion
   sobre un tono que no llego a sonar no mide nada. */
function pintarVeredicto() {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista) return
  const opciones = [
    ['modulacion:falta', 'Le falta modulación'], ['modulacion:sobra', 'Sobra modulación'],
    ['delay:falta', 'Le falta delay'], ['delay:sobra', 'Sobra delay'],
    ['reverb:falta', 'Le falta reverb'], ['reverb:sobra', 'Sobra reverb'],
  ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')
  $('#envio-estado').insertAdjacentHTML('beforeend', `<span class="veredicto">¿Cómo sonó?
    <button type="button" class="btn-juicio" data-juicio="global:bien">Bien</button>
    <button type="button" class="btn-juicio" data-juicio="suciedad:sobra">Muy sucio</button>
    <button type="button" class="btn-juicio" data-juicio="suciedad:falta">Muy limpio</button>
    <select class="juicio-efectos" aria-label="Juzgar los efectos"><option value="">Efectos…</option>${opciones}</select></span>`)
}

/* Se anota la cadena que estaba en pantalla junto al veredicto: sin ella, un
   "sobra suciedad" es ininterpretable en cuanto el sugeridor cambie. */
async function anotarJuicio(valor) {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista || !valor) return
  const [eje, direccion] = valor.split(':')
  await fetch('/api/juicio', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: actual.songId, trackIndex: pista.trackIndex,
      instrument: pista.instrument, name: pista.name,
      eje, direccion,
      juzgado: pista.ampli?.cadena ?? null,
      fuente: pista.ampli?.fuente ?? 'ninguna',
      sugeridor: pista.ampli?.deUsuario ? 'usuario' : 'sugeridor',
    }),
  })
  const estado = $('#envio-estado')
  estado.className = 'envio-estado ok'
  estado.textContent = 'anotado, gracias'
}

$('#vista-sorteo').addEventListener('click', async e => {
  if (e.target.id === 'guardar-tono') { guardarMiTono(); return }
  const juicio = e.target.closest?.('.btn-juicio')
  if (juicio) { anotarJuicio(juicio.dataset.juicio); return }
  if (e.target.id !== 'enviar-ampli') return
  if (!hayQueEnviar(actual)) return
  // Evita un segundo envio mientras el primero sigue vivo. Ya no es lo que
  // protege el estado compartido de ampli-usb.js -- de eso se ocupa el turno
  // de ese modulo (ver `enTurno` alla), que es el unico que puede coordinar
  // este envio con el editor, que esta guarda no ve --: es para la interfaz,
  // que necesita saber cuando el boton esta ocupado. Se marca en forma
  // sincrona, antes del primer await, para no dejar una ventana en la que un
  // segundo click alcance a colarse.
  if (enviando) {
    /* La guarda no cambia; solo deja de ser muda. El envio anterior sobrevive
       a sortear otra cancion: el boton de la tarjeta nueva esta habilitado,
       asi que este clic es legitimo y quedarse callado se ve igual que un
       boton roto. El de la tarjeta en curso no llega aca: se deshabilita
       mientras dura el envio.

       Cuanto puede durar: con el equipo respondiendo, del orden de dos o tres
       segundos. En el peor caso -- el equipo enchufado pero mudo, con TODAS
       las esperas venciendo -- son unos 64 s: 4 s la lectura del preset, 4 s
       por cada una de las cinco ranuras, y 2 s por perilla (la cadena mas
       larga de la planilla declara 22, de las que este envio se salta
       `amp.volume` y las que ya viajaron por `paraElAmpli`). Antes de mandar
       la cadena completa ese peor caso eran 16 s. No se corta a la mitad por
       su cuenta: cada escritura que vence se informa, y abandonar en silencio
       a la tercera seria decidir por el usuario que el resto no vale la pena
       -- pero el estado dice por que ranura va, para que un envio trabado no
       se vea igual que una pagina colgada. */
    const ocupado = $('#envio-estado')
    if (ocupado) {
      ocupado.className = 'envio-estado'
      ocupado.textContent = 'hay un envío en curso…'
    }
    return
  }
  enviando = true
  // La cancion de este envio queda fijada aqui: si el usuario sortea otra
  // mientras el envio corre (ver arriba cuanto puede durar), `actual` cambia y
  // `#tarjeta` se reemplaza por completo, pero este envio sigue corriendo
  // sobre los nodos y valores de la cancion original.
  const cancion = actual
  cancionEnviando = cancion
  const b = $('#enviar-ampli'), estado = $('#envio-estado')
  b.disabled = true
  pintarSelectorPistas()
  estado.className = 'envio-estado'
  estado.textContent = 'enviando…'

  try {
    /* La pista se lee aqui, en el mismo instante en que se fijo `cancion`:
       el envio manda el tono que se prometio al apretar el boton, aunque
       despues se cambie de pista. */
    const sugerencia = cancion.pistas[pistaElegida].ampli
    // La cadena completa de la planilla, o null cuando la sugerencia salio de
    // la tabla de reglas (que no opina sobre efectos).
    const cadena = sugerencia.cadena ?? null
    /* Las perillas del ampli que el servidor YA convirtio a escala de cable
       (gain, treb, bass). Se siguen mandando desde aqui y no desde la cadena
       porque es el unico camino que existe cuando la sugerencia sale de las
       reglas -- y cuando sale de la planilla dan exactamente el mismo numero:
       verificado contra el catalogo, los veinte modelos declaran gain, treb,
       mid y bass como 0..1 en cable, 1..10 en pantalla y con la MISMA curva a
       los dos lados, asi que `aCable` es (d - 1) / 9, que es literalmente lo
       que calcula `paraElAmpli`. */
    const perillasAmpli = sugerencia.paraElAmpli ?? {}
    /* Ronda de revision 4: `extraAmp` es lo que la cadena de la planilla
       aporta para la ranura `amp` MAS ALLA de `perillasAmpli` -- hoy `mid`,
       que `paraElAmpli` no convierte pero que se manda igual (curva lineal,
       ver arriba). Mismo `parametrosAmpQueViajan` que arma la frase de la
       tarjeta: si esto cambia, la frase y el salto de mas abajo cambian
       juntos, no pueden desviarse. */
    const { extra: extraAmp } = parametrosAmpQueViajan(cadena, perillasAmpli)
    const extraAmpSet = new Set(extraAmp)

    // Se informa lo que el amplificador CONFIRMO, no lo que se intento: el
    // equipo ignora en silencio lo que no entiende.
    const confirmados = [], fallidos = []
    // Ranuras cuya unidad no quedo donde se pidio. Van aparte de `fallidos`:
    // una perilla sin confirmar y una unidad que no cargo no se arreglan
    // igual, y mezclarlas en una sola lista las hace ilegibles.
    const problemasRanura = []
    /* Lo que NO se manda. La regla no cambia -- lo que no se sabe convertir no
       se envia, la perilla se queda en el default de la unidad, que es dato
       real del equipo -- pero hay dos motivos distintos y, sobre todo, dos
       CONSECUENCIAS muy distintas:

       - `sinCurva`: la perilla tiene curva de pantalla propia y este proyecto
         todavia no la midio contra el equipo. Es el caso comun y esperado.
       - `sinConversion`: el catalogo no declara esa perilla para esa unidad, o
         no es un control continuo, o la conversion no dio un numero finito.

       Y cortando esos dos, `porDefecto`: las perillas que no viajaron pero
       cuya unidad la cargo ESTE envio. No es lo mismo dejar quieto un `rate`
       de una unidad que ya estaba puesta que cargar un OVERDRIVE y dejarle el
       `level` y el `gain` a media carrera cuando el preset pedia la salida
       baja: eso es un estado del equipo que el usuario no pidio, que no puede
       deducir, y que se oye. Va aparte y en rojo; el resto queda en gris,
       donde corresponde. */
    const sinCurva = [], sinConversion = []
    // ranura -> { nombre, perillas: [] }
    const porDefecto = new Map()
    const anotarPorDefecto = (ranura, u, parametro) => {
      if (!porDefecto.has(ranura)) porDefecto.set(ranura, { nombre: u.nombre, perillas: [] })
      porDefecto.get(ranura).perillas.push(parametro)
    }

    /* El catalogo se carga ANTES de tocar el equipo. Si falla, no se escribe
       nada: la alternativa seria dejar las cinco ranuras reemplazadas y sin
       una sola perilla que ponerles, o sea el tono de nadie. Solo hace falta
       cuando hay cadena que convertir; sin ella, las perillas del ampli ya
       vienen en escala de cable desde el servidor. */
    let cat = null
    if (cadena) {
      try {
        cat = await catalogo()
      } catch (err) {
        // Nada escrito todavia: si ademas sortearon otra cancion, no hay
        // ningun riesgo del que avisar sobre la tarjeta nueva.
        if (actual !== cancion) return
        estado.className = 'envio-estado mal'
        estado.textContent = `${err.message}; no mandé nada`
        pintarBotonEnviar()
        return
      }
      if (actual !== cancion) return
    }

    /* Las unidades van ANTES que las perillas: cargar una unidad trae sus
       parametros por defecto, asi que ponerlas despues pisaria los valores
       recien enviados.

       Y antes de cambiar el modelo hay que leer el volumen que tenias.
       Calculado del catalogo: los `volume` por defecto de los veinte modelos
       van de -15,88 dB (SUPER HEAVY) a 0 (SUPER CLEAN), casi 16 dB de
       diferencia entre los extremos. Cambiar de modelo sin devolver el tuyo
       puede ser ese salto de golpe, con la guitarra enchufada. El volumen no
       se sugiere -- ver `parametrosAmpQueViajan`, que lo excluye a proposito
       --, pero eso no es excusa para moverlo sin querer.

       Devolverlo tal cual es correcto porque los veinte modelos declaran la
       MISMA escala para `volume`: -60..0 dB con curva t20r. Es el hecho que
       sostiene toda esta parte, asi que queda escrito.

       Cargar una unidad en las otras cuatro ranuras NO toca el PARAMETRO
       `volume` del nodo `amp`: cada replaceNode trae los defaults de SU nodo.
       Por eso esta proteccion es del nodo `amp` y solo bloquea al `amp`, no
       al envio entero.

       Y hasta ahi llega, que es lo que hay que decir claro: proteger el
       parametro `volume` NO es proteger lo que sale por el parlante. Cargar
       un OVERDRIVE delante del ampli sube el nivel aunque el `volume` se haya
       devuelto perfecto.

       Lo que SI se arreglo: las perillas que gobiernan ese nivel (`level`,
       `gain` de OVERDRIVE, `level` de los moduladores) ya se pueden convertir
       y por lo tanto YA SE MANDAN -- sus curvas se midieron contra el equipo
       el 2026-09-17, ver CURVAS en catalogo-lt25.js. Antes se saltaban y la
       unidad recien cargada se quedaba en SU valor por defecto, que es media
       carrera y no la salida que el preset pedia; eran 116 de las 661
       escrituras que la planilla declara para las ranuras de efecto. Lo que
       queda sin mandar, si algun dia vuelve a haberlo, se sigue diciendo en
       rojo y aparte: ver `porDefecto` mas abajo. */
    let notaModelo = '', malModelo = false

    // La misma lectura resuelve las dos preguntas: que unidad hay en cada
    // ranura (para no recargar la que ya esta puesta, que resetearia sus
    // perillas para nada) y cual es tu volumen.
    let cargadas = null, volumen = null, seLeyo = false
    try {
      const { preset } = await ampli.leerPreset()
      if (actual !== cancion) return
      const nodos = preset.audioGraph?.nodes ?? []
      cargadas = Object.fromEntries(nodos.map(n => [n.nodeId, n.FenderId]))
      const v = nodos.find(n => n.nodeId === 'amp')?.dspUnitParameters?.volume
      volumen = typeof v === 'number' ? v : null
      seLeyo = true
    } catch {
      // Si ademas sortearon otra cancion, no hay nada que avisar: esta lectura
      // no escribio nada, asi que gritar en rojo sobre la tarjeta nueva seria
      // alarmar por un riesgo que no existe.
      if (actual !== cancion) return
    }

    // Ya se escribio algo en el equipo. Sirve para no callar un envio
    // abandonado a mitad, que deja la cadena entre dos canciones.
    let algoEscrito = false
    // Ranuras cuya unidad quedo donde queremos: son las unicas a las que se
    // les pueden escribir perillas sin arriesgar dialar a ciegas otra unidad.
    const conUnidad = new Set()
    // Ranuras cuya unidad la cargo ESTE envio (no las que ya estaban puestas).
    // Son las que traen los defaults de fabrica de la unidad, y por eso una
    // perilla que no se pudo convertir pesa distinto ahi: ver `porDefecto`.
    const reemplazadas = new Set()

    /* Lo que va en cada ranura. Las que la cadena no menciona van a EMPTY, que
       es la decision de la spec 6.2: el boton promete el tono de ESTA cancion,
       y un delay heredado de la anterior es exactamente el efecto arbitrario
       que este diseño existe para evitar. La contra -- borra lo que el usuario
       haya dialado a mano en esas ranuras -- esta asumida ahi y dicha en la
       tarjeta antes de que ocurra.

       Se aplica igual cuando la sugerencia salio de las reglas y no hay cadena
       ninguna: si dependiera de si la cancion tiene preset de la comunidad, el
       mismo boton borraria tus efectos o no segun un dato que el usuario no
       ve. La regla es una sola y se puede predecir.

       El ampli es la excepcion y no puede quedar vacio: no existe un modelo
       "ninguno". Sin fenderId que poner (un preset que solo declara efectos)
       esa ranura se deja como esta. */
    const objetivo = ranura => cadena?.[ranura]?.fenderId
      ?? (ranura === 'amp' ? (sugerencia.fenderId ?? null) : VACIA)

    /* Como se nombra una unidad que el equipo dice que cargo y nosotros no
       pedimos. Con el catalogo a mano sale su nombre de pantalla; sin el -- una
       sugerencia de la tabla de reglas no lo necesita, asi que no se carga --
       queda el FenderId crudo, que es feo pero cierto.

       El `id &&` no es defensa de manual: si el equipo confirma sin decir CUAL
       unidad quedo, `cat.nombre(undefined)` devuelve `undefined` y el `??` no
       se dispara, porque `??` mira el resultado y no el argumento. El mensaje
       diria "quedo en undefined". */
    const nombreDeUnidad = id => id ? (cat?.nombre(id) ?? id) : 'una unidad que no identificó'

    async function cambiarAmpli(quiere) {
      // Sin un volumen que devolver NO se cambia el modelo. El equipo se
      // quedaria con el del modelo nuevo, que puede estar casi 16 dB arriba.
      // Las otras cuatro ranuras siguen su curso: ahi no hay nada que saltar.
      if (volumen === null) {
        notaModelo = seLeyo
          ? 'no pude leer tu volumen, dejo el modelo como estaba'
          : 'no pude leer el ampli, dejo el modelo como estaba'
        malModelo = true
        // El modelo que hay sigue siendo un ampli, y gain/treb/bass/mid se
        // llaman igual en los veinte: se le pueden escribir. Es lo que este
        // envio ya hacia antes de mandar la cadena.
        conUnidad.add('amp')
        return
      }
      algoEscrito = true
      try {
        // Se informa el identificador que el EQUIPO dice que quedo puesto, no
        // el que se pidio: es la misma regla que sigue el editor.
        const puesto = await ampli.reemplazarUnidad('amp', quiere)
        // Si el equipo dice que cargo OTRA unidad, no es un exito: el usuario
        // pidio un modelo y tiene otro, y va en rojo.
        const distinto = puesto !== quiere
        notaModelo = distinto
          ? `el ampli cargo ${nombreDeUnidad(puesto)}, no ${sugerencia.modelo}`
          : `modelo ${sugerencia.modelo}`
        malModelo = distinto
        conUnidad.add('amp')
        reemplazadas.add('amp')
        /* El volumen se devuelve AQUI, pegado al cambio de modelo, y no al
           final de las cinco ranuras como dice el orden de la spec 6.1:
           hacerlo despues dejaria una ventana de hasta 8 s (delay y reverb, a
           4 s de timeout cada uno) con el equipo sonando al volumen por
           defecto del modelo nuevo. */
        try {
          await ampli.ponerParametro('amp', 'volume', volumen)
        } catch {
          notaModelo += ' (ojo: no pude devolverte el volumen)'
          malModelo = true
        }
      } catch {
        /* Sin confirmacion no sabemos si el equipo cargo el modelo o no, y en la
           duda hay que suponer que SI: un ACK perdido por timeout no significa
           que la unidad no se haya cargado, y si se cargo, el volumen quedo en
           el del modelo nuevo. Se intenta devolverlo igual -- si el cambio no
           ocurrio, escribir el valor que ya estaba no hace nada. */
        try { await ampli.ponerParametro('amp', 'volume', volumen) } catch { /* nada mas que hacer */ }
        notaModelo = 'no pude confirmar el cambio de modelo, revisa el volumen del ampli'
        malModelo = true
        // Misma duda, misma suposicion: las perillas del ampli se escriben
        // igual, porque se llaman igual cargue el modelo que cargue. Y por la
        // misma suposicion cuenta como reemplazada: si cargo, quedo en sus
        // defaults.
        conUnidad.add('amp')
        reemplazadas.add('amp')
      }
    }

    async function cambiarEfecto(ranura, quiere) {
      algoEscrito = true
      try {
        const puesta = await ampli.reemplazarUnidad(ranura, quiere)
        if (puesta === quiere) { conUnidad.add(ranura); reemplazadas.add(ranura); return }
        /* El equipo dice que cargo OTRA unidad. A diferencia del ampli, aqui
           las perillas NO se escriben: los controlId de un delay y de un
           chorus no son los mismos, pero algunos si se repiten (`level`), asi
           que escribirlos seria dialar a ciegas una unidad que nadie pidio. */
        problemasRanura.push(`${ranura} quedó en ${nombreDeUnidad(puesta)}`)
      } catch {
        // Sin confirmacion no se afirma nada, ni que cargo ni que no cargo, y
        // por eso mismo tampoco se le escriben perillas: no sabemos a que
        // unidad irian.
        problemasRanura.push(`${ranura} sin confirmar`)
      }
    }

    /* Abandonar por una tirada nueva NO puede tragarse un aviso sobre el
       amplificador. Hasta aca ya pudimos haberle cambiado el modelo y fallado
       al devolverle el volumen, y `estado` es un nodo desprendido: escribirle
       es un no-op que no avisa de nada.

       El aviso va a `#hint`, no al estado de la tarjeta, por dos razones que
       aprendimos a golpes:

       - `#envio-estado` vive DENTRO del bloque del ampli, que solo se dibuja
         si la cancion trae sugerencia. Si la tirada nueva no la trae, ese nodo
         no existe y el aviso se perderia en silencio -- con el equipo hasta 16
         dB mas arriba.
       - Y aunque exista, ese bloque es un <details> cerrado por defecto, asi
         que el aviso quedaria dentro de un acordeon plegado. Estar en el
         documento no es lo mismo que estar a la vista.

       `#hint` esta siempre en el markup, siempre visible, y ya es la linea
       donde esta app pone lo que hay que leer.

       Escribir ahi PISA lo que la tirada nueva acababa de poner (el conteo de
       canciones que calzan, o un error del servidor). Es a proposito: en ese
       instante, que tu amplificador quedo hasta 16 dB mas arriba importa mas
       que cuantas canciones calzan con el filtro, y la proxima tirada devuelve
       la linea a su contenido normal.

       El segundo aviso es nuevo con la cadena completa: aunque el volumen este
       a salvo, abandonar a mitad deja el equipo con unas ranuras de esta
       cancion y otras de la anterior. Eso no suena a nada en particular, y
       callarlo dejaria al usuario buscando de donde salio ese tono.

       Y por eso mismo los dos NO pueden verse igual. `#hint` es gris tenue, y
       ese segundo aviso es frecuente e inofensivo: quien aprenda que la linea
       gris despues de sortear no dice nada urgente va a pasar de largo la de
       los 16 dB, que llega por el mismo canal. El aviso del volumen se pinta
       con la clase `mal`, el mismo rojo que ya usa `.envio-estado.mal`. La
       clase se REPONE en las dos ramas, no solo en una: `#hint` es un nodo
       permanente, asi que un `mal` que quede pegado tiñe de rojo el proximo
       conteo de canciones. */
    const abandonar = () => {
      if (actual === cancion) return false
      if (malModelo) {
        $('#hint').className = 'hint mal'
        $('#hint').textContent = notaModelo
      } else if (algoEscrito) {
        $('#hint').className = 'hint'
        $('#hint').textContent = 'sorteaste otra canción a mitad del envío: el ampli quedó con la cadena a medias'
      }
      return true
    }

    /* El estado dice por donde va. No mide nada -- cuanto tarda de verdad solo
       lo dice el equipo -- pero con cinco ranuras y hasta 22 perillas un
       `enviando…` congelado se ve igual que una pagina colgada, y aqui no hay
       forma de cancelar. Si la tarjeta ya se reemplazo, `estado` es un nodo
       desprendido y esto es un no-op legal; el corte real lo hace
       `abandonar()`. */
    const avanzando = t => { estado.textContent = `enviando… (${t})` }

    // 1. Las cinco unidades.
    for (const [i, ranura] of RANURAS.entries()) {
      // Si ya sorteamos otra cancion, `b` y `estado` son nodos desprendidos:
      // escribirles es un no-op legal que no avisa de nada, asi que hay que
      // cortar aqui y no seguir escribiendole al ampli la cadena de una
      // cancion que ya no esta en pantalla.
      if (abandonar()) return
      avanzando(`unidades ${i + 1}/${RANURAS.length}: ${ranura}`)
      const quiere = objetivo(ranura)
      if (!quiere) continue
      if (cargadas?.[ranura] === quiere) {
        /* Ya esta puesta: recargarla le resetearia las perillas a los defaults
           de la unidad para nada. Sus perillas si se escriben igual -- lo que
           hay cargado ahi puede venir de la cancion anterior con otros
           valores.

           En el ampli, ademas, este caso va PRIMERO que la comprobacion del
           volumen: si no hay nada que cambiar no importa que el volumen no se
           pueda leer, y avisar en rojo de un riesgo que no existe tapaba
           perillas que si se confirmaron. */
        if (ranura === 'amp') notaModelo = 'el modelo ya estaba puesto'
        conUnidad.add(ranura)
        continue
      }
      if (ranura === 'amp') await cambiarAmpli(quiere)
      else await cambiarEfecto(ranura, quiere)
    }

    // 2. Las perillas del ampli que vienen de la sugerencia, ya convertidas.
    if (conUnidad.has('amp')) {
      for (const [parametro, valor] of Object.entries(perillasAmpli)) {
        if (abandonar()) return
        avanzando(`amp.${parametro}`)
        algoEscrito = true
        try { await ampli.ponerParametro('amp', parametro, valor); confirmados.push(`amp.${parametro}`) }
        catch { fallidos.push(`amp.${parametro}`) }
      }
    }

    /* 3. Las perillas de la cadena, convertidas con el catalogo.

       Se recorre lo que la planilla DECLARO, no una lista fija de nombres: las
       perillas ausentes estan ausentes a proposito -- se quedan en el default
       de la unidad, que es dato real del equipo, en vez de en un numero que
       nadie eligio. */
    // `parametrosDe` construye los descriptores en cada llamada, asi que se
    // guardan por unidad en vez de rehacerlos perilla por perilla.
    const descriptores = new Map()
    const descriptorDe = (fenderId, id) => {
      if (!descriptores.has(fenderId)) descriptores.set(fenderId, cat.parametrosDe(fenderId))
      return descriptores.get(fenderId).find(p => p.id === id)
    }

    for (const ranura of RANURAS) {
      const u = cadena?.[ranura]
      if (!u) continue
      // Si no sabemos que unidad quedo en esa ranura, no se le escribe nada;
      // ya se dijo en `problemasRanura`.
      if (!conUnidad.has(ranura)) continue
      for (const [parametro, valorPantalla] of Object.entries(u.valores)) {
        if (abandonar()) return
        /* Del ampli hay dos perillas que no salen de aqui: `volume`, que es el
           TUYO -- se leyo antes de cambiar el modelo y se devolvio arriba, no
           el de la planilla --, y las que ya viajaron por `paraElAmpli`, que
           dan el mismo numero y no vale la pena mandar dos veces (son 2 s cada
           una en el peor caso). `extraAmpSet` (arriba, via `parametrosAmpQueViajan`)
           ya excluye las dos: solo queda mandar lo que SI esta ahi (hoy `mid`). */
        if (ranura === 'amp' && !extraAmpSet.has(parametro)) continue

        /* Una perilla que no viaja cae en una de dos bolsas segun si la unidad
           de esa ranura la cargo este envio: si la cargamos nosotros, la
           perilla no "se quedo como estaba", quedo en el default de fabrica de
           una unidad que el usuario no tenia puesta. Ver `porDefecto`. */
        const noViaja = (lista) => {
          if (reemplazadas.has(ranura)) anotarPorDefecto(ranura, u, parametro)
          else lista.push(`${ranura}.${parametro}`)
        }

        const d = descriptorDe(u.fenderId, parametro)
        if (!d) { noViaja(sinConversion); continue }
        /* `crudo` es exactamente el marcador de "la curva de pantalla de esta
           perilla no se midio": su `aCable` devuelve el valor tal cual y
           mandarlo seria tratar un numero de pantalla como si fuera de cable.
           Hoy ninguna perilla del catalogo cae aqui -- las seis curvas estan
           medidas --, pero la guarda se queda: es la respuesta correcta el dia
           que Fender publique un taper nuevo. */
        if (d.crudo) { noViaja(sinCurva); continue }
        // Una lista o un interruptor no traen `aCable`: su valor de pantalla
        // es un indice, no un punto de una curva. Hoy la planilla no declara
        // ninguno, pero el dia que lo haga esto no puede reventar ni --peor--
        // contarse como una escritura que el ampli no confirmo.
        if (typeof d.aCable !== 'function') { noViaja(sinConversion); continue }
        const cable = d.aCable(valorPantalla)
        // Un valor no finito no se manda: JSON.stringify convierte NaN en null
        // y el equipo lo ignora en silencio, que es justo lo que no queremos.
        if (!Number.isFinite(cable)) { noViaja(sinConversion); continue }
        avanzando(`${ranura}.${parametro}`)
        algoEscrito = true
        try { await ampli.ponerParametro(ranura, parametro, cable); confirmados.push(`${ranura}.${parametro}`) }
        catch { fallidos.push(`${ranura}.${parametro}`) }
      }
    }

    if (abandonar()) return

    /* El informe. Cada cosa en su lugar y ninguna implicando a otra: el modelo
       no es una perilla ("ya estaba puesto" no es "lo confirmo el equipo"), una
       unidad que no cargo no es una perilla sin confirmar, y lo que ni se
       intento se dice con su motivo en vez de desaparecer del mensaje. */
    const partes = []
    if (notaModelo) partes.push(notaModelo)
    /* Que no haya modelo que poner no puede terminar en un mensaje vacio y
       verde despues de haberle vaciado cuatro ranuras al equipo. Hoy no se
       llega aca -- la tabla de reglas siempre resuelve un FenderId y la
       planilla trae su unidad --, pero `fenderIdDeModelo` devuelve null a
       proposito antes que inventar un identificador, asi que esto esta a un
       nombre de modelo mal escrito de distancia. */
    /* Ronda de revision 4: sin unidad de amp, lo que no se manda no es solo
       `perillasAmpli` -- `extraAmpSet` (mid) tampoco viaja, por la misma
       razon (este bucle exige `conUnidad.has(ranura)` para CUALQUIER ranura,
       amp incluida). Antes de este cambio ese mid perdido no aparecia en
       ningun lado del mensaje. */
    const ampSinMandar = [...Object.keys(perillasAmpli), ...extraAmpSet]
    if (!conUnidad.has('amp') && ampSinMandar.length) {
      partes.push(`no supe qué modelo poner, así que ${ampSinMandar.map(p => `amp.${p}`).join(', ')} no se mandaron`)
    }
    if (problemasRanura.length) partes.push(`unidades: ${problemasRanura.join(', ')}`)
    if (confirmados.length) partes.push(`${confirmados.join(', ')} confirmados por el ampli`)
    if (fallidos.length) partes.push(`sin confirmar: ${fallidos.join(', ')}`)
    /* En rojo, y con la unidad por delante: la unidad se cargo recien y estas
       perillas quedaron en SU valor por defecto, no en el que pedia el tono.
       Cuando la que no viaja es la salida de un drive, eso se oye. */
    if (porDefecto.size) {
      const detalle = [...porDefecto].map(([ranura, { nombre, perillas }]) =>
        `${nombre} en ${ranura} (${perillas.join(', ')})`).join(', ')
      partes.push(`cargué estas unidades pero no sé convertir algunas de sus perillas, que quedaron en el valor por defecto de la unidad: ${detalle}`)
    }
    // Estos dos no van en rojo: la unidad de esa ranura ya estaba puesta, asi
    // que nada cambio ahi. No fallo nada; hay datos que este proyecto todavia
    // no sabe convertir, y se dicen en vez de callarse.
    if (sinCurva.length) partes.push(`sin mandar (falta medir su curva): ${sinCurva.join(', ')}`)
    if (sinConversion.length) partes.push(`sin mandar (el catálogo no dice cómo convertirlo): ${sinConversion.join(', ')}`)
    if (!partes.length) partes.push('no había nada que mandar')

    const mal = malModelo || fallidos.length > 0 || problemasRanura.length > 0
      || porDefecto.size > 0
      || (!conUnidad.has('amp') && ampSinMandar.length > 0)
    estado.className = mal ? 'envio-estado mal' : 'envio-estado ok'
    estado.textContent = partes.join(' · ')
    // Solo si llego: juzgar un tono que no sono no mide nada.
    if (!mal) pintarVeredicto()
    // pintarBotonEnviar recalcula segun ampli.conectado() y actual, en vez de
    // rehabilitar a ciegas: si el ampli se desconecto a mitad del envio, el
    // boton debe quedar deshabilitado con "Conecta el ampli primero", no
    // reabilitado con ese texto contradictorio.
    pintarBotonEnviar()
  } finally {
    // Sin esto el ampli se queda mostrando "sync with Fender Tone" en vez del
    // preset: cada perilla abre el modo sync y nadie lo cerraba. Va en el
    // finally para que tambien se cierre cuando el envio se abandona por una
    // tirada nueva o revienta a mitad.
    await ampli.cerrarSync()
    enviando = false
    cancionEnviando = null
    pintarSelectorPistas()
    pintarBotonEnviar()
  }
})


/* --- Filtro por bandas ----------------------------------------------------
   El indice completo se pide UNA vez y se filtra en el navegador. Son ~2.300
   entradas: mandarlas de una es mas simple y mas rapido que una peticion por
   tecla, y para una app local de una persona no hay razon para lo segundo.

   Se refresca despues de cada marcado, porque descartar la ultima cancion de
   una banda la saca del universo sorteable y su numero dejaria de ser cierto. */
/* Refresco en segundo plano: si falla, se conserva la lista que ya habia en
   vez de dejar el buscador vacio. Una lista un poco vieja sirve; ninguna, no.
   Y a diferencia de la carga inicial, aca no se toca el texto de ayuda: el
   usuario no pidio esto y no tiene nada que hacer al respecto. */
function refrescarArtistas() {
  api('/api/artists')
    .then(({ artists }) => { indiceArtistas = artists; pintarPillsBandas() })
    .catch(() => {})
}

async function cargarArtistas() {
  try {
    indiceArtistas = (await api('/api/artists')).artists
  } catch {
    /* Sin lista no hay buscador, pero el resto de la app funciona igual: se
       deja dicho en vez de dejar una caja muda que no responde al escribir. */
    indiceArtistas = []
    $('#banda-ayuda').textContent = 'No pude cargar la lista de bandas. El sorteo sigue funcionando sin este filtro.'
  }
}

/* Un buscador con desplegable y navegacion por teclado.

   Existe porque hay DOS -- bandas y canciones -- y la navegacion por flechas,
   el cierre al salir, y el clic-antes-del-blur son la misma logica con otros
   ids. Copiarla seria dos versiones que se desvian: la primera vez que alguien
   arregle un caso de borde en una, la otra queda con el bug.

   Lo que cambia entre los dos es solo esto: donde escribes, donde se dibuja,
   como se buscan los candidatos, como se dibuja cada uno, y que pasa al elegir.

   `buscar` puede ser asincrona -- la de canciones pregunta al servidor -- y de
   ahi salen las dos piezas que el buscador de bandas no necesitaba:
   `espera` (no preguntar en cada tecla) y el descarte de la respuesta vieja. */
function crearBuscador({ entrada, lista, buscar, dibujar, vacio, alElegir, espera = 0, soltarFoco = false }) {
  const caja = $(entrada)
  const desplegable = $(lista)
  let sugerido = -1      // fila resaltada, para las flechas
  let ultimoPedido = 0
  let temporizador

  const cerrar = () => {
    desplegable.hidden = true
    desplegable.innerHTML = ''
    sugerido = -1
  }

  async function pintar() {
    const q = caja.value
    if (!q.trim()) return cerrar()

    /* Escribir rapido dispara varias busquedas y no vuelven en orden: la del
       prefijo mas corto tiene mas resultados y puede tardar mas. Sin esto, la
       respuesta vieja pisaria a la nueva y verias sugerencias de lo que
       escribiste hace dos teclas. */
    const mio = ++ultimoPedido
    const hits = await buscar(q)
    if (mio !== ultimoPedido) return

    sugerido = hits.length ? 0 : -1
    desplegable.hidden = false
    desplegable.innerHTML = hits.length
      ? hits.map((h, i) => `
          <li role="option" aria-selected="${i === 0}" data-valor="${esc(String(h.valor))}">
            ${dibujar(h)}
          </li>`).join('')
      : `<li class="vacio">${esc(vacio)}</li>`
  }

  const pintarConEspera = () => {
    clearTimeout(temporizador)
    temporizador = setTimeout(pintar, espera)
  }

  /* `soltarFoco` no es un capricho: los atajos de teclado no disparan mientras
     el foco esta en un input, asi que tras abrir una cancion desde el buscador
     pulsar "1" escribia un 1 en la caja en vez de cambiar de pista. El de
     bandas NO lo suelta a proposito -- ahi es normal encadenar varias. */
  const elegir = valor => {
    caja.value = ''
    cerrar()
    if (soltarFoco) caja.blur()
    alElegir(valor)
  }

  caja.addEventListener('input', pintarConEspera)
  caja.addEventListener('focus', pintarConEspera)

  caja.addEventListener('keydown', e => {
    const filas = [...desplegable.querySelectorAll('li[data-valor]')]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!filas.length) return
      sugerido = (sugerido + (e.key === 'ArrowDown' ? 1 : -1) + filas.length) % filas.length
      filas.forEach((f, i) => f.setAttribute('aria-selected', String(i === sugerido)))
      filas[sugerido].scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Escape') {
      cerrar()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const fila = desplegable.querySelector('li[aria-selected="true"][data-valor]')
      if (fila) elegir(fila.dataset.valor)
    }
  })

  // El `mousedown` va antes del `blur` de la caja, asi que el clic alcanza a
  // registrarse; con `click` el desplegable ya se habria cerrado.
  desplegable.addEventListener('mousedown', e => {
    const fila = e.target.closest('li[data-valor]')
    if (fila) { e.preventDefault(); elegir(fila.dataset.valor) }
  })

  caja.addEventListener('blur', () => setTimeout(cerrar, 0))

  return { refrescar: pintar, cerrar }
}

function agregarBanda(nombre) {
  // La comparacion es por clave y no por texto: elegir "Motorhead" cuando ya
  // esta "Motörhead" seria la misma banda dos veces y un filtro sin efecto.
  const clave = claveDeArtista(nombre)
  if (!bandas.some(b => claveDeArtista(b) === clave)) bandas.push(nombre)
  // Limpiar la caja y cerrar el desplegable los hace crearBuscador; por aqui
  // tambien se entra desde los atajos, donde no hay nada escrito que limpiar.
  pintarBandas()
  sortear()
}

function quitarBanda(nombre) {
  bandas = bandas.filter(b => b !== nombre)
  pintarBandas()
  sortear()
}

function pintarBandas() {
  $('#banda-fichas').innerHTML = bandas.map(b => `
    <li>${esc(b)}<button type="button" data-quitar="${esc(b)}"
        aria-label="Quitar ${esc(b)}">&times;</button></li>`).join('')

  $('#banda-ayuda').textContent = bandas.length
    ? 'El sorteo se limita a estas bandas.'
    : 'Sin ninguna elegida, sortea de todo el catálogo.'

  pintarPillsBandas()
}

/* "Todas" + las bandas con mas canciones, en pastillas siempre visibles --
   como el mock, pero con datos reales en vez de una lista fija: el orden ya
   viene de `/api/artists` (ORDER BY canciones DESC), asi que "las primeras 4
   que no elegiste" SON las bandas mas grandes del catalogo, no un adorno.

   Es de un solo click, a proposito: pulsar una pastilla REEMPLAZA el filtro
   (bandas = [esa]), no lo suma. El buscador de mas arriba sigue permitiendo
   elegir varias a la vez -- eso cae en fichas removibles aparte -- pero la
   fila de pastillas es la eleccion rapida de una sola banda, y por eso a lo
   mas UNA aparece marcada. */
function pintarPillsBandas() {
  const caja = $('#banda-pills')
  const puestas = new Set(bandas.map(claveDeArtista))
  const libres = indiceArtistas.filter(a => !puestas.has(a.clave))
  const unaSola = bandas.length === 1 ? bandas[0] : null

  const pastilla = (etiqueta, activa, valor) =>
    `<li><button type="button" class="pill-banda${activa ? ' activa' : ''}" data-pill="${esc(valor ?? '')}">${esc(etiqueta)}</button></li>`

  caja.innerHTML = pastilla('Todas', bandas.length === 0, '')
    + libres.slice(0, 4).map(a => pastilla(a.nombre, a.nombre === unaSola, a.nombre)).join('')
}

$('#banda-pills').addEventListener('click', e => {
  const boton = e.target.closest('[data-pill]')
  if (!boton) return
  const valor = boton.dataset.pill
  bandas = valor ? [valor] : []
  pintarBandas()
  sortear()
})

/* El de bandas busca en el indice que ya esta en memoria, asi que no espera
   nada: la respuesta es sincrona y preguntar en cada tecla es gratis. */
crearBuscador({
  entrada: '#banda-q',
  lista: '#banda-sug',
  buscar: q => buscarArtistas(indiceArtistas, q, 8, bandas)
    .map(a => ({ valor: a.nombre, nombre: a.nombre, canciones: a.canciones })),
  dibujar: a => `<span>${esc(a.nombre)}</span><span class="cuantas">${a.canciones}</span>`,
  vacio: 'Ninguna banda del catálogo se llama así.',
  alElegir: agregarBanda,
})

/* El de canciones pregunta al servidor -- el catalogo entero son 380 KB y no
   vale mandarlo al navegador por esto -- asi que espera a que dejes de
   escribir. La consulta tarda ~45 ms sobre las 10.011 canciones; con la espera
   no se siente. */
crearBuscador({
  entrada: '#cancion-q',
  lista: '#cancion-sug',
  espera: 150,
  buscar: async q => {
    try {
      const { songs } = await api(`/api/buscar?q=${encodeURIComponent(q)}`)
      return songs.map(s => ({ valor: s.songId, artist: s.artist, title: s.title }))
    } catch {
      // Sin servidor no hay sugerencias; el mensaje de "ninguna" ya lo dice
      // sin prometer que el catalogo no la tiene.
      return []
    }
  },
  dibujar: s => `<span>${esc(s.title)}</span><span class="cuantas">${esc(s.artist)}</span>`,
  vacio: 'Ninguna canción del catálogo se llama así.',
  alElegir: abrirCancion,
  soltarFoco: true,
})

/* Abrir una cancion buscada NO toca el contador ni el aviso: describen lo que
   prometen tus filtros, y esta cancion no salio de ellos. Misma regla que
   "Sortear de todo". */
async function abrirCancion(songId) {
  try {
    const { song } = await api(`/api/song?songId=${encodeURIComponent(songId)}`)
    cambiarVista('sorteo')
    $('#hint').classList.remove('mal')
    pintarCancion(song)
  } catch (err) {
    $('#hint').className = 'hint mal'
    $('#hint').textContent = `No pude abrir esa canción: ${err.message}`
  }
}

$('#banda-fichas').addEventListener('click', e => {
  const b = e.target.closest('button[data-quitar]')
  if (b) quitarBanda(b.dataset.quitar)
})

sincronizarRangos('min')
sortear()
pintarStats()
cargarArtistas().then(pintarPillsBandas)

const LISTAS = [
  ['learned', 'Aprendidas'],
  ['liked', 'Me gustaron'],
  ['queued', 'Para después'],
  ['skipped', 'Descartadas'],
]

async function pintarListas() {
  const contenedor = $('#vista-listas')
  contenedor.innerHTML = '<p class="vacio">Cargando...</p>'

  try {
    const bloques = await Promise.all(LISTAS.map(async ([clave, titulo]) => {
      const { songs } = await api(`/api/lists?list=${clave}`)
      if (songs.length === 0) {
        return `<section class="lista"><h3>${titulo}</h3><p class="vacio">Todavía nada.</p></section>`
      }
      const filas = songs.map(s => `
        <li>
          <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.artist)} — ${esc(s.title)}</a>
          <span class="dif">dif ${s.pistas[s.pistaPorDefecto].difficulty}</span>
          ${clave === 'liked'
            ? `<button data-quitar-like="${s.songId}">Quitar like</button>`
            : `<button data-deshacer="${s.songId}">Deshacer</button>`}
        </li>`).join('')
      return `<section class="lista"><h3>${titulo} (${songs.length})</h3><ol>${filas}</ol></section>`
    }))

    contenedor.innerHTML = bloques.join('')
  } catch (err) {
    contenedor.innerHTML = `<p class="vacio">No pude cargar las listas: ${esc(err.message)}</p>`
  }
}

// Deshacer devuelve la cancion al sorteo. Quitar like solo borra el like,
// sin tocar el status (a diferencia de Deshacer, que manda status: null).
$('#vista-listas').addEventListener('click', async e => {
  const deshacer = e.target.dataset?.deshacer
  const quitarLike = e.target.dataset?.quitarLike
  if (!deshacer && !quitarLike) return

  const songId = Number(deshacer ?? quitarLike)
  const cuerpo = deshacer ? { songId, status: null } : { songId, liked: false }
  await api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  pintarStats()
  pintarListas()
})

const VISTAS = ['sorteo', 'listas', 'editor']

function cambiarVista(cual) {
  for (const v of VISTAS) {
    $(`#vista-${v}`).hidden = v !== cual
    $(`#ver-${v}`).classList.toggle('activo', v === cual)
  }
  /* La fila de filtros (modo, bandas, dificultad) describe el SORTEO: en
     "Mis listas" y en el editor no cambia nada de lo que se ve, y dejarla
     ahi es ofrecer controles que no hacen nada. Las fichas de banda elegidas
     la acompañan. */
  $('.fila-bandas').hidden = cual !== 'sorteo'
  $('#banda-fichas').hidden = cual !== 'sorteo'
  if (cual === 'listas') pintarListas()
  if (cual === 'editor') montarEditor()
}

for (const v of VISTAS) $(`#ver-${v}`).addEventListener('click', () => cambiarVista(v))

/* El desplegable de efectos necesita `change`: un <select> no emite el click
   que usa el resto de los juicios. */
$('#vista-sorteo').addEventListener('change', e => {
  if (e.target.matches?.('.juicio-efectos')) anotarJuicio(e.target.value)
})
