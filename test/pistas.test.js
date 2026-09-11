import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll, mark, getList, listarArtistas, getStats } from '../db/queries.js'

let siguienteId = 1

/* Inserta una cancion con las pistas que se le den. Cada pista es
   { instrument, name, difficulty, views, tuning }; el track_index es su
   posicion en el arreglo, igual que lo arma el ETL. */
function agregarConPistas(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, ?, 0, 0, 0, 1, '[]', '2026-09-03')
  `).run(songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId, o.fingerstyle ?? 0)

  o.pistas.forEach((p, i) => {
    db.prepare(`
      INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      songId, i, p.instrument ?? 'Distortion Guitar', p.name ?? 'Rhythm Guitar',
      p.difficulty ?? 3, p.views ?? 1000, p.tuning ?? '[64,59,55,50,45,40]'
    )
  })
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

/* EL test de este diseno. Escribir el predicado como dos existenciales
   sueltos -- "existe una acustica Y existe una facil" -- deja entrar
   canciones donde ninguna sola pista sirve. Medido sobre el catalogo real:
   178 canciones fantasma en acustico + dificultad 1-2. */
test('modo y dificultad los tiene que cumplir LA MISMA pista', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Fantasma',
    pistas: [
      { instrument: 'Acoustic Guitar (steel)', difficulty: 9, views: 5000 },
      { instrument: 'Distortion Guitar', difficulty: 1, views: 4000 },
    ],
  })
  const r = roll(db, { mode: 'acoustic', minDifficulty: 1, maxDifficulty: 2 })
  assert.equal(r.matching, 0, 'la acustica es dificil y la facil no es acustica')
  assert.equal(r.song, null)
})

test('una sola pista que cumple las dos cosas si califica', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Sirve',
    pistas: [
      { instrument: 'Distortion Guitar', difficulty: 9, views: 5000 },
      { instrument: 'Acoustic Guitar (steel)', difficulty: 2, views: 4000 },
    ],
  })
  const r = roll(db, { mode: 'acoustic', minDifficulty: 1, maxDifficulty: 2 })
  assert.equal(r.matching, 1)
  assert.equal(r.song.title, 'Sirve')
})

/* El caso Fade to Black: la pista mas vista es la distorsion de Kirk, pero
   la cancion tiene dos acusticas. Antes de este diseno NO salia en modo
   acustico. */
test('sale por una pista que no es la mas vista', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Fade to Black',
    pistas: [
      { instrument: 'Acoustic Guitar (steel)', name: 'Acoustic', difficulty: 2, views: 246001 },
      { instrument: 'Distortion Guitar', name: 'Lead Guitar', difficulty: 2, views: 2984809 },
    ],
  })
  assert.equal(roll(db, { mode: 'acoustic' }).matching, 1)
})

test('entra al filtro facil por su pista facil, aunque la mas vista sea dificil', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Tiene una facil',
    pistas: [
      { difficulty: 8, views: 9000 },
      { difficulty: 2, views: 100 },
    ],
  })
  assert.equal(roll(db, { minDifficulty: 1, maxDifficulty: 2 }).matching, 1)
})

/* Sin esto, una cancion con tres pistas que califican se contaria tres veces
   y el sorteo la elegiria tres veces mas seguido que a una de una pista. */
test('cuenta canciones, no pistas', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Tres pistas',
    pistas: [
      { difficulty: 3, views: 300 },
      { difficulty: 3, views: 200 },
      { difficulty: 3, views: 100 },
    ],
  })
  assert.equal(roll(db, {}).matching, 1)
  assert.equal(getStats(db).available, 1)
  assert.equal(listarArtistas(db)[0].canciones, 1)
})

test('la pista elegida siempre cumple el filtro con que se sorteo', () => {
  const db = base()
  agregarConPistas(db, {
    title: 'Mixta',
    pistas: [
      { instrument: 'Distortion Guitar', difficulty: 9, views: 9999 },
      { instrument: 'Acoustic Guitar (steel)', difficulty: 2, views: 1 },
    ],
  })
  const r = roll(db, { mode: 'acoustic', minDifficulty: 1, maxDifficulty: 2 })
  assert.equal(r.song.instrument, 'Acoustic Guitar (steel)')
})

test('empatadas en views, gana el track_index mas bajo', () => {
  const db = base()
  agregarConPistas(db, {
    pistas: [
      { name: 'Primera', difficulty: 3, views: 500 },
      { name: 'Segunda', difficulty: 3, views: 500 },
    ],
  })
  const r = roll(db, {})
  assert.equal(r.song.trackName, 'Primera')
})
