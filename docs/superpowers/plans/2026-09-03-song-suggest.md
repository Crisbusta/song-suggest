# song-suggest — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una web local que sortea canciones con guitarra interesante para aprender, filtradas por dificultad y tipo de guitarra, recordando qué ya se aprendió y qué se descartó.

**Architecture:** Tres piezas con una sola dirección de dependencia — un ETL que baja el catálogo de la API pública de Songsterr a un SQLite local, un servidor HTTP mínimo que consulta esa base, y un front vanilla sin build. Solo el ETL habla con la red; la app nunca lo hace.

**Tech Stack:** Node 25 y nada más. `node:sqlite`, `node:http` y `node:test` son built-in. Front en HTML/CSS/JS vanilla.

**Spec:** `docs/superpowers/specs/2026-09-03-song-suggest-design.md`

## Global Constraints

- **Node >= 24.** `node:sqlite` no es estable antes. Declarar en `package.json` → `engines.node: ">=24"`.
- **Cero dependencias npm.** No agregar `dependencies` ni `devDependencies` a `package.json` en ninguna tarea. Si una tarea parece necesitar un paquete, es señal de que el enfoque está mal.
- **ESM.** `package.json` lleva `"type": "module"`. Usar `import`, nunca `require`.
- **Tests con `node:test`**, corridos con `node --test test/*.test.js`. Aserciones con `node:assert/strict`. (Ojo: `node --test test/` con el directorio suelto **no funciona** en Node 25 — resuelve el directorio como módulo de entrada y revienta con `MODULE_NOT_FOUND`. El glob explícito sí funciona.)
- **Ningún test toca la red.** El ETL se prueba contra fixtures y contra servidores locales levantados con `node:http`.
- **Idioma.** Texto de interfaz, mensajes de consola, comentarios y nombres de tests, en español. En el código: la **API pública en inglés** — todo lo exportado (`openDb`, `parseCatalogPage`, `parseMeta`, `fetchCatalog`, `enrichPending`, `fetchJson`, `runPool`, `describeTuning`, `roll`, `mark`, `getList`, `getStats`, `createApp`, `MODES`, `LISTS`), los nombres de tabla y columna, y los nombres de archivo. Las variables locales y los helpers privados de un módulo **pueden ir en español**, y de hecho el plan los escribe así (`hidratar`, `contar`, `asegurarFila`, `obreros`, `ultimoError`). No es descuido: es la convención del proyecto, y no debe reportarse como defecto.
- **`song_state` no tiene foreign key hacia `songs`, y el ETL nunca la escribe.** Es invariante del diseño: permite rebajar el catálogo sin perder historial.
- **Un commit por tarea**, al final, con los tests pasando.

---

### Task 1: Esqueleto del proyecto y esquema de la base

**Files:**
- Create: `package.json`
- Create: `db/schema.sql`
- Create: `db/open.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `openDb(path)` → `DatabaseSync` con el esquema ya aplicado. Exportado desde `db/open.js`.

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "song-suggest",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test test/*.test.js",
    "etl": "node etl/index.js",
    "start": "node server.js"
  }
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `test/db.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'

test('crea las cuatro tablas', () => {
  const db = openDb(':memory:')
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name)
  for (const t of ['songs', 'song_state', 'tags', 'tracks']) {
    assert.ok(names.includes(t), `falta la tabla ${t}`)
  }
})

test('borrar el catalogo no borra el historial', () => {
  const db = openDb(':memory:')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (?, ?, ?, ?)'
  ).run(1, 10, 'Metallica', 'One')
  db.prepare(
    "INSERT INTO song_state (song_id, status, updated_at) VALUES (?, 'skipped', '2026-09-03')"
  ).run(1)

  db.exec('DELETE FROM songs')

  const state = db.prepare('SELECT status FROM song_state WHERE song_id = 1').get()
  assert.equal(state.status, 'skipped')
})

test('borrar una cancion si borra sus tracks y tags', () => {
  const db = openDb(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (1, 10, ?, ?)'
  ).run('Metallica', 'One')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument) VALUES (1, 0, ?)'
  ).run('Distortion Guitar')
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (1, 'metal')").run()

  db.exec('DELETE FROM songs WHERE song_id = 1')

  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 0)
})

test('rechaza un status invalido', () => {
  const db = openDb(':memory:')
  assert.throws(() => {
    db.prepare(
      "INSERT INTO song_state (song_id, status, updated_at) VALUES (1, 'inventado', '2026-09-03')"
    ).run()
  })
})
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `node --test test/db.test.js`
Expected: FAIL — `Cannot find module '../db/open.js'`

- [ ] **Step 4: Escribir `db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS songs (
  song_id      INTEGER PRIMARY KEY,
  artist_id    INTEGER NOT NULL,
  artist       TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  views        INTEGER,
  catalog_rank INTEGER,
  fingerstyle  INTEGER NOT NULL DEFAULT 0,
  has_chords   INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  is_junk      INTEGER NOT NULL DEFAULT 0,
  is_blank     INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  videos       TEXT,
  enriched_at  TEXT
);

CREATE TABLE IF NOT EXISTS tracks (
  song_id       INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  track_index   INTEGER NOT NULL,
  instrument_id INTEGER,
  instrument    TEXT    NOT NULL,
  name          TEXT,
  difficulty    INTEGER,
  views         INTEGER,
  tuning        TEXT,
  PRIMARY KEY (song_id, track_index)
);

CREATE TABLE IF NOT EXISTS tags (
  song_id INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (song_id, tag)
);

-- Sin foreign key hacia songs, a proposito: el catalogo se puede rebajar
-- entero sin perder el historial. El ETL nunca escribe esta tabla.
CREATE TABLE IF NOT EXISTS song_state (
  song_id     INTEGER PRIMARY KEY,
  status      TEXT CHECK (status IN ('learned','skipped','queued')),
  liked       INTEGER NOT NULL DEFAULT 0,
  shown_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_song ON tracks(song_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag    ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_songs_todo  ON songs(enriched_at) WHERE enriched_at IS NULL;
```

- [ ] **Step 5: Escribir `db/open.js`**

```js
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')

export function openDb(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
```

- [ ] **Step 6: Correr los tests**

Run: `node --test test/db.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json db/schema.sql db/open.js test/db.test.js
git commit -m "feat: esquema de la base y apertura de conexion"
```

---

### Task 2: Fixtures reales y parser del catálogo

**Files:**
- Create: `etl/fixtures/catalog-page.json` (descargado)
- Create: `etl/fixtures/meta-455118.json` (descargado)
- Create: `etl/parse.js`
- Test: `test/parse.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `parseCatalogPage(json, fromOffset)` → `{ songs: [...], tracks: [...] }` desde `etl/parse.js`.
  - `songs[i]` = `{ songId, artistId, artist, title, hasChords, catalogRank }`
  - `tracks[i]` = `{ songId, trackIndex, instrumentId, instrument, name, difficulty, views, tuning }` donde `tuning` es un **string JSON**, y `difficulty` es `null` si el track no la trae.

- [ ] **Step 1: Bajar los fixtures**

Esto es lo único de toda la implementación que toca la red. Correr una vez:

```bash
mkdir -p etl/fixtures
curl -s -H "User-Agent: Mozilla/5.0" \
  "https://www.songsterr.com/api/songs?pattern=&size=200" \
  -o etl/fixtures/catalog-page.json
curl -s -H "User-Agent: Mozilla/5.0" \
  "https://www.songsterr.com/api/meta/455118" \
  -o etl/fixtures/meta-455118.json
node -e "const a=require('./etl/fixtures/catalog-page.json'); console.log(a.length,'canciones')"
```

Esperado: `200 canciones`. Si baja menos, la API cambió — parar y avisar antes de seguir.

- [ ] **Step 2: Escribir el test que falla**

Crear `test/parse.test.js`:

```js
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
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `node --test test/parse.test.js`
Expected: FAIL — `Cannot find module '../etl/parse.js'`

- [ ] **Step 4: Escribir `etl/parse.js`**

```js
export function parseCatalogPage(page, fromOffset) {
  const songs = []
  const tracks = []

  page.forEach((raw, i) => {
    songs.push({
      songId: raw.songId,
      artistId: raw.artistId ?? 0,
      artist: raw.artist ?? '',
      title: raw.title ?? '',
      hasChords: raw.hasChords ? 1 : 0,
      catalogRank: fromOffset + i,
    })

    ;(raw.tracks ?? []).forEach((t, trackIndex) => {
      tracks.push({
        songId: raw.songId,
        trackIndex,
        instrumentId: t.instrumentId ?? null,
        instrument: t.instrument ?? 'Unknown',
        name: t.name ?? null,
        difficulty: Number.isInteger(t.difficulty) ? t.difficulty : null,
        views: t.views ?? null,
        tuning: Array.isArray(t.tuning) ? JSON.stringify(t.tuning) : null,
      })
    })
  })

  return { songs, tracks }
}
```

- [ ] **Step 5: Correr los tests**

Run: `node --test test/parse.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add etl/fixtures etl/parse.js test/parse.test.js
git commit -m "feat: parser del catalogo de Songsterr con fixtures reales"
```

---

### Task 3: Parser del enriquecimiento

**Files:**
- Modify: `etl/parse.js`
- Modify: `test/parse.test.js`

**Interfaces:**
- Consumes: `etl/fixtures/meta-455118.json` de la Task 2.
- Produces: `parseMeta(json)` → `{ songId, views, fingerstyle, hasChords, aiGenerated, isJunk, isBlank, isPublished, tags: string[], videos: string }`. `videos` es un **string JSON** con `[{videoId, feature}]`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/parse.test.js`:

```js
import { parseMeta } from '../etl/parse.js'

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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/parse.test.js`
Expected: FAIL — `parseMeta is not a function` (o error de import).

- [ ] **Step 3: Agregar `parseMeta` a `etl/parse.js`**

```js
const flag = (v, porDefecto = 0) => (v === undefined || v === null ? porDefecto : v ? 1 : 0)

export function parseMeta(meta) {
  return {
    songId: meta.songId,
    views: meta.views ?? null,
    fingerstyle: flag(meta.fingerstyle),
    hasChords: flag(meta.hasChords),
    aiGenerated: flag(meta.aiGenerated),
    isJunk: flag(meta.isJunk),
    isBlank: flag(meta.isBlank),
    isPublished: flag(meta.isPublished, 1),
    tags: Array.isArray(meta.tags) ? meta.tags.filter(t => typeof t === 'string') : [],
    videos: JSON.stringify(
      (Array.isArray(meta.videos) ? meta.videos : [])
        .filter(v => v && v.videoId)
        .map(v => ({ videoId: v.videoId, feature: v.feature ?? null }))
    ),
  }
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/parse.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add etl/parse.js test/parse.test.js
git commit -m "feat: parser del endpoint meta"
```

---

### Task 4: Track representativo de guitarra

**Files:**
- Modify: `db/schema.sql`
- Test: `test/representative.test.js`

**Interfaces:**
- Consumes: `openDb` de la Task 1.
- Produces: dos vistas SQL, `guitar_tracks` y `representative_track`. La segunda devuelve **exactamente una fila por canción** con columnas `song_id, track_index, instrument, name, difficulty, views, tuning`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/representative.test.js`. El fixture inline viene de los datos reales de "Master of Puppets", que tiene cuatro tracks de guitarra:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'

// Tracks reales de Master of Puppets (songId 455118).
const TRACKS = [
  [0, 'Baritone Sax',             'James Hetfield | Lead Vocals',  null, 1206],
  [1, 'Distortion Guitar',        'Kirk Hammett | Lead Guitar',       4, 106543],
  [2, 'Distortion Guitar',        'James Hetfield | Delay',           7, 1525],
  [3, 'Electric Guitar (clean)',  'James & Kirk | Clean Guitar',      2, 21291],
  [4, 'Distortion Guitar',        'Kirk & James | Extra Guitars',     3, 3281],
  [5, 'Electric Bass (finger)',   'Cliff Burton | Bass',              6, 318294],
]

function conMasterOfPuppets() {
  const db = openDb(':memory:')
  db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title) VALUES (455118, 20, ?, ?)'
  ).run('Metallica', 'Master of Puppets')
  const ins = db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (455118, ?, ?, ?, ?, ?)'
  )
  for (const t of TRACKS) ins.run(...t)
  return db
}

test('elige el track de guitarra mas tocado, ignorando el bajo', () => {
  const db = conMasterOfPuppets()
  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 455118').get()
  assert.equal(r.name, 'Kirk Hammett | Lead Guitar')
  assert.equal(r.difficulty, 4)
  assert.equal(r.instrument, 'Distortion Guitar')
})

test('devuelve exactamente una fila por cancion', () => {
  const db = conMasterOfPuppets()
  const { c } = db.prepare('SELECT COUNT(*) c FROM representative_track').get()
  assert.equal(c, 1)
})

test('ignora tracks de guitarra sin dificultad', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (1, 1, ?, ?)')
    .run('X', 'Y')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (1, 0, ?, ?, NULL, 99999)'
  ).run('Distortion Guitar', 'Sin dificultad')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (1, 1, ?, ?, 3, 10)'
  ).run('Distortion Guitar', 'Con dificultad')

  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 1').get()
  assert.equal(r.name, 'Con dificultad')
})

test('una cancion sin guitarra no aparece', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (2, 1, ?, ?)')
    .run('X', 'Solo bajo')
  db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, difficulty, views) VALUES (2, 0, ?, 5, 100)'
  ).run('Electric Bass (finger)')

  assert.equal(db.prepare('SELECT * FROM representative_track WHERE song_id = 2').get(), undefined)
})

test('desempata por track_index para ser determinista', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO songs (song_id, artist_id, artist, title) VALUES (3, 1, ?, ?)')
    .run('X', 'Empate')
  const ins = db.prepare(
    'INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views) VALUES (3, ?, ?, ?, ?, 500)'
  )
  ins.run(1, 'Distortion Guitar', 'segundo', 6)
  ins.run(0, 'Distortion Guitar', 'primero', 2)

  const r = db.prepare('SELECT * FROM representative_track WHERE song_id = 3').get()
  assert.equal(r.name, 'primero')
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/representative.test.js`
Expected: FAIL — `no such table: representative_track`

- [ ] **Step 3: Agregar las vistas al final de `db/schema.sql`**

```sql
CREATE VIEW IF NOT EXISTS guitar_tracks AS
SELECT * FROM tracks
WHERE difficulty IS NOT NULL
  AND instrument IN (
    'Distortion Guitar', 'Overdriven Guitar',
    'Electric Guitar (clean)', 'Electric Guitar (jazz)', 'Electric Guitar (muted)',
    'Acoustic Guitar (steel)', 'Acoustic Guitar (nylon)', 'Guitar Harmonics'
  );

-- Una fila por cancion: el track de guitarra mas tocado, que es el que la
-- gente efectivamente aprende. Desempate por track_index para ser determinista.
CREATE VIEW IF NOT EXISTS representative_track AS
SELECT song_id, track_index, instrument, name, difficulty, views, tuning
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY song_id ORDER BY views DESC, track_index ASC
  ) AS rn
  FROM guitar_tracks
)
WHERE rn = 1;
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/representative.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql test/representative.test.js
git commit -m "feat: vista del track representativo de guitarra"
```

---

### Task 5: Cliente HTTP con reintentos y concurrencia

**Files:**
- Create: `etl/http.js`
- Test: `test/http.test.js`

**Interfaces:**
- Consumes: nada.
- Produces, desde `etl/http.js`:
  - `fetchJson(url, { retries = 3, baseDelayMs = 500, sleep = defaultSleep })` → objeto parseado. Lanza `Error` si se agotan los reintentos.
  - `runPool(items, concurrency, worker)` → `Promise<void>`. `worker(item, index)` se llama por cada elemento, con a lo más `concurrency` en vuelo.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/http.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fetchJson, runPool } from '../etl/http.js'

// Levanta un servidor local cuyo comportamiento define `handler`.
async function conServidor(handler, fn) {
  const server = createServer(handler)
  await new Promise(r => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  try { return await fn(url) } finally { server.close() }
}

const sinEspera = () => Promise.resolve()

test('devuelve el JSON cuando responde bien', async () => {
  const r = await conServidor(
    (req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') },
    url => fetchJson(url, { sleep: sinEspera })
  )
  assert.deepEqual(r, { ok: true })
})

test('reintenta ante un 500 y termina saliendo bien', async () => {
  let intentos = 0
  const r = await conServidor(
    (req, res) => {
      intentos++
      if (intentos < 3) { res.statusCode = 500; return res.end('boom') }
      res.end('{"ok":true}')
    },
    url => fetchJson(url, { sleep: sinEspera })
  )
  assert.deepEqual(r, { ok: true })
  assert.equal(intentos, 3)
})

test('ante 429 espera mas que ante un 500', async () => {
  const esperas = []
  const sleep = ms => { esperas.push(ms); return Promise.resolve() }
  await conServidor(
    (req, res) => { res.statusCode = 429; res.end('slow down') },
    url => fetchJson(url, { retries: 2, baseDelayMs: 100, sleep }).catch(() => {})
  )
  assert.ok(esperas.length > 0, 'deberia haber esperado')
  assert.ok(esperas[0] >= 400, `un 429 debe esperar harto, espero ${esperas[0]}ms`)
})

test('el backoff crece entre intentos', async () => {
  const esperas = []
  const sleep = ms => { esperas.push(ms); return Promise.resolve() }
  await conServidor(
    (req, res) => { res.statusCode = 500; res.end('boom') },
    url => fetchJson(url, { retries: 3, baseDelayMs: 100, sleep }).catch(() => {})
  )
  assert.equal(esperas.length, 2)
  assert.ok(esperas[1] > esperas[0], 'la segunda espera debe ser mayor')
})

test('lanza error cuando se agotan los reintentos', async () => {
  await conServidor(
    (req, res) => { res.statusCode = 500; res.end('boom') },
    async url => {
      await assert.rejects(
        () => fetchJson(url, { retries: 2, sleep: sinEspera }),
        /500/
      )
    }
  )
})

test('un 404 no se reintenta', async () => {
  let intentos = 0
  await conServidor(
    (req, res) => { intentos++; res.statusCode = 404; res.end('nope') },
    async url => { await assert.rejects(() => fetchJson(url, { sleep: sinEspera })) }
  )
  assert.equal(intentos, 1)
})

test('runPool respeta el limite de concurrencia', async () => {
  let enVuelo = 0
  let maximo = 0
  await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    enVuelo++
    maximo = Math.max(maximo, enVuelo)
    await new Promise(r => setTimeout(r, 5))
    enVuelo--
  })
  assert.ok(maximo <= 3, `llego a ${maximo} en vuelo`)
  assert.ok(maximo > 1, 'deberia haber paralelismo real')
})

test('runPool procesa todos los elementos', async () => {
  const vistos = []
  await runPool(['a', 'b', 'c'], 2, async x => { vistos.push(x) })
  assert.deepEqual(vistos.sort(), ['a', 'b', 'c'])
})

test('runPool no deja obreros corriendo despues de retornar', async () => {
  const vistos = []
  await assert.rejects(() => runPool([1, 2, 3, 4, 5, 6], 2, async x => {
    if (x === 3) throw new Error('boom')
    await new Promise(r => setTimeout(r, 5))
    vistos.push(x)
  }), /boom/)

  const alRetornar = [...vistos]
  await new Promise(r => setTimeout(r, 60))
  assert.deepEqual(vistos, alRetornar, 'siguio procesando despues de que el await ya lanzo')
})

test('runPool termina los items restantes aunque uno falle', async () => {
  const vistos = []
  await assert.rejects(() => runPool([1, 2, 3, 4], 2, async x => {
    if (x === 2) throw new Error('boom')
    vistos.push(x)
  }))
  assert.deepEqual(vistos.sort(), [1, 3, 4])
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/http.test.js`
Expected: FAIL — `Cannot find module '../etl/http.js'`

- [ ] **Step 3: Escribir `etl/http.js`**

```js
const defaultSleep = ms => new Promise(r => setTimeout(r, ms))

const UA = 'song-suggest/1.0 (proyecto personal)'

export async function fetchJson(url, opts = {}) {
  const { retries = 3, baseDelayMs = 500, sleep = defaultSleep } = opts
  let ultimoError

  for (let intento = 0; intento < retries; intento++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })

      // 4xx que no sea 429 es culpa nuestra: reintentar no ayuda.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} en ${url}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)

      return await res.json()
    } catch (err) {
      ultimoError = err
      if (/HTTP 4(?!29)\d\d/.test(err.message)) throw err
      if (intento === retries - 1) break

      // Ante 429 bajamos el ritmo mucho mas que ante un error transitorio.
      const esRateLimit = err.message.includes('429')
      const factor = esRateLimit ? 8 : 1
      await sleep(baseDelayMs * factor * Math.pow(2, intento))
    }
  }

  throw ultimoError
}

export async function runPool(items, concurrency, worker) {
  let siguiente = 0
  const obreros = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      await worker(items[i], i)
    }
  })

  // allSettled y no all: con `all`, el primer worker que lanza hace que este
  // await retorne de inmediato mientras los otros obreros siguen corriendo en
  // segundo plano, mutando estado despues de que el llamador ya creyo haber
  // terminado. Drenamos todos los obreros y recien ahi propagamos el error.
  //
  // CONTRATO: runPool propaga el primer error del worker. Quien necesite
  // tolerar fallos por item -- como enrichPending, que debe seguir pese a que
  // una cancion falle -- captura dentro del propio worker.
  const resultados = await Promise.allSettled(obreros)
  const fallo = resultados.find(r => r.status === 'rejected')
  if (fallo) throw fallo.reason
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/http.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add etl/http.js test/http.test.js
git commit -m "feat: cliente HTTP con backoff y pool de concurrencia"
```

---

### Task 6: ETL fase 1 — catálogo

**Files:**
- Create: `etl/catalog.js`
- Test: `test/catalog.test.js`

**Interfaces:**
- Consumes: `parseCatalogPage` (Task 2), `openDb` (Task 1).
- Produces: `fetchCatalog(db, { fetchPage, pageSize = 200, maxFrom = 9800, onProgress })` → `Promise<{ pages, songs }>`.
  `fetchPage(from, size)` → `Promise<Array>` es inyectable; en producción envuelve `fetchJson`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/catalog.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { fetchCatalog } from '../etl/catalog.js'

// Genera un catalogo falso de `total` canciones, paginado.
function catalogoFalso(total) {
  return (from, size) =>
    Promise.resolve(
      Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => ({
        songId: from + i + 1,
        artistId: 7,
        artist: `Artista ${from + i}`,
        title: `Cancion ${from + i}`,
        hasChords: true,
        tracks: [{ instrumentId: 30, instrument: 'Distortion Guitar', views: 100, difficulty: 3, tuning: [64, 59, 55, 50, 45, 40], name: 'Lead Guitar' }],
      }))
    )
}

test('guarda todas las canciones y sus tracks', async () => {
  const db = openDb(':memory:')
  const r = await fetchCatalog(db, { fetchPage: catalogoFalso(450), pageSize: 200 })

  assert.equal(r.songs, 450)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 450)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 450)
})

test('corta apenas llega una pagina incompleta', async () => {
  const db = openDb(':memory:')
  let llamadas = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => { llamadas++; return catalogoFalso(300)(from, size) },
    pageSize: 200,
  })
  // 200 llenas + 100: la pagina corta ya dice que no hay mas, no se pide otra.
  assert.equal(llamadas, 2)
})

test('para cuando una pagina viene vacia', async () => {
  const db = openDb(':memory:')
  let llamadas = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => { llamadas++; return catalogoFalso(400)(from, size) },
    pageSize: 200,
  })
  // 200 + 200 justas, asi que hace falta una tercera pagina vacia para saber que se acabo.
  assert.equal(llamadas, 3)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 400)
})

test('no pasa del tope de paginacion de la API', async () => {
  const db = openDb(':memory:')
  let maxFromVisto = 0
  await fetchCatalog(db, {
    fetchPage: (from, size) => {
      maxFromVisto = Math.max(maxFromVisto, from)
      return catalogoFalso(100000)(from, size)
    },
    pageSize: 200,
    maxFrom: 800,
  })
  assert.ok(maxFromVisto <= 800, `pidio from=${maxFromVisto}, sobre el tope`)
})

test('asigna catalog_rank segun la posicion global', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(300), pageSize: 200 })

  const primera = db.prepare('SELECT catalog_rank FROM songs ORDER BY song_id LIMIT 1').get()
  const ultima = db.prepare('SELECT catalog_rank FROM songs ORDER BY song_id DESC LIMIT 1').get()
  assert.equal(primera.catalog_rank, 0)
  assert.equal(ultima.catalog_rank, 299)
})

test('re-correr el ETL no duplica ni pierde el historial', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(200), pageSize: 200 })
  db.prepare(
    "INSERT INTO song_state (song_id, status, updated_at) VALUES (1, 'learned', '2026-09-03')"
  ).run()

  await fetchCatalog(db, { fetchPage: catalogoFalso(200), pageSize: 200 })

  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs').get().c, 200)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tracks').get().c, 200)
  assert.equal(db.prepare('SELECT status FROM song_state WHERE song_id = 1').get().status, 'learned')
})

test('no borra enriched_at de una cancion ya enriquecida', async () => {
  const db = openDb(':memory:')
  await fetchCatalog(db, { fetchPage: catalogoFalso(1), pageSize: 200 })
  db.prepare("UPDATE songs SET enriched_at = '2026-09-01' WHERE song_id = 1").run()

  await fetchCatalog(db, { fetchPage: catalogoFalso(1), pageSize: 200 })

  assert.equal(db.prepare('SELECT enriched_at FROM songs WHERE song_id = 1').get().enriched_at, '2026-09-01')
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/catalog.test.js`
Expected: FAIL — `Cannot find module '../etl/catalog.js'`

- [ ] **Step 3: Escribir `etl/catalog.js`**

```js
import { parseCatalogPage } from './parse.js'

export async function fetchCatalog(db, opts) {
  const { fetchPage, pageSize = 200, maxFrom = 9800, onProgress } = opts

  const upsertSong = db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, has_chords, catalog_rank)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_id) DO UPDATE SET
      artist = excluded.artist,
      title = excluded.title,
      has_chords = excluded.has_chords,
      catalog_rank = excluded.catalog_rank
  `)
  const borrarTracks = db.prepare('DELETE FROM tracks WHERE song_id = ?')
  const insertTrack = db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument_id, instrument, name, difficulty, views, tuning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let paginas = 0
  let total = 0

  for (let from = 0; from <= maxFrom; from += pageSize) {
    const page = await fetchPage(from, pageSize)
    if (!Array.isArray(page) || page.length === 0) break

    const { songs, tracks } = parseCatalogPage(page, from)

    // Un lote por pagina: un Ctrl-C nunca deja la base a medias.
    db.exec('BEGIN')
    try {
      for (const s of songs) {
        upsertSong.run(s.songId, s.artistId, s.artist, s.title, s.hasChords, s.catalogRank)
        borrarTracks.run(s.songId)
      }
      for (const t of tracks) {
        insertTrack.run(t.songId, t.trackIndex, t.instrumentId, t.instrument, t.name, t.difficulty, t.views, t.tuning)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    paginas++
    total += songs.length
    // Las claves del callback van en ingles y espejan el valor de retorno:
    // es superficie publica que consume el CLI de la Task 8.
    onProgress?.({ pages: paginas, songs: total, from })

    if (page.length < pageSize) break
  }

  return { pages: paginas, songs: total }
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/catalog.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add etl/catalog.js test/catalog.test.js
git commit -m "feat: fase 1 del ETL, paginacion del catalogo"
```

---

### Task 7: ETL fase 2 — enriquecimiento reanudable

**Files:**
- Create: `etl/meta.js`
- Test: `test/meta.test.js`

**Interfaces:**
- Consumes: `parseMeta` (Task 3), `runPool` (Task 5).
- Produces: `enrichPending(db, { fetchMeta, concurrency = 3, limit = Infinity, onProgress })` → `Promise<{ ok, failed, failures: number[] }>`.
  `fetchMeta(songId)` → `Promise<object>`, inyectable.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/meta.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { enrichPending } from '../etl/meta.js'

function conCatalogo(n) {
  const db = openDb(':memory:')
  const ins = db.prepare(
    'INSERT INTO songs (song_id, artist_id, artist, title, catalog_rank) VALUES (?, 1, ?, ?, ?)'
  )
  for (let i = 0; i < n; i++) ins.run(i + 1, `A${i}`, `T${i}`, i)
  return db
}

const metaFalsa = songId => Promise.resolve({
  songId, views: 1000 + songId, fingerstyle: songId % 2 === 0,
  hasChords: true, aiGenerated: false, isJunk: false, isBlank: false, isPublished: true,
  tags: ['rock', 'metal'],
  videos: [{ id: 1, status: 'done', feature: 'backing', videoId: 'abc123' }],
})

test('enriquece las canciones pendientes', async () => {
  const db = conCatalogo(5)
  const r = await enrichPending(db, { fetchMeta: metaFalsa })

  assert.equal(r.ok, 5)
  assert.equal(r.failed, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM songs WHERE enriched_at IS NOT NULL').get().c, 5)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags').get().c, 10)

  const s = db.prepare('SELECT * FROM songs WHERE song_id = 2').get()
  assert.equal(s.views, 1002)
  assert.equal(s.fingerstyle, 1)
  assert.deepEqual(JSON.parse(s.videos), [{ videoId: 'abc123', feature: 'backing' }])
})

test('es reanudable: no re-pide lo ya enriquecido', async () => {
  const db = conCatalogo(5)
  await enrichPending(db, { fetchMeta: metaFalsa })

  const pedidos = []
  const r = await enrichPending(db, {
    fetchMeta: id => { pedidos.push(id); return metaFalsa(id) },
  })
  assert.deepEqual(pedidos, [])
  assert.equal(r.ok, 0)
})

test('procesa en orden de popularidad', async () => {
  const db = conCatalogo(5)
  const pedidos = []
  await enrichPending(db, {
    fetchMeta: id => { pedidos.push(id); return metaFalsa(id) },
    concurrency: 1,
    limit: 3,
  })
  assert.deepEqual(pedidos, [1, 2, 3])
})

test('una cancion que falla no detiene el resto', async () => {
  const db = conCatalogo(5)
  const r = await enrichPending(db, {
    fetchMeta: id => (id === 3 ? Promise.reject(new Error('HTTP 500')) : metaFalsa(id)),
  })

  assert.equal(r.ok, 4)
  assert.equal(r.failed, 1)
  assert.deepEqual(r.failures, [3])
  assert.equal(db.prepare('SELECT enriched_at FROM songs WHERE song_id = 3').get().enriched_at, null)
})

test('re-enriquecer reemplaza los tags viejos en vez de acumularlos', async () => {
  const db = conCatalogo(1)
  await enrichPending(db, { fetchMeta: metaFalsa })
  db.prepare('UPDATE songs SET enriched_at = NULL').run()
  await enrichPending(db, { fetchMeta: metaFalsa })

  assert.equal(db.prepare('SELECT COUNT(*) c FROM tags WHERE song_id = 1').get().c, 2)
})

test('respeta el limite', async () => {
  const db = conCatalogo(10)
  const r = await enrichPending(db, { fetchMeta: metaFalsa, limit: 4 })
  assert.equal(r.ok, 4)
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/meta.test.js`
Expected: FAIL — `Cannot find module '../etl/meta.js'`

- [ ] **Step 3: Escribir `etl/meta.js`**

```js
import { parseMeta } from './parse.js'
import { runPool } from './http.js'

export async function enrichPending(db, opts) {
  const { fetchMeta, concurrency = 3, limit = Infinity, onProgress } = opts

  const pendientes = db.prepare(`
    SELECT song_id FROM songs
    WHERE enriched_at IS NULL
    ORDER BY catalog_rank ASC
    LIMIT ?
  `).all(Number.isFinite(limit) ? limit : -1).map(r => r.song_id)

  const actualizar = db.prepare(`
    UPDATE songs SET
      views = ?, fingerstyle = ?, has_chords = ?, ai_generated = ?,
      is_junk = ?, is_blank = ?, is_published = ?, videos = ?, enriched_at = ?
    WHERE song_id = ?
  `)
  const borrarTags = db.prepare('DELETE FROM tags WHERE song_id = ?')
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (song_id, tag) VALUES (?, ?)')

  const failures = []
  let ok = 0

  await runPool(pendientes, concurrency, async songId => {
    let m
    try {
      m = parseMeta(await fetchMeta(songId))
    } catch {
      // Una que falla se anota y seguimos: no abortamos 10.000 por una.
      failures.push(songId)
      onProgress?.({ ok, failed: failures.length, total: pendientes.length })
      return
    }

    db.exec('BEGIN')
    try {
      actualizar.run(
        m.views, m.fingerstyle, m.hasChords, m.aiGenerated,
        m.isJunk, m.isBlank, m.isPublished, m.videos,
        new Date().toISOString(), songId
      )
      borrarTags.run(songId)
      for (const tag of m.tags) insertTag.run(songId, tag)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      failures.push(songId)
      return
    }

    ok++
    onProgress?.({ ok, failed: failures.length, total: pendientes.length })
  })

  return { ok, failed: failures.length, failures: failures.sort((a, b) => a - b) }
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/meta.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add etl/meta.js test/meta.test.js
git commit -m "feat: fase 2 del ETL, enriquecimiento reanudable"
```

---

### Task 8: CLI del ETL

**Files:**
- Create: `etl/index.js`

**Interfaces:**
- Consumes: `fetchCatalog` (Task 6), `enrichPending` (Task 7), `fetchJson` (Task 5), `openDb` (Task 1).
- Produces: el comando `npm run etl`. No exporta nada.

- [ ] **Step 1: Escribir `etl/index.js`**

```js
import { openDb } from '../db/open.js'
import { fetchJson } from './http.js'
import { fetchCatalog } from './catalog.js'
import { enrichPending } from './meta.js'

const BASE = 'https://www.songsterr.com/api'

const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const valor = (n, porDefecto) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : porDefecto
}

const db = openDb('songs.db')

if (!flag('solo-meta')) {
  console.log('Fase 1: bajando el catalogo...')
  const r = await fetchCatalog(db, {
    fetchPage: (from, size) => fetchJson(`${BASE}/songs?pattern=&size=${size}&from=${from}`),
    onProgress: p => process.stdout.write(`\r  ${p.songs} canciones (${p.pages} paginas)`),
  })
  console.log(`\n  Listo: ${r.songs} canciones.`)
}

if (!flag('solo-catalogo')) {
  const pendientes = db.prepare('SELECT COUNT(*) c FROM songs WHERE enriched_at IS NULL').get().c
  const limite = valor('limit', Infinity)
  console.log(`Fase 2: enriqueciendo (${pendientes} pendientes). Ctrl-C es seguro, se retoma.`)

  const r = await enrichPending(db, {
    fetchMeta: songId => fetchJson(`${BASE}/meta/${songId}`),
    concurrency: valor('concurrency', 3),
    limit: limite,
    onProgress: p => process.stdout.write(`\r  ${p.ok}/${p.total} ok, ${p.failed} fallidas`),
  })
  console.log(`\n  Listo: ${r.ok} enriquecidas, ${r.failed} fallidas.`)
  if (r.failed > 0) console.log(`  IDs fallidos: ${r.failures.slice(0, 20).join(', ')}`)
}

const stats = db.prepare(`
  SELECT COUNT(*) total, SUM(enriched_at IS NOT NULL) enriched FROM songs
`).get()
console.log(`\nBase: ${stats.enriched}/${stats.total} canciones listas para sortear.`)
```

- [ ] **Step 2: Verificar a mano con un lote chico**

Run: `node etl/index.js --limit 25`

Expected: baja el catálogo (~50 páginas), enriquece 25 canciones y termina con algo como
`Base: 25/10000 canciones listas para sortear.` Debe existir `songs.db`.

Si aparecen muchos `429`, bajar la concurrencia: `node etl/index.js --solo-meta --limit 25 --concurrency 1`. Anotar el resultado — es el dato que la spec dejó marcado como no verificado.

- [ ] **Step 3: Verificar que es reanudable**

Run: `node etl/index.js --solo-meta --limit 25`
Expected: enriquece 25 **nuevas**, no las mismas. `enriched` sube a 50.

- [ ] **Step 4: Commit**

```bash
git add etl/index.js
git commit -m "feat: CLI del ETL"
```

---

### Task 9: Descripción de la afinación

**Files:**
- Create: `lib/tuning.js`
- Test: `test/tuning.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `describeTuning(notas)` → `string | null` desde `lib/tuning.js`. `notas` es un arreglo de enteros MIDI **de la cuerda más aguda a la más grave**, que es el orden en que los entrega Songsterr (`[64,59,55,50,45,40]` es Mi estándar), o `null`. Devuelve `null` cuando es Mi estándar — o sea, cuando no hay nada que avisar. El último elemento es la sexta cuerda, que es lo que mira la detección de afinaciones Drop.

**Nota de diseño:** la spec listaba este código dentro de `public/`. Va en `lib/` porque lo usa el servidor, no el navegador — el front recibe el string ya armado.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tuning.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeTuning } from '../lib/tuning.js'

// Songsterr entrega las cuerdas de la mas aguda a la mas grave.
const ESTANDAR = [64, 59, 55, 50, 45, 40]

test('Mi estandar no genera aviso', () => {
  assert.equal(describeTuning(ESTANDAR), null)
})

test('sin datos de afinacion no inventa nada', () => {
  assert.equal(describeTuning(null), null)
  assert.equal(describeTuning([]), null)
})

test('todo un semitono abajo', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 1)), 'Medio tono abajo (Eb)')
})

test('todo un tono abajo', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 2)), 'Un tono abajo (D)')
})

test('tres semitonos abajo se describe en semitonos', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n - 3)), '3 semitonos abajo')
})

test('afinado arriba tambien se avisa', () => {
  assert.equal(describeTuning(ESTANDAR.map(n => n + 1)), 'Medio tono arriba')
})

test('Drop D: solo la sexta baja un tono', () => {
  assert.equal(describeTuning([64, 59, 55, 50, 45, 38]), 'Drop D')
})

test('Drop C#', () => {
  assert.equal(describeTuning([64, 59, 55, 50, 45, 37]), 'Drop C#')
})

test('una afinacion rara muestra las notas', () => {
  // Afinacion abierta cualquiera: ni trasladada ni de la familia Drop.
  assert.equal(describeTuning([50, 45, 43, 38, 33, 26]), 'Afinacion abierta: D-A-G-D-A-D')
})

test('una guitarra de siete cuerdas no revienta', () => {
  const r = describeTuning([64, 59, 55, 50, 45, 40, 35])
  assert.equal(typeof r, 'string')
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/tuning.test.js`
Expected: FAIL — `Cannot find module '../lib/tuning.js'`

- [ ] **Step 3: Escribir `lib/tuning.js`**

```js
const ESTANDAR = [64, 59, 55, 50, 45, 40]
const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const nombre = midi => NOTAS[((midi % 12) + 12) % 12]

export function describeTuning(notas) {
  if (!Array.isArray(notas) || notas.length === 0) return null
  if (notas.length !== 6) {
    return `Afinacion de ${notas.length} cuerdas: ${notas.map(nombre).join('-')}`
  }

  const offsets = notas.map((n, i) => n - ESTANDAR[i])

  if (offsets.every(o => o === 0)) return null

  // Todas las cuerdas movidas lo mismo: afinacion trasladada.
  if (offsets.every(o => o === offsets[0])) {
    const o = offsets[0]
    const abajo = o < 0
    const semis = Math.abs(o)
    if (semis === 1) return abajo ? 'Medio tono abajo (Eb)' : 'Medio tono arriba'
    if (semis === 2) return abajo ? 'Un tono abajo (D)' : 'Un tono arriba'
    return `${semis} semitonos ${abajo ? 'abajo' : 'arriba'}`
  }

  // Solo la sexta (la ultima del arreglo) movida hacia abajo: familia Drop.
  const sextaSuelta = offsets.slice(0, 5).every(o => o === 0) && offsets[5] < 0
  if (sextaSuelta) return `Drop ${nombre(notas[5])}`

  return `Afinacion abierta: ${notas.map(nombre).join('-')}`
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/tuning.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tuning.js test/tuning.test.js
git commit -m "feat: descripcion legible de la afinacion"
```

---

### Task 10: Consultas de sorteo

**Files:**
- Create: `db/queries.js`
- Test: `test/roll.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 1), vistas de la Task 4, `describeTuning` (Task 9).
- Produces, desde `db/queries.js`:
  - `MODES` = `['surprise', 'riffs', 'acoustic', 'solos']`
  - `roll(db, { mode = 'surprise', minDifficulty = 1, maxDifficulty = 10 })` → `{ song, matching, hint }`.
    `song` es `null` si no hay resultados; si no, `{ songId, artist, title, difficulty, instrument, trackName, tuning, tags, videos, url }` con `tuning` ya formateado por `describeTuning` y `url` armada como `https://www.songsterr.com/a/wa/song?id=<songId>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/roll.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll } from '../db/queries.js'

let siguienteId = 1

// Inserta una cancion enriquecida con un solo track de guitarra.
function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, ?, ?, ?, ?, ?, '[]', '2026-09-03')
  `).run(
    songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId,
    o.fingerstyle ?? 0, o.isJunk ?? 0, o.aiGenerated ?? 0, o.isBlank ?? 0, o.isPublished ?? 1
  )
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (?, 0, ?, ?, ?, 1000, ?)
  `).run(
    songId, o.instrument ?? 'Distortion Guitar', o.trackName ?? 'Rhythm Guitar',
    o.difficulty ?? 3, o.tuning ?? '[64,59,55,50,45,40]'
  )
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

test('devuelve una cancion que calza', () => {
  const db = base()
  agregar(db, { title: 'Unica' })
  const r = roll(db, {})
  assert.equal(r.song.title, 'Unica')
  assert.equal(r.matching, 1)
})

test('arma la url de Songsterr desde el id', () => {
  const db = base()
  agregar(db, { songId: 455118 })
  assert.equal(roll(db, {}).song.url, 'https://www.songsterr.com/a/wa/song?id=455118')
})

test('formatea la afinacion y calla cuando es estandar', () => {
  const db = base()
  agregar(db, { songId: 1, tuning: '[64,59,55,50,45,38]' })
  assert.equal(roll(db, {}).song.tuning, 'Drop D')

  const db2 = base()
  agregar(db2, { tuning: '[64,59,55,50,45,40]' })
  assert.equal(roll(db2, {}).song.tuning, null)
})

test('filtra por rango de dificultad', () => {
  const db = base()
  agregar(db, { difficulty: 2, title: 'Facil' })
  agregar(db, { difficulty: 8, title: 'Dificil' })

  const r = roll(db, { minDifficulty: 1, maxDifficulty: 3 })
  assert.equal(r.matching, 1)
  assert.equal(r.song.title, 'Facil')
})

test('modo riffs exige guitarra electrica distorsionada y no fingerstyle', () => {
  const db = base()
  agregar(db, { instrument: 'Distortion Guitar', title: 'Riff' })
  agregar(db, { instrument: 'Acoustic Guitar (steel)', title: 'Acustica' })
  agregar(db, { instrument: 'Distortion Guitar', fingerstyle: 1, title: 'Fingerstyle distorsionada' })

  const r = roll(db, { mode: 'riffs' })
  assert.equal(r.matching, 1)
  assert.equal(r.song.title, 'Riff')
})

test('modo acoustic acepta fingerstyle o instrumento acustico', () => {
  const db = base()
  agregar(db, { instrument: 'Acoustic Guitar (nylon)', title: 'Nylon' })
  agregar(db, { instrument: 'Distortion Guitar', fingerstyle: 1, title: 'Fingerstyle' })
  agregar(db, { instrument: 'Distortion Guitar', title: 'Electrica' })

  const r = roll(db, { mode: 'acoustic' })
  assert.equal(r.matching, 2)
  assert.notEqual(r.song.title, 'Electrica')
})

test('modo solos busca Lead o Solo en el nombre del track', () => {
  const db = base()
  agregar(db, { trackName: 'Kirk Hammett | Lead Guitar', title: 'Con solo' })
  agregar(db, { trackName: 'Guitar Solo', title: 'Solo tambien' })
  agregar(db, { trackName: 'Rhythm Guitar', title: 'Sin solo' })

  const r = roll(db, { mode: 'solos' })
  assert.equal(r.matching, 2)
  assert.notEqual(r.song.title, 'Sin solo')
})

test('modo solos sortea entre las mas dificiles cuando hay muchas', () => {
  const db = base()
  // 60 canciones de dificultad 1..6 repartidas parejo.
  for (let i = 0; i < 60; i++) {
    agregar(db, { trackName: 'Lead Guitar', difficulty: (i % 6) + 1 })
  }
  const vistas = new Set()
  for (let i = 0; i < 60; i++) vistas.add(roll(db, { mode: 'solos' }).song.difficulty)

  // El tercio superior de 60 son 20 canciones: las de dificultad 6 y 5.
  assert.ok(Math.min(...vistas) >= 5, `salieron dificultades ${[...vistas].sort()}`)
})

test('modo solos con pocas candidatas no restringe el sorteo', () => {
  const db = base()
  for (let i = 0; i < 6; i++) agregar(db, { trackName: 'Lead Guitar', difficulty: i + 1 })

  const vistas = new Set()
  for (let i = 0; i < 200; i++) vistas.add(roll(db, { mode: 'solos' }).song.difficulty)
  assert.ok(vistas.size > 3, 'con menos de 20 candidatas deben poder salir todas')
})

test('una cancion descartada no vuelve a salir nunca', () => {
  const db = base()
  const id = agregar(db)
  db.prepare("INSERT INTO song_state (song_id, status, updated_at) VALUES (?, 'skipped', 'x')").run(id)

  const r = roll(db, {})
  assert.equal(r.song, null)
  assert.equal(r.matching, 0)
})

test('una cancion solo marcada como gustada si puede salir', () => {
  const db = base()
  const id = agregar(db)
  db.prepare('INSERT INTO song_state (song_id, liked, updated_at) VALUES (?, 1, ?)').run(id, 'x')

  assert.notEqual(roll(db, {}).song, null)
})

test('excluye basura del catalogo', () => {
  const db = base()
  agregar(db, { isJunk: 1 })
  agregar(db, { aiGenerated: 1 })
  agregar(db, { isBlank: 1 })
  agregar(db, { isPublished: 0 })

  assert.equal(roll(db, {}).matching, 0)
})

test('excluye lo que aun no se enriquece', () => {
  const db = base()
  const id = agregar(db)
  db.prepare('UPDATE songs SET enriched_at = NULL WHERE song_id = ?').run(id)

  assert.equal(roll(db, {}).matching, 0)
})

test('sin resultados devuelve un hint que dice cuanto se gana ampliando', () => {
  const db = base()
  agregar(db, { difficulty: 7 })

  const r = roll(db, { minDifficulty: 1, maxDifficulty: 2 })
  assert.equal(r.song, null)
  assert.match(r.hint, /1/)
})

test('con pocas restantes avisa, con hartas no molesta', () => {
  const db = base()
  for (let i = 0; i < 3; i++) agregar(db, { difficulty: 3 })
  assert.ok(roll(db, {}).hint, 'con 3 restantes deberia avisar')

  const db2 = base()
  for (let i = 0; i < 50; i++) agregar(db2, { difficulty: 3 })
  assert.equal(roll(db2, {}).hint, null)
})

test('trae los tags de la cancion', () => {
  const db = base()
  const id = agregar(db)
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, 'metal')").run(id)
  db.prepare("INSERT INTO tags (song_id, tag) VALUES (?, '80s')").run(id)

  assert.deepEqual(roll(db, {}).song.tags.sort(), ['80s', 'metal'])
})

test('un modo desconocido es rechazado', () => {
  const db = base()
  agregar(db)
  assert.throws(() => roll(db, { mode: 'inventado' }), /modo/i)
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/roll.test.js`
Expected: FAIL — `Cannot find module '../db/queries.js'`

- [ ] **Step 3: Escribir `db/queries.js`**

```js
import { describeTuning } from '../lib/tuning.js'

export const MODES = ['surprise', 'riffs', 'acoustic', 'solos']

// Exclusiones permanentes: ya decidido, basura del catalogo, o sin enriquecer.
const BASE_FROM = `
  FROM songs s
  JOIN representative_track r ON r.song_id = s.song_id
  LEFT JOIN song_state st ON st.song_id = s.song_id
  WHERE s.enriched_at IS NOT NULL
    AND s.is_junk = 0 AND s.ai_generated = 0 AND s.is_blank = 0 AND s.is_published = 1
    AND st.status IS NULL
    AND r.difficulty BETWEEN ? AND ?
`

const MODE_SQL = {
  surprise: '',
  riffs: ` AND r.instrument IN ('Distortion Guitar','Overdriven Guitar') AND s.fingerstyle = 0`,
  acoustic: ` AND (s.fingerstyle = 1 OR r.instrument IN ('Acoustic Guitar (nylon)','Acoustic Guitar (steel)'))`,
  solos: ` AND (r.name LIKE '%Lead%' OR r.name LIKE '%Solo%')`,
}

const COLUMNS = `
  s.song_id, s.artist, s.title, s.videos,
  r.difficulty, r.instrument, r.name AS track_name, r.tuning
`

function contar(db, mode, min, max) {
  return db.prepare(`SELECT COUNT(*) c ${BASE_FROM}${MODE_SQL[mode]}`).get(min, max).c
}

function hidratar(db, fila) {
  if (!fila) return null
  const tags = db.prepare('SELECT tag FROM tags WHERE song_id = ?')
    .all(fila.song_id).map(r => r.tag)
  return {
    songId: fila.song_id,
    artist: fila.artist,
    title: fila.title,
    difficulty: fila.difficulty,
    instrument: fila.instrument,
    trackName: fila.track_name,
    tuning: describeTuning(fila.tuning ? JSON.parse(fila.tuning) : null),
    tags,
    videos: JSON.parse(fila.videos ?? '[]'),
    url: `https://www.songsterr.com/a/wa/song?id=${fila.song_id}`,
  }
}

// Solo aparece cuando hay algo util que sugerir.
function construirHint(db, mode, min, max, matching) {
  if (matching >= 10) return null
  const ampliado = contar(db, mode, 1, 10)
  if (matching === 0) {
    return ampliado > 0
      ? `No queda ninguna con esos filtros. Ampliando la dificultad a 1-10 hay ${ampliado}.`
      : 'No queda ninguna con este modo. Prueba otro.'
  }
  return ampliado > matching
    ? `Quedan ${matching}. Ampliando la dificultad a 1-10 serian ${ampliado}.`
    : `Quedan ${matching} con este modo.`
}

export function roll(db, opts = {}) {
  const { mode = 'surprise', minDifficulty = 1, maxDifficulty = 10 } = opts
  if (!MODES.includes(mode)) throw new Error(`modo desconocido: ${mode}`)

  const matching = contar(db, mode, minDifficulty, maxDifficulty)
  const hint = construirHint(db, mode, minDifficulty, maxDifficulty, matching)
  if (matching === 0) return { song: null, matching: 0, hint }

  let fila
  if (mode === 'solos') {
    // Sesgo al extremo alto: el tercio superior por dificultad, minimo 20,
    // para que un rango angosto no deje el sorteo entre dos canciones.
    const pool = Math.max(20, Math.ceil(matching / 3))
    fila = db.prepare(`
      SELECT * FROM (
        SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL.solos}
        ORDER BY r.difficulty DESC, s.song_id ASC LIMIT ?
      ) ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty, pool)
  } else {
    fila = db.prepare(`
      SELECT ${COLUMNS} ${BASE_FROM}${MODE_SQL[mode]} ORDER BY RANDOM() LIMIT 1
    `).get(minDifficulty, maxDifficulty)
  }

  return { song: hidratar(db, fila), matching, hint }
}
```

- [ ] **Step 4: Correr los tests**

Run: `node --test test/roll.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add db/queries.js test/roll.test.js
git commit -m "feat: consultas de sorteo con modos y exclusiones"
```

---

### Task 11: Marcado de estado y listas

**Files:**
- Modify: `db/queries.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: `roll` (Task 10).
- Produces, desde `db/queries.js`:
  - `mark(db, { songId, status, liked })` → `void`. `status` puede ser `'learned' | 'skipped' | 'queued' | null`; `null` explícito borra la disposición. `undefined` en cualquiera de los dos campos significa "no tocar".
  - `getList(db, list)` → `Array` con la misma forma de `song` que devuelve `roll`. `list` ∈ `['learned','skipped','queued','liked']`.
  - `getStats(db)` → `{ total, enriched, pending, available }`.
  - `roll` pasa a incrementar `shown_count` de la canción devuelta.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/state.test.js`. Reusar el helper `agregar` copiándolo — el plan lo repite a propósito para que la tarea sea autocontenida:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { roll, mark, getList, getStats } from '../db/queries.js'

let siguienteId = 1

function agregar(db, o = {}) {
  const songId = o.songId ?? siguienteId++
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_junk, ai_generated, is_blank, is_published, videos, enriched_at)
    VALUES (?, 1, ?, ?, 100, ?, 0, 0, 0, 0, 1, '[]', ?)
  `).run(songId, o.artist ?? 'Artista', o.title ?? `Cancion ${songId}`, songId,
         o.enriched === false ? null : '2026-09-03')
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (?, 0, 'Distortion Guitar', 'Rhythm Guitar', ?, 1000, '[64,59,55,50,45,40]')
  `).run(songId, o.difficulty ?? 3)
  return songId
}

function base() { siguienteId = 1; return openDb(':memory:') }

test('marcar crea la fila si no existia', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'learned' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.status, 'learned')
  assert.equal(s.liked, 0)
})

test('status y liked son independientes', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, liked: true })
  mark(db, { songId: id, status: 'skipped' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.status, 'skipped')
  assert.equal(s.liked, 1, 'marcar status no debe borrar el like')
})

test('marcar solo status no pisa el like, y viceversa', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'learned', liked: true })
  mark(db, { songId: id, status: 'queued' })

  const s = db.prepare('SELECT * FROM song_state WHERE song_id = ?').get(id)
  assert.equal(s.liked, 1)
  assert.equal(s.status, 'queued')
})

test('status null devuelve la cancion al sorteo', () => {
  const db = base()
  const id = agregar(db)
  mark(db, { songId: id, status: 'skipped' })
  assert.equal(roll(db, {}).matching, 0)

  mark(db, { songId: id, status: null })
  assert.equal(roll(db, {}).matching, 1)
})

test('sortear incrementa shown_count', () => {
  const db = base()
  const id = agregar(db)
  roll(db, {})
  roll(db, {})

  assert.equal(db.prepare('SELECT shown_count FROM song_state WHERE song_id = ?').get(id).shown_count, 2)
})

test('shown_count no saca la cancion del sorteo', () => {
  const db = base()
  agregar(db)
  roll(db, {})
  assert.equal(roll(db, {}).matching, 1)
})

test('las listas devuelven lo marcado, con forma de cancion', () => {
  const db = base()
  const a = agregar(db, { title: 'Aprendida' })
  const b = agregar(db, { title: 'Descartada' })
  const c = agregar(db, { title: 'Para despues' })
  mark(db, { songId: a, status: 'learned', liked: true })
  mark(db, { songId: b, status: 'skipped' })
  mark(db, { songId: c, status: 'queued' })

  assert.deepEqual(getList(db, 'learned').map(s => s.title), ['Aprendida'])
  assert.deepEqual(getList(db, 'skipped').map(s => s.title), ['Descartada'])
  assert.deepEqual(getList(db, 'queued').map(s => s.title), ['Para despues'])
  assert.deepEqual(getList(db, 'liked').map(s => s.title), ['Aprendida'])

  const fila = getList(db, 'learned')[0]
  assert.equal(fila.difficulty, 3)
  assert.match(fila.url, /songsterr/)
})

test('una lista vacia devuelve arreglo vacio', () => {
  const db = base()
  assert.deepEqual(getList(db, 'queued'), [])
})

test('una lista desconocida es rechazada', () => {
  const db = base()
  assert.throws(() => getList(db, 'inventada'), /lista/i)
})

test('stats cuenta total, enriquecidas y disponibles', () => {
  const db = base()
  agregar(db)
  agregar(db)
  const c = agregar(db, { enriched: false })
  const d = agregar(db)
  mark(db, { songId: d, status: 'skipped' })

  const s = getStats(db)
  assert.equal(s.total, 4)
  assert.equal(s.enriched, 3)
  assert.equal(s.pending, 1)
  assert.equal(s.available, 2, 'enriquecidas menos las ya decididas')
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/state.test.js`
Expected: FAIL — `mark is not a function` (o error de import).

- [ ] **Step 3: Agregar a `db/queries.js`**

```js
export const LISTS = ['learned', 'skipped', 'queued', 'liked']

function asegurarFila(db, songId) {
  db.prepare(`
    INSERT INTO song_state (song_id, updated_at) VALUES (?, ?)
    ON CONFLICT(song_id) DO NOTHING
  `).run(songId, new Date().toISOString())
}

export function mark(db, { songId, status, liked }) {
  asegurarFila(db, songId)
  // `undefined` significa "no tocar"; `null` en status borra la disposicion.
  if (status !== undefined) {
    db.prepare('UPDATE song_state SET status = ?, updated_at = ? WHERE song_id = ?')
      .run(status, new Date().toISOString(), songId)
  }
  if (liked !== undefined) {
    db.prepare('UPDATE song_state SET liked = ?, updated_at = ? WHERE song_id = ?')
      .run(liked ? 1 : 0, new Date().toISOString(), songId)
  }
}

export function getList(db, list) {
  if (!LISTS.includes(list)) throw new Error(`lista desconocida: ${list}`)
  const filtro = list === 'liked' ? 'st.liked = 1' : 'st.status = ?'
  const params = list === 'liked' ? [] : [list]

  const filas = db.prepare(`
    SELECT ${COLUMNS}
    FROM songs s
    JOIN representative_track r ON r.song_id = s.song_id
    JOIN song_state st ON st.song_id = s.song_id
    WHERE ${filtro}
    ORDER BY st.updated_at DESC
  `).all(...params)

  return filas.map(f => hidratar(db, f))
}

export function getStats(db) {
  const s = db.prepare(`
    SELECT COUNT(*) total, SUM(enriched_at IS NOT NULL) enriched FROM songs
  `).get()
  const available = db.prepare(`SELECT COUNT(*) c ${BASE_FROM}`).get(1, 10).c
  return {
    total: s.total,
    enriched: s.enriched ?? 0,
    pending: s.total - (s.enriched ?? 0),
    available,
  }
}
```

- [ ] **Step 4: Hacer que `roll` incremente `shown_count`**

En `db/queries.js`, justo antes del `return` de `roll`, cuando `fila` existe:

```js
  if (fila) {
    asegurarFila(db, fila.song_id)
    db.prepare('UPDATE song_state SET shown_count = shown_count + 1 WHERE song_id = ?')
      .run(fila.song_id)
  }
```

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/`
Expected: PASS. Los tests de la Task 10 deben seguir verdes — `shown_count` no saca canciones del sorteo porque las exclusiones miran `status`, no `shown_count`.

- [ ] **Step 6: Commit**

```bash
git add db/queries.js test/state.test.js
git commit -m "feat: marcado de estado, listas y estadisticas"
```

---

### Task 12: Servidor HTTP

**Files:**
- Create: `server.js`
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 1), `roll`/`mark`/`getList`/`getStats` (Tasks 10-11).
- Produces:
  - `createApp(db)` → un `http.Server` sin escuchar, exportado para los tests.
  - `npm start` levanta en `http://localhost:3000`.
  - Endpoints: `GET /api/roll`, `POST /api/mark`, `GET /api/lists?list=`, `GET /api/stats`, y estáticos desde `public/`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/server.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { createApp } from '../server.js'

function conApp(fn) {
  const db = openDb(':memory:')
  db.prepare(`
    INSERT INTO songs (song_id, artist_id, artist, title, views, catalog_rank,
                       fingerstyle, is_published, videos, enriched_at)
    VALUES (1, 1, 'Metallica', 'One', 100, 0, 0, 1, '[]', '2026-09-03')
  `).run()
  db.prepare(`
    INSERT INTO tracks (song_id, track_index, instrument, name, difficulty, views, tuning)
    VALUES (1, 0, 'Distortion Guitar', 'Lead Guitar', 4, 1000, '[64,59,55,50,45,40]')
  `).run()

  const server = createApp(db)
  return new Promise((resolve, reject) => {
    server.listen(0, async () => {
      const url = `http://127.0.0.1:${server.address().port}`
      try { resolve(await fn(url, db)) } catch (e) { reject(e) } finally { server.close() }
    })
  })
}

test('GET /api/roll devuelve song, matching y hint', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.song.title, 'One')
  assert.equal(body.matching, 1)
  assert.ok('hint' in body)
}))

test('GET /api/roll respeta los filtros del query string', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll?minDifficulty=1&maxDifficulty=2`)
  const body = await res.json()
  assert.equal(body.song, null)
  assert.equal(body.matching, 0)
}))

test('un modo invalido devuelve 400, no 500', () => conApp(async url => {
  const res = await fetch(`${url}/api/roll?mode=inventado`)
  assert.equal(res.status, 400)
  assert.ok((await res.json()).error)
}))

test('POST /api/mark guarda el estado', () => conApp(async (url, db) => {
  const res = await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: 1, status: 'learned', liked: true }),
  })
  assert.equal(res.status, 200)
  const s = db.prepare('SELECT * FROM song_state WHERE song_id = 1').get()
  assert.equal(s.status, 'learned')
  assert.equal(s.liked, 1)
}))

test('POST /api/mark sin songId devuelve 400', () => conApp(async url => {
  const res = await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'learned' }),
  })
  assert.equal(res.status, 400)
}))

test('GET /api/lists devuelve la lista pedida', () => conApp(async url => {
  await fetch(`${url}/api/mark`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: 1, status: 'queued' }),
  })
  const body = await (await fetch(`${url}/api/lists?list=queued`)).json()
  assert.equal(body.songs.length, 1)
  assert.equal(body.songs[0].title, 'One')
}))

test('GET /api/stats responde los cuatro contadores', () => conApp(async url => {
  const body = await (await fetch(`${url}/api/stats`)).json()
  assert.deepEqual(Object.keys(body).sort(), ['available', 'enriched', 'pending', 'total'])
}))

test('una ruta desconocida devuelve 404', () => conApp(async url => {
  assert.equal((await fetch(`${url}/api/nada`)).status, 404)
}))

test('sirve index.html en la raiz', () => conApp(async url => {
  const res = await fetch(`${url}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
}))
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/server.test.js`
Expected: FAIL — `Cannot find module '../server.js'`

- [ ] **Step 3: Escribir `server.js`**

```js
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/open.js'
import { roll, mark, getList, getStats } from './db/queries.js'

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function leerCuerpo(req) {
  const trozos = []
  for await (const t of req) trozos.push(t)
  try { return JSON.parse(Buffer.concat(trozos).toString() || '{}') } catch { return null }
}

export function createApp(db) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const ruta = url.pathname

    try {
      if (ruta === '/api/roll') {
        const entero = (n, def) => {
          const v = Number(url.searchParams.get(n))
          return Number.isInteger(v) && v >= 1 && v <= 10 ? v : def
        }
        return json(res, 200, roll(db, {
          mode: url.searchParams.get('mode') ?? 'surprise',
          minDifficulty: entero('minDifficulty', 1),
          maxDifficulty: entero('maxDifficulty', 10),
        }))
      }

      if (ruta === '/api/mark' && req.method === 'POST') {
        const body = await leerCuerpo(req)
        if (!body || !Number.isInteger(body.songId)) {
          return json(res, 400, { error: 'falta songId' })
        }
        mark(db, body)
        return json(res, 200, { ok: true })
      }

      if (ruta === '/api/lists') {
        return json(res, 200, { songs: getList(db, url.searchParams.get('list')) })
      }

      if (ruta === '/api/stats') return json(res, 200, getStats(db))

      if (ruta.startsWith('/api/')) return json(res, 404, { error: 'no existe' })

      // Estaticos, con normalize para no salir de public/.
      const rel = normalize(ruta === '/' ? 'index.html' : ruta).replace(/^(\.\.[/\\])+/, '')
      const archivo = join(PUBLIC, rel)
      if (!archivo.startsWith(PUBLIC) || !existsSync(archivo)) {
        res.writeHead(404); return res.end('no existe')
      }
      res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
      return res.end(await readFile(archivo))
    } catch (err) {
      // Un modo o una lista invalida es culpa del cliente, no del servidor.
      const esValidacion = /desconocid[oa]/i.test(err.message)
      return json(res, esValidacion ? 400 : 500, { error: err.message })
    }
  })
}

// Arranque solo cuando se ejecuta directo, no cuando lo importa un test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync('songs.db')) {
    console.error('No existe songs.db. Corre primero:  npm run etl')
    process.exit(1)
  }
  const db = openDb('songs.db')
  const { enriched, available } = getStats(db)
  if (enriched === 0) {
    console.error('La base esta vacia. Corre primero:  npm run etl')
    process.exit(1)
  }
  createApp(db).listen(3000, () => {
    console.log(`song-suggest en http://localhost:3000  (${available} canciones disponibles)`)
  })
}
```

- [ ] **Step 4: Crear un `public/index.html` mínimo**

El test de estáticos lo necesita; la Task 13 lo reemplaza.

```html
<!doctype html>
<meta charset="utf-8">
<title>song-suggest</title>
<p>En construccion.</p>
```

- [ ] **Step 5: Correr los tests**

Run: `node --test test/`
Expected: PASS, toda la suite.

- [ ] **Step 6: Commit**

```bash
git add server.js public/index.html test/server.test.js
git commit -m "feat: servidor HTTP local con la API de sorteo"
```

---

### Task 13: Front — pantalla de sorteo

**Files:**
- Modify: `public/index.html`
- Create: `public/app.js`
- Create: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/roll`, `POST /api/mark`, `GET /api/stats`.
- Produces: la pantalla principal. Sin tests automatizados, por decisión de la spec.

- [ ] **Step 1: Escribir `public/index.html`**

```html
<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>song-suggest</title>
<link rel="stylesheet" href="/style.css">

<header>
  <h1>¿Qué aprendo hoy?</h1>
  <nav>
    <button id="ver-sorteo" class="activo">Sortear</button>
    <button id="ver-listas">Mis listas</button>
  </nav>
</header>

<main id="vista-sorteo">
  <section class="controles">
    <label>
      Modo
      <select id="modo">
        <option value="surprise">Sorpréndeme</option>
        <option value="riffs">Riffs eléctricos</option>
        <option value="acoustic">Acústica / fingerpicking</option>
        <option value="solos">Solos y técnica</option>
      </select>
    </label>
    <label>Dificultad mínima <input id="min" type="range" min="1" max="10" value="1"><output id="min-val">1</output></label>
    <label>Dificultad máxima <input id="max" type="range" min="1" max="10" value="10"><output id="max-val">10</output></label>
  </section>

  <section id="tarjeta" class="tarjeta"></section>
  <p id="hint" class="hint"></p>

  <section class="acciones">
    <button id="aprendida">Ya la aprendí</button>
    <button id="descartada">No me tinca</button>
    <button id="despues">Después</button>
    <button id="otra" class="principal">Otra</button>
    <button id="like" class="like" title="Me gustó">♡</button>
  </section>
</main>

<main id="vista-listas" hidden></main>

<script type="module" src="/app.js"></script>
</html>
```

- [ ] **Step 2: Escribir `public/style.css`**

```css
:root { --fondo: #14151a; --panel: #1e2029; --texto: #e8e8ea; --tenue: #9a9aa5; --acento: #d4a24a; }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.5rem; background: var(--fondo); color: var(--texto);
       font: 16px/1.5 system-ui, sans-serif; max-width: 46rem; margin-inline: auto; }
h1 { font-size: 1.4rem; margin: 0; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
nav button { background: none; border: 0; color: var(--tenue); cursor: pointer; font-size: 1rem; }
nav button.activo { color: var(--acento); }

.controles { display: grid; gap: .75rem; background: var(--panel); padding: 1rem; border-radius: .6rem; }
.controles label { display: flex; align-items: center; gap: .6rem; color: var(--tenue); font-size: .9rem; }
.controles select { margin-left: auto; }
.controles input[type=range] { flex: 1; }

.tarjeta { background: var(--panel); border-radius: .6rem; padding: 1.5rem; margin: 1rem 0; min-height: 9rem; }
.tarjeta h2 { margin: 0 0 .2rem; font-size: 1.5rem; }
.tarjeta .artista { color: var(--tenue); margin: 0 0 1rem; }
.tarjeta .meta { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
.tarjeta .chip { background: #2a2d38; border-radius: 1rem; padding: .15rem .7rem; font-size: .8rem; }
.tarjeta .afinacion { background: var(--acento); color: #14151a; font-weight: 600; }
.tarjeta a { color: var(--acento); }
.vacio { color: var(--tenue); text-align: center; padding-top: 2rem; }
.hint { color: var(--tenue); font-size: .9rem; min-height: 1.5rem; }

.acciones { display: flex; flex-wrap: wrap; gap: .5rem; }
.acciones button { background: #2a2d38; border: 0; color: var(--texto); padding: .6rem 1rem;
                   border-radius: .4rem; cursor: pointer; font-size: .95rem; }
.acciones button:hover:not(:disabled) { background: #363a48; }
.acciones button:disabled { opacity: .4; cursor: default; }
.acciones .principal { margin-left: auto; background: var(--acento); color: #14151a; font-weight: 600; }
.acciones .like.marcado { color: #e2585b; }

.lista { margin-bottom: 2rem; }
.lista h3 { color: var(--acento); font-size: 1rem; }
.lista ol { list-style: none; padding: 0; }
.lista li { display: flex; align-items: center; gap: .6rem; padding: .5rem 0; border-bottom: 1px solid #2a2d38; }
.lista li .dif { color: var(--tenue); font-size: .85rem; }
.lista li button { margin-left: auto; background: none; border: 0; color: var(--tenue); cursor: pointer; }
```

- [ ] **Step 3: Escribir `public/app.js`**

```js
const $ = s => document.querySelector(s)
const api = (ruta, opts) => fetch(ruta, opts).then(r => r.json())

let actual = null

function pintar({ song, hint }) {
  actual = song
  $('#hint').textContent = hint ?? ''

  if (!song) {
    $('#tarjeta').innerHTML = '<p class="vacio">Nada que sortear con estos filtros.</p>'
    for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = true
    return
  }
  for (const id of ['aprendida', 'descartada', 'despues', 'like']) $(`#${id}`).disabled = false
  $('#like').classList.remove('marcado')
  $('#like').textContent = '♡'

  const chips = [
    `<span class="chip">dificultad ${song.difficulty}/10</span>`,
    `<span class="chip">${song.instrument}</span>`,
    song.tuning ? `<span class="chip afinacion">${song.tuning}</span>` : '',
    ...song.tags.slice(0, 4).map(t => `<span class="chip">${t}</span>`),
  ].join('')

  const backing = song.videos.find(v => v.feature === 'backing') ?? song.videos[0]

  $('#tarjeta').innerHTML = `
    <h2>${song.title}</h2>
    <p class="artista">${song.artist}</p>
    <div class="meta">${chips}</div>
    <p>
      <a href="${song.url}" target="_blank" rel="noopener">Ver la tablatura en Songsterr →</a>
      ${backing ? ` · <a href="https://www.youtube.com/watch?v=${backing.videoId}" target="_blank" rel="noopener">Backing track</a>` : ''}
    </p>`
}

async function sortear() {
  const params = new URLSearchParams({
    mode: $('#modo').value,
    minDifficulty: $('#min').value,
    maxDifficulty: $('#max').value,
  })
  pintar(await api(`/api/roll?${params}`))
}

const marcar = cuerpo =>
  api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: actual.songId, ...cuerpo }),
  })

// Los sliders no se pisan entre ellos.
function sincronizarRangos(cambiado) {
  const min = $('#min'), max = $('#max')
  if (Number(min.value) > Number(max.value)) {
    if (cambiado === 'min') max.value = min.value
    else min.value = max.value
  }
  $('#min-val').value = min.value
  $('#max-val').value = max.value
}

for (const [id, ev] of [['min', 'min'], ['max', 'max']]) {
  $(`#${id}`).addEventListener('input', () => { sincronizarRangos(ev); sortear() })
}
$('#modo').addEventListener('change', sortear)
$('#otra').addEventListener('click', sortear)

for (const [id, status] of [['aprendida', 'learned'], ['descartada', 'skipped'], ['despues', 'queued']]) {
  $(`#${id}`).addEventListener('click', async () => { await marcar({ status }); sortear() })
}

$('#like').addEventListener('click', async () => {
  const marcado = $('#like').classList.toggle('marcado')
  $('#like').textContent = marcado ? '♥' : '♡'
  await marcar({ liked: marcado })
})

sincronizarRangos('min')
sortear()
```

- [ ] **Step 4: Verificar a mano**

```bash
node etl/index.js --limit 300   # si aun no hay suficientes canciones enriquecidas
npm start
```

Abrir `http://localhost:3000` y comprobar, uno por uno:
1. Aparece una canción con dificultad, instrumento y link a Songsterr.
2. "Otra" trae una distinta.
3. Mover los sliders sortea de nuevo y la dificultad mostrada respeta el rango.
4. El slider mínimo no puede pasar al máximo.
5. Cambiar a "Acústica" trae canciones acústicas o de fingerstyle.
6. "No me tinca" sortea otra, y esa canción no vuelve a aparecer (recargar y sortear varias veces).
7. Un rango imposible (min 9, max 10, modo acústica) muestra el mensaje de vacío con el hint, sin errores en la consola del navegador.
8. Alguna canción muestra el aviso de afinación en dorado.

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: pantalla de sorteo"
```

---

### Task 14: Front — vista de listas

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/lists?list=`, `POST /api/mark` con `status: null`.
- Produces: la segunda vista, con las cuatro listas y el deshacer.

- [ ] **Step 1: Agregar el renderizado de listas a `public/app.js`**

```js
const LISTAS = [
  ['learned', 'Aprendidas'],
  ['liked', 'Me gustaron'],
  ['queued', 'Para después'],
  ['skipped', 'Descartadas'],
]

async function pintarListas() {
  const contenedor = $('#vista-listas')
  contenedor.innerHTML = '<p class="vacio">Cargando...</p>'

  const bloques = await Promise.all(LISTAS.map(async ([clave, titulo]) => {
    const { songs } = await api(`/api/lists?list=${clave}`)
    if (songs.length === 0) {
      return `<section class="lista"><h3>${titulo}</h3><p class="vacio">Todavía nada.</p></section>`
    }
    const filas = songs.map(s => `
      <li>
        <a href="${s.url}" target="_blank" rel="noopener">${s.artist} — ${s.title}</a>
        <span class="dif">dif ${s.difficulty}</span>
        ${clave === 'liked' ? '' : `<button data-deshacer="${s.songId}">Deshacer</button>`}
      </li>`).join('')
    return `<section class="lista"><h3>${titulo} (${songs.length})</h3><ol>${filas}</ol></section>`
  }))

  contenedor.innerHTML = bloques.join('')
}

// Deshacer devuelve la cancion al sorteo.
$('#vista-listas').addEventListener('click', async e => {
  const songId = e.target.dataset?.deshacer
  if (!songId) return
  await api('/api/mark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ songId: Number(songId), status: null }),
  })
  pintarListas()
})

function cambiarVista(aListas) {
  $('#vista-sorteo').hidden = aListas
  $('#vista-listas').hidden = !aListas
  $('#ver-sorteo').classList.toggle('activo', !aListas)
  $('#ver-listas').classList.toggle('activo', aListas)
  if (aListas) pintarListas()
}

$('#ver-listas').addEventListener('click', () => cambiarVista(true))
$('#ver-sorteo').addEventListener('click', () => cambiarVista(false))
```

- [ ] **Step 2: Verificar a mano**

```bash
npm start
```

1. Marcar una canción como aprendida, otra como descartada, otra como "Después", y darle corazón a una.
2. Ir a "Mis listas": las cuatro aparecen en su sección, con el conteo correcto.
3. La canción con corazón aparece en "Me gustaron" **y además** en la lista de su disposición, si tenía una — son ejes independientes.
4. "Deshacer" sobre una descartada la saca de la lista.
5. Volver a "Sortear": esa canción puede volver a salir.
6. La consola del navegador sin errores.

- [ ] **Step 3: Correr toda la suite una última vez**

Run: `node --test test/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: vista de listas con deshacer"
```

---

## Notas de verificación final

Antes de dar el proyecto por terminado:

```bash
node --test test/       # toda la suite verde
npm run etl             # catalogo completo, puede demorar ~1 hora
npm start
```

El ETL completo es el único paso largo. Si en la Task 8 aparecieron muchos `429`, correrlo con `--concurrency 1` y anotar en la spec cuál resultó ser el ritmo tolerado — es la incertidumbre que la spec dejó explícitamente abierta.
