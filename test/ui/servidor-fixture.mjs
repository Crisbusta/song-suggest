/* ---------------------------------------------------------------------------
   El servidor que usan los tests de navegador.

   Sirve una base EN MEMORIA con canciones inventadas, no `songs.db`. Dos
   razones, y las dos importan:

   - `songs.db` cambia: el ETL lo reescribe y `song_state` cambia cada vez que
     marcas una cancion. Un test montado sobre el iria poniendose rojo solo.
   - Sortear ESCRIBE (`shown_count`). Los tests no deben tocar tu historial.

   Los datos estan calculados para que una sola cancion cubra dos invariantes a
   la vez: la de "la pista elegida es la mas vista QUE CALIFICA" y la de "las
   que no califican se muestran marcadas".
   --------------------------------------------------------------------------- */
import { openDb } from '../../db/open.js'
import { createApp } from '../../server.js'

const db = openDb(':memory:')

const cancion = (songId, artist, title, pistas, tags = []) => {
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, 0, 0, 0, 0, 1, '[]', '2026-09-12')
  `).run(songId, artist, title, songId)
  /* Sin etiquetas no hay sugerencia de ampli y el panel sale en su estado
     vacio, sin las ranuras ni el desplegable. Que el fixture las traiga es lo
     que permite probar el panel de verdad. */
  for (const tag of tags) {
    db.prepare('INSERT INTO tags (song_id, tag) VALUES (?, ?)').run(songId, tag)
  }
  pistas.forEach((p, i) => {
    db.prepare(`
      INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
      VALUES (?, ?, ?, ?, ?, ?, '[64,59,55,50,45,40]')
    `).run(songId, i, p.instrumento, p.nombre, p.dificultad, p.vistas)
  })
}

/* Seis pistas, como Fade to Black. Las acusticas se dibujan primero porque la
   lista agrupa por instrumento, pero la mas vista es el Lead con distorsion:
   por eso esta cancion demuestra que la eleccion por defecto NO es la primera
   fila. Y las dos ultimas son dificiles, asi que con el filtro en 1-3 quedan
   fuera y tienen que verse marcadas. */
cancion(1, 'Banda Seis', 'Cancion De Seis Pistas', [
  { instrumento: 'Acoustic Guitar (steel)', nombre: 'Hetfield | Acoustic Guitar', dificultad: 2, vistas: 200 },
  { instrumento: 'Acoustic Guitar (steel)', nombre: 'Hetfield | Acoustic Guitar (12 String)', dificultad: 2, vistas: 300 },
  { instrumento: 'Distortion Guitar', nombre: 'Hammett | Gibson Flying V | Lead Guitar', dificultad: 2, vistas: 5000 },
  { instrumento: 'Distortion Guitar', nombre: 'Hetfield | Electra | Rhythm Guitar', dificultad: 2, vistas: 250 },
  { instrumento: 'Distortion Guitar', nombre: 'Hetfield | Harmonies', dificultad: 8, vistas: 100 },
  { instrumento: 'Distortion Guitar', nombre: 'Hetfield | Extras', dificultad: 9, vistas: 50 },
], ['thrash metal'])

// Una sola pista: la lista entera no debe dibujarse. Es el 19,4% del catalogo.
cancion(2, 'Banda Una', 'Cancion De Una Pista', [
  { instrumento: 'Distortion Guitar', nombre: 'Guitarra', dificultad: 4, vistas: 900 },
])

// Relleno, para que el contador no diga siempre lo mismo y el sorteo tenga de
// donde elegir.
for (let i = 3; i <= 12; i++) {
  cancion(i, `Banda ${i}`, `Relleno ${i}`, [
    { instrumento: 'Distortion Guitar', nombre: 'Guitarra', dificultad: 5, vistas: 100 },
  ])
}

createApp(db).listen(3199, () => console.log('fixture en http://localhost:3199'))
