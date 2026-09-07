import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarArtista, construirIndice, expandirArtistas } from '../lib/artistas.js'

test('normalizarArtista baja caja, quita tildes y puntuacion', () => {
  assert.equal(normalizarArtista('Mötley Crüe'), 'motley crue')
  assert.equal(normalizarArtista("Guns N' Roses"), 'guns n roses')
  assert.equal(normalizarArtista('blink-182'), 'blink 182')
  assert.equal(normalizarArtista('  Rush  '), 'rush')
})

/* El error que este test fija se cometio dos veces en este proyecto: un
   `[^a-z0-9 ]` borra los alfabetos no latinos enteros, y entonces TODOS los
   nombres en cirilico normalizan a la cadena vacia y colapsan en un solo
   grupo. Medido sobre el catalogo: son unas 90 canciones que calzarian con el
   primer artista de la lista. */
test('normalizarArtista conserva los alfabetos no latinos', () => {
  assert.equal(normalizarArtista('Кино'), 'кино')
  assert.equal(normalizarArtista('КИНО'), 'кино')
  assert.equal(normalizarArtista('ヨルシカ'), 'ヨルシカ')
  assert.notEqual(normalizarArtista('Кино'), normalizarArtista('Ария'))
})

test('construirIndice agrupa las escrituras de un mismo artista', () => {
  const i = construirIndice([
    { artist: 'Кино', c: 21 },
    { artist: 'КИНО', c: 8 },
    { artist: 'Rush', c: 40 },
  ])
  assert.equal(i.length, 2)
  const kino = i.find(a => a.clave === 'кино')
  assert.equal(kino.canciones, 29)
  assert.deepEqual(kino.variantes.sort(), ['КИНО', 'Кино'])
})

test('construirIndice usa como nombre visible la escritura con mas canciones', () => {
  const i = construirIndice([{ artist: 'Blink-182', c: 3 }, { artist: 'blink-182', c: 34 }])
  assert.equal(i[0].nombre, 'blink-182')
})

test('construirIndice ordena de mas a menos canciones', () => {
  const i = construirIndice([
    { artist: 'Rush', c: 40 }, { artist: 'Metallica', c: 166 }, { artist: 'Tool', c: 12 },
  ])
  assert.deepEqual(i.map(a => a.nombre), ['Metallica', 'Rush', 'Tool'])
})

/* Un nombre que normaliza a vacio no puede compartir grupo con otro que
   tambien normalice a vacio: seria el mismo colapso del test de arriba por
   otra puerta. En el catalogo real hay exactamente uno, un `-`. */
test('los nombres que normalizan a vacio quedan cada uno en su grupo', () => {
  const i = construirIndice([{ artist: '-', c: 1 }, { artist: '???', c: 2 }])
  assert.equal(i.length, 2)
  assert.deepEqual(i.map(a => a.nombre).sort(), ['-', '???'])
})

test('expandirArtistas devuelve todas las escrituras de lo elegido', () => {
  const i = construirIndice([
    { artist: 'Кино', c: 21 }, { artist: 'КИНО', c: 8 }, { artist: 'Rush', c: 40 },
  ])
  assert.deepEqual(expandirArtistas(i, ['Кино']).sort(), ['КИНО', 'Кино'])
  assert.deepEqual(expandirArtistas(i, ['Rush']), ['Rush'])
})

test('expandirArtistas calza cualquiera de las escrituras, no solo la visible', () => {
  const i = construirIndice([{ artist: 'blink-182', c: 34 }, { artist: 'Blink-182', c: 3 }])
  assert.deepEqual(expandirArtistas(i, ['Blink-182']).sort(), ['Blink-182', 'blink-182'])
})

test('expandirArtistas junta varias bandas sin repetir', () => {
  const i = construirIndice([
    { artist: 'Rush', c: 40 }, { artist: 'Tool', c: 12 },
  ])
  assert.deepEqual(expandirArtistas(i, ['Rush', 'Tool', 'Rush']).sort(), ['Rush', 'Tool'])
})

/* Un nombre desconocido NO aporta escrituras, en vez de aportar algo
   parecido. Es la misma regla que `resolverUnidad` en lt25-nombres.js: antes
   de adivinar, nada. La cuenta de "cuantas calzan" refleja la verdad sola. */
test('un artista desconocido no aporta ninguna escritura', () => {
  const i = construirIndice([{ artist: 'Rush', c: 40 }])
  assert.deepEqual(expandirArtistas(i, ['Los Prisioneros']), [])
  assert.deepEqual(expandirArtistas(i, ['Rus']), [])
  assert.deepEqual(expandirArtistas(i, ['Rush Live']), [])
})

/* `construirIndice` y `expandirArtistas` tienen que derivar la MISMA clave del
   mismo nombre. El unico caso donde pueden desviarse sin que nada mas lo note
   es el del nombre que normaliza a vacio, porque es el unico que no usa su
   normalizacion como clave: si una de las dos lo indexa por `''` y la otra lo
   busca por su clave cruda, elegir esa banda deja de encontrar su grupo. */
test('un artista cuyo nombre normaliza a vacio se sigue encontrando al elegirlo', () => {
  const i = construirIndice([{ artist: '-', c: 1 }, { artist: 'Rush', c: 40 }])
  assert.deepEqual(expandirArtistas(i, ['-']), ['-'])
})

test('expandirArtistas sin bandas elegidas devuelve vacio', () => {
  const i = construirIndice([{ artist: 'Rush', c: 40 }])
  assert.deepEqual(expandirArtistas(i, []), [])
  assert.deepEqual(expandirArtistas(i, undefined), [])
})
