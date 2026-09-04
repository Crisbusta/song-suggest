import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCatalogPage } from '../etl/parse.js'

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
