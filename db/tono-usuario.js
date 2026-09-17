/* ---------------------------------------------------------------------------
   Lectura y escritura del tono que el usuario aprobo, y de sus juicios.

   No decide NADA de tono: guarda lo que el equipo tenia y lo devuelve tal
   cual. Quien decide si se aplica es db/queries.js, y quien lo puntua es
   lib/tono/evaluador.js.

   Las dos tablas son zona protegida (ver CLAUDE.md): el ETL no reconstruye
   ninguna de las dos.
   --------------------------------------------------------------------------- */

/* U+001F, el separador de unidades de ASCII. No aparece en ningun nombre de
   pista del catalogo, asi que no puede colisionar con lo que separa: sin el,
   {instrument:'ab', name:'c'} y {instrument:'a', name:'bc'} darian la misma
   firma y un tono se aplicaria a la pista equivocada. */
const SEP = ''
export const firmaDePista = ({ instrument, name }) => `${instrument ?? ''}${SEP}${name ?? ''}`

export function guardarTono(db, { songId, trackIndex, instrument, name, cadena, descriptor = null, origen, nota = null }) {
  db.prepare(`
    INSERT INTO user_tone (song_id, track_index, track_sig, cadena, descriptor, origen, nota, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_id, track_index) DO UPDATE SET
      track_sig = excluded.track_sig, cadena = excluded.cadena,
      descriptor = excluded.descriptor, origen = excluded.origen,
      nota = excluded.nota, updated_at = excluded.updated_at
  `).run(songId, trackIndex, firmaDePista({ instrument, name }),
         JSON.stringify(cadena), descriptor && JSON.stringify(descriptor),
         origen, nota, new Date().toISOString())
}

/* `desfasada` es lo unico interesante de esta funcion: la fila existe, pero la
   pista que hay HOY en ese track_index no es la que se guardo -- el ETL borra
   y reinserta `tracks` con el orden que venga de Songsterr.

   Se devuelve la cadena igual (el tono sigue siendo tuyo y no se tira por una
   reordenacion ajena) pero marcada, para que quien la use decida no aplicarla
   y la interfaz pueda decirlo. Silenciarlo seria aplicar tu tono de la ritmica
   a un solo: no lanza, no se nota, y el sintoma es "el tono que guarde dejo de
   servir". */
export function leerTono(db, { songId, trackIndex, instrument, name }) {
  const f = db.prepare('SELECT * FROM user_tone WHERE song_id = ? AND track_index = ?').get(songId, trackIndex)
  if (!f) return null
  return {
    cadena: JSON.parse(f.cadena),
    descriptor: f.descriptor ? JSON.parse(f.descriptor) : null,
    origen: f.origen,
    nota: f.nota,
    updatedAt: f.updated_at,
    desfasada: f.track_sig !== firmaDePista({ instrument, name }),
  }
}

export function borrarTono(db, { songId, trackIndex }) {
  db.prepare('DELETE FROM user_tone WHERE song_id = ? AND track_index = ?').run(songId, trackIndex)
}
