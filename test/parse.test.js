import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCatalogPage, parseMeta } from '../etl/parse.js'

const page = JSON.parse(
  readFileSync(fileURLToPath(new URL('../etl/fixtures/catalog-page.json', import.meta.url)), 'utf8')
)

test('parsea toda la pagina sin perder canciones', () => {
  const { songs } = parseCatalogPage(page, 0)
  assert.equal(songs.length, page.length)
  for (const s of songs) {
    assert.equal(typeof s.songId, 'number')
    assert.equal(typeof s.artist, 'string')
    assert.ok(s.artist.length > 0)
    assert.equal(typeof s.title, 'string')
  }
})

test('catalogRank respeta el offset de la pagina', () => {
  const { songs } = parseCatalogPage(page, 400)
  assert.equal(songs[0].catalogRank, 400)
  assert.equal(songs[1].catalogRank, 401)
})

test('extrae los tracks con su indice y su dificultad', () => {
  const { tracks } = parseCatalogPage(page, 0)
  assert.ok(tracks.length > page.length, 'deberia haber mas tracks que canciones')

  const first = tracks.filter(t => t.songId === page[0].songId)
  assert.equal(first.length, page[0].tracks.length)
  assert.equal(first[0].trackIndex, 0)
  for (const t of first) {
    assert.equal(typeof t.instrument, 'string')
    assert.ok(t.difficulty === null || Number.isInteger(t.difficulty))
  }
})

test('guarda tuning como string JSON parseable', () => {
  const { tracks } = parseCatalogPage(page, 0)
  const conTuning = tracks.find(t => t.tuning !== null)
  assert.ok(conTuning, 'algun track debe traer tuning')
  const notas = JSON.parse(conTuning.tuning)
  assert.ok(Array.isArray(notas))
  assert.ok(notas.every(n => Number.isInteger(n)))
})

test('un track sin difficulty queda en null, no en undefined', () => {
  const entrada = [{
    songId: 1, artistId: 2, artist: 'X', title: 'Y', hasChords: false,
    tracks: [{ instrumentId: 30, instrument: 'Distortion Guitar', views: 5, name: 'Guitar' }]
  }]
  const { tracks } = parseCatalogPage(entrada, 0)
  assert.equal(tracks[0].difficulty, null)
  assert.equal(tracks[0].tuning, null)
})

const meta = JSON.parse(
  readFileSync(fileURLToPath(new URL('../etl/fixtures/meta-455118.json', import.meta.url)), 'utf8')
)

test('parseMeta extrae las banderas como enteros 0/1', () => {
  const m = parseMeta(meta)
  assert.equal(m.songId, 455118)
  for (const k of ['fingerstyle', 'hasChords', 'aiGenerated', 'isJunk', 'isBlank', 'isPublished']) {
    assert.ok(m[k] === 0 || m[k] === 1, `${k} deberia ser 0 o 1, es ${m[k]}`)
  }
  assert.equal(typeof m.views, 'number')
})

test('parseMeta trae los tags como arreglo de strings', () => {
  const m = parseMeta(meta)
  assert.ok(Array.isArray(m.tags))
  assert.ok(m.tags.includes('thrash metal'))
  assert.ok(m.tags.every(t => typeof t === 'string'))
})

test('parseMeta guarda solo videoId y feature de cada video', () => {
  const m = parseMeta(meta)
  const videos = JSON.parse(m.videos)
  assert.ok(videos.length > 0)
  for (const v of videos) {
    assert.deepEqual(Object.keys(v).sort(), ['feature', 'videoId'])
  }
})

test('parseMeta tolera meta sin tags ni videos', () => {
  const m = parseMeta({ songId: 9, views: 0 })
  assert.deepEqual(m.tags, [])
  assert.equal(m.videos, '[]')
  assert.equal(m.isPublished, 1)
})

test('parseMeta distingue banderas ausentes de explícitamente falsas', () => {
  // isPublished ausente debe ser 1 (default diferente)
  const absent = parseMeta({ songId: 9 })
  assert.equal(absent.isPublished, 1, 'isPublished ausente debe ser 1')

  // isPublished explícitamente false debe ser 0
  const explicit = parseMeta({ songId: 9, isPublished: false })
  assert.equal(explicit.isPublished, 0, 'isPublished false debe ser 0')

  // fingerstyle ausente debe ser 0 (default normal)
  const fingerstyleAbsent = parseMeta({ songId: 9 })
  assert.equal(fingerstyleAbsent.fingerstyle, 0, 'fingerstyle ausente debe ser 0')

  // fingerstyle explícitamente false también debe ser 0
  const fingerstyleExplicit = parseMeta({ songId: 9, fingerstyle: false })
  assert.equal(fingerstyleExplicit.fingerstyle, 0, 'fingerstyle false debe ser 0')
})
