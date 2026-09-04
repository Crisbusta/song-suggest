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
      ${backing ? ` · <a href="https://www.youtube.com/watch?v=${backing.videoId}" target="_blank" rel="noopener">Backing track</a>` : ''}
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
