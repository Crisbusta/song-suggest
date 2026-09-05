import { ampli } from './ampli-usb.js'

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
  const ampli = a
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
             Deducido de: ${a.motivos.map(esc).join(', ')}.
           </p>
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
    ${ampli}
    ${preview}
    <p class="enlaces">
      <a href="${song.url}" target="_blank" rel="noopener">Ver la tablatura en Songsterr →</a>
      ${song.backingVideo ? ` · <a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.backingVideo)}" target="_blank" rel="noopener">Pista de acompañamiento</a>` : ''}
    </p>`
  // Reinicia la animacion de entrada en cada tirada.
  void $('#tarjeta').offsetWidth
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
  ampli.reconectarSiSePuede()
}

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

function cambiarVista(aListas) {
  $('#vista-sorteo').hidden = aListas
  $('#vista-listas').hidden = !aListas
  $('#ver-sorteo').classList.toggle('activo', !aListas)
  $('#ver-listas').classList.toggle('activo', aListas)
  if (aListas) pintarListas()
}

$('#ver-listas').addEventListener('click', () => cambiarVista(true))
$('#ver-sorteo').addEventListener('click', () => cambiarVista(false))
