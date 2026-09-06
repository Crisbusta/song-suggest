import { ampli } from './ampli-usb.js'
import { montarEditor } from './editor.js'

const $ = s => document.querySelector(s)

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

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

function pintar({ song, matching, hint }) {
  actual = song
  $('#hint').textContent = hint ?? ''
  // matching describe el filtro, no la cancion: se muestra con los controles.
  $('#calzan').textContent = matching === 1
    ? '1 canción calza con estos filtros'
    : `${matching.toLocaleString('es-CL')} canciones calzan con estos filtros`

  if (!song) {
    $('#tarjeta').innerHTML = '<p class="vacio">Nada que sortear con estos filtros.</p>'
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
    return
  }
  for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = false

  const marcado = !!song.liked
  $('#like').classList.toggle('marcado', marcado)
  $('#like').textContent = marcado ? '♥' : '♡'

  // La dificultad decide si intentas la cancion o no, asi que deja de ser un
  // chip igual a "90s" y pasa a medidor. El numero va al lado porque el color
  // solo no debe cargar el significado.
  const medidor = Array.from({ length: 10 }, (_, i) =>
    `<i class="${i < song.difficulty ? 'on' : ''}"></i>`).join('')

  const dificultad = `
    <div class="dificultad">
      <span class="medidor" role="img" aria-label="Dificultad ${song.difficulty} de 10">${medidor}</span>
      <span class="valor">${song.difficulty}<small>/10</small></span>
      <span class="instrumento">${esc(song.instrument)}</span>
    </div>`

  // La afinacion es informacion accionable: te dice si hay que reafinar antes
  // de empezar. Sale del monton de chips y se vuelve un aviso propio.
  const aviso = song.tuning
    ? `<p class="aviso-afinacion">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
           <path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>
         </svg>
         ${esc(song.tuning)}
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

  const a = song.ampli
  // Nombrada distinto del modulo `ampli` importado arriba: un `const ampli`
  // aqui lo taparia dentro de su propio inicializador (TDZ) justo donde el
  // Step 1 necesita llamar a `ampli.soportado()`.
  const bloqueAmpli = a
    ? `<details class="ampli">
         <summary>Ajustes para tu Mustang LT25</summary>
         <div class="ampli-cuerpo">
           <p class="modelo"><span>Modelo</span><strong>${esc(a.modelo)}</strong></p>
           ${perilla('Gain', a.gain)}
           ${perilla('Volume', a.volume)}
           ${perilla('Treble', a.treble)}
           ${perilla('Bass', a.bass)}
           ${perilla('Reverb', a.reverb)}
           <p class="descargo">
             Punto de partida, no el tono del disco.
             Deducido de: ${a.motivos.map(esc).join(', ')}.<br>
             Al ampli se mandan el <strong>modelo</strong> y <strong>gain, treb y bass</strong>.
             Cambiar de modelo deja el resto de sus perillas (mid, master, presence…)
             en los valores por defecto de ese modelo; tu volumen se lee antes y se
             devuelve, y si no se puede, se te avisa y el modelo no se toca.
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

  $('#tarjeta').className = 'tarjeta entra'
  $('#tarjeta').innerHTML = `
    <div>
      <h2>${esc(song.title)}</h2>
      <p class="artista">${esc(song.artist)}</p>
    </div>
    ${dificultad}
    ${aviso}
    ${chips ? `<div class="meta">${chips}</div>` : ''}
    ${bloqueAmpli}
    ${preview}
    <p class="enlaces">
      <a href="${song.url}" target="_blank" rel="noopener">Ver la tablatura en Songsterr →</a>
      ${song.backingVideo ? ` · <a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.backingVideo)}" target="_blank" rel="noopener">Pista de acompañamiento</a>` : ''}
    </p>`
  // Reinicia la animacion de entrada en cada tirada.
  void $('#tarjeta').offsetWidth
  pintarBotonEnviar()
}

// Al pulsar la miniatura se reemplaza por el reproductor y suena. Delegado en la
// tarjeta porque el bloque se redibuja completo en cada tirada; y como se
// redibuja, el iframe anterior muere solo y la canción anterior deja de sonar.
$('#tarjeta').addEventListener('click', e => {
  const bloque = e.target.closest('[data-escuchar]')
  if (!bloque) return
  const id = bloque.dataset.escuchar
  bloque.outerHTML = `
    <div class="preview">
      <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0"
              title="Reproductor de YouTube" allow="autoplay; encrypted-media"
              referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    </div>`
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
  try {
    pintar(await api(`/api/roll?${params}`))
  } catch (err) {
    actual = null
    $('#tarjeta').innerHTML = '<p class="vacio">No pude hablar con el servidor.</p>'
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

// Refleja en el boton de envio si hay conexion. Vive aqui porque el callback
// de estado la llama; tolera que el boton aun no exista (lo crea la tarea
// siguiente) y que la cancion no traiga sugerencia.
function pintarBotonEnviar() {
  const b = $('#enviar-ampli')
  if (!b) return
  b.disabled = !(ampli.conectado() && actual?.ampli?.paraElAmpli)
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
  const valores = actual?.ampli?.paraElAmpli
  if (!valores) return
  // Evita un segundo envio mientras el primero sigue vivo. Ya no es lo que
  // protege el estado compartido de ampli-usb.js -- de eso se ocupa el turno
  // de ese modulo (ver `enTurno` alla), que es el unico que puede coordinar
  // este envio con el editor, que esta guarda no ve --: es para la interfaz,
  // que necesita saber cuando el boton esta ocupado. Se marca en forma
  // sincrona, antes del primer await, para no dejar una ventana en la que un
  // segundo click alcance a colarse.
  if (enviando) {
    /* La guarda no cambia; solo deja de ser muda. El envio anterior puede
       durar hasta unos 16 s (leer el preset, cambiar el modelo y cuatro
       escrituras, cada una con su timeout) y sobrevive a sortear otra
       cancion: el boton de la tarjeta nueva esta habilitado, asi que este clic
       es legitimo y quedarse callado se ve igual que un boton roto. El de la
       tarjeta en curso no llega aca: se deshabilita mientras dura el envio. */
    const ocupado = $('#envio-estado')
    if (ocupado) {
      ocupado.className = 'envio-estado'
      ocupado.textContent = 'hay un envío en curso…'
    }
    return
  }
  enviando = true
  // La cancion de este envio queda fijada aqui: si el usuario sortea otra
  // mientras el envio corre (hasta unos 16 s en el peor caso), `actual`
  // cambia y `#tarjeta` se reemplaza por completo, pero este envio sigue
  // corriendo sobre los nodos y valores de la cancion original.
  const cancion = actual
  const b = $('#enviar-ampli'), estado = $('#envio-estado')
  b.disabled = true
  estado.className = 'envio-estado'
  estado.textContent = 'enviando…'

  try {
    // Se informa lo que el amplificador CONFIRMO, no lo que se intento: el
    // equipo ignora en silencio lo que no entiende.
    const confirmados = [], fallidos = []

    /* El modelo va ANTES que las perillas: cargar una unidad nueva trae sus
       parametros por defecto, asi que ponerlo despues pisaria los valores
       recien enviados.

       Y antes de cambiarlo hay que leer el volumen que tenias. Calculado del
       catalogo: los `volume` por defecto de los veinte modelos van de -15,88 dB
       (SUPER HEAVY) a 0 (SUPER CLEAN), casi 16 dB de diferencia entre los
       extremos. Cambiar de modelo sin devolver el tuyo puede ser ese salto de
       golpe, con la guitarra enchufada. El volumen no se sugiere -- su curva es
       de las que todavia no sabemos convertir -- pero eso no es excusa para
       moverlo sin querer.

       Devolverlo tal cual es correcto porque los veinte modelos declaran la
       MISMA escala para `volume`: -60..0 dB con curva t20r. Es el hecho que
       sostiene toda esta parte, asi que queda escrito. */
    let notaModelo = '', malModelo = false

    async function ponerModelo(fenderId) {
      let volumen = null, cargado = null
      try {
        const { preset } = await ampli.leerPreset()
        if (actual !== cancion) return { abandonado: true }
        const nodo = preset.audioGraph?.nodes?.find(n => n.nodeId === 'amp')
        cargado = nodo?.FenderId ?? null
        const v = nodo?.dspUnitParameters?.volume
        volumen = typeof v === 'number' ? v : null
      } catch {
        return { nota: 'no pude leer el ampli, dejo el modelo como estaba', mal: true }
      }

      // El "ya estaba puesto" va PRIMERO: si no hay nada que cambiar, no
      // importa que el volumen no se pueda leer, y avisar en rojo de un riesgo
      // que no existe tapaba tres perillas que si se confirmaron.
      if (cargado === fenderId) return { nota: 'el modelo ya estaba puesto' }

      // Sin un volumen que devolver NO se cambia el modelo. El equipo se
      // quedaria con el del modelo nuevo, que puede estar casi 16 dB arriba.
      if (volumen === null) {
        return { nota: 'no pude leer tu volumen, dejo el modelo como estaba', mal: true }
      }

      try {
        // Se informa el identificador que el EQUIPO dice que quedo puesto, no
        // el que se pidio: es la misma regla que sigue el editor.
        const puesto = await ampli.reemplazarUnidad('amp', fenderId)
        // Si el equipo dice que cargo OTRA unidad, no es un exito: el usuario
        // pidio un modelo y tiene otro. Se muestra el identificador crudo
        // porque el nombre de pantalla de una unidad que no pedimos no lo
        // tenemos aca, y en rojo, porque no es lo que se pidio.
        const distinto = puesto !== fenderId
        const nota = distinto
          ? `el ampli cargo ${puesto}, no ${cancion.ampli.modelo}`
          : `modelo ${cancion.ampli.modelo}`
        try {
          await ampli.ponerParametro('amp', 'volume', volumen)
          return { nota, mal: distinto }
        } catch {
          return { nota: `${nota} (ojo: no pude devolverte el volumen)`, mal: true }
        }
      } catch {
        /* Sin confirmacion no sabemos si el equipo cargo el modelo o no, y en la
           duda hay que suponer que SI: un ACK perdido por timeout no significa
           que la unidad no se haya cargado, y si se cargo, el volumen quedo en
           el del modelo nuevo. Se intenta devolverlo igual -- si el cambio no
           ocurrio, escribir el valor que ya estaba no hace nada. */
        try { await ampli.ponerParametro('amp', 'volume', volumen) } catch { /* nada mas que hacer */ }
        return { nota: 'no pude confirmar el cambio de modelo, revisa el volumen del ampli', mal: true }
      }
    }

    const fenderId = cancion.ampli?.fenderId
    if (fenderId) {
      const r = await ponerModelo(fenderId)
      if (r.abandonado) return
      notaModelo = r.nota
      malModelo = !!r.mal
    }

    /* Abandonar por una tirada nueva NO puede tragarse un aviso sobre el
       amplificador. Hasta aca ya pudimos haberle cambiado el modelo y fallado
       al devolverle el volumen, y `estado` es un nodo desprendido: escribirle
       es un no-op que no avisa de nada. Un aviso de volumen no es de la
       cancion, es del equipo, asi que se pinta en la tarjeta que este en
       pantalla, que es donde el usuario lo va a ver. */
    const abandonar = () => {
      if (actual === cancion) return false
      if (malModelo) {
        const vivo = $('#envio-estado')
        if (vivo) { vivo.className = 'envio-estado mal'; vivo.textContent = notaModelo }
      }
      return true
    }

    for (const [parametro, valor] of Object.entries(valores)) {
      // Si ya sorteamos otra cancion, `b` y `estado` son nodos desprendidos:
      // escribirles es un no-op legal que no avisa de nada, asi que hay que
      // cortar aqui y no seguir escribiendole al ampli valores de una
      // cancion que ya no esta en pantalla.
      if (abandonar()) return
      try { await ampli.ponerParametro('amp', parametro, valor); confirmados.push(parametro) }
      catch { fallidos.push(parametro) }
    }
    if (abandonar()) return
    // El modelo se cuenta aparte de las perillas: no es una de ellas, y
    // "ya estaba puesto" no es lo mismo que "lo confirmo el equipo".
    const conModelo = t => notaModelo ? `${notaModelo} · ${t}` : t
    if (!fallidos.length) {
      estado.className = malModelo ? 'envio-estado mal' : 'envio-estado ok'
      estado.textContent = conModelo(`${confirmados.join(', ')} confirmados por el ampli`)
    } else if (!confirmados.length) {
      estado.className = 'envio-estado mal'
      estado.textContent = conModelo(`sin confirmar: ${fallidos.join(', ')}`)
    } else {
      estado.className = 'envio-estado mal'
      estado.textContent = conModelo(`${confirmados.join(', ')} confirmados; sin confirmar: ${fallidos.join(', ')}`)
    }
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
  }
})

sincronizarRangos('min')
sortear()
pintarStats()

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
          <a href="${s.url}" target="_blank" rel="noopener">${esc(s.artist)} — ${esc(s.title)}</a>
          <span class="dif">dif ${s.difficulty}</span>
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
