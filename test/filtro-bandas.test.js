import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll, mark, listarArtistas } from '../db/queries.js'

let siguienteId = 1

function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, ?, 0, 0, 0, 1, '[]', '2026-09-03')
  `).run(songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId, o.fingerstyle ?? 0)
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (?, 0, ?, ?, ?, 1000, '[64,59,55,50,45,40]')
  `).run(songId, o.instrument ?? 'Distortion Guitar', o.trackName ?? 'Rhythm Guitar', o.difficulty ?? 3)
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

test('sin bandas elegidas, el sorteo no filtra por artista', () => {
  const db = base()
  agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Tool' })
  assert.equal(roll(db, {}).matching, 2)
  assert.equal(roll(db, { artists: [] }).matching, 2)
})

test('con bandas elegidas, solo sortea de esas', () => {
  const db = base()
  agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Tool' })
  agregar(db, { artist: 'Kyuss' })
  const r = roll(db, { artists: ['Rush', 'Kyuss'] })
  assert.equal(r.matching, 2)
  assert.ok(['Rush', 'Kyuss'].includes(r.song.artist))
})

/* El caso que motiva todo el modulo `artistas.js`: elegir una escritura tiene
   que traer las canciones de las otras. Sin esto, elegir `Кино` deja fuera
   ocho de sus veintinueve canciones reales. */
test('elegir una banda trae sus otras escrituras', () => {
  const db = base()
  agregar(db, { artist: 'Кино' })
  agregar(db, { artist: 'КИНО' })
  agregar(db, { artist: 'Tool' })
  assert.equal(roll(db, { artists: ['Кино'] }).matching, 2)
  assert.equal(roll(db, { artists: ['КИНО'] }).matching, 2)
})

test('una banda desconocida no arrastra canciones de otras', () => {
  const db = base()
  agregar(db, { artist: 'Rush' })
  const r = roll(db, { artists: ['Los Prisioneros'] })
  assert.equal(r.matching, 0)
  assert.equal(r.song, null)
})

test('el filtro de bandas se combina con el modo y con la dificultad', () => {
  const db = base()
  agregar(db, { artist: 'Rush', difficulty: 2 })
  agregar(db, { artist: 'Rush', difficulty: 9 })
  agregar(db, { artist: 'Tool', difficulty: 9 })
  assert.equal(roll(db, { artists: ['Rush'] }).matching, 2)
  assert.equal(roll(db, { artists: ['Rush'], minDifficulty: 8 }).matching, 1)
  assert.equal(roll(db, { artists: ['Rush'], mode: 'acoustic' }).matching, 0)
})

/* Que el aviso diga QUE filtro te dejo sin canciones, no solo que quedaste en
   cero. Es la misma regla que el resto de la app: la interfaz no puede
   afirmar menos de lo que sabe. */
test('el aviso distingue si lo que vacia la lista son las bandas o los otros filtros', () => {
  const db = base()
  agregar(db, { artist: 'Rush', difficulty: 9, instrument: 'Distortion Guitar' })
  agregar(db, { artist: 'Tool', difficulty: 2 })

  // Las bandas tienen canciones, pero no en este rango de dificultad.
  const porDificultad = roll(db, { artists: ['Rush'], minDifficulty: 1, maxDifficulty: 3 })
  assert.equal(porDificultad.matching, 0)
  assert.match(porDificultad.hint, /dificultad/i)

  // Las bandas no tienen ninguna en este modo, con la dificultad entera.
  const porModo = roll(db, { artists: ['Rush'], mode: 'acoustic' })
  assert.equal(porModo.matching, 0)
  assert.match(porModo.hint, /Rush/)

  // Ninguna de las bandas elegidas existe en el catalogo.
  const porBanda = roll(db, { artists: ['Los Prisioneros'] })
  assert.equal(porBanda.matching, 0)
  assert.match(porBanda.hint, /no est/i)
})

test('el aviso nombra las bandas elegidas cuando quedan pocas', () => {
  const db = base()
  agregar(db, { artist: 'Rush' })
  const r = roll(db, { artists: ['Rush'] })
  assert.equal(r.matching, 1)
  assert.match(r.hint, /Rush/)
})

test('las canciones ya descartadas no cuentan para el filtro de bandas', () => {
  const db = base()
  const id = agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Rush' })
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(roll(db, { artists: ['Rush'] }).matching, 1)
})

test('listarArtistas devuelve nombre, variantes y cuantas canciones', () => {
  const db = base()
  agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Tool' })
  const l = listarArtistas(db)
  assert.deepEqual(l.map(a => a.nombre), ['Rush', 'Tool'])
  assert.equal(l[0].canciones, 2)
})

test('listarArtistas agrupa las escrituras y suma sus canciones', () => {
  const db = base()
  agregar(db, { artist: 'blink-182' })
  agregar(db, { artist: 'blink-182' })
  agregar(db, { artist: 'Blink-182' })
  const l = listarArtistas(db)
  assert.equal(l.length, 1)
  assert.equal(l[0].nombre, 'blink-182')
  assert.equal(l[0].canciones, 3)
  assert.deepEqual(l[0].variantes.sort(), ['Blink-182', 'blink-182'])
})

/* La lista que alimenta el buscador tiene que ver el mismo universo que el
   sorteo. Si contara canciones que el sorteo nunca va a devolver, el numero al
   lado de cada banda seria una promesa que el boton no cumple. */
test('listarArtistas ve el mismo universo que el sorteo', () => {
  const db = base()
  const id = agregar(db, { artist: 'Rush' })
  agregar(db, { artist: 'Rush' })
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(listarArtistas(db)[0].canciones, 1)
})

test('listarArtistas no lista un artista que se quedo sin canciones sorteables', () => {
  const db = base()
  const id = agregar(db, { artist: 'Tool' })
  agregar(db, { artist: 'Rush' })
  mark(db, { songId: id, status: 'skipped' })
  assert.deepEqual(listarArtistas(db).map(a => a.nombre), ['Rush'])
})

/* Veintiun artistas del catalogo traen una coma en el nombre -- "Crosby,
   Stills, Nash & Young", "Earth, Wind & Fire", "Emerson, Lake & Palmer" -- asi
   que el transporte de la eleccion no puede separar por coma. Este test fija
   que el nombre viaja entero: si alguien cambia el endpoint a `?artists=a,b`,
   estos artistas dejan de poder elegirse. */
test('un nombre de banda con coma se elige entero', () => {
  const db = base()
  agregar(db, { artist: 'Earth, Wind & Fire' })
  agregar(db, { artist: 'Rush' })
  const r = roll(db, { artists: ['Earth, Wind & Fire'] })
  assert.equal(r.matching, 1)
  assert.equal(r.song.artist, 'Earth, Wind & Fire')
})
