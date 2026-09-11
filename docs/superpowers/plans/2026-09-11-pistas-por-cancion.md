# Elegir la pista de la canción — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el sorteo encuentre canciones por *cualquiera* de sus pistas de guitarra, y que la tarjeta deje elegir cuál practicar — con su dificultad, su afinación y su tono de amplificador.

**Architecture:** El predicado de `BASE_FROM` se muda de la vista `representative_track` a la tabla `guitar_tracks`, evaluando modo y dificultad sobre la misma fila. Una función de ventana elige la pista por defecto (la más vista de las que califican) y garantiza una fila por canción, para que el sorteo siga siendo uniforme por canción. `hidratar()` devuelve todas las pistas con su tono ya calculado, así que el selector de la tarjeta no toca la red.

**Tech Stack:** Node ≥ 24 sin dependencias de npm. `node:sqlite`, `node:http`, `node:test`. Front vainilla sin build.

**Spec:** `docs/superpowers/specs/2026-09-11-pistas-por-cancion-design.md`

## Global Constraints

- **Cero dependencias de npm.** No instalar nada. Sólo módulos `node:`.
- **Node ≥ 24** (`node:sqlite` y `node:test` nativos).
- **Los tests corren con `npm test`** y ninguno toca la red.
- **`song_state` no se toca.** Ni su esquema, ni su clave primaria. Es la única tabla que el ETL no puede reconstruir.
- **`public/fender-protocolo.js`, `public/despachador.js` y `public/ampli-usb.js` no se modifican.** El transporte al amplificador queda igual.
- **Comentarios y mensajes de commit en español, sin tildes en el código** (convención del repo: los identificadores y comentarios en `.js` van sin tildes; el Markdown sí las lleva).
- **Nada de números inventados.** Si un dato no está en la fuente, viaja como `null` y la interfaz no lo dibuja.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `db/queries.js` | El predicado por pista, los contadores, `hidratar` con `pistas` | 1, 2 |
| `test/pistas.test.js` | **Nuevo.** El predicado por pista y la pista por defecto | 1 |
| `test/roll.test.js` | Se adapta a la respuesta sin campos espejo | 2 |
| `test/filtro-bandas.test.js` | Se adapta al conteo por canción | 1 |
| `public/tarjeta.js` | La etiqueta de una pista (lógica pura, con test) | 3 |
| `test/tarjeta.test.js` | El test de esa etiqueta | 3 |
| `public/app.js` | El `<select>` de pistas y el re-dibujo al cambiarla | 3, 4 |
| `public/index.html` | El botón de sortear de todo | 4 |
| `public/style.css` | El estilo del selector y de la marca de "no califica" | 3 |
| `server.js` | El parámetro `todo=1` de `/api/roll` | 4 |
| `public/index.html` | El botón de sortear de todo | 4 |
| `README.md` | Las dos secciones que quedan desactualizadas | 5 |

---

### Task 1: El predicado se muda a la pista

**Files:**
- Modify: `db/queries.js:14-35` (`BASE_FROM`, `MODE_SQL`, `COLUMNS`), `db/queries.js:45-49` (`listarArtistas`), `db/queries.js:72-75` (`contar`), `db/queries.js:180-195` (el sorteo), `db/queries.js:233-240` (`getList`), `db/queries.js:249` (`getStats`)
- Create: `test/pistas.test.js`
- Test: `test/pistas.test.js`, `test/filtro-bandas.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `BASE_FROM` une `guitar_tracks` con alias `g`. `COLUMNS` incluye `g.track_index`. La fila que `roll()` pasa a `hidratar()` trae `track_index` — la pista elegida. `contar()` devuelve canciones distintas.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/pistas.test.js`. El helper `agregarConPistas` inserta una canción con varias pistas; es distinto del `agregar` de los otros archivos de test, que inserta una sola.

```js
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
```

**Por qué estos dos leen `song.instrument` y `song.trackName`:** esta tarea NO toca `hidratar()`, así que la respuesta conserva la forma vieja — lo único que cambia es de qué pista salen los datos. La Task 2 los reescribe a `pistas[pistaPorDefecto]` junto con los de `test/roll.test.js`. **Esta tarea tiene que terminar con la suite entera en verde.**

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `node --test test/pistas.test.js`
Expected: FAIL. `'modo y dificultad los tiene que cumplir LA MISMA pista'` falla con `matching` 1 en vez de 0 — hoy `representative_track` toma la acústica (más vista) y su dificultad 9 queda fuera del rango, así que puede dar 0 por la razón equivocada; verificar el motivo del fallo, no sólo que falle.

- [ ] **Step 3: Mudar `BASE_FROM`, `MODE_SQL` y `COLUMNS` a la pista**

En `db/queries.js`, reemplazar las líneas 13-35 por:

```js
/* Exclusiones permanentes: ya decidido, basura del catalogo, o sin enriquecer.

   El predicado vive en la PISTA (`g`), no en la cancion. Modo y dificultad se
   evaluan sobre la MISMA fila `g` a proposito: escribirlo como dos
   existenciales sueltos -- "existe una acustica y existe una facil" -- deja
   entrar canciones donde ninguna sola pista sirve. Medido sobre el universo
   sorteable al 2026-09-11: 178 canciones fantasma en acustico + 1-2 (1.881
   correctas contra 2.059). Ver test/pistas.test.js. */
const BASE_FROM = `
  FROM songs s
  JOIN guitar_tracks g ON g.song_id = s.song_id
  LEFT JOIN song_state st ON st.song_id = s.song_id
  WHERE s.enriched_at IS NOT NULL
    AND s.is_junk = 0 AND s.ai_generated = 0 AND s.is_blank = 0 AND s.is_published = 1
    AND st.status IS NULL
    AND g.difficulty BETWEEN ? AND ?
`

const MODE_SQL = {
  surprise: '',
  riffs: ` AND g.instrument IN ('Distortion Guitar','Overdriven Guitar') AND s.fingerstyle = 0`,
  acoustic: ` AND (s.fingerstyle = 1 OR g.instrument IN ('Acoustic Guitar (nylon)','Acoustic Guitar (steel)'))`,
  solos: ` AND (g.name LIKE '%Lead%' OR g.name LIKE '%Solo%')`,
}

const COLUMNS = `
  s.song_id, s.artist, s.title, s.videos,
  g.track_index, g.difficulty, g.instrument, g.name AS track_name, g.tuning,
  COALESCE(st.liked, 0) AS liked
`

/* Una fila por cancion: la pista mas vista DE LAS QUE CALIFICAN.

   Cumple dos cosas a la vez, y las dos importan:

   1. Elige la pista por defecto. Que sea la mas vista de las que CALIFICAN --
      y no la mas vista a secas -- es lo que evita que pidas "facil" y la
      tarjeta abra en una pista de dificultad 5.
   2. Deduplica. Sin esto, una cancion con tres pistas que califican aparece
      tres veces y `ORDER BY RANDOM()` la elige tres veces mas seguido que a
      una de una sola pista. El sorteo tiene que ser uniforme por CANCION.

   Desempate por track_index para ser determinista, igual que
   representative_track. */
const unaPorCancion = cuerpo => `
  SELECT * FROM (
    SELECT ${COLUMNS},
           ROW_NUMBER() OVER (
             PARTITION BY s.song_id ORDER BY g.views DESC, g.track_index ASC
           ) AS rn
    ${cuerpo}
  ) WHERE rn = 1
`
```

- [ ] **Step 4: Contar canciones distintas en los tres sitios que cuentan**

`contar()` (`db/queries.js:72-75`):

```js
function contar(db, mode, min, max, fa = { sql: '', params: [] }) {
  return db.prepare(`SELECT COUNT(DISTINCT s.song_id) c ${BASE_FROM}${MODE_SQL[mode]}${fa.sql}`)
    .get(min, max, ...fa.params).c
}
```

`listarArtistas()` (`db/queries.js:45-49`) — sólo cambia el `COUNT`:

```js
export function listarArtistas(db) {
  return construirIndice(db.prepare(`
    SELECT s.artist, COUNT(DISTINCT s.song_id) c ${BASE_FROM} GROUP BY s.artist ORDER BY c DESC
  `).all(1, 10))
}
```

`getStats()` (`db/queries.js:249`):

```js
  const available = db.prepare(`SELECT COUNT(DISTINCT s.song_id) c ${BASE_FROM}`).get(1, 10).c
```

- [ ] **Step 5: El sorteo usa `unaPorCancion`**

Reemplazar el bloque `if (mode === 'solos') { ... } else { ... }` (`db/queries.js:180-195`):

```js
  let fila
  if (mode === 'solos') {
    // Sesgo al extremo alto: el tercio superior por dificultad, minimo 20,
    // para que un rango angosto no deje el sorteo entre dos canciones. La
    // dificultad que ordena es la de la PISTA ELEGIDA, ya resuelta por
    // unaPorCancion.
    const pool = Math.max(20, Math.ceil(matching / 3))
    fila = db.prepare(`
      SELECT * FROM (
        ${unaPorCancion(`${BASE_FROM}${MODE_SQL.solos}${fa.sql}`)}
        ORDER BY difficulty DESC, song_id ASC LIMIT ?
      ) ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params, pool)
  } else {
    fila = db.prepare(`
      ${unaPorCancion(`${BASE_FROM}${MODE_SQL[mode]}${fa.sql}`)}
      ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, ...fa.params)
  }
```

Ojo con el `ORDER BY` del caso `solos`: adentro del `SELECT *` exterior las columnas ya vienen con su alias, así que se ordena por `difficulty` y `song_id` pelados, sin el prefijo `g.`/`s.`.

- [ ] **Step 6: `getList` mantiene la pista representativa, con el alias nuevo**

`COLUMNS` ahora dice `g.`, y `getList` no filtra por nada — ahí "la más vista" sigue siendo la respuesta correcta. Se renombra el alias de la vista a `g` para que `COLUMNS` sirva a los dos (`db/queries.js:233-240`):

```js
  const filas = db.prepare(`
    SELECT ${COLUMNS}
    FROM songs s
    JOIN representative_track g ON g.song_id = s.song_id
    JOIN song_state st ON st.song_id = s.song_id
    WHERE ${filtro}
    ORDER BY st.updated_at DESC
  `).all(...params)
```

`representative_track` ya expone `track_index`, así que `COLUMNS` calza sin tocar el esquema.

- [ ] **Step 7: Correr la suite entera**

Run: `npm test`
Expected: **PASS, la suite entera.** Esta tarea no toca `hidratar()`, así que la forma de la respuesta no cambia y ningún test viejo debería notarla — sólo cambia de qué pista salen los datos, y en los fixtures viejos cada canción tiene una sola pista. Cualquier fallo acá es de este cambio, no del siguiente.

- [ ] **Step 8: Commit**

```bash
git add db/queries.js test/pistas.test.js
git commit -m "feat: el sorteo filtra por cualquier pista de guitarra, no solo la mas vista

Modo y dificultad se evaluan sobre la MISMA fila de guitar_tracks. Escribirlo
como dos existenciales sueltos dejaria entrar 178 canciones donde ninguna sola
pista sirve (acustico + 1-2, medido sobre las 9.734 sorteables).

unaPorCancion() hace dos cosas: elige la pista por defecto (la mas vista DE LAS
QUE CALIFICAN, para que pedir facil no abra en una pista dificil) y deduplica,
para que el sorteo siga siendo uniforme por cancion y no por pista.

Los tres contadores pasan a COUNT(DISTINCT s.song_id).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `hidratar` devuelve todas las pistas con su tono

**Files:**
- Modify: `db/queries.js:86-119` (`hidratar`), y sus dos llamadas en `roll` (`db/queries.js:203`) y `getList` (`db/queries.js:242`)
- Test: `test/pistas.test.js`, `test/roll.test.js`

**Interfaces:**
- Consumes: de la Task 1, la fila con `track_index` y `BASE_FROM`/`MODE_SQL` por pista.
- Produces: `hidratar()` devuelve `{ songId, artist, title, tags, pistas, pistaPorDefecto, officialVideo, backingVideo, url, liked }`. Cada elemento de `pistas` es `{ trackIndex, instrument, name, difficulty, views, tuning, califica, ampli }`, donde `ampli` es `null` o `{ ...sugerencia, paraElAmpli }`. **Ya no existen** `difficulty`, `instrument`, `trackName`, `tuning` ni `ampli` al nivel de la canción.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/pistas.test.js`:

```js
test('devuelve TODAS las pistas de guitarra, ordenadas por views', () => {
  const db = base()
  agregarConPistas(db, {
    pistas: [
      { name: 'Poco vista', views: 10 },
      { name: 'La mas vista', views: 9000 },
      { name: 'Media', views: 500 },
    ],
  })
  const { pistas } = roll(db, {}).song
  assert.deepEqual(pistas.map(p => p.name), ['La mas vista', 'Media', 'Poco vista'])
  assert.deepEqual(pistas.map(p => p.trackIndex), [1, 2, 0])
})

/* Las que no califican se muestran igual, marcadas: quien mira la tarjeta
   tiene que poder ver por que salio esta cancion y cual pista no fue el
   motivo. */
test('marca cuales pistas cumplen el filtro y cuales no', () => {
  const db = base()
  agregarConPistas(db, {
    pistas: [
      { instrument: 'Distortion Guitar', name: 'Dura', difficulty: 9, views: 9000 },
      { instrument: 'Acoustic Guitar (steel)', name: 'Blanda', difficulty: 2, views: 100 },
    ],
  })
  const { pistas } = roll(db, { mode: 'acoustic', minDifficulty: 1, maxDifficulty: 2 }).song
  assert.equal(pistas.find(p => p.name === 'Blanda').califica, true)
  assert.equal(pistas.find(p => p.name === 'Dura').califica, false)
})

/* El regalo de este diseno: la regla acustica de lib/ampli.js ya estaba
   escrita y argumentada, solo no recibia nunca la pista correcta. Elegir la
   acustica de Metallica tiene que dar CHAMPION, no el preset de banda a gain
   alto. */
test('cada pista trae su propio tono, derivado de su instrumento', () => {
  const db = base()
  const songId = agregarConPistas(db, {
    artist: 'Metallica',
    title: 'Fade to Black',
    pistas: [
      { instrument: 'Distortion Guitar', name: 'Lead Guitar', difficulty: 2, views: 9000 },
      { instrument: 'Acoustic Guitar (steel)', name: 'Acoustic', difficulty: 2, views: 100 },
    ],
  })
  db.prepare('INSERT INTO tags (song_id, tag) VALUES (?, ?)').run(songId, 'thrash metal')

  const { pistas } = roll(db, {}).song
  const acustica = pistas.find(p => p.instrument.startsWith('Acoustic'))
  const electrica = pistas.find(p => p.instrument === 'Distortion Guitar')

  assert.equal(acustica.ampli.modelo, 'CHAMPION', 'la acustica no usa el preset de banda')
  assert.equal(acustica.ampli.gain, 1)
  assert.notEqual(electrica.ampli.modelo, 'CHAMPION')
  assert.ok(electrica.ampli.gain > acustica.ampli.gain)
})

test('la afinacion es la de cada pista, no una sola de la cancion', () => {
  const db = base()
  agregarConPistas(db, {
    pistas: [
      { name: 'Estandar', views: 9000, tuning: '[64,59,55,50,45,40]' },
      { name: 'Drop D', views: 100, tuning: '[64,59,55,50,45,38]' },
    ],
  })
  const { pistas } = roll(db, {}).song
  assert.equal(pistas.find(p => p.name === 'Estandar').tuning, null)
  assert.equal(pistas.find(p => p.name === 'Drop D').tuning, 'Drop D')
})

/* getList no filtra por nada, asi que no hay filtro contra el cual calificar.
   Todas cuentan, y la pista por defecto es la mas vista a secas. */
test('en las listas guardadas todas las pistas califican', () => {
  const db = base()
  const songId = agregarConPistas(db, {
    pistas: [{ name: 'A', views: 900 }, { name: 'B', views: 100 }],
  })
  mark(db, { songId, status: 'learned' })
  const [song] = getList(db, 'learned')
  assert.ok(song.pistas.every(p => p.califica))
  assert.equal(song.pistas[song.pistaPorDefecto].name, 'A')
})
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `node --test test/pistas.test.js`
Expected: FAIL con `Cannot read properties of undefined (reading 'map')` o similar — `song.pistas` todavía no existe.

- [ ] **Step 3: Implementar `pistasDeLaCancion` y `pistasQueCalifican`**

En `db/queries.js`, agregar antes de `hidratar` (que está en la línea 86):

```js
/* Los track_index que cumplen el filtro con el que se sorteo esta cancion.

   Se pregunta al MISMO SQL que decidio el sorteo -- BASE_FROM + MODE_SQL --
   en vez de reimplementar el predicado en JavaScript. Dos copias de esta
   regla se desviarian, y la tarjeta terminaria marcando como "califica" una
   pista por la que el sorteo jamas habria devuelto la cancion. */
function pistasQueCalifican(db, songId, mode, min, max) {
  const filas = db.prepare(`
    SELECT g.track_index ${BASE_FROM}${MODE_SQL[mode]} AND s.song_id = ?
  `).all(min, max, songId)
  return new Set(filas.map(f => f.track_index))
}

/* Todas las pistas de guitarra de una cancion, ordenadas por views, cada una
   con su propio tono.

   No hay corte de ruido, y es una decision medida, no un olvido: la
   distribucion de views esta dominada por una pista desbocada, asi que
   cualquier corte relativo castiga pistas legitimas. Con un corte al 10% del
   maximo, Fade to Black pierde la ritmica de Hetfield (287.234 views contra
   los 2.984.809 de Kirk) -- justo lo que alguien querria aprender. Peor: en
   cada corte evaluado, miles de las pistas cortadas son la mas facil de su
   cancion, o sea exactamente las que hacen que la cancion entre al filtro.
   Cortar haria entrar canciones por una pista que despues no se muestra.
   Ordenar por views hace solo el trabajo: el ruido se hunde al fondo, y el
   94% de las canciones tiene cuatro pistas o menos.

   `califican` es el conjunto de track_index que cumplen el filtro, o null
   cuando no hubo filtro (getList): ahi todas califican. */
function pistasDeLaCancion(db, fila, tags, califican) {
  const filas = db.prepare(`
    SELECT track_index, instrument, name, difficulty, views, tuning
    FROM guitar_tracks WHERE song_id = ?
    ORDER BY views DESC, track_index ASC
  `).all(fila.song_id)

  return filas.map(p => {
    const tuning = describeTuning(p.tuning ? JSON.parse(p.tuning) : null)
    /* `artist` y `title` no son opcionales: son lo unico con lo que
       sugerirAjustes puede buscar un preset de la comunidad. Sin ellos la
       busqueda nunca recibe un artista y todo el camino de los presets queda
       inerte, con la suite en verde. */
    const sugerencia = sugerirAjustes({
      tags, instrument: p.instrument, tuning,
      artist: fila.artist, title: fila.title,
    })
    return {
      trackIndex: p.track_index,
      instrument: p.instrument,
      name: p.name,
      difficulty: p.difficulty,
      views: p.views,
      tuning,
      califica: califican ? califican.has(p.track_index) : true,
      // Punto de partida para el ampli, o null si los tags no dan senal util.
      // paraElAmpli son los mismos valores en la escala que espera el equipo.
      ampli: sugerencia && { ...sugerencia, paraElAmpli: paraElAmpli(sugerencia) },
    }
  })
}
```

- [ ] **Step 4: Reescribir `hidratar`**

Reemplazar `hidratar` entero (`db/queries.js:86-119`):

```js
/* `califican` viene del sorteo (los track_index que cumplen el filtro) o es
   null desde getList, que no filtra por nada.

   Los campos de la PISTA -- difficulty, instrument, trackName, tuning, ampli
   -- ya NO viven al nivel de la cancion. Tenerlos en los dos lados serian dos
   fuentes de verdad para el mismo dato, y la primera vez que el selector y la
   cabecera se desincronicen no habria forma de saber cual miente. La tarjeta
   lee siempre de pistas[elegida]. */
function hidratar(db, fila, califican = null) {
  if (!fila) return null
  const tags = db.prepare('SELECT tag FROM tags WHERE song_id = ?')
    .all(fila.song_id).map(r => r.tag)
  const pistas = pistasDeLaCancion(db, fila, tags, califican)
  return {
    songId: fila.song_id,
    artist: fila.artist,
    title: fila.title,
    pistas,
    // Cual viene elegida. El SQL ya decidio cual es (la mas vista de las que
    // califican); aca solo se traduce ese track_index a su posicion en el
    // arreglo ya ordenado.
    pistaPorDefecto: Math.max(0, pistas.findIndex(p => p.trackIndex === fila.track_index)),
    tags,
    officialVideo: elegirVideo(fila.videos, null),
    backingVideo: elegirVideo(fila.videos, 'backing'),
    url: `https://www.songsterr.com/a/wa/song?id=${fila.song_id}`,
    liked: !!fila.liked,
  }
}
```

El `Math.max(0, ...)` cubre el caso imposible de que `findIndex` devuelva -1: antes que mandar un índice inválido al cliente, se cae a la primera pista, que siempre existe si la canción salió del sorteo.

- [ ] **Step 5: Actualizar las dos llamadas**

En `roll()`, el `return` final (`db/queries.js:203`):

```js
  return {
    song: hidratar(db, fila, fila && pistasQueCalifican(db, fila.song_id, mode, minDifficulty, maxDifficulty)),
    matching,
    hint,
  }
```

En `getList()` la llamada no cambia — `hidratar(db, f)` ya usa el default `califican = null`.

- [ ] **Step 6: Correr los tests nuevos**

Run: `node --test test/pistas.test.js`
Expected: PASS, los once.

- [ ] **Step 7: Adaptar los tests viejos a la respuesta sin campos espejo**

Run: `npm test`

`test/roll.test.js` va a fallar en los asserts que leen `song.difficulty`, `song.tuning`, `song.instrument`, `song.trackName` y `song.ampli`. Cada uno pasa a leer de la pista elegida. Ejemplo del que está en `test/roll.test.js:44` (`'formatea la afinacion y calla cuando es estandar'`):

```js
// antes: assert.equal(roll(db, {}).song.tuning, 'Drop D')
const elegida = s => s.pistas[s.pistaPorDefecto]
assert.equal(elegida(roll(db, {}).song).tuning, 'Drop D')
```

Definir `elegida` una vez arriba del archivo y usarla en todos. **No** reintroducir los campos espejo para que los tests viejos pasen: el punto de quitarlos es enterarse de quién dependía de ellos.

`test/tarjeta.test.js` no debería fallar — prueba funciones puras que reciben el objeto `ampli`, no la canción entera. Si falla, es que algo le llegaba desde la forma vieja: arreglar el test, no la forma.

- [ ] **Step 8: Correr la suite entera y commitear**

Run: `npm test`
Expected: PASS, todo.

```bash
git add db/queries.js test/pistas.test.js test/roll.test.js
git commit -m "feat: cada cancion viaja con todas sus pistas y el tono de cada una

hidratar() devuelve `pistas` -- todas las de guitarra, ordenadas por views, con
su dificultad, su afinacion, si cumple el filtro, y su cadena de ampli ya
calculada. Precalcular en el servidor es lo que deja que el selector de la
tarjeta no toque la red ni agregue estados asincronos a app.js.

Sin corte de ruido por views, y es medido: al 10% Fade to Black pierde la
ritmica de Hetfield, y miles de las pistas cortadas son la mas facil de su
cancion -- las que hacen que entre al filtro.

Se quitan los campos espejo del nivel de la cancion (difficulty, instrument,
trackName, tuning, ampli). Dos fuentes de verdad para el mismo dato es como la
cabecera y el selector terminan diciendo cosas distintas sin que se note.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El selector en la tarjeta

**Files:**
- Modify: `public/tarjeta.js` (agregar `etiquetaDePista`), `public/app.js` (el `<select>` y el re-dibujo), `public/style.css`
- Test: `test/tarjeta.test.js`

**Interfaces:**
- Consumes: de la Task 2, `song.pistas` y `song.pistaPorDefecto`.
- Produces: `etiquetaDePista(pista)` → `string`, exportada de `public/tarjeta.js`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/tarjeta.test.js` (el import de arriba del archivo pasa a incluir `etiquetaDePista`):

```js
test('etiquetaDePista nombra la pista, su dificultad y su afinacion', () => {
  assert.equal(
    etiquetaDePista({
      name: 'Kirk Hammett | Lead Guitar', instrument: 'Distortion Guitar',
      difficulty: 2, tuning: null,
    }),
    'Kirk Hammett | Lead Guitar · dificultad 2'
  )
  assert.equal(
    etiquetaDePista({
      name: 'Rhythm', instrument: 'Distortion Guitar', difficulty: 4, tuning: 'Drop D',
    }),
    'Rhythm · dificultad 4 · Drop D'
  )
})

/* El catalogo trae nombres vacios y nombres en otros alfabetos ('Дорожка 1').
   Sin nombre, el instrumento es lo unico que queda para distinguir la pista:
   una opcion en blanco en el selector no se puede elegir a proposito. */
test('sin nombre, la pista se identifica por su instrumento', () => {
  assert.equal(
    etiquetaDePista({ name: '', instrument: 'Acoustic Guitar (steel)', difficulty: 3, tuning: null }),
    'Acoustic Guitar (steel) · dificultad 3'
  )
  assert.equal(
    etiquetaDePista({ name: null, instrument: 'Drums', difficulty: 5, tuning: null }),
    'Drums · dificultad 5'
  )
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `node --test test/tarjeta.test.js`
Expected: FAIL con `etiquetaDePista is not a function`.

- [ ] **Step 3: Implementar `etiquetaDePista`**

Al final de `public/tarjeta.js`:

```js
/* Como se nombra una pista en el selector.

   El nombre crudo del catalogo es lo mas util cuando existe ("Kirk Hammett |
   Gibson Flying V | Lead Guitar" dice mas que "Distortion Guitar"), pero el
   catalogo trae nombres vacios y en otros alfabetos. Sin nombre se cae al
   instrumento: una opcion en blanco no se puede elegir a proposito.

   La afinacion solo aparece cuando describeTuning devolvio algo -- estandar
   es null y no se dice, misma regla que la tarjeta ya usaba. */
export function etiquetaDePista(pista) {
  const nombre = pista.name?.trim() || pista.instrument
  return [nombre, `dificultad ${pista.difficulty}`, pista.tuning]
    .filter(Boolean)
    .join(' · ')
}
```

- [ ] **Step 4: Correr el test**

Run: `node --test test/tarjeta.test.js`
Expected: PASS.

- [ ] **Step 5: Dibujar el selector en `app.js`**

En `public/app.js`, agregar `etiquetaDePista` al import de `./tarjeta.js` (línea 4).

La tarjeta pasa a leer de la pista elegida. Donde hoy usa `song.difficulty`, `song.tuning`, `song.instrument`, `song.trackName` y `song.ampli`, pasa a usar `song.pistas[pistaElegida]` (la variable de la canción dentro de `pintarTarjeta` se llama `song`). Mantener una variable de módulo con la pista elegida del sorteo actual, que se reinicia en cada sorteo:

```js
/* Cual pista se esta mirando. Se reinicia en cada sorteo -- igual que el modo,
   la dificultad y las bandas, la eleccion no se recuerda entre sorteos ni
   entre recargas. */
let pistaElegida = 0
```

El bloque del selector, que se inserta arriba del bloque de dificultad (la variable `dificultad` de `public/app.js:61`). Sólo aparece con dos pistas o más:

```js
  const selectorPistas = song.pistas.length > 1 ? `
    <div class="pistas">
      <label for="pista">Pista</label>
      <select id="pista">
        ${song.pistas.map((p, i) => `
          <option value="${i}"${i === pistaElegida ? ' selected' : ''}${p.califica ? '' : ' class="no-califica"'}>
            ${esc(etiquetaDePista(p))}${p.califica ? '' : ' — fuera del filtro'}
          </option>
        `).join('')}
      </select>
    </div>
  ` : ''
```

`esc()` sobre la etiqueta no es opcional: `name` viene del catálogo y es texto de terceros.

Y el listener, que re-dibuja la tarjeta con la nueva pista:

```js
  $('#pista')?.addEventListener('change', e => {
    pistaElegida = Number(e.target.value)
    dibujarTarjeta(s)   // el mismo objeto: no se vuelve a pedir nada al servidor
  })
```

**Antes de eso hay que abrir una costura en `pintar()`.** Hoy `pintar({song, matching, hint})` (`public/app.js:32`) hace tres cosas juntas: escribe el contador `#calzan`, escribe `#hint`, y dibuja la tarjeta. El cambio de pista sólo quiere la tercera, y la Task 4 también. Partirla:

```js
/* Escribe lo que describe al FILTRO (el contador y el aviso) y delega la
   tarjeta. Separadas porque hay dos caminos que quieren dibujar la tarjeta sin
   tocar el contador: cambiar de pista (la cancion es la misma, el filtro no se
   movio) y el sorteo de todo (la cancion no salio de los controles). */
function pintar({ song, matching, hint }) {
  $('#hint').className = 'hint'
  $('#hint').textContent = hint ?? ''
  $('#calzan').textContent = matching === 1
    ? '1 canción calza con estos filtros'
    : `${matching.toLocaleString('es-CL')} canciones calzan con estos filtros`
  pintarTarjeta(song)
}

function pintarTarjeta(song) {
  actual = song
  // ...todo el cuerpo que hoy sigue al bloque de #calzan, sin cambios:
  // el guardia de `!song`, el habilitar/deshabilitar de los cuatro botones,
  // el corazon, y el innerHTML de #tarjeta.
}
```

El comentario del aviso rojo del ampli (`public/app.js:33-35`) se queda con el `$('#hint').className = 'hint'`, en `pintar`.

Con eso, el listener del selector:

```js
  $('#pista')?.addEventListener('change', e => {
    pistaElegida = Number(e.target.value)
    pintarTarjeta(actual)   // el mismo objeto: no se le pide nada al servidor
  })
```

- [ ] **Step 6: El botón del ampli usa la pista elegida**

En `enviar-ampli` (`public/app.js`, alrededor de la línea 460), donde hoy toma `sugerencia` de la canción, pasa a tomarla de `s.pistas[pistaElegida].ampli`. `despachador.js`, `ampli-usb.js` y `fender-protocolo.js` **no se tocan**: reciben exactamente la misma forma de objeto que antes.

- [ ] **Step 7: Estilo del selector**

En `public/style.css`, siguiendo las convenciones que ya tiene el archivo para `.dificultad` y las fichas de bandas:

```css
.pistas { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
.pistas select { flex: 1; min-width: 0; }
/* Las que no cumplen el filtro se muestran igual -- quien mira tiene que
   poder ver por que salio esta cancion y cual pista no fue el motivo. */
.pistas option.no-califica { opacity: .6; }
```

- [ ] **Step 8: Verificar a mano contra el servidor real**

`public/app.js` no tiene tests automatizados, por la decisión de diseño que el README documenta. La verificación es a mano:

```
npm start
```

En <http://localhost:3000>, comprobar:
1. Con modo Acústico y dificultad 1-2, sortear hasta que salga una canción con varias pistas. **La tarjeta abre en una pista acústica y fácil.**
2. El selector lista todas las pistas; las que no cumplen dicen "fuera del filtro".
3. Cambiar de pista actualiza dificultad, aviso de afinación y el bloque del ampli, **sin pedirle nada al servidor** (verificar en la pestaña Network del navegador: cero peticiones al cambiar).
4. Una canción de una sola pista no muestra selector.
5. Sortear de nuevo vuelve la selección a la pista por defecto.

- [ ] **Step 9: Commit**

```bash
git add public/tarjeta.js public/app.js public/style.css test/tarjeta.test.js
git commit -m "feat: elegir que pista de la cancion practicar

El selector lista todas las pistas de guitarra y re-dibuja dificultad,
afinacion y el bloque del ampli sin tocar la red -- el servidor ya mando el
tono de cada una. Las que no cumplen el filtro se muestran igual, marcadas:
quien mira tiene que poder ver por que salio esta cancion.

etiquetaDePista cae al instrumento cuando el catalogo no da nombre; una opcion
en blanco no se puede elegir a proposito.

El envio al ampli toma la cadena de la pista elegida. El transporte
(despachador, ampli-usb, fender-protocolo) no se toca: recibe la misma forma
de objeto que antes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: El sorteo de todo

**Files:**
- Modify: `server.js:30-47` (`/api/roll`), `public/index.html`, `public/app.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `roll()` de las tareas anteriores, sin cambios.
- Produces: `/api/roll?todo=1` ignora `mode`, `minDifficulty`, `maxDifficulty` y `artist`.

- [ ] **Step 1: Escribir el test que falla**

En `test/server.test.js`, usando el helper `conApp` que ya está en el archivo (`test/server.test.js:9`). No escribir otro: `conApp` levanta el servidor en un puerto efímero, lo cierra al terminar, y **ya siembra** la canción que este test necesita — Metallica "One", dificultad 4, `Distortion Guitar`.

```js
/* La cancion que conApp siembra es dificultad 4 y con distorsion, asi que un
   filtro de acustico 1-2 la deja fuera. Es exactamente el par que hace falta:
   una consulta que no devuelve nada, y la misma con todo=1 que si. */
test('/api/roll?todo=1 ignora los filtros que vengan en la query', () => conApp(async url => {
  const filtrado = await (await fetch(`${url}/api/roll?mode=acoustic&maxDifficulty=2`)).json()
  assert.equal(filtrado.song, null)
  assert.equal(filtrado.matching, 0)

  const todo = await (await fetch(`${url}/api/roll?mode=acoustic&maxDifficulty=2&todo=1`)).json()
  assert.equal(todo.song.title, 'One')
  assert.equal(todo.matching, 1)
}))
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `node --test test/server.test.js`
Expected: FAIL — `todo.song` es `null`, porque el parámetro todavía no existe y la query se filtra igual.

- [ ] **Step 3: Implementar el parámetro**

En `server.js`, dentro de `if (ruta === '/api/roll')`, antes del `return json(...)`:

```js
        /* El sorteo de todo: ignora modo, dificultad y bandas sin tocar los
           controles, para que al volver la configuracion siga donde se dejo.
           No es un modo nuevo en MODES: los modos son criterios de filtrado y
           este es su ausencia, que es exactamente lo que roll() hace con sus
           parametros por defecto. */
        if (url.searchParams.get('todo') === '1') return json(res, 200, roll(db, {}))
```

- [ ] **Step 4: Correr el test**

Run: `node --test test/server.test.js`
Expected: PASS.

- [ ] **Step 5: El botón en el front**

En `public/index.html`, junto al botón de sortear:

```html
<button id="todo" type="button">Sortear de todo</button>
```

En `public/app.js`, un listener que pide sin mandar los controles:

```js
/* Sortea ignorando los filtros SIN tocar los controles: los sliders, el modo y
   las fichas de bandas quedan donde estan para el proximo sorteo normal.

   Y NO pisa la linea de "cuantas calzan": esa linea describe lo que los
   controles prometen, y este sorteo no salio de los controles. Pisarla la
   dejaria describiendo un universo que la proxima vez que pulses Sortear ya no
   es el tuyo. */
$('#todo').addEventListener('click', async () => {
  try {
    const r = await api('/api/roll?todo=1')
    pistaElegida = 0
    pintarTarjeta(r.song)   // la costura abierta en la Task 3
  } catch (err) {
    $('#hint').className = 'hint mal'
    $('#hint').textContent = `Error: ${err.message}. ¿Sigue corriendo \`npm start\`?`
  }
})
```

`pintarTarjeta` en vez de `pintar` es lo que deja el contador quieto. Usa `api()` (`public/app.js:19`), no `fetch` pelado, para que el manejo de errores sea el mismo que el del resto de la app.

- [ ] **Step 6: Verificar a mano**

```
npm start
```

1. Poner modo Acústico, dificultad 1-2 y elegir una banda.
2. Pulsar **Sortear de todo**: sale una canción que puede no cumplir nada de eso.
3. **Los tres controles siguen exactamente donde los dejaste**, y el contador sigue describiéndolos.
4. Pulsar **Sortear** normal: vuelve a respetar los filtros.

- [ ] **Step 7: Commit**

```bash
git add server.js public/index.html public/app.js test/server.test.js
git commit -m "feat: sortear de todo sin perder los filtros puestos

Un boton que ignora modo, dificultad y bandas sin tocar los controles: al
volver, la configuracion sigue donde se dejo. Hoy habria que arrastrar los
sliders y volver a ponerlos.

No es un modo nuevo en MODES -- los modos son criterios de filtrado y este es
su ausencia, que es lo que roll() ya hace con sus parametros por defecto.

No pisa la linea de 'cuantas calzan': esa describe lo que los controles
prometen, y este sorteo no salio de los controles.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: El README

**Files:**
- Modify: `README.md` (la sección de filtros y la de envío al amplificador)

**Interfaces:**
- Consumes: el comportamiento ya implementado en las tareas 1-4.
- Produces: nada de código.

- [ ] **Step 1: Agregar la sección de pistas**

Después de la sección "Filtrar por bandas", agregar:

```markdown
## Elegir la pista

Casi ninguna canción tiene una sola guitarra. *Fade to Black* tiene seis pistas:
dos acústicas para el intro y cuatro con distorsión para lo que viene después.
La tarjeta te deja elegir cuál practicar, y cambia con ella la dificultad, el
aviso de afinación y los ajustes que se le mandan al amplificador — elegir la
acústica de Metallica te da un CHAMPION limpio, no el preset de banda a
ganancia alta.

**Los filtros miran todas las pistas.** Si pides dificultad 1-2, entra cualquier
canción que tenga *una* pista de guitarra a ese nivel, aunque la más tocada sea
más difícil. Eso suma 2.143 canciones al filtro fácil, 1.850 al modo Solos y
1.064 al Acústico, sobre las 9.734 sorteables. Antes *Fade to Black* no salía en
modo acústico: teniendo dos pistas acústicas, la app sólo miraba la más vista,
que es la distorsión.

Tres cosas que conviene saber:

- **La pista que viene elegida es la más vista de las que cumplen tu filtro**,
  no la más vista a secas. Si pides fácil, la tarjeta abre en una pista fácil.
- **Se listan todas las pistas, también las que no cumplen el filtro**, marcadas
  como tales. Así se ve por qué salió esta canción y cuál pista no fue el
  motivo. No hay corte por popularidad: con uno al 10%, *Fade to Black* perdería
  la guitarra rítmica de Hetfield.
- **Marcar la canción como aprendida la marca entera**, hayas tocado el intro o
  el riff. La cuenta es por canción, no por pista.

La elección **no se recuerda** entre sorteos ni entre recargas, igual que el
modo, la dificultad y las bandas.

## Sortear de todo

El botón **Sortear de todo** ignora el modo, la dificultad y las bandas por una
vez, **sin tocar los controles**: al volver, tu configuración sigue donde la
dejaste. El contador de "cuántas calzan" tampoco se mueve — sigue describiendo
lo que tus controles prometen, no el sorteo que acabas de hacer.
```

- [ ] **Step 2: Corregir la sección de envío al amplificador**

En la sección "Enviar los ajustes al amplificador", la frase de apertura dice que los ajustes son "de cada canción". Pasa a ser de cada pista:

```markdown
La tarjeta trae unos ajustes sugeridos para un **Fender Mustang LT25** — los de
la **pista que tengas elegida**, no los de la canción entera — y un botón que se
los manda al equipo por USB, sin intermediarios: el navegador le habla directo
por WebHID.
```

- [ ] **Step 3: Corregir la mención de la dificultad en la apertura**

La primera frase del README dice "con filtros de modo, dificultad y bandas". No es incorrecta, pero la dificultad cambió de significado. Ajustar el párrafo de apertura para que diga que el sorteo es por canción y la práctica por pista.

- [ ] **Step 4: Releer el README entero buscando afirmaciones vencidas**

Run: `grep -n "representativ\|track\|pista" README.md`

Cualquier frase que hable de "el track" en singular como si la canción tuviera uno solo queda vencida. Corregirla o borrarla.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: la seleccion de pista y el sorteo de todo en el README

Con los tres limites que un lector necesita: la pista que viene elegida es la
mas vista DE LAS QUE CUMPLEN el filtro, se listan todas incluidas las que no
cumplen, y la cuenta de aprendidas sigue siendo por cancion y no por pista.

Corrige ademas la seccion de envio al ampli, que describia los ajustes como de
la cancion cuando ahora son de la pista elegida.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cierre

Con las cinco tareas verdes:

```bash
npm test
```

Y después, la skill `superpowers:finishing-a-development-branch` para decidir cómo integrar `feat/pistas-por-cancion`.
