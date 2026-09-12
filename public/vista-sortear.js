/* ---------------------------------------------------------------------------
   El HTML de la vista Sortear: la columna izquierda, la de la cancion.

   Devuelve cadenas y no toca el DOM ni escucha eventos, asi que se puede leer
   entero sin tener el navegador en la cabeza. Quien lo inserta y cablea los
   clicks es `app.js`; el panel del amplificador es `panel-ampli.js`.

   Todo lo que viene del catalogo pasa por `esc()`: los nombres de pista, de
   artista y de cancion son texto de terceros y terminan dentro de HTML.
   --------------------------------------------------------------------------- */
import { esc, listaDePistas, urlUltimateGuitar, etiquetasDePistas } from './tarjeta.js'

/* El reproductor de verdad, que sustituye a la miniatura al pulsarla. No se
   carga de entrada: el iframe de YouTube son ~1 MB de scripts y la mayoria de
   las tiradas no se escuchan. */
export const iframePreviewHtml = url =>
  `<div class="preview reproduciendo"><iframe src="${esc(url)}" title="Reproductor de YouTube" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`

// La miniatura con el play encima. `data-escuchar` es lo que app.js busca para
// cambiarla por el iframe de arriba.
const miniatura = song => song.officialVideo
  ? `<button type="button" class="preview" data-escuchar="${esc(song.officialVideo)}" aria-label="Escuchar la canción en YouTube"><span class="play" aria-hidden="true">▶</span><small>escuchar en YouTube</small></button>`
  : ''

/* Los tres enlaces de fuera. El de Ultimate Guitar es `null` cuando falta la
   banda o el titulo -- ver `urlUltimateGuitar` -- y entonces no se dibuja, en
   vez de mandar a una pagina de resultados vacia. */
const enlaces = (song, ug) => [
  `<a href="${esc(song.url)}" target="_blank" rel="noopener">Songsterr ↗</a>`,
  ug ? `<a href="${esc(ug)}" target="_blank" rel="noopener">Ultimate Guitar ↗</a>` : '',
  song.backingVideo
    ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(song.backingVideo)}" target="_blank" rel="noopener">Acompañamiento ↗</a>`
    : '',
].join('')

/* Con una sola pista no hay nada que elegir, asi que la lista entera sobra y se
   describe en linea. Es el 19,4% del catalogo, no un caso raro.

   `tuning` viene en null cuando la afinacion es la estandar -- no significa
   "desconocida" -- y por eso se dice "E estándar" en vez de callar. */
const pistaUnica = song => {
  const pista = song.pistas[0]
  const dificultad = pista.difficulty != null ? ` · dificultad ${esc(pista.difficulty)}/10` : ''
  return `<div class="pista-unica"><p class="pistas-titulo">Tu pista</p><strong title="${esc(pista.name || pista.instrument)}">${esc(etiquetasDePistas(song.pistas)[0])}</strong><p>${esc(pista.instrument)} · ${esc(pista.tuning ?? 'E estándar')}${dificultad}</p></div>`
}

/* La columna de la cancion entera.

   Las pistas van dentro de `#detalle-pistas`, su propia region, y eso NO es
   cosmetica: cambiar de pista redibuja solo ese trozo, asi que un video que
   este sonando no se reinicia. Si esto volviera a ser un unico bloque, cada
   cambio de pista mataria el iframe. */
export function pintarSortear(song, elegida) {
  if (!song) return '<p class="vacio">Nada que sortear con estos filtros.</p>'

  /* La afinacion sube aqui, junto a la cuenta de pistas, como pide el diseño.
     Es la de la pista ELEGIDA: `tuning` en null significa estandar, no
     desconocida, y por eso se nombra en vez de callarse. */
  const afinacion = song.pistas[elegida]?.tuning ?? 'E estándar'
  const cuantas = `${song.pistas.length} pista${song.pistas.length === 1 ? '' : 's'} de guitarra · afinación ${esc(afinacion)}`
  const tags = song.tags.slice(0, 5).map(t => `<span class="chip">${esc(t)}</span>`).join('')
  const detalle = song.pistas.length === 1 ? pistaUnica(song) : listaDePistas(song.pistas, elegida)

  /* La identidad y el video son la parte estrecha; la lista de pistas, la ancha.
     Van como HERMANAS dentro de la tarjeta, que envuelve: asi se ponen lado a
     lado cuando cabe y se apilan cuando no, sin que el titulo de 54px tenga que
     competir con la lista por el mismo ancho. */
  return `<div class="cancion-cabecera">
      <div class="cancion-identidad">
        <p class="artista">${esc(song.artist)}</p><h2>${esc(song.title)}</h2><p class="cancion-cuenta">${cuantas}</p>
        <p class="enlaces">${enlaces(song, urlUltimateGuitar(song.artist, song.title))}</p>
        ${tags ? `<div class="meta">${tags}</div>` : ''}
      </div>${miniatura(song)}
    </div>
    <div id="detalle-pistas">${detalle}</div>`
}
