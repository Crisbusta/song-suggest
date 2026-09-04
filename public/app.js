const $ = s => document.querySelector(s)
const api = (ruta, opts) => fetch(ruta, opts).then(r => r.json())

let actual = null

function pintar({ song, hint }) {
  actual = song
  $('#hint').textContent = hint ?? ''

  if (!song) {
    $('#tarjeta').innerHTML = '<p class="vacio">Nada que sortear con estos filtros.</p>'
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
    return
  }
  for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = false
  $('#like').classList.remove('marcado')
  $('#like').textContent = '♡'

  const chips = [
    `<span class="chip">dificultad ${song.difficulty}/10</span>`,
    `<span class="chip">${song.instrument}</span>`,
    song.tuning ? `<span class="chip afinacion">${song.tuning}</span>` : '',
    ...song.tags.slice(0, 4).map(t => `<span class="chip">${t}</span>`),
  ].join('')

  const backing = song.videos.find(v => v.feature === 'backing') ?? song.videos[0]

  $('#tarjeta').innerHTML = `
    <h2>${song.title}</h2>
    <p class="artista">${song.artist}</p>
    <div class="meta">${chips}</div>
    <p>
      <a href="${song.url}" target="_blank" rel="noopener">Ver la tablatura en Songsterr →</a>
      ${backing ? ` · <a href="https://www.youtube.com/watch?v=${backing.videoId}" target="_blank" rel="noopener">Pista de acompañamiento</a>` : ''}
    </p>`
}

async function sortear() {
  const params = new URLSearchParams({
    mode: $('#modo').value,
    minDifficulty: $('#min').value,
    maxDifficulty: $('#max').value,
  })
  pintar(await api(`/api/roll?${params}`))
}

const marcar = cuerpo =>
  api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: actual.songId, ...cuerpo }),
  })

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
  $(`#${id}`).addEventListener('input', () => { sincronizarRangos(ev); sortear() })
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

sincronizarRangos('min')
sortear()

const LISTAS = [
  ['learned', 'Aprendidas'],
  ['liked', 'Me gustaron'],
  ['queued', 'Para después'],
  ['skipped', 'Descartadas'],
]

async function pintarListas() {
  const contenedor = $('#vista-listas')
  contenedor.innerHTML = '<p class="vacio">Cargando...</p>'

  const bloques = await Promise.all(LISTAS.map(async ([clave, titulo]) => {
    const { songs } = await api(`/api/lists?list=${clave}`)
    if (songs.length === 0) {
      return `<section class="lista"><h3>${titulo}</h3><p class="vacio">Todavía nada.</p></section>`
    }
    const filas = songs.map(s => `
      <li>
        <a href="${s.url}" target="_blank" rel="noopener">${s.artist} — ${s.title}</a>
        <span class="dif">dif ${s.difficulty}</span>
        ${clave === 'liked' ? '' : `<button data-deshacer="${s.songId}">Deshacer</button>`}
      </li>`).join('')
    return `<section class="lista"><h3>${titulo} (${songs.length})</h3><ol>${filas}</ol></section>`
  }))

  contenedor.innerHTML = bloques.join('')
}

// Deshacer devuelve la cancion al sorteo.
$('#vista-listas').addEventListener('click', async e => {
  const songId = e.target.dataset?.deshacer
  if (!songId) return
  await api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: Number(songId), status: null }),
  })
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
