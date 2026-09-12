import { ampli } from './ampli-usb.js'
import { montarEditor } from './editor.js'
import { crearCatalogo, RANURAS, VACIA } from './catalogo-lt25.js'
import { esc, parametrosAmpQueViajan, resumenEnvioAmpli, selectorDePistas } from './tarjeta.js'
import { buscarArtistas, claveDeArtista } from './artistas.js'

const $ = s => document.querySelector(s)

/* Estado del filtro por bandas. Vive aca arriba y no junto a su bloque de mas
   abajo por una razon concreta: la lista de artistas se pide con un `fetch`, y
   durante esa espera los listeners de los sliders ya estan registrados. Si
   `bandas` se declarara despues, mover un slider en ese instante entraria a
   `sortear()` con la variable en su zona muerta y reventaria. Declarada aca,
   ese sorteo temprano simplemente no manda ninguna banda, que es lo correcto. */
let indiceArtistas = []
let bandas = []          // los nombres visibles elegidos, en orden de eleccion
let sugerido = -1        // fila resaltada del desplegable, para las flechas

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

// El reproductor embebido, a partir de una URL ya armada. Compartido entre el
// click de la miniatura y `pintarTarjeta` (que lo reconstruye al cambiar de
// pista, para que un video sonando no vuelva a la miniatura silenciosa): dos
// copias de este markup se desviarian.
const iframePreviewHtml = url => `
  <div class="preview">
    <iframe src="${url}"
            title="Reproductor de YouTube" allow="autoplay; encrypted-media"
            referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
  </div>`

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
    ? '1 canción calza con estos filtros'
    : `${matching.toLocaleString('es-CL')} canciones calzan con estos filtros`
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

// Redibuja la tarjeta de la cancion que ya esta en pantalla, con la pista que
// haya elegida. No toca el contador ni el aviso: el filtro no se movio.
// `sinFiltros` distingue el vacio del sorteo de todo (no hay filtro que
// nombrar) del vacio de un sorteo filtrado -- son dos frases, no una.
function pintarTarjeta(song, sinFiltros = false) {
  // Capturado ANTES de pisar `actual`: es la comparacion contra la cancion que
  // HABIA en pantalla, no contra la que esta por entrar.
  const mismaCancion = song != null && actual === song
  actual = song

  if (!song) {
    $('#tarjeta').innerHTML = sinFiltros
      ? '<p class="vacio">No queda ninguna canción por sortear.</p>'
      : '<p class="vacio">Nada que sortear con estos filtros.</p>'
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
    return
  }
  for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = false

  const marcado = !!song.liked
  $('#like').classList.toggle('marcado', marcado)
  $('#like').textContent = marcado ? '♥' : '♡'

  /* Todo lo que describe QUE se practica -- dificultad, instrumento,
     afinacion y el tono del ampli -- sale de la pista elegida, no de la
     cancion: la cancion ya no tiene esos campos, justamente para que la
     cabecera y el selector no puedan contradecirse. */
  const pista = song.pistas[pistaElegida]

  // El selector: logica pura, ver tarjeta.js#selectorDePistas (que decide
  // cuando no hay nada que elegir, cual opcion viene marcada y como se dicen
  // las pistas que no cumplen el filtro).
  const selectorPistas = selectorDePistas(song.pistas, pistaElegida)

  // La dificultad decide si intentas la cancion o no, asi que deja de ser un
  // chip igual a "90s" y pasa a medidor. El numero va al lado porque el color
  // solo no debe cargar el significado.
  const medidor = Array.from({ length: 10 }, (_, i) =>
    `<i class="${i < pista.difficulty ? 'on' : ''}"></i>`).join('')

  const dificultad = `
    <div class="dificultad">
      <span class="medidor" role="img" aria-label="Dificultad ${pista.difficulty} de 10">${medidor}</span>
      <span class="valor">${pista.difficulty}<small>/10</small></span>
      <span class="instrumento">${esc(pista.instrument)}</span>
    </div>`

  // La afinacion es informacion accionable: te dice si hay que reafinar antes
  // de empezar. Sale del monton de chips y se vuelve un aviso propio.
  const aviso = pista.tuning
    ? `<p class="aviso-afinacion">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
           <path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>
         </svg>
         ${esc(pista.tuning)}
       </p>`
    : ''

  const chips = song.tags.slice(0, 5)
    .map(t => `<span class="chip">${esc(t)}</span>`).join('')

  // Ajustes del ampli. Cerrado por defecto: la tarjeta ya esta densa y esto
  // solo importa una vez que decidiste intentar la cancion. La frase del pie
  // no es decoracion: es lo que hace defendible mostrar estos numeros.
  const perilla = (nombre, v) => `
    <div class="perilla">
      <span class="nombre">${nombre}</span>
      <span class="barra" role="img" aria-label="${nombre} ${v} de 10">${
        Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')
      }</span>
      <span class="num">${v}</span>
    </div>`

  const a = pista.ampli
  /* Seis perillas de pantalla, pero no las seis viven en el mismo trato con
     el boton. Lo que la planilla no declaro llega en null (comunidad) y no se
     dibuja como si valiera algo -- de ahi el filtro (Mid en ruta de reglas
     llega `undefined`, que el mismo `!= null` deja fuera solo). Reverb ni
     siquiera entra a este filtro: se trata aparte, ver mas abajo. */
  const perillas = a
    ? [['Gain', a.gain], ['Volume', a.volume], ['Treble', a.treble], ['Bass', a.bass], ['Mid', a.mid]]
        .filter(([, v]) => v != null)
        .map(([n, v]) => perilla(n, v)).join('')
    : ''

  /* El Reverb sugerido y el envio se contradicen, y hay que decirlo -- pero no
     poniendolo en la misma fila que Gain/Treble/Bass, que el boton SI escribe.
     En el Mustang LT25 el reverb no es una perilla del panel: es la unidad de
     la ranura `reverb`. Cuando la sugerencia sale de la tabla de reglas hay un
     numero de Reverb del 1 al 10 pero no hay cadena, asi que el boton manda esa
     ranura vacia -- despues de apretarlo no hay ni unidad de reverb que ajustar
     a mano. El numero no se tira (es consejo real de la tabla), pero se saca de
     la fila de perillas: lo deshonesto no es el numero, es presentarlo al lado
     de los que si viajan, como si fuera lo mismo. Volume, en cambio, SI va en
     la fila: tampoco se manda (esta en decibeles, sin curva conocida), pero el
     envio no le contradice nada -- el ampli conserva el volumen que tenia.

     Ronda de revision 1: la invitacion a elegir una unidad de reverb a mano
     no puede callar que el PROXIMO envio la vuelve a vaciar -- si no, la
     tarjeta pide una accion sin avisar que ese mismo boton la deshace. Se dice
     aca, pegado a la invitacion, no solo en `.descargo` tres lineas mas abajo:
     quien lee "elige tu una unidad" tiene que leer la contra en la misma
     frase, no confiar en que la conecte con un parrafo aparte. */
  const reverbSeVacia = a && a.reverb != null && !a.cadena?.reverb
  const reverbHtml = reverbSeVacia
    ? `<p class="reverb-aparte">
         Reverb <strong>${a.reverb}</strong> de 10 es la sugerencia, pero el botón no la
         manda: en este ampli el reverb es la unidad de la ranura <strong>reverb</strong>,
         y este tono la deja vacía. Puedes elegir tú una unidad de reverb en el
         ampli, pero el próximo envío te la vuelve a vaciar otra vez.
       </p>`
    : ''

  // ranurasDeEfectos/hayEfectos/queSeManda: logica pura, ver
  // tarjeta.js#resumenEnvioAmpli (y su comentario, con el historial completo
  // de las rondas de revision 2, 3 y 4 que la motivaron).
  const { ranurasDeEfectos, hayEfectos, queSeManda } = resumenEnvioAmpli(a)

  // La cadena que ocupa este tono: todo lo que venga del CSV pasa por esc().
  const cadenaHtml = a?.cadena
    ? `<ul class="cadena">${hayEfectos
        ? ranurasDeEfectos.map(r => `<li><span>${r}</span> <strong>${esc(a.cadena[r].nombre)}</strong></li>`).join('')
        : '<li class="sin-efectos">sin efectos: este tono es el ampli pelado</li>'}</ul>`
    : ''

  const modeloHtml = a?.modelo != null
    ? `<strong>${esc(a.modelo)}</strong>`
    : `<strong class="sin-dato">no declarado</strong>`

  // Nombrada distinto del modulo `ampli` importado arriba: un `const ampli`
  // aqui lo taparia dentro de su propio inicializador (TDZ) justo donde el
  // Step 1 necesita llamar a `ampli.soportado()`.
  const bloqueAmpli = a
    ? `<details class="ampli">
         <summary>Ajustes para tu Mustang LT25</summary>
         <div class="ampli-cuerpo">
           <p class="modelo"><span>Modelo</span>${modeloHtml}</p>
           ${perillas}
           ${cadenaHtml}
           ${reverbHtml}
           <p class="descargo">
             ${a.fuente === 'comunidad'
               ? `${esc(a.procedencia)}.${a.incierto ? ' <strong>La propia planilla marca este preset como dudoso.</strong>' : ''}
                  Es lo que a alguien le funcionó, no el tono de la grabación.`
               : `Punto de partida, no el tono del disco. Deducido de: ${a.motivos.map(esc).join(', ')}.`}
             <br>
             ${queSeManda} El <strong>Volume</strong> no viaja: el botón no toca el volumen.
             ${hayEfectos
               ? ' Qué perillas de los efectos se pudieron convertir de verdad queda dicho en el estado del envío, no aquí.'
               : ''}
             Las ranuras que este tono no usa quedan vacías cada vez que envías,
             así que no se te mezcla con la canción anterior: <strong>eso borra lo que
             hayas dialado a mano en esas ranuras.</strong>
             Cargar una unidad deja el resto de sus perillas en los valores por
             defecto de esa unidad; tu volumen se lee antes y se devuelve, y si no
             se puede, se te avisa y el modelo no se toca.
           </p>
           ${ampli.soportado()
             ? `<p class="envio">
                  <button type="button" id="enviar-ampli" class="enviar-ampli">Enviar al ampli</button>
                  <span id="envio-estado" class="envio-estado"></span>
                </p>`
             : `<p class="envio-estado">Enviar los ajustes al ampli requiere Chrome o Edge.</p>`}
         </div>
       </details>`
    : ''

  // esc() para contextos HTML y encodeURIComponent() para los de URL: no son
  // intercambiables. esc() convierte & en &amp;, que el navegador decodifica de
  // vuelta a & al parsear el atributo, asi que un id con & o ? reestructuraria
  // la direccion en vez de viajar como valor opaco.
  // Miniatura con play encima: no cargamos el reproductor de YouTube (~1 MB de
  // scripts) en cada tirada, solo una imagen liviana. El iframe entra al pulsar.
  const preview = song.officialVideo
    ? `<div class="preview" data-escuchar="${esc(song.officialVideo)}">
         <img src="https://i.ytimg.com/vi/${encodeURIComponent(song.officialVideo)}/hqdefault.jpg"
              alt="Escuchar ${esc(song.artist)} - ${esc(song.title)}" loading="lazy">
         <button type="button" class="play" aria-label="Escuchar la canción">▶</button>
       </div>`
    : ''

  /* El panel del ampli y un video sonando describen la CANCION, no la pista:
     perderlos en cada cambio de pista le cobraria un clic extra justo a la
     comparacion de tonos que el selector existe para habilitar (ver el
     docblock de arriba). Se leen ANTES de pisar el innerHTML -- despues los
     nodos ya no existen -- y solo cuando es la misma cancion: una cancion
     nueva de verdad tiene que abrir con el panel cerrado y la miniatura, no
     heredar el estado de la anterior. */
  const panelAbierto = mismaCancion && !!$('#tarjeta .ampli')?.open
  const videoUrl = mismaCancion ? $('#tarjeta iframe')?.src : null

  // Sin animacion de entrada cuando es la misma cancion: solo cambio la
  // pista, y no hay "entrada" que reproducir.
  $('#tarjeta').className = mismaCancion ? 'tarjeta' : 'tarjeta entra'
  $('#tarjeta').innerHTML = `
    <div>
      <h2>${esc(song.title)}</h2>
      <p class="artista">${esc(song.artist)}</p>
    </div>
    ${selectorPistas}
    ${dificultad}
    ${aviso}
    ${chips ? `<div class="meta">${chips}</div>` : ''}
    ${bloqueAmpli}
    ${preview}
    <p class="enlaces">
      <a href="${esc(song.url)}" target="_blank" rel="noopener">Ver la tablatura en Songsterr →</a>
      ${song.backingVideo ? ` · <a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.backingVideo)}" target="_blank" rel="noopener">Pista de acompañamiento</a>` : ''}
    </p>`

  // Repone lo que se leyo antes de pisar el innerHTML. El panel es un simple
  // atributo; el video reconstruye el iframe -- es un nodo nuevo, asi que
  // arranca de nuevo (el ?autoplay=1 que ya trae `videoUrl` se encarga), pero
  // sigue sonando en vez de volver a la miniatura silenciosa.
  if (panelAbierto) { const d = $('#tarjeta .ampli'); if (d) d.open = true }
  if (videoUrl) {
    const bloque = $('#tarjeta [data-escuchar]')
    if (bloque) bloque.outerHTML = iframePreviewHtml(videoUrl)
  }

  $('#pista')?.addEventListener('change', e => {
    pistaElegida = Number(e.target.value)
    pintarTarjeta(actual)   // el mismo objeto: no se le pide nada al servidor
    /* El `<select>` se destruye a si mismo al redibujar, y el foco se caeria
       al `<body>`. En Firefox y en el Chrome de Windows las flechas sobre un
       desplegable cerrado disparan `change` en cada tecla: sin devolver el
       foco, recorrer las pistas con el teclado se corta en la primera. */
    $('#pista')?.focus()
  })

  // Reinicia la animacion de entrada en cada tirada.
  void $('#tarjeta').offsetWidth
  pintarBotonEnviar()
  pintarSelectorPistas()
}

/* El selector se bloquea mientras hay un envio en curso, igual que el boton de
   enviar. No es cosmetico: cambiar de pista redibuja la tarjeta, y el envio que
   sigue corriendo (hasta 64 s en el peor caso, ver mas abajo) escribiria su
   resultado -- incluidos los avisos en rojo, que este proyecto se niega a
   tragarse -- en un `#envio-estado` que ya no esta en pantalla, dejando el
   ampli con un tono que la tarjeta no muestra y sin decir nada. El sorteo se
   salva solo, porque `actual` cambia y `abandonar()` lo detecta; el cambio de
   pista no, porque la cancion es la misma. */
function pintarSelectorPistas() {
  const s = $('#pista')
  if (s) s.disabled = enviando
}

// Al pulsar la miniatura se reemplaza por el reproductor y suena. Delegado en la
// tarjeta porque el bloque se redibuja completo en cada tirada; y como se
// redibuja, el iframe anterior muere solo y la canción anterior deja de sonar.
$('#tarjeta').addEventListener('click', e => {
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

// Los sliders no se pisan entre ellos.
function sincronizarRangos(cambiado) {
  const min = $('#min'), max = $('#max')
  if (Number(min.value) > Number(max.value)) {
    if (cambiado === 'min') max.value = min.value
    else min.value = max.value
  }
  $('#min-val').value = min.value
  $('#max-val').value = max.value
}

for (const [id, ev] of [['min', 'min'], ['max', 'max']]) {
  $(`#${id}`).addEventListener('input', () => { sincronizarRangos(ev); sortearConEspera() })
}
$('#modo').addEventListener('change', sortear)
$('#otra').addEventListener('click', sortear)

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
  $('#like').textContent = marcado ? '♥' : '♡'
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
  b.disabled = !(ampli.conectado() && hayQueEnviar(actual))
  b.textContent = ampli.conectado() ? 'Enviar al ampli' : 'Conecta el ampli primero'
}

// Si el navegador no soporta WebHID el boton no aparece: un control inerte es
// peor que ninguno.
if (ampli.soportado()) {
  $botonAmpli.hidden = false
  $('#ver-editor').hidden = false
  ampli.alCambiarEstado(conectado => {
    $botonAmpli.textContent = conectado ? 'Ampli conectado' : 'Conectar ampli'
    $botonAmpli.classList.toggle('conectado', conectado)
    $botonAmpli.title = conectado ? 'Pulsa para desconectar' : 'Conectar el Mustang LT25 por USB'
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
$('#tarjeta').addEventListener('click', async e => {
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
       se sugiere -- su curva es de las que todavia no sabemos convertir --
       pero eso no es excusa para moverlo sin querer.

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
       devuelto perfecto, y las perillas que lo gobiernan (`level`, `gain` de
       OVERDRIVE y VARIFUZZ, `level` de los moduladores) son justo de las que
       este proyecto todavia no sabe convertir: no se mandan, y la unidad
       recien cargada se queda en SU valor por defecto -- media carrera, no la
       salida baja que el preset pedia. Eso no se puede arreglar sin medir las
       curvas, pero si se puede DECIR, y va en rojo y aparte: ver `porDefecto`
       mas abajo. */
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
        // `crudo` es exactamente el marcador de "la curva de pantalla de esta
        // perilla no se midio todavia": su `aCable` devuelve el valor tal cual
        // y mandarlo seria tratar un numero de pantalla como si fuera de cable.
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
    pintarSelectorPistas()
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
    .then(({ artists }) => { indiceArtistas = artists; pintarAtajos() })
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

function pintarSugerencias() {
  const caja = $('#banda-sug')
  const q = $('#banda-q').value
  const hits = buscarArtistas(indiceArtistas, q, 8, bandas)
  sugerido = hits.length ? 0 : -1

  if (!q.trim()) { caja.hidden = true; caja.innerHTML = ''; return }

  caja.hidden = false
  caja.innerHTML = hits.length
    ? hits.map((a, i) => `
        <li role="option" aria-selected="${i === 0}" data-nombre="${esc(a.nombre)}">
          <span>${esc(a.nombre)}</span>
          <span class="cuantas">${a.canciones}</span>
        </li>`).join('')
    : `<li class="vacio">Ninguna banda del catálogo se llama así.</li>`
}

function moverSugerencia(paso) {
  const filas = [...$('#banda-sug').querySelectorAll('li[data-nombre]')]
  if (!filas.length) return
  sugerido = (sugerido + paso + filas.length) % filas.length
  filas.forEach((f, i) => f.setAttribute('aria-selected', String(i === sugerido)))
  filas[sugerido].scrollIntoView({ block: 'nearest' })
}

function cerrarSugerencias() {
  $('#banda-sug').hidden = true
  $('#banda-sug').innerHTML = ''
  sugerido = -1
}

function agregarBanda(nombre) {
  // La comparacion es por clave y no por texto: elegir "Motorhead" cuando ya
  // esta "Motörhead" seria la misma banda dos veces y un filtro sin efecto.
  const clave = claveDeArtista(nombre)
  if (!bandas.some(b => claveDeArtista(b) === clave)) bandas.push(nombre)
  $('#banda-q').value = ''
  cerrarSugerencias()
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

  pintarAtajos()
}

/* Los atajos salen de lo que ya hiciste: `shown_count` y `liked` viven en
   `song_state` desde antes. Solo aparecen cuando aportan algo -- una banda que
   ya elegiste no se ofrece de nuevo. */
function pintarAtajos() {
  const caja = $('#banda-atajos')
  const puestas = new Set(bandas.map(claveDeArtista))
  const libres = indiceArtistas.filter(a => !puestas.has(a.clave))

  const fila = (rotulo, lista) => lista.length
    ? `<p>${rotulo}: ${lista.map(a =>
        `<button type="button" data-agregar="${esc(a.nombre)}">${esc(a.nombre)}</button>`
      ).join(' · ')}</p>`
    : ''

  caja.innerHTML = fila('Con más canciones', libres.slice(0, 5))
}

$('#banda-q').addEventListener('input', pintarSugerencias)
$('#banda-q').addEventListener('focus', pintarSugerencias)

$('#banda-q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moverSugerencia(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moverSugerencia(-1) }
  else if (e.key === 'Escape') cerrarSugerencias()
  else if (e.key === 'Enter') {
    e.preventDefault()
    const fila = $('#banda-sug').querySelector('li[aria-selected="true"][data-nombre]')
    if (fila) agregarBanda(fila.dataset.nombre)
  }
})

// El `mousedown` va antes del `blur` de la caja, asi que el clic alcanza a
// registrarse; con `click` el desplegable ya se habria cerrado.
$('#banda-sug').addEventListener('mousedown', e => {
  const fila = e.target.closest('li[data-nombre]')
  if (fila) { e.preventDefault(); agregarBanda(fila.dataset.nombre) }
})

$('#banda-q').addEventListener('blur', () => setTimeout(cerrarSugerencias, 0))

$('#banda-fichas').addEventListener('click', e => {
  const b = e.target.closest('button[data-quitar]')
  if (b) quitarBanda(b.dataset.quitar)
})

$('#banda-atajos').addEventListener('click', e => {
  const b = e.target.closest('button[data-agregar]')
  if (b) agregarBanda(b.dataset.agregar)
})

sincronizarRangos('min')
sortear()
pintarStats()
cargarArtistas().then(pintarAtajos)

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
  if (cual === 'listas') pintarListas()
  if (cual === 'editor') montarEditor()
}

for (const v of VISTAS) $(`#ver-${v}`).addEventListener('click', () => cambiarVista(v))
