# Presets de la comunidad — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Goal:** Que una canción de Metallica reciba el tono de Metallica —modelo, efectos y perillas— en vez de la deducción genérica de su etiqueta de género.

**Architecture:** Dos CSV de la comunidad entran al repo como dato crudo. Módulos puros los parsean, traducen sus nombres a los `FenderId` del catálogo del equipo y los indexan por canción, artista y género. La sugerencia gana una cadena de efectos y su procedencia; el envío de la tarjeta aprende a mandar la cadena completa.

**Tech Stack:** Node 25 (`node:test`), ESM, sin dependencias, WebHID, HTML/CSS/JS a mano.

**Spec:** `docs/superpowers/specs/2026-09-06-presets-comunidad-design.md`

## Global Constraints

- **Node ≥ 24. Cero dependencias npm.** Sin paso de build. El parseo de CSV se escribe a mano.
- **ESM**: `import`, nunca `require`.
- **Tests con `node:test`** y `node:assert/strict`, corridos con `npm test` (que es `node --test test/*.test.js`; un directorio pelado falla en Node 25).
- **Ningún test toca la red ni el hardware.**
- **Idioma**: interfaz, mensajes y comentarios en español. No se traducen: ranuras (`amp`, `stomp`, `mod`, `delay`, `reverb`), nombres de parámetro (`gain`, `treb`, `bass`, `time`…) ni los `FenderId`.
- **Nada de adivinar nombres.** Ni por prefijo, ni por distancia de edición, ni por parecido. Exacto o alias explícito; lo demás se descarta con aviso.
- **Lo que no se sabe convertir no se manda.** La perilla queda en el valor por defecto de la unidad y la interfaz lo dice.
- **Escaping**: todo lo que venga del CSV y llegue a HTML pasa por `esc()`. Es texto de terceros.
- **Un commit por tarea**, con la suite pasando.
- **La suite parte en 183 tests.** Cada tarea declara cuántos agrega, no a qué total llega.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `data/presets-lt25-bandas.csv` | **Crear.** Hoja 1 cruda, verbatim |
| `data/presets-lt25-tonos.csv` | **Crear.** Hoja 2 cruda, verbatim |
| `data/PROCEDENCIA.md` | **Crear.** De dónde salieron, cuándo, y qué son |
| `lib/csv.js` | **Crear.** Parser de CSV puro |
| `lib/lt25-nombres.js` | **Crear.** Nombre del CSV → `FenderId` del catálogo |
| `lib/presets-comunidad.js` | **Crear.** Importa las dos hojas y las indexa |
| `lib/ampli.js` | **Modificar.** Precedencia: preset de la comunidad antes que la tabla |
| `public/app.js` | **Modificar.** Mandar la cadena; mostrar procedencia |
| `docs/presets-comunidad-auditoria.md` | **Crear.** Qué entró, qué se descartó y por qué |
| `test/csv.test.js`, `test/lt25-nombres.test.js`, `test/presets-comunidad.test.js` | **Crear.** |

---

### Task 1: El parser de CSV

**Files:**
- Create: `lib/csv.js`
- Test: `test/csv.test.js`

**Interfaces:**
- Produces: `parsearCsv(texto)` → `string[][]`; `numeroCsv(celda)` → `number | null`.

**Por qué a mano.** Los dos CSV traen comillas, comas dentro de campos, saltos de línea dentro de celdas y decimales con coma. Un `split(',')` los rompe en silencio, que es la peor forma de romperlos.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/csv.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsearCsv, numeroCsv } from '../lib/csv.js'

test('separa filas y columnas simples', () => {
  assert.deepEqual(parsearCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
})

test('respeta las comas dentro de comillas', () => {
  assert.deepEqual(parsearCsv('a,"b,c",d'), [['a', 'b,c', 'd']])
})

test('respeta los saltos de linea dentro de comillas', () => {
  // Pasa de verdad en la hoja 1: una celda con el nombre de la banda en dos lineas.
  assert.deepEqual(parsearCsv('a,"b\nc",d'), [['a', 'b\nc', 'd']])
})

test('unas comillas dobles dentro de un campo son una comilla', () => {
  assert.deepEqual(parsearCsv('a,"di ""hola""",b'), [['a', 'di "hola"', 'b']])
})

test('conserva las celdas vacias, que es donde vive el significado', () => {
  // La hoja 1 usa columnas fijas: una celda vacia dice "esta perilla no se
  // especifico". Colapsarlas correria todo el bloque y asignaria mal los valores.
  assert.deepEqual(parsearCsv('a,,,b'), [['a', '', '', 'b']])
})

test('tolera CRLF', () => {
  assert.deepEqual(parsearCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']])
})

test('la ultima fila sin salto final no se pierde', () => {
  assert.deepEqual(parsearCsv('a,b\n1,2\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']])
})

test('numeroCsv acepta el punto y la coma decimal', () => {
  assert.equal(numeroCsv('8.5'), 8.5)
  assert.equal(numeroCsv('9,0'), 9)      // asi viene en la hoja 2
  assert.equal(numeroCsv('10,0'), 10)
  assert.equal(numeroCsv('  4  '), 4)
  assert.equal(numeroCsv('-6'), -6)
})

test('numeroCsv devuelve null para lo que no es un numero, incluido el guion', () => {
  // El guion es como las dos hojas dicen "esta ranura no se usa". Convertirlo
  // en 0 seria mandarle al amplificador un valor que nadie pidio.
  assert.equal(numeroCsv('-'), null)
  assert.equal(numeroCsv(''), null)
  assert.equal(numeroCsv('   '), null)
  assert.equal(numeroCsv(undefined), null)
  assert.equal(numeroCsv('n/a'), null)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/csv.test.js`
Esperado: FAIL con `Cannot find module '../lib/csv.js'`.

- [ ] **Step 3: Implementar**

Crear `lib/csv.js`:

```js
/* ---------------------------------------------------------------------------
   Parser de CSV, escrito a mano porque este proyecto no tiene dependencias.

   No es un `split(',')` por una razon concreta: los CSV de la comunidad traen
   comas dentro de campos entrecomillados, saltos de linea dentro de celdas y
   decimales con coma. Un split los rompe en silencio, corriendo las columnas
   -- y como esas columnas son posicionales, correrlas asigna el valor de una
   perilla a otra sin que nada avise.
   --------------------------------------------------------------------------- */

/* Devuelve las filas tal cual, celdas vacias incluidas. Las vacias importan:
   en la hoja de bandas las columnas son fijas y una celda vacia significa "esta
   perilla no se especifico", asi que colapsarlas correria el bloque entero. */
export function parsearCsv(texto) {
  const filas = []
  let fila = [], campo = '', dentro = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (dentro) {
      if (c !== '"') { campo += c; continue }
      if (texto[i + 1] === '"') { campo += '"'; i++ } else dentro = false
    } else if (c === '"') dentro = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

/* Un numero, o null. Nunca 0 por descarte: el guion es como las hojas dicen
   "esta ranura no se usa", y convertirlo en 0 le mandaria al amplificador un
   valor que nadie escribio. */
export function numeroCsv(celda) {
  const s = String(celda ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Esperado: PASS. Esta tarea agrega 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/csv.js test/csv.test.js
git commit -m "feat: parser de CSV escrito a mano, sin dependencias"
```

---

### Task 2: Traducir los nombres del CSV a los del equipo

**Files:**
- Create: `lib/lt25-nombres.js`
- Test: `test/lt25-nombres.test.js`

**Interfaces:**
- Produces: `resolverUnidad(nombre)` → `{ fenderId, nombre, ranura, parametros }` o `null`. `parametros` es el array de `controlId` **en el orden del catálogo**, que es lo que hace posible la decodificación posicional.

**El peligro concreto.** En la exploración, un resolvedor por prefijo convirtió el valor `5.0` en el modelo `50S TWIN`. Silenciosamente. Por eso: exacto, o alias explícito, o `null`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/lt25-nombres.test.js`:

```js
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/lt25-nombres.test.js`
Esperado: FAIL con `Cannot find module '../lib/lt25-nombres.js'`.

Si además falla por no encontrar los CSV, es correcto: los copia la Task 3. Implementa igual y deja ese último test para el final de la Task 3.

- [ ] **Step 3: Implementar**

Crear `lib/lt25-nombres.js`:

```js
/* ---------------------------------------------------------------------------
   Traduce los nombres que usa la planilla de la comunidad a las unidades reales
   del amplificador.

   La regla, y no es pedanteria: EXACTO o alias explicito. Nada de prefijos, ni
   distancia de edicion, ni parecido. Al explorar, un resolvedor por prefijo
   convirtio el valor "5.0" en el modelo "50S TWIN" sin decir nada; y este
   proyecto ya tuvo una vez tres nombres de modelo mal por confiar en una fuente
   que no era el equipo. Un nombre que no calza no se aproxima: se descarta.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'

const UNIDADES = JSON.parse(
  readFileSync(new URL('../public/lt25-unidades.json', import.meta.url), 'utf8'))

const clave = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/* Las abreviaturas de la planilla. Cada una se escribe a mano una vez, y el
   ultimo test de este archivo garantiza que no falte ninguna. */
const ALIAS = {
  CHAMP: 'CHAMPION',
  '60SUKCLN': '60S UK CLEAN', '70SUKCLN': '70S UK CLEAN', '60SUK': '60S UK CLEAN',
  DELUXECLEAN: 'DELUXE CLN', '50S': '50S TWIN',
  COMP: 'COMPRESSOR', MYTH: 'MYTHIC DRIVE', MYTHDRIVE: 'MYTHIC DRIVE',
  MYTHEDITFORPERSONALTASTE: 'MYTHIC DRIVE',
  BLUES: 'BLUES DRIVE', DIRT: 'ROCK DIRT', GATE: 'METAL GATE',
  EQ: '5-BAND EQ', '5BANDEQ': '5-BAND EQ',
  WAH: 'TOUCH WAH',
  SMROOM: 'SMALL ROOM', LRGHALL: 'LARGE HALL', LGHALL: 'LARGE HALL',
}

const porClave = new Map()
for (const u of UNIDADES) {
  const n = u.info?.displayName
  if (!n) continue
  porClave.set(clave(n), {
    fenderId: u.FenderId,
    nombre: n,
    ranura: u.info?.subcategory ?? null,
    // El ORDEN importa: es el de la pantalla del amplificador, y es lo que
    // permite leer las columnas sin nombre de la planilla.
    parametros: (u.ui?.uiParameters ?? []).map(p => p.controlId),
  })
}

export function resolverUnidad(nombre) {
  const k = clave(nombre)
  if (!k) return null
  return porClave.get(k) ?? porClave.get(clave(ALIAS[k] ?? '')) ?? null
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Esperado: PASS salvo el último test si los CSV todavía no están; ese cierra en la Task 3. Esta tarea agrega 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/lt25-nombres.js test/lt25-nombres.test.js
git commit -m "feat: traducir los nombres de la planilla a las unidades del equipo"
```

---

### Task 3: Importar las dos hojas

**Files:**
- Create: `data/presets-lt25-bandas.csv`, `data/presets-lt25-tonos.csv`, `data/PROCEDENCIA.md`, `lib/presets-comunidad.js`
- Test: `test/presets-comunidad.test.js`

**Interfaces:**
- Consumes: `parsearCsv`, `numeroCsv` (Task 1); `resolverUnidad` (Task 2).
- Produces: `PRESETS_BANDA` (array), `PRESETS_TONO` (array), `auditoria()` → `{ leidas, importadas, descartadas: [{fila, motivo}] }`.
  Cada preset: `{ clave, artista, cancion, epoca, genero, incierto, cadena }`, donde `cadena` es `{ amp: {fenderId, nombre, valores}, stomp: …, mod: …, delay: …, reverb: … }` y `valores` es `{ [controlId]: number }` **sólo con los que la planilla declara**.

- [ ] **Step 1: Copiar los CSV y escribir su procedencia**

```bash
mkdir -p data
cp /Users/coto/Downloads/presets-lt25.csv   data/presets-lt25-bandas.csv
cp /Users/coto/Downloads/presets-lt25-2.csv data/presets-lt25-tonos.csv
wc -l data/presets-lt25-*.csv
```

Esperado: 78 y 11 líneas. Se copian **verbatim**: no reformatear, no ordenar, no arreglar los decimales con coma. Son el dato auditable.

Crear `data/PROCEDENCIA.md`:

```markdown
# De dónde salieron estos archivos

Planilla mantenida por la comunidad de usuarios del Fender Mustang LT:
https://docs.google.com/spreadsheets/d/1KWvjJ6q6Ora2MqmxtUAWjq9Uerp0Ycza5ouuKuol5HQ/edit?gid=1647190216

Exportada el 2026-09-06. Copiada aquí **tal cual**, sin reformatear, para que
cualquiera pueda contrastar lo que la app hace contra lo que la planilla dice.

- `presets-lt25-bandas.csv` — 77 presets indexados por guitarrista y/o banda.
- `presets-lt25-tonos.csv` — 10 tonos con nombre genérico.

**Es trabajo de otras personas.** Se cita, no se apropia. Este repositorio es
local y no se publica; si algún día se publicara, hay que revisar antes en qué
términos la planilla permite redistribuirse.

**Es opinión, no medición.** Son los ajustes que a alguien le funcionaron, no el
tono de la grabación. La planilla marca su propia incertidumbre en varias filas
(`{EXPERIMENTAL}`, `(INACCURATE)`, `Pearl jam?`) y esas marcas viajan hasta la
pantalla: no se limpian.

Dos columnas del bloque de amplificador (la 6ª y la 7ª) **no se usan**: los
veinte modelos declaran cinco perillas y esas columnas traen valores negativos,
así que no son perillas. Su significado se desconoce. Ver §3.1.1 de la spec.
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/presets-comunidad.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS_BANDA, PRESETS_TONO, auditoria } from '../lib/presets-comunidad.js'
import { resolverUnidad } from '../lib/lt25-nombres.js'

test('se leen las 77 filas de bandas y las 10 de tonos', () => {
  const a = auditoria()
  assert.equal(a.leidas.bandas, 77)
  assert.equal(a.leidas.tonos, 10)
})

test('nada se pierde en silencio: leidas = importadas + descartadas', () => {
  const a = auditoria()
  assert.equal(a.importadas + a.descartadas.length, a.leidas.bandas + a.leidas.tonos)
})

test('cada descarte dice por que', () => {
  for (const d of auditoria().descartadas) {
    assert.ok(d.motivo && d.motivo.length > 5, `descarte sin motivo: ${JSON.stringify(d)}`)
  }
})

test('un preset conocido llega entero', () => {
  const p = PRESETS_BANDA.find(x => /enter sandman/i.test(x.cancion ?? ''))
  assert.equal(p.artista.toLowerCase(), 'metallica')
  assert.equal(p.cadena.amp.nombre, 'METAL 2000')
  assert.ok(Number.isFinite(p.cadena.amp.valores.gain))
})

test('las marcas de incertidumbre de la planilla se conservan', () => {
  const inciertos = PRESETS_BANDA.filter(p => p.incierto)
  assert.ok(inciertos.length >= 4, 'la planilla marca al menos cuatro filas como dudosas')
  assert.ok(inciertos.some(p => /radiohead/i.test(p.artista)))
})

test('los valores se leen posicionalmente y en el orden del catalogo', () => {
  // La invariante que hizo creible toda la decodificacion: ningun preset puede
  // declarar un parametro que su unidad no tenga.
  for (const p of [...PRESETS_BANDA, ...PRESETS_TONO]) {
    for (const [ranura, u] of Object.entries(p.cadena)) {
      const real = resolverUnidad(u.nombre)
      for (const k of Object.keys(u.valores)) {
        assert.ok(real.parametros.includes(k),
          `${p.clave}: ${ranura}=${u.nombre} declara "${k}", que no es una perilla suya`)
      }
    }
  }
})

test('del bloque de amplificador solo entran las cinco perillas reales', () => {
  // Las columnas 6 y 7 traen valores negativos y no sabemos que son (spec 3.1.1).
  for (const p of PRESETS_BANDA) {
    if (!p.cadena.amp) continue
    assert.ok(Object.keys(p.cadena.amp.valores).length <= 5)
    for (const v of Object.values(p.cadena.amp.valores)) assert.ok(v >= 0, 'una perilla nunca es negativa')
  }
})

test('un guion no se convierte en cero', () => {
  for (const p of [...PRESETS_BANDA, ...PRESETS_TONO])
    for (const u of Object.values(p.cadena))
      for (const [k, v] of Object.entries(u.valores))
        assert.ok(v !== null && Number.isFinite(v), `${p.clave}: ${k} quedo en ${v}`)
})

test('los duplicados por banda conservan su epoca, que es lo que los distingue', () => {
  const rush = PRESETS_BANDA.filter(p => /rush/i.test(p.artista))
  assert.equal(rush.length, 3)
  assert.equal(new Set(rush.map(p => p.epoca)).size, 3)
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `node --test test/presets-comunidad.test.js`
Esperado: FAIL con `Cannot find module '../lib/presets-comunidad.js'`.

- [ ] **Step 4: Implementar**

Crear `lib/presets-comunidad.js`. Estructura de las hojas, verificada contra los archivos:

- **Bandas**: una fila de cabecera. `0` Band, `1` Genre, `2` Era; bloques `[nombre, primerValor, ancho]` = amp `[3, 4, 7]`, stomp `[11, 12, 5]`, mod `[17, 18, 5]`, delay `[23, 24, 4]`, reverb `[28, 29, 3]`.
- **Tonos**: una fila de cabecera. `0` TONE; amp `[1, 2, 5]`, stomp `[7, 8, 5]`, mod `[13, 14, 5]`, delay `[19, 20, 4]`, reverb `[24, 25, 3]`.

```js
/* ---------------------------------------------------------------------------
   Importa la planilla de la comunidad (ver data/PROCEDENCIA.md).

   Es OPINION, no medicion: los ajustes que a alguien le funcionaron. Por eso
   cada preset conserva de donde salio y si la propia planilla lo marco como
   dudoso, y por eso nada se descarta en silencio -- auditoria() dice cuantas
   filas se leyeron, cuantas entraron y por que se cayo cada una.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs'
import { parsearCsv, numeroCsv } from './csv.js'
import { resolverUnidad } from './lt25-nombres.js'

const leer = f => parsearCsv(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'))

const BLOQUES_BANDA = { amp: [3, 4, 7], stomp: [11, 12, 5], mod: [17, 18, 5], delay: [23, 24, 4], reverb: [28, 29, 3] }
const BLOQUES_TONO  = { amp: [1, 2, 5], stomp: [7, 8, 5], mod: [13, 14, 5], delay: [19, 20, 4], reverb: [24, 25, 3] }

const descartes = []
const marcaIncierta = /\{EXPERIMENTAL\}|\(INACCURATE\)|\?/i

/* Lee un bloque: la unidad y sus perillas, por POSICION en el orden que declara
   el catalogo. Solo entran los parametros que la planilla escribio; el resto se
   queda en el valor por defecto de la unidad, que es dato real del equipo.

   Del amplificador solo se leen sus cinco perillas aunque la hoja reserve siete
   columnas: las dos ultimas traen valores negativos y no sabemos que son. */
function leerBloque(fila, [iNombre, iValor, ancho], donde) {
  const crudo = (fila[iNombre] ?? '').trim()
  if (!crudo || crudo === '-') return null
  const u = resolverUnidad(crudo)
  if (!u) { descartes.push({ fila: donde, motivo: `unidad no reconocida: "${crudo}"` }); return null }
  const valores = {}
  const cuantos = Math.min(ancho, u.parametros.length)
  for (let k = 0; k < cuantos; k++) {
    const v = numeroCsv(fila[iValor + k])
    if (v !== null) valores[u.parametros[k]] = v
  }
  return { fenderId: u.fenderId, nombre: u.nombre, valores }
}

function leerCadena(fila, bloques, donde) {
  const cadena = {}
  for (const [ranura, b] of Object.entries(bloques)) {
    const u = leerBloque(fila, b, donde)
    if (u) cadena[ranura] = u
  }
  return cadena
}

// "Metallica - Enter Sandman" -> artista y cancion. "Alex Lifeson / Rush" -> banda.
function partirClave(txt) {
  const limpio = txt.replace(/\{[^}]*\}|\([^)]*\)/g, '').trim()
  const porBarra = limpio.split(/\s*\/\/?\s*/).map(s => s.trim()).filter(Boolean)
  const base = porBarra.length > 1 ? porBarra[porBarra.length - 1] : porBarra[0] ?? limpio
  const m = base.match(/^(.+?)\s+-\s+(.+)$/)
  return m ? { artista: m[1].trim(), cancion: m[2].trim() } : { artista: base, cancion: null }
}

const filasBanda = leer('presets-lt25-bandas.csv').slice(1).filter(f => f[0]?.trim())
const filasTono  = leer('presets-lt25-tonos.csv').slice(1).filter(f => f[0]?.trim())

export const PRESETS_BANDA = filasBanda.map(f => {
  const clave = f[0].trim()
  const { artista, cancion } = partirClave(clave)
  return {
    clave, artista, cancion,
    genero: (f[1] ?? '').trim() || null,
    epoca: (f[2] ?? '').trim().replace(/^-$/, '') || null,
    incierto: marcaIncierta.test(clave),
    cadena: leerCadena(f, BLOQUES_BANDA, clave),
  }
}).filter(p => Object.keys(p.cadena).length > 0 ||
    (descartes.push({ fila: p.clave, motivo: 'ninguna ranura reconocible' }), false))

export const PRESETS_TONO = filasTono.map(f => ({
  clave: f[0].trim(), artista: null, cancion: null, genero: null, epoca: null,
  incierto: marcaIncierta.test(f[0]),
  cadena: leerCadena(f, BLOQUES_TONO, f[0].trim()),
})).filter(p => Object.keys(p.cadena).length > 0 ||
    (descartes.push({ fila: p.clave, motivo: 'ninguna ranura reconocible' }), false))

export const auditoria = () => ({
  leidas: { bandas: filasBanda.length, tonos: filasTono.length },
  importadas: PRESETS_BANDA.length + PRESETS_TONO.length,
  descartadas: descartes,
})
```

- [ ] **Step 5: Correr los tests, incluido el que quedó pendiente en la Task 2**

Run: `npm test`
Esperado: PASS, incluido `todo nombre de unidad de los dos CSV resuelve`. Esta tarea agrega 9 tests.

Si algún nombre no resuelve, **no lo aproximes**: agrégalo a `ALIAS` en `lib/lt25-nombres.js` si sabes qué unidad es, o a `DESCARTADOS` en el test con un comentario que diga por qué no lo es.

- [ ] **Step 6: Commit**

```bash
git add data/ lib/presets-comunidad.js test/presets-comunidad.test.js lib/lt25-nombres.js test/lt25-nombres.test.js
git commit -m "feat: importar la planilla de presets de la comunidad"
```

---

### Task 4: Calzar presets con canciones

**Files:**
- Modify: `lib/presets-comunidad.js`
- Test: `test/presets-comunidad.test.js`

**Interfaces:**
- Produces: `buscarPreset({ artist, title, tags })` → `{ preset, motivo }` o `null`. `motivo` es `'cancion'`, `'artista'` o `'artista (sin desempate de epoca)'`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/presets-comunidad.test.js`:

```js
import { buscarPreset } from '../lib/presets-comunidad.js'

test('una cancion nombrada gana sobre el preset de su artista', () => {
  const r = buscarPreset({ artist: 'Metallica', title: 'Enter Sandman', tags: [] })
  assert.equal(r.motivo, 'cancion')
  assert.match(r.preset.clave, /Enter Sandman/i)
})

test('otra cancion del mismo artista cae en el preset de artista', () => {
  const r = buscarPreset({ artist: 'Metallica', title: 'Master of Puppets', tags: [] })
  assert.equal(r.motivo, 'artista')
  assert.equal(r.preset.artista.toLowerCase(), 'metallica')
})

test('el nombre se normaliza: mayusculas, acentos y el articulo inicial', () => {
  assert.ok(buscarPreset({ artist: 'THE ROLLING STONES', title: 'x', tags: [] }))
  assert.ok(buscarPreset({ artist: 'Rolling Stones', title: 'x', tags: [] }))
})

test('con varios presets del mismo artista, la epoca de la cancion desempata', () => {
  const r = buscarPreset({ artist: 'Rush', title: 'x', tags: ['80s'] })
  assert.match(r.preset.epoca, /80/)
  assert.equal(r.motivo, 'artista')
})

test('sin epoca que calce se elige uno, y se dice que fue sin desempate', () => {
  const r = buscarPreset({ artist: 'Rush', title: 'x', tags: [] })
  assert.equal(r.motivo, 'artista (sin desempate de epoca)')
})

test('un artista sin preset no devuelve uno parecido', () => {
  assert.equal(buscarPreset({ artist: 'Los Prisioneros', title: 'x', tags: [] }), null)
  assert.equal(buscarPreset({ artist: '', title: '', tags: [] }), null)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/presets-comunidad.test.js`
Esperado: FAIL con `buscarPreset is not a function`.

- [ ] **Step 3: Implementar**

Agregar a `lib/presets-comunidad.js`:

```js
/* Normaliza para comparar: sin mayusculas, sin acentos, sin el articulo inicial
   y sin puntuacion. "THE ROLLING STONES" y "Rolling Stones" tienen que ser lo
   mismo, porque la planilla y el catalogo no escriben igual. */
const norm = s => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const porCancion = new Map(), porArtista = new Map()
for (const p of PRESETS_BANDA) {
  if (p.cancion) porCancion.set(`${norm(p.artista)}||${norm(p.cancion)}`, p)
  const k = norm(p.artista)
  if (k) porArtista.set(k, [...(porArtista.get(k) ?? []), p])
}

const DECADAS = ['50s', '60s', '70s', '80s', '90s', '00s', '2000s', '2010s']

/* De lo mas especifico a lo mas generico. Una cancion nombrada gana; si no,
   el artista; y entre varios presets del mismo artista desempata la decada,
   que es justo lo que los distingue en la planilla (Rush tiene tres). */
export function buscarPreset({ artist, title, tags = [] }) {
  const a = norm(artist)
  if (!a) return null

  const exacta = porCancion.get(`${a}||${norm(title)}`)
  if (exacta) return { preset: exacta, motivo: 'cancion' }

  const suyos = porArtista.get(a)
  if (!suyos?.length) return null
  if (suyos.length === 1) return { preset: suyos[0], motivo: 'artista' }

  const decadas = new Set(tags.map(t => String(t).toLowerCase()).filter(t => DECADAS.includes(t)))
  const porEpoca = suyos.find(p => p.epoca && [...decadas].some(d => p.epoca.toLowerCase().includes(d.slice(0, 2))))
  return porEpoca
    ? { preset: porEpoca, motivo: 'artista' }
    // Se elige uno igual, pero se dice: la interfaz no puede presentar como
    // "el tono de Rush" algo que es "uno de los tres tonos de Rush".
    : { preset: suyos[0], motivo: 'artista (sin desempate de epoca)' }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Esperado: PASS. Esta tarea agrega 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/presets-comunidad.js test/presets-comunidad.test.js
git commit -m "feat: calzar presets de la comunidad con cancion, artista y epoca"
```

---

### Task 5: El mapeo de tonos a géneros

**Files:**
- Modify: `lib/presets-comunidad.js`
- Test: `test/presets-comunidad.test.js`

**Interfaces:**
- Produces: `presetDeGenero(tags)` → `{ preset, motivo: 'genero' }` o `null`.

**Esto es juicio, no dato**, y el código tiene que decirlo. Los 10 tonos de la hoja 2 no vienen atados a ningún género: el mapeo lo decide quien escribe esta tabla.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/presets-comunidad.test.js`:

```js
import { presetDeGenero, MAPEO_TONO_GENERO } from '../lib/presets-comunidad.js'

test('cada tono mapeado existe de verdad en la hoja de tonos', () => {
  // Un mapeo que apunta a un tono inexistente es una regla muerta y silenciosa.
  for (const tono of Object.values(MAPEO_TONO_GENERO)) {
    assert.ok(PRESETS_TONO.some(p => p.clave === tono), `"${tono}" no esta en la hoja de tonos`)
  }
})

test('un tag mapeado devuelve su tono', () => {
  const r = presetDeGenero(['blues'])
  assert.equal(r.motivo, 'genero')
  assert.equal(r.preset.clave, 'Texas Blues')
})

test('gana el tag mas especifico, no el primero de la lista de la cancion', () => {
  const r = presetDeGenero(['rock', 'doom metal'])
  assert.equal(r.preset.clave, 'Doom Wizard')
})

test('un genero sin mapeo no inventa un tono', () => {
  assert.equal(presetDeGenero(['reggaeton']), null)
  assert.equal(presetDeGenero([]), null)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/presets-comunidad.test.js`
Esperado: FAIL con `presetDeGenero is not a function`.

- [ ] **Step 3: Implementar**

Agregar a `lib/presets-comunidad.js`:

```js
/* Los diez tonos de la hoja 2 no vienen atados a ningun genero: este mapeo lo
   decidio quien escribio esta tabla, mirando el nombre del tono y las unidades
   que trae. ES JUICIO, NO DATO -- a diferencia de los presets por banda, aqui
   nadie dijo "este tono es para blues". Se puede discutir fila por fila, y la
   interfaz lo presenta como lo que es.

   Los tonos sin fila aqui no se usan: "Goated Solo Tone" no es un genero. */
export const MAPEO_TONO_GENERO = {
  'blues': 'Texas Blues',
  'blues rock': 'Texas Blues',
  'electric blues': 'Texas Blues',
  'doom metal': 'Doom Wizard',
  'sludge': 'Doom Wizard',
  'stoner rock': 'Doom Wizard',
  'alternative metal': 'Alt Metal ish',
  'nu metal': 'Alt Metal ish',
  'jazz': 'Clean Jazz Amp',
  'bossa nova': 'Clean Jazz Amp',
  'new wave': 'Bright Chorus',
  'post-punk': 'Bright Chorus',
  'indie rock': 'Chorus + Drive',
  'shoegaze': 'Sexy Flanger',
  'dream pop': 'Sexy Flanger',
}

// Del tag mas especifico al mas generico, igual que la tabla de reglas: gana el
// primero que calza en ESTE orden, no el orden en que la cancion trae sus tags.
const ORDEN_TONOS = Object.keys(MAPEO_TONO_GENERO)

export function presetDeGenero(tags = []) {
  const presentes = new Set(tags.map(t => String(t).toLowerCase()))
  const tag = ORDEN_TONOS.find(t => presentes.has(t))
  if (!tag) return null
  const preset = PRESETS_TONO.find(p => p.clave === MAPEO_TONO_GENERO[tag])
  return preset ? { preset, motivo: 'genero' } : null
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Esperado: PASS. Esta tarea agrega 4 tests.

Si `cada tono mapeado existe de verdad` falla, el nombre en `MAPEO_TONO_GENERO` no coincide con la columna `TONE` del CSV. Cópialo del archivo, no lo escribas de memoria.

- [ ] **Step 5: Commit**

```bash
git add lib/presets-comunidad.js test/presets-comunidad.test.js
git commit -m "feat: mapear los tonos genericos de la planilla a generos"
```

---

### Task 6: Meter los presets en la sugerencia

**Files:**
- Modify: `lib/ampli.js`
- Test: `test/ampli.test.js`

**Interfaces:**
- Consumes: `buscarPreset`, `presetDeGenero` (Tasks 4 y 5).
- Produces: `sugerirAjustes({ tags, instrument, tuning, artist, title })` gana tres campos: `cadena` (o `null`), `fuente` (`'comunidad'` / `'reglas'`) y `procedencia` (texto para la interfaz). Los campos que ya devolvía no cambian de nombre ni de forma.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/ampli.test.js`:

```js
test('una cancion con preset de la comunidad lo usa, y lo dice', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.fuente, 'comunidad')
  assert.match(r.procedencia, /Enter Sandman/i)
  assert.ok(r.cadena.amp)
})

test('sin preset, la tabla de reglas sigue mandando y se dice tambien', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Banda Que No Existe', title: 'x' })
  assert.equal(r.fuente, 'reglas')
  assert.equal(r.modelo, 'METAL 2000')
  assert.match(r.procedencia, /tags/i)
})

test('llamarla sin artista sigue funcionando igual que antes', () => {
  // Toda la suite anterior la llama asi: no puede romperse.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar', tuning: null })
  assert.equal(r.modelo, 'METAL 2000')
  assert.equal(r.fuente, 'reglas')
})

test('un preset marcado como dudoso por la planilla llega marcado', () => {
  const r = sugerirAjustes({ tags: [], instrument: 'Distortion Guitar', tuning: null,
    artist: 'Radiohead', title: 'Creep' })
  assert.ok(r.incierto, 'la planilla marco esa fila como experimental')
})

test('lo que la planilla no dice queda en null, no en un valor inventado', () => {
  // El corazon de este modulo: un numero inventado que parece plausible es peor
  // que no tener el dato. Un preset sin reverb declarado no puede llegar con un 5.
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.equal(r.reverb, null)
  for (const k of ['gain', 'volume', 'treble', 'bass'])
    assert.ok(r[k] === null || (r[k] >= 1 && r[k] <= 10), `${k} = ${r[k]}`)
})

test('el modelo del preset de la comunidad tambien viaja con su FenderId', () => {
  const r = sugerirAjustes({ tags: ['thrash metal'], instrument: 'Distortion Guitar',
    tuning: null, artist: 'Metallica', title: 'Enter Sandman' })
  assert.ok(r.fenderId.startsWith('DUBS_'))
  assert.equal(r.fenderId, r.cadena.amp.fenderId)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/ampli.test.js`
Esperado: FAIL — `r.fuente` es `undefined`.

- [ ] **Step 3: Implementar**

En `lib/ampli.js`, importar arriba:

```js
import { buscarPreset, presetDeGenero } from './presets-comunidad.js'
```

Y al principio de `sugerirAjustes`, antes de buscar en `REGLAS`:

```js
export function sugerirAjustes({ tags = [], instrument = '', tuning = null, artist = '', title = '' } = {}) {
  /* Precedencia: lo especifico gana. Un preset que alguien dialo para esta
     banda vale mas que lo que deducimos de una etiqueta de genero -- pero es
     OPINION de esa persona, no medicion, asi que viaja diciendo de donde salio
     y si la propia planilla lo marco como dudoso. */
  const hallado = buscarPreset({ artist, title, tags }) ?? presetDeGenero(tags)
  if (hallado) {
    const { preset, motivo } = hallado
    const amp = preset.cadena.amp
    const v = amp?.valores ?? {}
    return {
      modelo: amp?.nombre ?? null,
      fenderId: amp?.fenderId ?? null,
      /* La escala de la planilla es la misma que la nuestra: 1-10 de pantalla.
         Lo que la planilla NO dice queda en null, nunca en un valor por
         descarte: un 5 inventado se veria igual que un 5 que alguien eligio, y
         es justo la mentira que este modulo se niega a contar desde su primera
         linea. La interfaz no dibuja las perillas que vienen en null. */
      gain: v.gain ?? null, volume: v.volume ?? null,
      treble: v.treb ?? null, bass: v.bass ?? null,
      reverb: null,   // la planilla no trae el reverb del panel
      cadena: preset.cadena,
      fuente: 'comunidad',
      incierto: preset.incierto,
      procedencia: motivo === 'cancion'
        ? `preset de la comunidad para ${preset.clave}`
        : motivo === 'genero'
          ? `tono "${preset.clave}" de la comunidad, que elegimos nosotros para este genero`
          : `preset de la comunidad para ${preset.artista}` +
            (motivo.includes('sin desempate') ? ', uno de varios' : ''),
      motivos: [motivo === 'genero' ? 'tono de la comunidad' : 'preset de la comunidad'],
    }
  }
  // …aqui sigue el cuerpo actual, sin cambios…
```

Y en el `return` final del cuerpo actual, agregar los tres campos nuevos:

```js
  return { modelo, fenderId: fenderIdDeModelo(modelo), ...p, motivos,
           cadena: null, fuente: 'reglas', incierto: false,
           procedencia: 'deducido de tus tags de genero' }
```

- [ ] **Step 4: Correr toda la suite**

Run: `npm test`
Esperado: PASS. Esta tarea agrega 5 tests. **Los tests anteriores de `sugerirAjustes` tienen que seguir pasando sin tocarse**: llaman sin `artist`, y esa forma no cambia.

- [ ] **Step 5: Commit**

```bash
git add lib/ampli.js test/ampli.test.js
git commit -m "feat: la sugerencia usa el preset de la comunidad cuando existe"
```

---

### Task 7: Mandar la cadena al amplificador

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `actual.ampli.cadena` (Task 6); `ampli.leerPreset`, `ampli.reemplazarUnidad`, `ampli.ponerParametro` (ya existen).

**Sin tests automáticos:** es cableado de DOM y WebHID. La suite no cambia de número.

**Lo que ya está resuelto y no hay que rehacer:** el envío actual ya lee el preset, guarda el `volume`, cambia el modelo, lo devuelve y manda tres perillas, con todos los caminos de fallo cubiertos y en rojo. Esta tarea **extiende** ese bloque a las otras cuatro ranuras.

- [ ] **Step 1: Reemplazar las cinco unidades, no sólo el ampli**

Donde hoy se llama `ampli.reemplazarUnidad('amp', fenderId)`, recorrer las cinco ranuras. Las que la cadena no menciona van a `EMPTY` (`DUBS_Passthru`), que es la decisión de la spec §6.2: el botón promete el tono de esta canción, y un delay heredado de la canción anterior es exactamente el efecto arbitrario que este diseño evita.

```js
const RANURAS = ['stomp', 'mod', 'amp', 'delay', 'reverb']
const VACIA = 'DUBS_Passthru'
for (const ranura of RANURAS) {
  const quiere = cadena?.[ranura]?.fenderId ?? (ranura === 'amp' ? fenderId : VACIA)
  if (cargadas[ranura] === quiere) continue      // ya esta puesta: no la recargues
  await ampli.reemplazarUnidad(ranura, quiere)
}
```

`cargadas` sale del preset que ya se lee al principio del envío: `Object.fromEntries(preset.audioGraph.nodes.map(n => [n.nodeId, n.FenderId]))`.

- [ ] **Step 2: Cargar el catálogo en `app.js`**

`app.js` todavía no conoce el catálogo de unidades; lo carga `editor.js`. Hace
falta aquí para saber convertir cada perilla y para saber cuáles **no** se saben
convertir. Se carga una vez, perezosamente, igual que allá:

```js
import { crearCatalogo } from './catalogo-lt25.js'
let catalogoLt25 = null
async function catalogo() {
  if (!catalogoLt25) {
    const r = await fetch('/lt25-unidades.json')
    if (!r.ok) throw new Error(`no pude cargar el catalogo: HTTP ${r.status}`)
    catalogoLt25 = crearCatalogo(await r.json())
  }
  return catalogoLt25
}
```

- [ ] **Step 3: Mandar los parámetros de cada unidad, saltando lo que no se sabe convertir**

Después de devolver el `volume`:

```js
for (const ranura of RANURAS) {
  const u = cadena?.[ranura]
  if (!u) continue
  for (const [parametro, valorPantalla] of Object.entries(u.valores)) {
    // El volume se devuelve aparte, con el que tenia el usuario.
    if (ranura === 'amp' && parametro === 'volume') continue
    const d = descriptor(u.fenderId, parametro)
    if (!d || d.crudo) { sinConvertir.push(`${ranura}.${parametro}`); continue }
    try { await ampli.ponerParametro(ranura, parametro, d.aCable(valorPantalla)); confirmados.push(`${ranura}.${parametro}`) }
    catch { fallidos.push(`${ranura}.${parametro}`) }
  }
}
```

`descriptor(fenderId, id)` es `(await catalogo()).parametrosDe(fenderId).find(p => p.id === id)`, con el `catalogo()` del paso anterior. `d.crudo` es `true` justamente en los parámetros cuya curva todavía no se midió.

- [ ] **Step 4: Decir lo que no se mandó**

`sinConvertir` no puede quedarse callado. Agregarlo al estado del envío, con el mismo criterio que el resto: se informa lo que el equipo confirmó, y **también lo que ni se intentó y por qué**.

```js
if (sinConvertir.length) {
  estado.textContent += ` · sin mandar (falta medir su curva): ${sinConvertir.join(', ')}`
}
```

- [ ] **Step 5: Verificar**

Run: `npm test` → en verde, sin cambio en el número de tests.
Run: `node --check public/app.js`

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: el boton manda la cadena de efectos completa"
```

---

### Task 8: Mostrar la cadena y de dónde salió

**Files:**
- Modify: `public/app.js`, `public/style.css`

**Sin tests automáticos.** La suite no cambia de número.

- [ ] **Step 1: No dibujar las perillas que no tienen valor**

Hoy la plantilla dibuja las cinco siempre. Con un preset de la comunidad, las que
la planilla no declara llegan en `null` y no se pueden dibujar como si valieran
algo. Reemplazar las cinco llamadas fijas a `perilla(...)` por:

```js
const perillas = [['Gain', a.gain], ['Volume', a.volume], ['Treble', a.treble],
                  ['Bass', a.bass], ['Reverb', a.reverb]]
  .filter(([, v]) => v != null)
  .map(([n, v]) => perilla(n, v)).join('')
```

y usar `${perillas}` donde antes iban las cinco líneas.

- [ ] **Step 2: La cadena en la tarjeta**

En la plantilla del bloque `<details class="ampli">`, después de las perillas, listar las ranuras que la cadena ocupa. Todo lo que venga del CSV pasa por `esc()`.

```js
const cadenaHtml = a.cadena
  ? `<ul class="cadena">${['stomp','mod','delay','reverb']
      .filter(r => a.cadena[r])
      .map(r => `<li><span>${r}</span> <strong>${esc(a.cadena[r].nombre)}</strong></li>`)
      .join('') || '<li class="sin-efectos">sin efectos: este tono es el ampli pelado</li>'}</ul>`
  : ''
```

- [ ] **Step 3: La procedencia, con sus palabras**

Reemplazar el párrafo `.descargo` para que diga de dónde salen los números. No es decoración: un preset que alguien dialó y una deducción de etiquetas merecen frases distintas.

```js
<p class="descargo">
  ${a.fuente === 'comunidad'
    ? `${esc(a.procedencia)}.${a.incierto ? ' <strong>La propia planilla marca este preset como dudoso.</strong>' : ''}
       Es lo que a alguien le funcionó, no el tono de la grabación.`
    : `Punto de partida, no el tono del disco. Deducido de: ${a.motivos.map(esc).join(', ')}.`}
  <br>
  Al ampli se mandan el <strong>modelo</strong>, los <strong>efectos</strong> y sus perillas.
  Las ranuras que este tono no usa quedan vacías, así que no se te mezcla con la canción anterior.
</p>
```

- [ ] **Step 4: Estilos**

Agregar al final de `public/style.css`:

```css
/* --- La cadena de efectos en la tarjeta ---------------------------------- */
.cadena { list-style: none; margin: var(--e2) 0 0; padding: 0; display: grid; gap: var(--e1); }
.cadena li { display: flex; gap: var(--e2); align-items: baseline; font-size: var(--t-chico); }
.cadena li span { font-size: var(--t-micro); color: var(--tenue); text-transform: uppercase;
  letter-spacing: .08em; min-width: 4.5rem; }
.sin-efectos { color: var(--tenue); font-size: var(--t-micro); }
```

Verificar que esas custom properties existen en `:root` de `public/style.css`. Si alguna falta, usar la más cercana que exista y decirlo en el reporte, sin inventar valores.

- [ ] **Step 5: Verificar**

Run: `npm test` → en verde, sin cambio.
Run: `node --check public/app.js`

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: mostrar la cadena de efectos y de donde salio"
```

---

### Task 9: La auditoría del import

**Files:**
- Create: `docs/presets-comunidad-auditoria.md`

**Por qué es una tarea y no un comentario.** Un import que pierde filas en silencio es peor que uno que falla. Esto deja por escrito qué entró de verdad.

- [ ] **Step 1: Generar los números**

```bash
node --input-type=module -e '
import { PRESETS_BANDA, PRESETS_TONO, auditoria } from "./lib/presets-comunidad.js"
import { openDb } from "./db/open.js"
import { buscarPreset } from "./lib/presets-comunidad.js"
const a = auditoria()
console.log(JSON.stringify(a, null, 2))
const db = openDb("songs.db")
const filas = db.prepare(`SELECT s.artist, s.title,
  (SELECT group_concat(t.tag, char(124)) FROM tags t WHERE t.song_id = s.song_id) AS tags
  FROM songs s WHERE s.is_junk=0 AND s.is_blank=0`).all()
let cancion=0, artista=0, nada=0
for (const f of filas) {
  const r = buscarPreset({ artist: f.artist, title: f.title, tags: (f.tags??"").split("|") })
  if (!r) nada++; else if (r.motivo === "cancion") cancion++; else artista++
}
console.log(`canciones ${filas.length} | por cancion ${cancion} | por artista ${artista} | sin preset ${nada}`)
'
```

- [ ] **Step 2: Escribirla**

Crear `docs/presets-comunidad-auditoria.md` con: la fecha, cuántas filas trae cada hoja, cuántas entraron, **la lista completa de descartes Y DE AVISOS, cada uno con su motivo**, y cuántas canciones del catálogo quedan cubiertas por preset de canción, por preset de artista y por ninguno.

Los `avisos` son lo que de verdad hay que leer: los descartes de fila entera van a ser cero, y todas las anomalías reales del corpus —un nombre de unidad irresoluble, una celda no numérica, una ranura con valores y sin unidad— viven en `avisos`. Imprimir sólo los descartes dejaría el documento vacío y la impresión de que no hubo ninguna anomalía.

Si algún número no cuadra con la spec (§3), **el que manda es el medido**: corregir la spec en el mismo commit y decir cuál era el error.

- [ ] **Step 3: Commit**

```bash
git add docs/presets-comunidad-auditoria.md
git commit -m "docs: auditoria del import de presets de la comunidad"
```

---

### Task 10: Prueba manual con el amplificador

**Esta tarea la ejecuta el humano con el equipo enchufado.** No produce código.

- [ ] **Step 1: Levantar**

```bash
pkill -f "node server.js" 2>/dev/null
osascript -e 'quit app "Fender Tone LT Desktop"' 2>/dev/null
npm start
```

- [ ] **Step 2: Las comprobaciones**

En Chrome, `http://localhost:3000`, con el ampli conectado:

1. Sortear en modo "Riffs eléctricos" hasta que salga un tema de **Metallica**. La tarjeta dice "preset de la comunidad para Metallica" y lista los efectos.
2. Enviar. **Escuchar**: ¿suena a Metallica, más que la sugerencia genérica de antes?
3. Mirar el ampli: el modelo y las cuatro ranuras son los que la tarjeta mostraba.
4. Sortear un tema de un artista **sin** preset. La tarjeta dice "deducido de tus tags de género".
5. Enviar. Las ranuras de efectos quedan vacías, sin arrastrar nada del envío anterior.
6. Sortear **Enter Sandman** si aparece: la tarjeta lo nombra por canción, no por artista.
7. Una canción de **Radiohead**: la tarjeta advierte que la planilla marcó ese preset como dudoso.
8. Si algún envío informa "sin mandar (falta medir su curva)", anotar qué parámetros fueron.
9. **Reversibilidad**: reseleccionar el preset en la rueda del ampli. Todo vuelve.

- [ ] **Step 3: Reportar**

La 2 es la que decide. Todo lo demás puede estar bien y el proyecto habrá fallado si no suena más parecido.

---

## Notas de verificación final

```bash
npm test        # en verde; 183 de partida mas lo que agregue cada tarea
npm start       # y las nueve comprobaciones de la Task 10
```

**Una incógnita que se cierra sin código:** las columnas 6 y 7 del bloque de
amplificador se descartan porque no sabemos qué son (spec §3.1.1). La planilla
original es una hoja de cálculo y muy probablemente tiene una fila de encabezado
combinada que la exportación aplanó. Abrirla y mirar esas dos columnas es medio
minuto, y si tienen nombre, recuperarlas es agregar dos entradas al import.

Dos cosas que este plan **no** arregla, y que siguen siendo la mejora que más canciones tocaría (spec §9): que se use un solo tag de los 9,6 que trae cada canción, y que el ajuste acústico aplaste el género de 1.641 canciones. Quedan para su propio plan.
