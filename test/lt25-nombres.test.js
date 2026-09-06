import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolverUnidad } from '../lib/lt25-nombres.js'
import { parsearCsv } from '../lib/csv.js'

test('un nombre exacto del catalogo resuelve', () => {
  const u = resolverUnidad('METAL 2000')
  assert.equal(u.fenderId, 'DUBS_Evh3')
  assert.equal(u.ranura, 'amp')
})

test('las abreviaturas de la comunidad resuelven por alias explicito', () => {
  assert.equal(resolverUnidad('Champ').nombre, 'CHAMPION')
  assert.equal(resolverUnidad('60s UK CLN').nombre, '60S UK CLEAN')
  assert.equal(resolverUnidad('Sm. Room').nombre, 'SMALL ROOM')
  assert.equal(resolverUnidad('Myth').nombre, 'MYTHIC DRIVE')
  assert.equal(resolverUnidad('Dirt').nombre, 'ROCK DIRT')
  assert.equal(resolverUnidad('Wah').nombre, 'TOUCH WAH')
})

test('NO se adivina por prefijo: un valor numerico no es un modelo', () => {
  // Esto paso de verdad al explorar: "5.0" resolvia a "50S TWIN".
  assert.equal(resolverUnidad('5.0'), null)
  assert.equal(resolverUnidad('9'), null)
  assert.equal(resolverUnidad('80s'), null)   // aparecio en la columna de delay
})

test('lo desconocido devuelve null, no algo parecido', () => {
  assert.equal(resolverUnidad('Marshall JCM800'), null)
  assert.equal(resolverUnidad(''), null)
  assert.equal(resolverUnidad(undefined), null)
})

test('trae las perillas en el orden del catalogo, que es lo posicional', () => {
  assert.deepEqual(resolverUnidad('5-Band EQ').parametros, ['low', 'lowmid', 'mid', 'highmid', 'high'])
  assert.deepEqual(resolverUnidad('Chorus').parametros, ['level', 'rateHz', 'depth'])
  assert.deepEqual(resolverUnidad('Metal 2000').parametros, ['gain', 'volume', 'treb', 'mid', 'bass'])
})

test('todo nombre de unidad de los dos CSV resuelve, o esta en la lista de descartes', () => {
  // El test que impide una perdida silenciosa: si alguien edita un CSV y mete
  // un nombre nuevo, aqui salta en vez de desaparecer.
  const DESCARTADOS = ['80s']   // valor mal puesto en la columna de delay de una fila
  const cols = [
    ['/Users/coto/Desktop/song-suggest/data/presets-lt25-bandas.csv', 1, [3, 11, 17, 23, 28]],
    ['/Users/coto/Desktop/song-suggest/data/presets-lt25-tonos.csv', 1, [1, 7, 13, 19, 24]],
  ]
  const sinResolver = []
  for (const [ruta, desde, indices] of cols) {
    for (const f of parsearCsv(readFileSync(ruta, 'utf8')).slice(desde)) {
      for (const i of indices) {
        const v = (f[i] ?? '').trim()
        if (!v || v === '-') continue
        if (!resolverUnidad(v) && !DESCARTADOS.includes(v)) sinResolver.push(v)
      }
    }
  }
  assert.deepEqual([...new Set(sinResolver)], [], 'nombres del CSV que no resuelven ni estan descartados')
})
