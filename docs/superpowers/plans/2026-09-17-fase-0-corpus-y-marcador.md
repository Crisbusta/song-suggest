# Fase 0 — Corpus de juicios y marcador de tono

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder registrar qué tono aprobó el usuario y qué le pareció mal, y puntuar cualquier sugeridor contra ese corpus — sin cambiar la lógica de tono.

**Architecture:** Dos tablas nuevas en zona protegida (`user_tone`, `tone_judgment`). La captura reutiliza `ampli.leerPreset()`, que ya existe. Un corto-circuito en `pistasDeLaCancion()` aplica el tono guardado sin tocar `sugerirAjustes`. El marcador es una herramienta de línea de comandos (`npm run tono:evaluar`), no un test: lee `songs.db`, y `CLAUDE.md` prohíbe que los tests lo toquen.

**Tech Stack:** Node ≥ 24, `node:sqlite`, `node:test`, módulos ES servidos tal cual desde `public/`. Cero dependencias de npm.

**Spec:** `docs/superpowers/specs/2026-09-13-resolucion-de-tono-hibrida-design.md` (§4.4, §4.6, §9 Fase 0)

## Global Constraints

- **Cero dependencias de npm.** Sólo módulos `node:`. Requiere Node ≥ 24. No hay paso de build.
- **Comentarios en español SIN tildes dentro de `.js`.** El Markdown sí las lleva.
- **Nunca inventar un número.** Si la fuente no trae un dato, viaja como `null` y la interfaz no lo dibuja.
- **`npm test` no abre navegador ni toca la red**, y **nunca corre contra `songs.db`** — los tests de base usan `openDb(':memory:')`.
- **Los tests de navegador cubren invariantes, no aspecto.** Ninguno comprueba un color ni una medida.
- **Zona protegida:** `user_tone` y `tone_judgment` entran a la tabla de `CLAUDE.md` y a `npm run backup` **en el mismo commit que las crea** (Tarea 1). No son reconstruibles por el ETL.
- **Commits:** prefijo en minúscula, asunto en español, el cuerpo explica *por qué* con las cifras que lo sostienen. Se ramifica desde `main` y se mergea con `--no-ff`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `db/schema.sql` | Las dos tablas nuevas (Tarea 1) |
| `tools/backup.mjs` | Volcar el WAL y copiar la base (Tarea 1) |
| `db/tono-usuario.js` | Leer y escribir `user_tone` y `tone_judgment`. No decide nada de tono |
| `lib/tono/ejes.js` | De una cadena LT25 a los ejes del vocabulario. Puro, sin base ni DOM |
| `lib/tono/evaluador.js` | Puntuar un candidato contra el corpus. Puro |
| `tools/evaluar-tono.mjs` | La herramienta: lee `songs.db`, llama al evaluador, imprime el informe |
| `db/queries.js` | Corto-circuito: si hay tono guardado, ése manda |
| `server.js` | `GET/PUT/DELETE /api/tono` y `POST /api/juicio` |
| `public/panel-ampli.js` | Botón "Guardar mi tono" y la fila de veredicto |
| `public/app.js` | Cablear los dos |

---

### Task 1: Las dos tablas, la zona protegida, y un backup que no pierda el WAL

**Files:**
- Modify: `db/schema.sql` (al final)
- Create: `tools/backup.mjs`
- Modify: `package.json` (script `backup`)
- Modify: `CLAUDE.md` (tabla de zonas protegidas)
- Test: `test/tono-usuario.test.js`

**Interfaces:**
- Consumes: `openDb(path)` de `db/open.js`, que ejecuta `db/schema.sql` entero en cada apertura con `CREATE TABLE IF NOT EXISTS`. Por eso "migración" aquí es sólo añadir el `CREATE TABLE`: es idempotente y no hay nada que versionar.
- Produces: las tablas `user_tone` y `tone_judgment`; `tools/backup.mjs` exporta `volcarWal(db)`.

**Por qué el backup entra en esta tarea y no después.** `npm run backup` es hoy `cp songs.db`, y la base corre en WAL (lo fija `db/open.js`). Medido el 2026-09-17: `songs.db` tenía 31.281.152 bytes y `songs.db-wal` **5.302.472 bytes sin volcar**. Un `cp` del archivo principal se lleva la base tal como estaba en el último checkpoint y **pierde en silencio** lo que siga en el WAL. Hoy eso arriesga historial de sorteos; desde este commit arriesgaría tonos que costaron minutos de dialar cada uno. La protección que la spec pide para estas tablas no existe de verdad si el backup puede saltárselas.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tono-usuario.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'

test('el esquema crea las dos tablas del corpus de tono', () => {
  const db = openDb(':memory:')
  const tablas = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_tone','tone_judgment')"
  ).all().map(r => r.name).sort()
  assert.deepEqual(tablas, ['tone_judgment', 'user_tone'])
})

test('un juicio solo admite las dos formas con sentido', () => {
  const db = openDb(':memory:')
  const poner = (eje, direccion) => db.prepare(`
    INSERT INTO tone_judgment (song_id, track_index, track_sig, eje, direccion, juzgado, fuente, sugeridor, creado_en)
    VALUES (1, 0, 'sig', ?, ?, '{}', 'reglas', 'v1', '2026-09-17')
  `).run(eje, direccion)

  poner('global', 'bien')
  poner('suciedad', 'sobra')
  // "global" solo se combina con "bien", y un eje concreto nunca con "bien":
  // un "bien" por eje no dice nada que el global no diga mejor.
  assert.throws(() => poner('global', 'sobra'), /CHECK/)
  assert.throws(() => poner('suciedad', 'bien'), /CHECK/)
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/tono-usuario.test.js`
Expected: FAIL — `deepEqual([], ['tone_judgment','user_tone'])`, porque las tablas no existen.

- [ ] **Step 3: Añadir las tablas al esquema**

Al final de `db/schema.sql`:

```sql
-- El tono que el usuario dialo y aprobo, leido del equipo. Zona protegida:
-- el ETL no puede reconstruirlo. Sin FOREIGN KEY hacia songs, igual que
-- song_state: el catalogo se puede rebajar entero sin perder esto.
--
-- track_sig es instrument + U+001F + name de la pista al guardarla.
-- etl/catalog.js borra y reinserta `tracks` con el trackIndex que venga de
-- Songsterr, asi que (song_id, track_index) NO es estable: si Songsterr
-- reordena, la fila se aplicaria a otra pista en silencio. Al leer se compara
-- la firma y, si no calza, la fila no se aplica y se reporta desfasada.
CREATE TABLE IF NOT EXISTS user_tone (
  song_id     INTEGER NOT NULL,
  track_index INTEGER NOT NULL,
  track_sig   TEXT    NOT NULL,
  cadena      TEXT    NOT NULL,
  descriptor  TEXT,
  origen      TEXT    NOT NULL CHECK (origen IN ('leido','editado')),
  nota        TEXT,
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (song_id, track_index)
);

-- Los juicios rapidos. Es un REGISTRO, no un estado: se acumula, no se pisa.
-- La misma pista juzgada tres veces a lo largo de tres versiones del sugeridor
-- son tres filas, y esa historia ES el dato -- es lo que permite preguntar si
-- una version mejoro sobre la anterior. Zona protegida por la misma razon que
-- user_tone, y con mas fuerza: el ETL no reconstruye horas de escucha.
CREATE TABLE IF NOT EXISTS tone_judgment (
  id          INTEGER PRIMARY KEY,
  song_id     INTEGER NOT NULL,
  track_index INTEGER NOT NULL,
  track_sig   TEXT    NOT NULL,
  eje         TEXT    NOT NULL CHECK (eje IN ('global','suciedad','modulacion','delay','reverb')),
  direccion   TEXT    NOT NULL CHECK (direccion IN ('bien','sobra','falta')),
  juzgado     TEXT    NOT NULL,
  fuente      TEXT    NOT NULL,
  sugeridor   TEXT    NOT NULL,
  creado_en   TEXT    NOT NULL,
  CHECK ((eje =  'global' AND direccion =  'bien')
      OR (eje <> 'global' AND direccion <> 'bien'))
);
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/tono-usuario.test.js`
Expected: PASS, los dos tests.

- [ ] **Step 5: Escribir el test del backup**

Añadir a `test/tono-usuario.test.js` (los imports van arriba del archivo):

```js
import { volcarWal } from '../tools/backup.mjs'
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('volcar el WAL deja la base copiable con un cp del archivo principal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tono-'))
  try {
    const ruta = join(dir, 'x.db')
    const db = openDb(ruta)
    db.prepare(`
      INSERT INTO user_tone (song_id, track_index, track_sig, cadena, origen, updated_at)
      VALUES (7, 2, 'sig', '{"amp":1}', 'leido', '2026-09-17')
    `).run()

    volcarWal(db)
    // Un cp del archivo principal, sin -wal: es lo que hace `npm run backup`.
    copyFileSync(ruta, join(dir, 'copia.db'))
    db.close()

    const copia = openDb(join(dir, 'copia.db'))
    const fila = copia.prepare('SELECT song_id, cadena FROM user_tone').get()
    assert.equal(fila?.song_id, 7, 'el tono guardado no llego a la copia')
    assert.equal(fila.cadena, '{"amp":1}')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 6: Correr el test y verlo fallar**

Run: `node --test test/tono-usuario.test.js`
Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `../tools/backup.mjs`.

- [ ] **Step 7: Escribir `tools/backup.mjs`**

```js
/* Copia songs.db a songs-<fecha>.db.bak.

   El checkpoint NO es opcional, y por eso este script existe en vez de un `cp`
   suelto: la base corre en WAL (ver db/open.js) y un `cp` del archivo
   principal se lleva la base tal como estaba en el ultimo checkpoint. Medido
   el 2026-09-17 sobre la base real: 31.281.152 bytes en songs.db y 5.302.472
   en songs.db-wal sin volcar. Perder eso no era grave mientras solo fueran
   sorteos; con user_tone y tone_judgment ahi dentro seria perder tonos que
   costaron minutos de dialar cada uno, y que el ETL no puede reconstruir. */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'

/* TRUNCATE y no PASSIVE: PASSIVE se rinde en silencio si hay otro proceso
   leyendo -- y `npm start` y `npm run etl` pueden convivir sobre la misma
   base, que es justo el caso en el que un backup a medias enganaria. */
export const volcarWal = db => db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

if (import.meta.filename === process.argv[1]) {
  const origen = process.argv[2] ?? 'songs.db'
  const sello = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const destino = `songs-${sello}.db.bak`
  const db = new DatabaseSync(origen)
  volcarWal(db)
  db.close()
  copyFileSync(origen, destino)
  console.log(`copiado ${origen} -> ${destino}`)
}
```

- [ ] **Step 8: Correr el test y verlo pasar**

Run: `node --test test/tono-usuario.test.js`
Expected: PASS, los tres tests.

- [ ] **Step 9: Apuntar el script de npm al nuevo backup**

En `package.json`, reemplazar la línea de `backup` por:

```json
"backup": "node tools/backup.mjs",
```

- [ ] **Step 10: Comprobar el backup a mano contra la base real**

Run: `npm run backup && ls -la songs-*.db.bak | tail -1 && rm songs-*.db.bak`
Expected: aparece un `.bak` de tamaño parecido al de `songs.db`, y se borra.

- [ ] **Step 11: Declarar las tablas como zona protegida**

En `CLAUDE.md`, añadir dos filas a la tabla de **Zonas protegidas**, debajo de la de `song_state`:

```markdown
| Tabla `user_tone` (esquema y PK) | El tono que dialaste y aprobaste, leído del equipo. El ETL no lo reconstruye: cada fila son minutos frente al amplificador. |
| Tabla `tone_judgment` (esquema) | Tus juicios sobre los tonos propuestos. Es el único patrón de medida que existe para saber si un cambio de tono mejora o empeora; sin él, cualquier cambio vuelve a ser opinión. |
```

- [ ] **Step 12: Correr la suite entera**

Run: `npm test`
Expected: PASS. El conteo sube en 3 sobre el anterior (378 → 381).

- [ ] **Step 13: Commit**

```bash
git add db/schema.sql tools/backup.mjs package.json CLAUDE.md test/tono-usuario.test.js
git commit -m "feat: las dos tablas del corpus de tono, y un backup que no pierde el WAL"
```

---

### Task 2: Guardar y leer el tono del usuario, con la firma de pista

**Files:**
- Create: `db/tono-usuario.js`
- Test: `test/tono-usuario.test.js` (añadir)

**Interfaces:**
- Consumes: las tablas de la Tarea 1.
- Produces:
  - `firmaDePista({ instrument, name })` → `string`
  - `guardarTono(db, { songId, trackIndex, instrument, name, cadena, descriptor?, origen, nota? })` → `void`
  - `leerTono(db, { songId, trackIndex, instrument, name })` → `{ cadena, descriptor, origen, nota, updatedAt, desfasada: boolean } | null`
  - `borrarTono(db, { songId, trackIndex })` → `void`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test/tono-usuario.test.js`:

```js
import { firmaDePista, guardarTono, leerTono, borrarTono } from '../db/tono-usuario.js'

const PISTA = { songId: 10, trackIndex: 3, instrument: 'Electric Guitar (clean)', name: 'Rhythm Guitar' }
const CADENA = { amp: { fenderId: 'DUBS_Twin', nombre: 'TWIN CLEAN', valores: { gain: 3 } } }

test('un tono guardado se lee igual que se escribio', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  const t = leerTono(db, PISTA)
  assert.deepEqual(t.cadena, CADENA)
  assert.equal(t.origen, 'leido')
  assert.equal(t.desfasada, false)
})

test('guardar dos veces la misma pista deja UN tono, el ultimo', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  guardarTono(db, { ...PISTA, cadena: { amp: { nombre: 'OTRO' } }, origen: 'editado' })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_tone').get().n, 1)
  assert.equal(leerTono(db, PISTA).cadena.amp.nombre, 'OTRO')
})

test('si la pista cambio de identidad, el tono no se aplica: se avisa', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  // Songsterr reordeno y en ese track_index hay ahora otra pista.
  const t = leerTono(db, { ...PISTA, name: 'Lead Guitar' })
  assert.equal(t.desfasada, true, 'una firma que no calza tiene que avisarse')
  assert.deepEqual(t.cadena, CADENA, 'y no se borra: sigue ahi por si la pista vuelve')
})

test('borrar un tono devuelve la pista a no tener ninguno', () => {
  const db = openDb(':memory:')
  guardarTono(db, { ...PISTA, cadena: CADENA, origen: 'leido' })
  borrarTono(db, PISTA)
  assert.equal(leerTono(db, PISTA), null)
})

test('la firma separa instrumento y nombre con un caracter que no aparece en el catalogo', () => {
  // Sin separador, {instrument:'ab', name:'c'} y {instrument:'a', name:'bc'}
  // darian la misma firma.
  assert.notEqual(
    firmaDePista({ instrument: 'ab', name: 'c' }),
    firmaDePista({ instrument: 'a', name: 'bc' }),
  )
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/tono-usuario.test.js`
Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `../db/tono-usuario.js`.

- [ ] **Step 3: Escribir `db/tono-usuario.js`**

```js
/* Lectura y escritura del tono que el usuario aprobo, y de sus juicios.

   No decide nada de tono: guarda lo que el equipo tenia y lo devuelve. Quien
   decide si se aplica es db/queries.js. */

/* U+001F (unit separator). No aparece en ningun nombre de pista del catalogo,
   asi que no puede colisionar con el contenido que separa. */
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

/* `desfasada` es lo unico interesante de esta funcion: la fila existe pero la
   pista que hay hoy en ese track_index no es la que se guardo. Se devuelve la
   cadena igual -- el tono sigue siendo tuyo y no se tira por una reordenacion
   ajena -- pero marcada, para que quien la use decida no aplicarla y la
   interfaz pueda decirlo. Silenciarlo seria aplicar tu tono de la ritmica a un
   solo, que es exactamente el fallo que nadie notaria. */
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
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/tono-usuario.test.js`
Expected: PASS, los ocho tests del archivo.

- [ ] **Step 5: Commit**

```bash
git add db/tono-usuario.js test/tono-usuario.test.js
git commit -m "feat: guardar y leer el tono aprobado, con firma de pista contra la deriva del indice"
```

---

### Task 3: Registrar los juicios

**Files:**
- Modify: `db/tono-usuario.js` (añadir al final)
- Test: `test/tono-juicios.test.js`

**Interfaces:**
- Consumes: tabla `tone_judgment` (Tarea 1), `firmaDePista` (Tarea 2).
- Produces:
  - `guardarJuicio(db, { songId, trackIndex, instrument, name, eje, direccion, juzgado, fuente, sugeridor })` → `void`
  - `leerJuicios(db)` → `Array<{ id, songId, trackIndex, trackSig, eje, direccion, juzgado, fuente, sugeridor, creadoEn }>`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tono-juicios.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../db/open.js'
import { guardarJuicio, leerJuicios } from '../db/tono-usuario.js'

const BASE = {
  songId: 5, trackIndex: 1,
  instrument: 'Distortion Guitar', name: 'Rhythm Guitar',
  juzgado: { amp: { nombre: '90S ROCK', valores: { gain: 8 } } },
  fuente: 'comunidad', sugeridor: 'reglas@2026-09-17',
}

test('un juicio guarda que se juzgo, no solo el veredicto', () => {
  const db = openDb(':memory:')
  guardarJuicio(db, { ...BASE, eje: 'suciedad', direccion: 'sobra' })
  const [j] = leerJuicios(db)
  assert.equal(j.eje, 'suciedad')
  assert.equal(j.direccion, 'sobra')
  // Sin la cadena juzgada, "sobra suciedad" es ininterpretable en cuanto el
  // sugeridor cambie: mas limpio que QUE.
  assert.equal(j.juzgado.amp.nombre, '90S ROCK')
  assert.equal(j.fuente, 'comunidad')
  assert.equal(j.sugeridor, 'reglas@2026-09-17')
})

test('juzgar la misma pista dos veces deja DOS filas, no una', () => {
  const db = openDb(':memory:')
  guardarJuicio(db, { ...BASE, eje: 'suciedad', direccion: 'sobra', sugeridor: 'v1' })
  guardarJuicio(db, { ...BASE, eje: 'global', direccion: 'bien', sugeridor: 'v2' })
  const js = leerJuicios(db)
  assert.equal(js.length, 2, 'la historia de juicios ES el dato: no se pisa')
  assert.deepEqual(js.map(j => j.sugeridor), ['v1', 'v2'])
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/tono-juicios.test.js`
Expected: FAIL — `guardarJuicio is not a function`, porque aún no existe.

- [ ] **Step 3: Añadir las dos funciones al final de `db/tono-usuario.js`**

```js
/* Los juicios se ACUMULAN: sin clave por pista y sin UPDATE. La misma pista
   juzgada tres veces a lo largo de tres versiones del sugeridor son tres
   filas, y esa historia es lo que permite preguntar si una version mejoro
   sobre la anterior. */
export function guardarJuicio(db, { songId, trackIndex, instrument, name, eje, direccion, juzgado, fuente, sugeridor }) {
  db.prepare(`
    INSERT INTO tone_judgment (song_id, track_index, track_sig, eje, direccion, juzgado, fuente, sugeridor, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(songId, trackIndex, firmaDePista({ instrument, name }), eje, direccion,
         JSON.stringify(juzgado ?? null), fuente, sugeridor, new Date().toISOString())
}

export function leerJuicios(db) {
  return db.prepare('SELECT * FROM tone_judgment ORDER BY id ASC').all().map(f => ({
    id: f.id,
    songId: f.song_id,
    trackIndex: f.track_index,
    trackSig: f.track_sig,
    eje: f.eje,
    direccion: f.direccion,
    juzgado: JSON.parse(f.juzgado),
    fuente: f.fuente,
    sugeridor: f.sugeridor,
    creadoEn: f.creado_en,
  }))
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/tono-juicios.test.js`
Expected: PASS, los dos tests.

- [ ] **Step 5: Commit**

```bash
git add db/tono-usuario.js test/tono-juicios.test.js
git commit -m "feat: registrar juicios de tono, con la cadena que se juzgo al lado"
```

---

### Task 4: Los ejes — de una cadena del LT25 al vocabulario

**Files:**
- Create: `lib/tono/ejes.js`
- Test: `test/tono-ejes.test.js`

**Interfaces:**
- Consumes: `MODELOS_LT25` y `AMPLIS_LIMPIOS` de `lib/ampli.js` (hay que exportar `AMPLIS_LIMPIOS`, hoy es privada).
- Produces:
  - `FAMILIAS_AMP: Record<string, 'limpio'|'crunch'|'alta-ganancia'>`
  - `ejesDe(cadena)` → `{ familia, gain, suciedad: [number, number], modulacion: boolean, delay: boolean, reverb: boolean }`
  - `comparar(a, b, eje)` → `-1 | 0 | 1` (cuánto más “a” que “b” en ese eje)

**Por qué una tabla nueva y no reusar `AMPLIS_LIMPIOS`.** `lib/ampli.js` ya tiene una lista de amplis limpios, pero su propio comentario declara que sólo sirve para detectar una contradicción, *"nunca para elegir un modelo"*, y que *"no hace falta que sea una clasificacion completa"*. Usarla como clasificación total la sacaría de su contrato. Se crea `FAMILIAS_AMP` completa, y un test exige que **sea total sobre los 20 modelos** y que **no contradiga** a `AMPLIS_LIMPIOS`. Así no hay dos listas que se desvíen en silencio, que es lo que `CLAUDE.md` evita manteniendo un solo archivo de reglas.

**`FAMILIAS_AMP` es juicio musical, igual que las 24 filas de `REGLAS`.** Cambiar una fila es cambiar una opinión.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tono-ejes.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODELOS_LT25 } from '../lib/ampli.js'
import { FAMILIAS_AMP, ejesDe, comparar } from '../lib/tono/ejes.js'

test('la tabla de familias cubre los veinte modelos y ninguno mas', () => {
  assert.deepEqual(Object.keys(FAMILIAS_AMP).sort(), [...MODELOS_LT25].sort())
})

test('la familia limpia no contradice a la lista que ya usa lib/ampli.js', async () => {
  // Dos listas sobre lo mismo se desvian. Esta no puede decir "crunch" de un
  // modelo que el resto del proyecto trata como limpio.
  const { AMPLIS_LIMPIOS } = await import('../lib/ampli.js')
  for (const m of AMPLIS_LIMPIOS) {
    assert.equal(FAMILIAS_AMP[m], 'limpio', `${m} esta en AMPLIS_LIMPIOS pero aqui es ${FAMILIAS_AMP[m]}`)
  }
})

test('los ejes salen de la cadena: familia, ganancia y que ranuras estan ocupadas', () => {
  const e = ejesDe({
    amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } },
    mod: { nombre: 'CHORUS', valores: {} },
    reverb: { nombre: 'PLATE', valores: {} },
  })
  assert.equal(e.familia, 'limpio')
  assert.equal(e.gain, 3)
  assert.equal(e.modulacion, true)
  assert.equal(e.delay, false)
  assert.equal(e.reverb, true)
})

test('una cadena sin ampli no inventa una familia', () => {
  const e = ejesDe({ mod: { nombre: 'CHORUS' } })
  assert.equal(e.familia, null)
  assert.equal(e.gain, null)
})

test('la suciedad ordena primero por familia y luego por ganancia', () => {
  const limpioAlto = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: { gain: 9 } } })
  const sucioBajo = ejesDe({ amp: { nombre: 'METAL 2000', valores: { gain: 1 } } })
  // Un modelo de alta ganancia con el gain abajo sigue siendo mas sucio que
  // un limpio con el gain arriba: la voz del modelo manda. Es justo el caso
  // de Weird Fishes -- 90S ROCK a gain 3 suena saturado.
  assert.equal(comparar(sucioBajo, limpioAlto, 'suciedad'), 1)
  assert.equal(comparar(limpioAlto, sucioBajo, 'suciedad'), -1)
})

test('en las ranuras, comparar dice si una tiene efecto y la otra no', () => {
  const con = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: {} }, mod: { nombre: 'CHORUS' } })
  const sin = ejesDe({ amp: { nombre: 'TWIN CLEAN', valores: {} } })
  assert.equal(comparar(con, sin, 'modulacion'), 1)
  assert.equal(comparar(sin, con, 'modulacion'), -1)
  assert.equal(comparar(con, con, 'modulacion'), 0)
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/tono-ejes.test.js`
Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `../lib/tono/ejes.js`.

- [ ] **Step 3: Exportar `AMPLIS_LIMPIOS` desde `lib/ampli.js`**

Cambiar `const AMPLIS_LIMPIOS = [` por `export const AMPLIS_LIMPIOS = [`, y añadir al final de su comentario:

```
   Se exporta para que `lib/tono/ejes.js` compruebe que su clasificacion
   completa no la contradice: dos listas sobre lo mismo se desvian.
```

- [ ] **Step 4: Escribir `lib/tono/ejes.js`**

```js
/* De una cadena del LT25 a los ejes con los que se juzga un tono.

   Es el germen del vocabulario cerrado de la fase 2 (ver §4.2 de la spec), y
   existe ya porque el marcador de la fase 0 lo necesita: para preguntar "este
   candidato es mas limpio que el que rechace" hace falta un eje en el que
   comparar, y las perillas crudas no sirven -- DELUXE CLN contra TWIN CLEAN
   son los dos limpios, y penalizar esa diferencia igual que confundir limpio
   con metal seria ruido. */
import { MODELOS_LT25 } from '../ampli.js'

/* Juicio musical, igual que las 24 filas de REGLAS: cambiar una fila es
   cambiar una opinion. Un test exige que sea TOTAL sobre los veinte modelos
   -- un modelo sin familia haria que el marcador lo ignorara en silencio -- y
   que no contradiga a AMPLIS_LIMPIOS. */
export const FAMILIAS_AMP = {
  '50S TWIN': 'limpio', '60S UK CLEAN': 'limpio', '70S UK CLEAN': 'limpio',
  CHAMPION: 'limpio', 'DELUXE CLN': 'limpio', PRINCETON: 'limpio',
  'SUPER CLEAN': 'limpio', 'TWIN CLEAN': 'limpio',

  '70S ROCK': 'crunch', BASSMAN: 'crunch', BURN: 'crunch',
  'DELUXE DIRT': 'crunch', EXCELSIOR: 'crunch', SMALLTONE: 'crunch',

  '80S ROCK': 'alta-ganancia', '90S ROCK': 'alta-ganancia',
  'ALT METAL': 'alta-ganancia', 'DOOM METAL': 'alta-ganancia',
  'METAL 2000': 'alta-ganancia', 'SUPER HEAVY': 'alta-ganancia',
}

const RANGO_FAMILIA = { limpio: 0, crunch: 1, 'alta-ganancia': 2 }
const RANURAS_DE_EJE = { modulacion: 'mod', delay: 'delay', reverb: 'reverb' }

/* Sin ampli en la cadena no hay familia ni ganancia, y viajan como null: no
   se inventa un 'limpio' por defecto, que es la clase de suposicion que haria
   que el marcador puntuara una cadena rota como si fuera buena. */
export function ejesDe(cadena) {
  const amp = cadena?.amp ?? null
  const familia = amp?.nombre ? (FAMILIAS_AMP[amp.nombre] ?? null) : null
  const gain = amp?.valores?.gain ?? null
  return {
    familia,
    gain,
    // Lexicografico: primero la voz del modelo, y la ganancia solo desempata.
    suciedad: [familia ? RANGO_FAMILIA[familia] : -1, gain ?? -1],
    modulacion: !!cadena?.mod?.nombre,
    delay: !!cadena?.delay?.nombre,
    reverb: !!cadena?.reverb?.nombre,
  }
}

const signo = n => (n > 0 ? 1 : n < 0 ? -1 : 0)

/* Cuanto mas "a" que "b" en ese eje: 1 si a tiene mas, -1 si menos, 0 si
   igual. Es lo unico que el marcador necesita, porque un veredicto es una
   DIRECCION, no una nota. */
export function comparar(a, b, eje) {
  if (eje === 'suciedad') {
    return signo(a.suciedad[0] - b.suciedad[0]) || signo(a.suciedad[1] - b.suciedad[1])
  }
  if (!(eje in RANURAS_DE_EJE)) throw new Error(`eje desconocido: ${eje}`)
  return signo(Number(a[eje]) - Number(b[eje]))
}
```

- [ ] **Step 5: Correr el test y verlo pasar**

Run: `node --test test/tono-ejes.test.js`
Expected: PASS, los seis tests.

- [ ] **Step 6: Correr la suite entera**

Run: `npm test`
Expected: PASS. `lib/ampli.js` sólo cambió en un `export`, así que sus tests no se mueven.

- [ ] **Step 7: Commit**

```bash
git add lib/tono/ejes.js lib/ampli.js test/tono-ejes.test.js
git commit -m "feat: los ejes con los que se compara un tono, y la tabla de familias de ampli"
```

---

### Task 5: El evaluador — puntuar un candidato contra el corpus

**Files:**
- Create: `lib/tono/evaluador.js`
- Test: `test/tono-evaluador.test.js`

**Interfaces:**
- Consumes: `ejesDe`, `comparar` de `lib/tono/ejes.js`.
- Produces:
  - `evaluarJuicio(juicio, candidato)` → `'cumple' | 'viola' | 'sin-efecto'`
  - `distanciaATono(objetivo, candidato)` → `{ familia: boolean, gain: number|null, ranuras: number }`
  - `informe({ juicios, capturas })` → `{ cumplidas, violadas, sinEfecto, ejemplos, capturas: { total, familiaOk, ranurasMal } }`

**La regla que hace útil el veredicto:** `(suciedad, sobra)` se cumple si el candidato es **estrictamente** más limpio que la cadena juzgada. Empatar es fallar — si empatar contara como cumplir, un candidato que no cambia nada sacaría nota perfecta.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tono-evaluador.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluarJuicio, distanciaATono, informe } from '../lib/tono/evaluador.js'

const SUCIO = { amp: { nombre: '90S ROCK', valores: { gain: 8 } } }
const LIMPIO = { amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } } }

test('"sobra suciedad" se cumple solo si el candidato es mas limpio', () => {
  const j = { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO }
  assert.equal(evaluarJuicio(j, LIMPIO), 'cumple')
  assert.equal(evaluarJuicio(j, SUCIO), 'viola', 'empatar es fallar: no cambiar nada no puede puntuar')
  assert.equal(evaluarJuicio(j, { amp: { nombre: 'SUPER HEAVY', valores: { gain: 9 } } }), 'viola')
})

test('"falta modulacion" se cumple si el candidato la trae', () => {
  const j = { eje: 'modulacion', direccion: 'falta', juzgado: LIMPIO }
  assert.equal(evaluarJuicio(j, { ...LIMPIO, mod: { nombre: 'CHORUS' } }), 'cumple')
  assert.equal(evaluarJuicio(j, LIMPIO), 'viola')
})

test('un "bien" se viola en cuanto el candidato se aleja en cualquier eje', () => {
  const j = { eje: 'global', direccion: 'bien', juzgado: LIMPIO }
  assert.equal(evaluarJuicio(j, LIMPIO), 'cumple')
  assert.equal(evaluarJuicio(j, SUCIO), 'viola', 'esto es lo que caza las regresiones')
  assert.equal(evaluarJuicio(j, { ...LIMPIO, delay: { nombre: 'ECHO' } }), 'viola')
})

test('un candidato sin sugerencia no cumple ningun juicio', () => {
  const j = { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO }
  assert.equal(evaluarJuicio(j, null), 'sin-efecto')
})

test('la distancia a un tono capturado se mide en ejes, no en perillas', () => {
  const d = distanciaATono(LIMPIO, { amp: { nombre: 'DELUXE CLN', valores: { gain: 3 } } })
  assert.equal(d.familia, true, 'DELUXE CLN y TWIN CLEAN son los dos limpios: la familia acierta')
  assert.equal(d.gain, 0)
  assert.equal(d.ranuras, 0)
  const lejos = distanciaATono(LIMPIO, SUCIO)
  assert.equal(lejos.familia, false)
})

test('el informe cuenta cumplidas, violadas y sin efecto, y guarda ejemplos', () => {
  const r = informe({
    juicios: [
      { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO, candidato: LIMPIO, songId: 1, trackIndex: 0 },
      { eje: 'suciedad', direccion: 'sobra', juzgado: SUCIO, candidato: SUCIO, songId: 2, trackIndex: 0 },
    ],
    capturas: [],
  })
  assert.equal(r.cumplidas, 1)
  assert.equal(r.violadas, 1)
  assert.equal(r.ejemplos.violadas[0].songId, 2, 'una violacion sin ejemplo no se puede revisar')
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/tono-evaluador.test.js`
Expected: FAIL con `ERR_MODULE_NOT_FOUND` para `../lib/tono/evaluador.js`.

- [ ] **Step 3: Escribir `lib/tono/evaluador.js`**

```js
/* Puntuar un sugeridor candidato contra el corpus del usuario.

   Dos verdades, dos reglas:

   - Un TONO CAPTURADO es un objetivo exacto, y se mide la distancia en ejes.
   - Un VEREDICTO es una restriccion direccional, y se cumple o no.

   Lo que esto NO demuestra, y conviene tenerlo escrito aqui tambien: que un
   tono suene como el disco. Demuestra que coincide mas con lo que el usuario
   aprobo. Ver §10 de la spec. */
import { ejesDe, comparar } from './ejes.js'

const EJES_DE_RANURA = ['modulacion', 'delay', 'reverb']

/* `sin-efecto` no es un aprobado: es "este juicio no dice nada sobre este
   candidato". Un candidato sin sugerencia no puede cumplir nada, pero
   tampoco es justo contarlo como violacion -- se cuenta aparte y el informe
   lo muestra, para que un sugeridor que deja pistas sin tono no pueda subir
   la nota simplemente callandose. */
export function evaluarJuicio({ eje, direccion, juzgado }, candidato) {
  if (!candidato) return 'sin-efecto'
  const antes = ejesDe(juzgado)
  const ahora = ejesDe(candidato)

  if (direccion === 'bien') {
    const igual = comparar(ahora, antes, 'suciedad') === 0
      && EJES_DE_RANURA.every(e => comparar(ahora, antes, e) === 0)
    return igual ? 'cumple' : 'viola'
  }
  // "sobra" pide bajar, "falta" pide subir. Estrictamente: empatar es fallar,
  // porque si no, no cambiar nada sacaria nota perfecta.
  const querido = direccion === 'sobra' ? -1 : 1
  return comparar(ahora, antes, eje) === querido ? 'cumple' : 'viola'
}

export function distanciaATono(objetivo, candidato) {
  const o = ejesDe(objetivo)
  const c = ejesDe(candidato)
  return {
    familia: o.familia === c.familia,
    gain: o.gain == null || c.gain == null ? null : Math.abs(o.gain - c.gain),
    ranuras: EJES_DE_RANURA.filter(e => o[e] !== c[e]).length,
  }
}

/* El informe es un informe y no una nota: una nota sola escondria las
   regresiones, que son lo que venimos a cazar. Por eso cada bolsa guarda
   ejemplos -- una violacion que no se puede mirar no se puede arreglar. */
export function informe({ juicios, capturas }) {
  const r = {
    cumplidas: 0, violadas: 0, sinEfecto: 0,
    ejemplos: { cumplidas: [], violadas: [], sinEfecto: [] },
    capturas: { total: capturas.length, familiaOk: 0, ranurasMal: 0 },
  }
  for (const j of juicios) {
    const veredicto = evaluarJuicio(j, j.candidato)
    const bolsa = veredicto === 'cumple' ? 'cumplidas' : veredicto === 'viola' ? 'violadas' : 'sinEfecto'
    r[bolsa]++
    if (r.ejemplos[bolsa].length < 5) {
      r.ejemplos[bolsa].push({ songId: j.songId, trackIndex: j.trackIndex, eje: j.eje, direccion: j.direccion })
    }
  }
  for (const c of capturas) {
    const d = distanciaATono(c.objetivo, c.candidato)
    if (d.familia) r.capturas.familiaOk++
    r.capturas.ranurasMal += d.ranuras
  }
  return r
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/tono-evaluador.test.js`
Expected: PASS, los seis tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tono/evaluador.js test/tono-evaluador.test.js
git commit -m "feat: el evaluador de tono -- veredictos direccionales y distancia a lo capturado"
```

---

### Task 6: `npm run tono:evaluar`

**Files:**
- Create: `tools/evaluar-tono.mjs`
- Modify: `package.json` (script `tono:evaluar`)

**Interfaces:**
- Consumes: `informe` de `lib/tono/evaluador.js`, `leerJuicios`/`leerTono` de `db/tono-usuario.js`, `sugerirAjustes` de `lib/ampli.js`, `openDb`.
- Produces: la herramienta. No exporta nada que otra tarea use.

**Esto NO es un test y no entra en `npm test`:** lee `songs.db`, y `CLAUDE.md` lo prohíbe. Su lógica ya está probada en la Tarea 5 contra un corpus sintético.

**El contrapeso obligatorio.** El informe imprime **siempre** el recuento del barrido completo del catálogo al lado del marcador. Con ~50 juicios y una tabla de reglas editable a mano, subir la nota es trivial; un cambio que mejora 12 pistas del corpus y mueve 8.000 del catálogo **no está probado, está sin probar**. Un marcador sin ese contrapeso es peor que ninguno, porque da confianza falsa.

- [ ] **Step 1: Escribir `tools/evaluar-tono.mjs`**

```js
/* Marcador: puntua el sugeridor actual contra el corpus del usuario.

   No es un test y no entra en `npm test`: lee songs.db, y CLAUDE.md lo
   prohibe. Su logica vive en lib/tono/evaluador.js, que si esta testeado
   contra un corpus sintetico. */
import { openDb } from '../db/open.js'
import { leerJuicios } from '../db/tono-usuario.js'
import { sugerirAjustes } from '../lib/ampli.js'
import { informe } from '../lib/tono/evaluador.js'

const db = openDb(process.argv[2] ?? 'songs.db')

const cancion = db.prepare('SELECT artist, title FROM songs WHERE song_id = ?')
const pista = db.prepare('SELECT instrument, name, tuning FROM tracks WHERE song_id = ? AND track_index = ?')
const tagsDe = db.prepare('SELECT tag FROM tags WHERE song_id = ?')

/* El candidato es el sugeridor de HOY. Cuando cambie, este mismo comando
   vuelve a correr y la diferencia entre los dos informes es la respuesta. */
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

const r = informe({ juicios, capturas })

console.log(`\nCorpus: ${juicios.length} juicios, ${capturas.length} tonos capturados\n`)
if (!juicios.length && !capturas.length) {
  console.log('Sin corpus todavia. Juzga algunos tonos en la app y vuelve.')
  process.exit(0)
}
console.log(`  cumplidas   ${r.cumplidas}`)
console.log(`  violadas    ${r.violadas}`)
console.log(`  sin efecto  ${r.sinEfecto}   (el sugeridor no propone nada para esa pista)`)
for (const [bolsa, ejs] of Object.entries(r.ejemplos)) {
  if (!ejs.length) continue
  console.log(`\n  ejemplos ${bolsa}:`)
  for (const e of ejs) console.log(`    cancion ${e.songId} pista ${e.trackIndex} — ${e.eje}/${e.direccion}`)
}
if (capturas.length) {
  console.log(`\n  tonos capturados: familia acertada en ${r.capturas.familiaOk} de ${r.capturas.total}`)
  console.log(`  ranuras equivocadas en total: ${r.capturas.ranurasMal}`)
}

/* El contrapeso, y no es opcional: sin el, un cambio que mejora doce pistas
   del corpus y mueve ocho mil del catalogo parece un exito. */
const alcance = db.prepare(`
  SELECT COUNT(*) n FROM guitar_tracks g JOIN songs s USING(song_id)
  WHERE s.enriched_at IS NOT NULL
`).get().n
console.log(`\n  CONTRAPESO: el catalogo tiene ${alcance} pistas de guitarra enriquecidas.`)
console.log(`  Un cambio medido sobre ${juicios.length + capturas.length} casos no esta probado sobre las otras ${alcance - juicios.length - capturas.length}.\n`)
```

- [ ] **Step 2: Añadir el script a `package.json`**

```json
"tono:evaluar": "node tools/evaluar-tono.mjs",
```

- [ ] **Step 3: Correr la herramienta con el corpus vacío**

Run: `npm run tono:evaluar`
Expected: imprime `Corpus: 0 juicios, 0 tonos capturados` y `Sin corpus todavia...`. Que no reviente con el corpus vacío es justamente lo que se comprueba aquí: es el estado en el que va a estar el día que se implemente.

- [ ] **Step 4: Correr la suite entera**

Run: `npm test`
Expected: PASS. La herramienta no entra en la suite.

- [ ] **Step 5: Commit**

```bash
git add tools/evaluar-tono.mjs package.json
git commit -m "feat: npm run tono:evaluar, el marcador -- con el contrapeso del catalogo entero"
```

---

### Task 7: Las rutas de la API

**Files:**
- Modify: `server.js` (junto a `/api/mark`, alrededor de la línea 82)
- Test: `test/server.test.js` (añadir)

**Interfaces:**
- Consumes: `guardarTono`, `leerTono`, `borrarTono`, `guardarJuicio` de `db/tono-usuario.js`.
- Produces: `GET /api/tono?songId=&trackIndex=`, `PUT /api/tono`, `DELETE /api/tono`, `POST /api/juicio`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test/server.test.js`, siguiendo el patrón de los tests que ya hay ahí:

`conApp(fn)` es el helper que ese archivo ya tiene: abre una base en memoria,
inserta la canción 1 (Metallica / "One") con **una pista en `track_index` 0,
`Distortion Guitar` llamada `Lead Guitar`**, levanta el servidor y llama a
`fn(url, db)`. Los tests nuevos la reutilizan; no se crean helpers nuevos.

```js
test('PUT /api/tono guarda y GET lo devuelve', () => conApp(async (url, db) => {
  const put = await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      cadena: { amp: { nombre: 'TWIN CLEAN', valores: { gain: 3 } } },
      origen: 'leido',
    }),
  })
  assert.equal(put.status, 200)

  const q = new URLSearchParams({
    songId: '1', trackIndex: '0',
    instrument: 'Distortion Guitar', name: 'Lead Guitar',
  })
  const leido = await (await fetch(`${url}/api/tono?${q}`)).json()
  assert.equal(leido.tono.cadena.amp.nombre, 'TWIN CLEAN')
  assert.equal(leido.tono.desfasada, false)
}))

test('GET /api/tono avisa cuando la pista ya no es la que se guardo', () => conApp(async url => {
  await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      cadena: { amp: { nombre: 'TWIN CLEAN', valores: {} } }, origen: 'leido',
    }),
  })
  const q = new URLSearchParams({
    songId: '1', trackIndex: '0',
    instrument: 'Distortion Guitar', name: 'OTRA PISTA',
  })
  const leido = await (await fetch(`${url}/api/tono?${q}`)).json()
  assert.equal(leido.tono.desfasada, true)
}))

test('PUT /api/tono sin songId entero responde 400', () => conApp(async url => {
  const r = await fetch(`${url}/api/tono`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trackIndex: 0 }),
  })
  assert.equal(r.status, 400)
}))

test('POST /api/juicio guarda el veredicto', () => conApp(async (url, db) => {
  const r = await fetch(`${url}/api/juicio`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: 1, trackIndex: 0,
      instrument: 'Distortion Guitar', name: 'Lead Guitar',
      eje: 'suciedad', direccion: 'sobra',
      juzgado: { amp: { nombre: '90S ROCK' } },
      fuente: 'comunidad', sugeridor: 'v1',
    }),
  })
  assert.equal(r.status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tone_judgment').get().n, 1)
}))
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/server.test.js`
Expected: FAIL con status 404 en el PUT, porque la ruta no existe.

- [ ] **Step 3: Añadir las rutas en `server.js`**

Importar arriba, junto a los otros de `db/`:

```js
import { guardarTono, leerTono, borrarTono, guardarJuicio } from './db/tono-usuario.js'
```

Y justo debajo del bloque de `/api/mark`:

```js
      /* El tono del usuario. `instrument` y `name` viajan en el GET porque
         `leerTono` los necesita para decidir si la fila quedo desfasada --
         sin ellos habria que confiar en el track_index, que es justo lo que
         la firma existe para no hacer. */
      if (ruta === '/api/tono') {
        if (req.method === 'GET') {
          const songId = Number(url.searchParams.get('songId'))
          const trackIndex = Number(url.searchParams.get('trackIndex'))
          if (!Number.isInteger(songId) || !Number.isInteger(trackIndex)) {
            return json(res, 400, { error: 'falta songId o trackIndex' })
          }
          return json(res, 200, { tono: leerTono(db, {
            songId, trackIndex,
            instrument: url.searchParams.get('instrument'),
            name: url.searchParams.get('name'),
          }) })
        }
        if (req.method === 'PUT') {
          const body = await leerCuerpo(req)
          if (!body || !Number.isInteger(body.songId) || !Number.isInteger(body.trackIndex) || !body.cadena) {
            return json(res, 400, { error: 'falta songId, trackIndex o cadena' })
          }
          guardarTono(db, body)
          return json(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          const body = await leerCuerpo(req)
          if (!body || !Number.isInteger(body.songId) || !Number.isInteger(body.trackIndex)) {
            return json(res, 400, { error: 'falta songId o trackIndex' })
          }
          borrarTono(db, body)
          return json(res, 200, { ok: true })
        }
      }

      if (ruta === '/api/juicio' && req.method === 'POST') {
        const body = await leerCuerpo(req)
        if (!body || !Number.isInteger(body.songId) || !body.eje || !body.direccion) {
          return json(res, 400, { error: 'falta songId, eje o direccion' })
        }
        guardarJuicio(db, body)
        return json(res, 200, { ok: true })
      }
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/server.test.js`
Expected: PASS, los tres tests nuevos y los que ya había.

- [ ] **Step 5: Commit**

```bash
git add server.js test/server.test.js
git commit -m "feat: rutas para guardar el tono aprobado y registrar juicios"
```

---

### Task 8: El corto-circuito — tu tono manda

**Files:**
- Modify: `db/queries.js` (dentro de `pistasDeLaCancion`, alrededor de la línea 156)
- Test: `test/pistas.test.js` (añadir)

**Interfaces:**
- Consumes: `leerTono` de `db/tono-usuario.js`.
- Produces: el campo `ampli.deUsuario: boolean` en cada pista hidratada, para que la interfaz pueda decir que ese tono es tuyo y no una sugerencia.

**Por qué un corto-circuito y no una fuente del resolutor.** El resolutor no existe hasta la fase 2. Esto es una guarda de tres líneas, trivial de escribir y trivial de quitar; la fase 3 la sustituye por una fuente de verdad con prioridad máxima. Va aquí y no en la fase 3 por una razón que no es técnica: **si capturar un tono no arregla la canción hoy, no se capturan cuarenta, y sin corpus no hay ninguna de las fases siguientes.**

- [ ] **Step 1: Escribir el test que falla**

Añadir a `test/pistas.test.js`:

`agregarConPistas(db, { artist, title, pistas: [...] })` y `base()` son los
helpers que ese archivo ya tiene. `getSong` **no** está entre sus imports
todavía: hay que añadirlo a la línea de `import ... from '../db/queries.js'`.

```js
import { guardarTono } from '../db/tono-usuario.js'
// y añadir getSong al import que ya existe de '../db/queries.js'

test('un tono guardado pisa la sugerencia de esa pista', () => {
  const db = base()
  const songId = agregarConPistas(db, {
    artist: 'Radiohead', title: 'Weird Fishes',
    pistas: [{ instrument: 'Electric Guitar (clean)', name: 'Lead Guitar 1' }],
  })
  guardarTono(db, {
    songId, trackIndex: 0,
    instrument: 'Electric Guitar (clean)', name: 'Lead Guitar 1',
    cadena: { amp: { fenderId: 'DUBS_Twin', nombre: 'TWIN CLEAN', valores: { gain: 2 } } },
    origen: 'leido',
  })
  const pista = getSong(db, songId).pistas[0]
  assert.equal(pista.ampli.cadena.amp.nombre, 'TWIN CLEAN')
  assert.equal(pista.ampli.deUsuario, true)
})

test('un tono desfasado NO se aplica: la pista vuelve a la sugerencia', () => {
  const db = base()
  const songId = agregarConPistas(db, {
    artist: 'Radiohead', title: 'Weird Fishes',
    pistas: [{ instrument: 'Electric Guitar (clean)', name: 'Lead Guitar 1' }],
  })
  guardarTono(db, {
    songId, trackIndex: 0,
    instrument: 'Electric Guitar (clean)', name: 'OTRA PISTA DISTINTA',
    cadena: { amp: { nombre: 'TWIN CLEAN', valores: {} } }, origen: 'leido',
  })
  const pista = getSong(db, songId).pistas[0]
  assert.notEqual(pista.ampli?.deUsuario, true, 'una firma que no calza no puede aplicarse')
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/pistas.test.js`
Expected: FAIL — `pista.ampli.cadena.amp.nombre` no es `TWIN CLEAN`, porque hoy manda `sugerirAjustes`.

- [ ] **Step 3: Añadir el corto-circuito en `db/queries.js`**

Importar arriba:

```js
import { leerTono } from './tono-usuario.js'
```

Y dentro del `.map(p => {` de `pistasDeLaCancion`, **antes** de llamar a `sugerirAjustes`:

```js
    /* Corto-circuito: si tu guardaste un tono para esta pista, ese manda y no
       se pregunta nada mas. Es deliberadamente tosco -- gana entero o no gana
       -- y la fase 3 lo sustituye por una fuente del resolutor, que ademas
       podra combinar un tono tuyo PARCIAL. Ver §9 Fase 3 de la spec.

       Una fila desfasada (la pista que hay hoy en ese track_index no es la que
       guardaste) no se aplica: se cae a la sugerencia normal. */
    const mio = leerTono(db, {
      songId: fila.song_id, trackIndex: p.track_index,
      instrument: p.instrument, name: p.name,
    })
    if (mio && !mio.desfasada) {
      return {
        trackIndex: p.track_index,
        instrument: p.instrument,
        name: p.name,
        difficulty: p.difficulty,
        tuning,
        califica: califican ? califican.has(p.track_index) : true,
        ampli: {
          cadena: mio.cadena,
          deUsuario: true,
          procedencia: 'lo dialaste tu y lo guardaste',
          paraElAmpli: null,
        },
      }
    }
```

> `paraElAmpli: null` es correcto y no un pendiente: la cadena guardada ya viene en valores de cable leídos del equipo, así que no hay que convertir nada. Quien la envía la usa tal cual.

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/pistas.test.js`
Expected: PASS, los dos tests nuevos y los que ya había.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: PASS. Sin filas en `user_tone`, el comportamiento es idéntico al de antes.

- [ ] **Step 6: Commit**

```bash
git add db/queries.js test/pistas.test.js
git commit -m "feat: el tono que guardaste manda sobre la sugerencia"
```

---

### Task 9: La interfaz — guardar el tono y juzgarlo

**Files:**
- Modify: `public/panel-ampli.js` (en `pintarPanelAmpli`, el bloque `.panel-envio`)
- Modify: `public/app.js` (los listeners del panel)
- Modify: `public/style.css` (la fila de veredicto)
- Test: `test/ui/tono.spec.js`

**Interfaces:**
- Consumes: `ampli.leerPreset()` de `public/ampli-usb.js` (ya existe), y las rutas de la Tarea 7.
- Produces: nada que otra tarea use.

**Dónde va, y por qué ahí.** El veredicto aparece **en la línea que hoy ocupa `#envio-estado`**, al confirmar el ACK del envío. Altura añadida cero en el caso normal — el panel del ampli acaba de pasar por un rediseño entero para caber sin scroll, y añadirle una fila fija lo devolvería al problema. El botón "Guardar mi tono" va junto a "Enviar al ampli", habilitado sólo con el equipo conectado.

**Guardar lo LEÍDO, no lo enviado.** El LT25 descarta en silencio lo que no entiende; guardar lo que se le mandó registraría un tono que el equipo pudo no haber aceptado. Por eso se llama a `ampli.leerPreset()` después del envío, no se reutiliza la cadena que se envió.

- [ ] **Step 1: Escribir el test de navegador que falla**

Crear `test/ui/tono.spec.js`:

```js
import { test, expect } from '@playwright/test'

/* El fixture no tiene amplificador conectado -- WebHID no existe en el
   navegador de pruebas --, asi que lo que se comprueba aqui es lo que NO
   depende del equipo: que el boton existe, que esta deshabilitado sin ampli,
   y que un veredicto viaja al servidor. */

test('sin ampli conectado, "Guardar mi tono" existe pero no se puede pulsar', async ({ page }) => {
  await page.goto('/')
  await page.locator('#panel-ampli').waitFor()
  const boton = page.locator('#guardar-tono')
  await expect(boton).toBeVisible()
  await expect(boton).toBeDisabled()
})

test('el veredicto solo aparece despues de enviar, no antes', async ({ page }) => {
  await page.goto('/')
  await page.locator('#panel-ampli').waitFor()
  // Sin envio no hay nada que juzgar: preguntar "como sono" antes de que
  // suene es pedir una opinion sobre nada.
  await expect(page.locator('.veredicto')).toHaveCount(0)
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx playwright test tono`
Expected: FAIL — el localizador `#guardar-tono` no encuentra nada.

- [ ] **Step 3: Añadir el botón en `public/panel-ampli.js`**

En el `return` final de `pintarPanelAmpli`, reemplazar el bloque `.panel-envio` por:

```js
    <div class="panel-envio">
      <button type="button" id="enviar-ampli" class="btn btn-primary btn-block enviar-ampli" ${estado.puedeEnviar ? '' : 'disabled'}>Enviar al ampli <kbd>E</kbd></button>
      <button type="button" id="guardar-tono" class="btn btn-secondary btn-block" ${estado.conectado ? '' : 'disabled'}>Guardar mi tono</button>
      <p id="envio-estado" class="envio-estado" role="status">Sin enviar todavía</p>
    </div>
```

- [ ] **Step 4: Cablear los dos gestos en `public/app.js`**

Dentro del listener de clicks del panel del ampli, junto al de `#enviar-ampli`:

```js
/* Se guarda lo que el equipo TIENE, no lo que se le mando: el LT25 descarta
   en silencio lo que no entiende, asi que registrar lo enviado seria anotar
   un tono que pudo no haberse aceptado. */
async function guardarMiTono() {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista) return
  const { preset } = await ampli.leerPreset()
  const cadena = Object.fromEntries((preset.audioGraph?.nodes ?? [])
    .map(n => [n.nodeId, { fenderId: n.FenderId, valores: n.dspUnitParameters ?? {} }]))
  await fetch('/api/tono', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: actual.songId, trackIndex: pista.trackIndex,
      instrument: pista.instrument, name: pista.name,
      cadena, origen: 'leido',
    }),
  })
  $('#envio-estado').textContent = 'tono guardado: esta canción ya es tuya'
}

/* El veredicto ocupa la linea del estado de envio, y solo despues del ACK:
   preguntar "como sono" antes de que suene es pedir una opinion sobre nada. */
function pintarVeredicto() {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista) return
  $('#envio-estado').innerHTML = `<span class="veredicto">¿Cómo sonó?
    <button type="button" class="btn-juicio" data-juicio="global:bien">Bien</button>
    <button type="button" class="btn-juicio" data-juicio="suciedad:sobra">Muy sucio</button>
    <button type="button" class="btn-juicio" data-juicio="suciedad:falta">Muy limpio</button>
    <select class="juicio-efectos" aria-label="Juzgar los efectos">
      <option value="">Efectos…</option>
      <option value="modulacion:falta">Le falta modulación</option>
      <option value="modulacion:sobra">Sobra modulación</option>
      <option value="delay:falta">Le falta delay</option>
      <option value="delay:sobra">Sobra delay</option>
      <option value="reverb:falta">Le falta reverb</option>
      <option value="reverb:sobra">Sobra reverb</option>
    </select></span>`
}

async function anotarJuicio(valor) {
  const pista = actual?.pistas?.[pistaElegida]
  if (!pista || !valor) return
  const [eje, direccion] = valor.split(':')
  await fetch('/api/juicio', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      songId: actual.songId, trackIndex: pista.trackIndex,
      instrument: pista.instrument, name: pista.name,
      eje, direccion,
      juzgado: pista.ampli?.cadena ?? null,
      fuente: pista.ampli?.fuente ?? 'ninguna',
      sugeridor: pista.ampli?.deUsuario ? 'usuario' : 'sugeridor',
    }),
  })
  $('#envio-estado').textContent = 'anotado, gracias'
}
```

Y en el listener delegado del panel, añadir:

```js
  if (e.target.id === 'guardar-tono') { guardarMiTono(); return }
  const juicio = e.target.closest('.btn-juicio')
  if (juicio) { anotarJuicio(juicio.dataset.juicio); return }
```

Más un listener de `change` para el `<select>`:

```js
$('#panel-ampli').addEventListener('change', e => {
  if (e.target.matches('.juicio-efectos')) anotarJuicio(e.target.value)
})
```

Y llamar a `pintarVeredicto()` donde hoy se escribe el resultado del envío confirmado.

- [ ] **Step 5: Dar estilo a la fila de veredicto en `public/style.css`**

```css
/* Ocupa la linea del estado de envio, no una fila nueva: el panel acaba de
   pasar por un rediseño para caber sin scroll y una fila fija lo devolveria
   al problema. */
.veredicto { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.btn-juicio {
  font: inherit; padding: 2px 8px; border-radius: 999px; cursor: pointer;
  color: var(--color-neutral-300); background: transparent;
  border: 1px solid var(--color-divider);
}
.btn-juicio:hover { border-color: var(--color-accent); color: var(--color-text); }
.juicio-efectos { font: inherit; font-size: 12px; }
```

- [ ] **Step 6: Correr el test y verlo pasar**

Run: `npx playwright test tono`
Expected: PASS, los dos tests.

- [ ] **Step 7: Comprobar que el panel sigue cabiendo**

Run: `npm run test:ui`
Expected: PASS, los 25 tests que ya había más los 2 nuevos. En particular los tres de `con la ventana de NNNpx de alto solo scrollea la lista de pistas`: si el botón nuevo rompiera la altura, fallarían ahí.

- [ ] **Step 8: Commit**

```bash
git add public/panel-ampli.js public/app.js public/style.css test/ui/tono.spec.js
git commit -m "feat: guardar el tono del ampli y juzgar como sono, sin crecer de alto"
```

---

### Task 10: Cerrar la fase

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-resolucion-de-tono-hibrida-design.md` (cabecera de estado)
- Modify: `README.md` (si documenta los comandos)

- [ ] **Step 1: Marcar la fase 0 como implementada en la spec**

En el bloque de estado de la cabecera, cambiar `> Estado: **propuesta**. No hay nada implementado.` por:

```markdown
> Estado: **fase 0 implementada** (2026-09-17). Las fases 1 a 5 siguen siendo propuesta.
```

- [ ] **Step 2: Documentar el comando nuevo**

En `README.md`, junto al resto de comandos:

```markdown
`npm run tono:evaluar` puntúa el sugeridor de tono contra tus juicios y tus
tonos guardados. No demuestra que un tono suene como el disco: demuestra que
coincide más con lo que aprobaste.
```

- [ ] **Step 3: Correr todo**

Run: `npm test && npm run test:ui`
Expected: PASS en las dos.

- [ ] **Step 4: Commit y merge**

```bash
git add docs/superpowers/specs/2026-09-13-resolucion-de-tono-hibrida-design.md README.md
git commit -m "docs: la fase 0 del tono queda implementada"
git checkout main && git merge --no-ff <rama> -m "merge: corpus de juicios y marcador de tono"
```

---

## Cómo se sabe que la fase 0 terminó

No por que los tests pasen — pasan desde la Tarea 1. Termina cuando **puedes hacer esto**:

1. Sortear una canción, mandarla al ampli, y decir en un clic que sonó muy sucia.
2. Dialar el tono bueno en el equipo, pulsar "Guardar mi tono", y que esa canción salga así a partir de ese momento.
3. Correr `npm run tono:evaluar` y leer cuántos de tus juicios cumple el sugeridor de hoy.

A partir del punto 3, cualquier cambio de tono deja de ser opinión. Es lo único que esta fase compra, y es lo que hace seguras las cuatro siguientes.
