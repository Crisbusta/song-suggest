/* ---------------------------------------------------------------------------
   Marcador: puntua el sugeridor de tono actual contra el corpus del usuario.

   NO es un test y no entra en `npm test`: lee songs.db, y CLAUDE.md lo
   prohibe. Su logica vive en lib/tono/evaluador.js, que si esta testeado
   contra un corpus sintetico.

   Lo que imprime no es "acierta mas": es "coincide mas con lo que aprobaste".
   --------------------------------------------------------------------------- */
import { openDb } from '../db/open.js'
import { leerJuicios } from '../db/tono-usuario.js'
import { sugerirAjustes } from '../lib/ampli.js'
import { informe } from '../lib/tono/evaluador.js'

const db = openDb(process.argv[2] ?? 'songs.db')

const cancion = db.prepare('SELECT artist, title FROM songs WHERE song_id = ?')
const pista = db.prepare('SELECT instrument, name FROM tracks WHERE song_id = ? AND track_index = ?')
const tagsDe = db.prepare('SELECT tag FROM tags WHERE song_id = ?')

/* El candidato es el sugeridor de HOY. Cuando cambie, este mismo comando
   vuelve a correr y la diferencia entre los dos informes es la respuesta que
   veniamos a buscar. */
const candidatoDe = (songId, trackIndex) => {
  const s = cancion.get(songId)
  const p = pista.get(songId, trackIndex)
  if (!s || !p) return null
  const a = sugerirAjustes({
    tags: tagsDe.all(songId).map(r => r.tag),
    instrument: p.instrument, tuning: null, artist: s.artist, title: s.title,
  })
  return a?.cadena ?? null
}

const juicios = leerJuicios(db).map(j => ({ ...j, candidato: candidatoDe(j.songId, j.trackIndex) }))
const capturas = db.prepare('SELECT song_id, track_index, cadena FROM user_tone').all().map(f => ({
  objetivo: JSON.parse(f.cadena),
  candidato: candidatoDe(f.song_id, f.track_index),
}))

console.log(`\nCorpus: ${juicios.length} juicios, ${capturas.length} tonos capturados\n`)
if (!juicios.length && !capturas.length) {
  console.log('Sin corpus todavia. Juzga algunos tonos en la app y vuelve.\n')
  process.exit(0)
}

const r = informe({ juicios, capturas })
console.log(`  cumplidas   ${r.cumplidas}`)
console.log(`  violadas    ${r.violadas}`)
console.log(`  sin efecto  ${r.sinEfecto}   (el sugeridor no propone nada para esa pista)`)
for (const [bolsa, ejs] of Object.entries(r.ejemplos)) {
  if (!ejs.length) continue
  console.log(`\n  ejemplos ${bolsa}:`)
  for (const e of ejs) console.log(`    cancion ${e.songId} pista ${e.trackIndex} -- ${e.eje}/${e.direccion}`)
}
if (capturas.length) {
  console.log(`\n  tonos capturados: familia acertada en ${r.capturas.familiaOk} de ${r.capturas.total}`)
  console.log(`  ranuras equivocadas en total: ${r.capturas.ranurasMal}`)
}

/* El contrapeso, y no es opcional: con ~50 juicios y una tabla de reglas
   editable a mano, hacer subir el marcador es trivial. Sin esta linea, un
   cambio que mejora doce pistas del corpus y mueve ocho mil del catalogo
   parece un exito -- y un marcador que da confianza falsa es peor que no
   tener marcador. */
const alcance = db.prepare(`
  SELECT COUNT(*) n FROM guitar_tracks g JOIN songs s USING(song_id)
  WHERE s.enriched_at IS NOT NULL
`).get().n
/* Se cuentan PISTAS DISTINTAS, no filas: la misma pista puede tener tres
   juicios y un tono capturado, y sumarlos daria un corpus cuatro veces mas
   grande del que es -- y una resta negativa contra el catalogo, que es como
   se cazo este error al correr la herramienta por primera vez. */
const tocadas = new Set([
  ...juicios.map(j => `${j.songId}:${j.trackIndex}`),
  ...db.prepare('SELECT song_id, track_index FROM user_tone').all().map(f => `${f.song_id}:${f.track_index}`),
])
console.log(`\n  CONTRAPESO: el corpus cubre ${tocadas.size} pistas distintas.`)
console.log(`  El catalogo tiene ${alcance} pistas de guitarra enriquecidas, asi que`)
console.log(`  un cambio medido aqui no esta probado sobre las otras ${alcance - tocadas.size}.\n`)
