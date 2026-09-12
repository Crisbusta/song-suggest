import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { buscarCanciones, getSong, mark, roll } from '../db/queries.js'

let siguienteId = 1

function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, ?, ?, 0, ?, ?, ?, ?, '[]', ?)
  `).run(
    songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`,
    o.views ?? 100, songId,
    o.isJunk ?? 0, o.aiGenerated ?? 0, o.isBlank ?? 0, o.isPublished ?? 1,
    o.enrichedAt === null ? null : '2026-09-03'
  )
  for (const [i, p] of (o.pistas ?? [{}]).entries()) {
    db.prepare(`
      INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      songId, i, p.instrument ?? 'Distortion Guitar', p.name ?? 'Rhythm Guitar',
      p.difficulty ?? 3, p.views ?? 1000, p.tuning ?? '[64,59,55,50,45,40]'
    )
  }
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

// ---------------------------------------------------------------- buscar

test('encuentra por titulo', () => {
  const db = base()
  agregar(db, { artist: 'Metallica', title: 'Fade to Black' })
  agregar(db, { artist: 'Metallica', title: 'One' })
  const r = buscarCanciones(db, 'fade')
  assert.equal(r.length, 1)
  assert.equal(r[0].title, 'Fade to Black')
})

test('encuentra por artista', () => {
  const db = base()
  agregar(db, { artist: 'Metallica', title: 'One' })
  agregar(db, { artist: 'Tool', title: 'Sober' })
  assert.deepEqual(buscarCanciones(db, 'metallica').map(s => s.title), ['One'])
})

/* Cuando no calza ni el titulo ni el artista por si solos, se prueba contra los
   dos pegados: asi se puede escribir la banda y el tema juntos, que es como uno
   los tiene en la cabeza. */
test('encuentra escribiendo banda y titulo juntos', () => {
  const db = base()
  agregar(db, { artist: 'Metallica', title: 'Fade to Black' })
  agregar(db, { artist: 'Tool', title: 'Fade' })
  assert.deepEqual(buscarCanciones(db, 'metallica fade').map(s => s.title), ['Fade to Black'])
})

test('ignora tildes y puntuacion, igual que el buscador de bandas', () => {
  const db = base()
  agregar(db, { artist: 'Santana', title: 'Corazón Espinado' })
  assert.equal(buscarCanciones(db, 'corazon espinado').length, 1)
  assert.equal(buscarCanciones(db, 'CORAZON').length, 1)
})

test('una consulta vacia no devuelve nada', () => {
  const db = base()
  agregar(db, { title: 'Cualquiera' })
  assert.deepEqual(buscarCanciones(db, ''), [])
  assert.deepEqual(buscarCanciones(db, '   '), [])
})

test('respeta el limite', () => {
  const db = base()
  for (let i = 0; i < 20; i++) agregar(db, { title: `Blues ${i}` })
  assert.equal(buscarCanciones(db, 'blues').length, 8)
  assert.equal(buscarCanciones(db, 'blues', 3).length, 3)
})

/* Mismo criterio que buscarArtistas: lo que EMPIEZA con lo escrito va primero,
   y entre iguales gana la mas vista. Escribir "one" tiene que ofrecer "One"
   antes que "Everlong", que tambien lo contiene. */
test('primero lo que empieza con lo escrito, despues lo mas visto', () => {
  const db = base()
  agregar(db, { title: 'Someone Like You', views: 9999 })
  agregar(db, { title: 'One', views: 1 })
  assert.deepEqual(buscarCanciones(db, 'one').map(s => s.title), ['One', 'Someone Like You'])
})

/* La posicion se mide sobre el titulo y sobre el artista por separado, NO sobre
   "artista titulo" pegado. Midiendola sobre la cadena pegada, el largo del
   nombre de la banda decidiria el orden: "Tool Someone" calza en la posicion 5
   y "Metallica One" en la 10, asi que Someone ganaria a One por tener la banda
   un nombre mas corto. */
test('el largo del nombre de la banda no decide el orden', () => {
  const db = base()
  agregar(db, { artist: 'Tool', title: 'Someone', views: 100 })
  agregar(db, { artist: 'Metallica', title: 'One', views: 100 })
  assert.deepEqual(buscarCanciones(db, 'one').map(s => s.title), ['One', 'Someone'])
})

test('entre dos que empiezan igual, gana la mas vista', () => {
  const db = base()
  agregar(db, { title: 'One Step Closer', views: 10 })
  agregar(db, { title: 'One', views: 5000 })
  assert.deepEqual(buscarCanciones(db, 'one').map(s => s.title), ['One', 'One Step Closer'])
})

/* EL criterio de este buscador: la pediste por nombre. Esconderla porque un dia
   la descartaste seria el buscador desobedeciendo una orden explicita. El
   sorteo si la sigue excluyendo -- son dos preguntas distintas. */
test('una cancion descartada sigue apareciendo en la busqueda', () => {
  const db = base()
  const id = agregar(db, { title: 'Descartada' })
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(buscarCanciones(db, 'descartada').length, 1)
  assert.equal(roll(db, {}).matching, 0, 'pero el sorteo si la excluye')
})

/* La basura del catalogo si se esconde, y no es lo mismo: eso no lo decidiste
   tu, y no hay tablatura util detras. */
test('la basura del catalogo no aparece', () => {
  const db = base()
  agregar(db, { title: 'Basura', isJunk: 1 })
  agregar(db, { title: 'Basura generada', aiGenerated: 1 })
  agregar(db, { title: 'Basura vacia', isBlank: 1 })
  agregar(db, { title: 'Basura despublicada', isPublished: 0 })
  agregar(db, { title: 'Basura sin enriquecer', enrichedAt: null })
  assert.deepEqual(buscarCanciones(db, 'basura'), [])
})

test('una cancion sin pistas de guitarra no aparece: no hay tarjeta que abrir', () => {
  const db = base()
  agregar(db, { title: 'Solo bateria', pistas: [{ instrument: 'Drums', difficulty: 4 }] })
  assert.deepEqual(buscarCanciones(db, 'bateria'), [])
})

// ---------------------------------------------------------------- getSong

test('getSong devuelve la cancion con todas sus pistas', () => {
  const db = base()
  const id = agregar(db, {
    artist: 'Metallica', title: 'Fade to Black',
    pistas: [
      { instrument: 'Distortion Guitar', name: 'Lead', views: 900 },
      { instrument: 'Acoustic Guitar (steel)', name: 'Acustica', views: 100 },
    ],
  })
  const s = getSong(db, id)
  assert.equal(s.title, 'Fade to Black')
  assert.equal(s.pistas.length, 2)
})

/* Sin filtro no hay contra que calificar, igual que en las listas guardadas. */
test('getSong: todas las pistas califican y viene elegida la mas vista', () => {
  const db = base()
  const id = agregar(db, {
    pistas: [{ name: 'Poco vista', views: 10 }, { name: 'La mas vista', views: 900 }],
  })
  const s = getSong(db, id)
  assert.ok(s.pistas.every(p => p.califica))
  assert.equal(s.pistas[s.pistaPorDefecto].name, 'La mas vista')
})

/* Buscar no es sortear: no gasta la cancion. Si sumara shown_count, mirar el
   tono de un tema que ya te sabes lo contaria como si te lo hubieran ofrecido. */
test('getSong no escribe nada en song_state', () => {
  const db = base()
  const id = agregar(db, { title: 'Consultada' })
  getSong(db, id)
  const fila = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(fila, undefined, 'no crea la fila siquiera')
})

test('getSong de una cancion descartada la devuelve igual', () => {
  const db = base()
  const id = agregar(db, { title: 'Descartada' })
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(getSong(db, id).title, 'Descartada')
})

test('getSong de un id que no existe devuelve null', () => {
  const db = base()
  agregar(db, {})
  assert.equal(getSong(db, 99999), null)
})
