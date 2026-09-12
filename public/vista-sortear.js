import { esc, listaDePistas, urlUltimateGuitar, etiquetasDePistas } from './tarjeta.js'

export const iframePreviewHtml = url => `<div class="preview reproduciendo"><iframe src="${esc(url)}" title="Reproductor de YouTube" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`

/* El contenido de pistas tiene su region propia para conservar el reproductor. */
export function pintarSortear(song, elegida) {
  if (!song) return '<p class="vacio">Nada que sortear con estos filtros.</p>'
  const pista = song.pistas[elegida]
  const tags = song.tags.slice(0, 5).map(t => `<span class="chip">${esc(t)}</span>`).join('')
  const preview = song.officialVideo ? `<button type="button" class="preview" data-escuchar="${esc(song.officialVideo)}" aria-label="Escuchar la canción en YouTube"><span class="play" aria-hidden="true">▶</span><small>escuchar en YouTube</small></button>` : ''
  const ug = urlUltimateGuitar(song.artist, song.title)
  const unica = song.pistas.length === 1 ? `<div class="pista-unica"><p class="pistas-titulo">Tu pista</p><strong title="${esc(pista.name || pista.instrument)}">${esc(etiquetasDePistas(song.pistas)[0])}</strong><p>${esc(pista.instrument)} · ${esc(pista.tuning ?? 'E estándar')}${pista.difficulty != null ? ` · dificultad ${esc(pista.difficulty)}/10` : ''}</p></div>` : listaDePistas(song.pistas, elegida)
  return `<div class="cancion-cabecera">
      <div class="cancion-identidad"><p class="artista">${esc(song.artist)}</p><h2>${esc(song.title)}</h2><p class="cancion-cuenta">${song.pistas.length} pista${song.pistas.length === 1 ? '' : 's'} de guitarra</p>
      <p class="enlaces"><a href="${esc(song.url)}" target="_blank" rel="noopener">Songsterr ↗</a>${ug ? `<a href="${esc(ug)}" target="_blank" rel="noopener">Ultimate Guitar ↗</a>` : ''}${song.backingVideo ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.backingVideo)}" target="_blank" rel="noopener">Acompañamiento ↗</a>` : ''}</p></div>${preview}
    </div>
    ${tags ? `<div class="meta">${tags}</div>` : ''}
    <div id="detalle-pistas">${unica}</div>`
}
