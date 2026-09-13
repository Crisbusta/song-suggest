# Resolución de tono híbrida — diagnóstico y diseño

> Estado: **propuesta**. No hay nada implementado. Todas las cifras están
> medidas contra el `songs.db` real el 2026-09-13 (10.011 canciones, 9.788 con
> pista de guitarra, 25.061 pistas de guitarra) y contra los dos CSV de
> `data/`. Los scripts de medición son de un solo uso y no quedaron en el repo;
> cada cifra dice contra qué se midió para poder rehacerla.

---

## 1. Diagnóstico

### 1.1 Dónde está hoy la lógica

```
db/queries.js:pistasDeLaCancion()
  └─ por CADA pista: lib/ampli.js:sugerirAjustes({ tags, instrument, tuning, artist, title })
       ├─ lib/presets-comunidad.js:buscarPreset()     → preset entero de la planilla
       ├─ lib/presets-comunidad.js:presetDeGenero()   → preset entero de la hoja 2
       └─ REGLAS (24 filas, tag de género → modelo + 5 perillas)
     lib/ampli.js:paraElAmpli()                        → escala de cable
  └─ public/app.js  → despachador → ampli-usb → WebHID
```

`sugerirAjustes` hace **cuatro trabajos en una función**: elige la fuente,
decide el tono, lo expresa como unidades del LT25 y lo redacta para el usuario.
Ese acoplamiento es la causa de todo lo que sigue.

### 1.2 Las cuatro consecuencias, medidas

**(a) El tono casi no distingue entre pistas de la misma canción.**

De las 7.891 canciones con dos o más pistas de guitarra, **5.704 (72,3%)
reciben exactamente el mismo tono en todas sus pistas**. El promedio es de
**1,31 tonos distintos para 2,94 pistas**. Es el problema que abriste con Fade
to Black, y no es un caso raro: es la norma.

La razón es directa: los únicos datos por pista que entran a `sugerirAjustes`
son `instrument` y `tuning`. Dos pistas `Distortion Guitar` en E estándar son
indistinguibles para el resolutor, se llamen "Rhythm Guitar" o "Guitar Solo".

**(b) El nombre de la pista no se lee nunca.**

`sugerirAjustes` recibe `{ tags, instrument, tuning, artist, title }`. `name` no
está en esa lista y `pistasDeLaCancion` no se lo pasa. Sin embargo:

| señal en `track.name` | pistas | % de 25.061 |
|---|---:|---:|
| lead / solo / harmony / melody | 6.193 | 24,7% |
| rhythm / riff / chord | 4.485 | 17,9% |
| acoustic / nylon / classical | 890 | 3,6% |
| clean | 882 | 3,5% |
| dist / overdrive / crunch / heavy | 592 | 2,4% |
| **clasificable con regex simple** | **13.042** | **52,1%** |
| nombre sin señal de rol | 11.060 | 44,1% |
| sin nombre | 959 | 3,8% |

Más de la mitad del catálogo trae escrito el rol de la pista y hoy se tira.
`public/tarjeta.js` ya tiene una regex de roles (`ROLES`, línea 187) — pero la
usa para **elegir una etiqueta legible**, no para decidir el tono.

**(c) La elección es "preset entero o nada", y por debajo no hay efectos.**

| fuente que gana | pistas | % |
|---|---:|---:|
| reglas de género | 13.655 | 54,5% |
| tono de la comunidad por género | 6.933 | 27,7% |
| preset de la comunidad (artista o canción) | 2.442 | 9,7% |
| sin sugerencia | 2.031 | 8,1% |

La tabla `REGLAS` **no opina sobre efectos**: produce modelo + gain, volume,
treble, bass, reverb, y `cadena: null`. O sea que **el 54,5% de las pistas no
recibe ninguna información de stomp, mod, delay ni reverb**, aunque la planilla
de la comunidad sí la tenga para ese artista:

| ranura | presets que la declaran (de 87) |
|---|---:|
| amp | 86 (99%) |
| stomp | 74 (85%) |
| reverb | 75 (86%) |
| mod | 61 (70%) |
| delay | 42 (48%) |

El código lo dice explícitamente: *"Se usa entera o no se usa"*. Hoy no existe
un camino en el que el preset del artista aporte el amplificador y el rol de la
pista corrija la ganancia — es lo uno o lo otro.

**(d) La excepción acústica tiene que tirar el preset completo.**

`lib/ampli.js` anula el preset de comunidad entero cuando la pista es acústica,
porque no hay forma de quedarse con la opinión sobre el amplificador y
corregir sólo la ganancia. Está medido en el propio comentario del módulo: sin
esa excepción, 504 canciones de pista acústica recibían algo del preset de
comunidad y 116 con gain ≥ 6 (Rush, "Closer To The Heart", en guitarra de
**nylon**, recibía BURN a gain 10).

La excepción está bien: la decisión correcta con las herramientas de hoy. Pero
el precio es que esas 504 canciones pierden también el reverb, el delay y la
modulación que el preset traía y que sí servían.

### 1.3 Lo que el diagnóstico NO dice

- No dice que las reglas de género estén mal. Dice que son la fuente de más
  baja resolución y que hoy ganan el 54,5% de las veces sin poder combinarse
  con nada.
- No dice que haya que tocar el envío. El camino WebHID funciona y está en zona
  protegida.
- No hay ninguna medición de **acierto** aquí, y no la puede haber: no existe
  fuente de verdad de "el tono correcto de esta pista". Todo lo que sigue mejora
  la *resolución* y la *explicabilidad*, no un acierto demostrable.

---

## 2. Qué se reutiliza sin cambios

Esto es más de lo que parece. La propuesta es **incremental de verdad**: cinco
de las siete piezas del camino actual no se tocan.

| pieza | estado | por qué sirve tal cual |
|---|---|---|
| `public/lt25-unidades.json` | **intacto** | Volcado del firmware. Es la autoridad de qué existe. Zona protegida. |
| `public/catalogo-lt25.js` | **intacto, más usado** | `crearCatalogo`, `conversores`, `RANURAS`, `VACIA`. Ya es la capa de validación y conversión que el renderer necesita. Es puro y no toca el DOM: **verificado importándolo desde node**, devuelve los 20 amplis. Hoy `lib/` no lo usa y `paraElAmpli` reimplementa `(v-1)/9` a mano. |
| `lib/lt25-nombres.js` | **intacto** | `resolverUnidad`: nombre → FenderId sin adivinar. |
| `public/fender-protocolo.js`, `despachador.js`, `ampli-usb.js` | **intactos** | Zona protegida. El renderer tiene que seguir entregando la forma que `app.js` ya envía. |
| `lib/presets-comunidad.js` — mitad importadora | **intacta** | `leerBloque`, `leerCadena`, `rangoDeclarado`, `numeroConSufijoDeclarado`, `auditoria`. Parsea el CSV y valida contra el catálogo; nada de eso depende de cómo se elija un preset. |
| `lib/presets-comunidad.js` — mitad resolutora | **se envuelve** | `buscarPreset` y `presetDeGenero` siguen existiendo y siguen devolviendo lo mismo. Lo que cambia es quién los llama y qué hace con la respuesta. |
| `lib/ampli.js` — `REGLAS` | **se reinterpreta** | Las 24 filas se quedan; cambia lo que emiten. |
| `lib/tuning.js` | **intacto** | `describeTuning` ya devuelve `null` para estándar, que es la semántica correcta. |
| `public/ampli-usb.js` — `ampli.leerPreset()` | **intacto, reutilizado** | **Hallazgo relevante para la fase 3**: el editor ya lee el preset completo del equipo (`opLeerPreset`, línea 611, usado por `releerYRedibujar`). "Guardar mi tono" no necesita protocolo nuevo. |

Lo único que desaparece es la **decisión** dentro de `sugerirAjustes`. La
función sobrevive como fachada (§6.4).

---

## 3. Arquitectura propuesta

### 3.1 El camino

```
Song + Track
   │
   ▼
public/track-classifier.js ──────► PerfilDePista  { rol, familia de instrumento, afinación }
   │
   ▼
lib/tono/fuentes/*.js ───────────► Evidencia[]    (afirmaciones sueltas, nunca un preset)
   │                                 cada fuente aporta sólo lo que sabe
   ▼
lib/tono/resolver.js ────────────► ToneDescriptor + trazas
   │                                 combina por grupos, aplica restricciones
   ▼
lib/tono/lt25-renderer.js ───────► cadena LT25 validada contra el catálogo
   │
   ▼
public/app.js → despachador → WebHID     (sin cambios)
```

### 3.2 Responsabilidades, una frase cada una

- **`public/track-classifier.js`** — de `{ name, instrument, tuning }` a un
  `PerfilDePista`. Puro, sin catálogo, sin LT25. Vive en `public/` y no en
  `lib/` por la misma razón que `artistas.js`: `tarjeta.js` ya clasifica roles
  para las etiquetas, y dos regex de roles se desviarían (CLAUDE.md, §
  "`lib/` vs `public/`").
- **Fuentes (`lib/tono/fuentes/*.js`)** — cada una recibe el contexto y
  devuelve `Evidencia[]`. No conocen a las otras fuentes, no conocen el
  resolutor y **no conocen el LT25**. Una fuente que no sabe nada devuelve `[]`.
- **`lib/tono/resolver.js`** — agrupa las evidencias por campo, resuelve
  conflictos (§5), aplica las restricciones de pista (§5.3) y emite un
  `ToneDescriptor` con sus trazas. No conoce el LT25.
- **`lib/tono/descriptor.js`** — el vocabulario cerrado y sus validadores. Es
  el contrato entre fuentes, resolutor y renderer.
- **`lib/tono/lt25-renderer.js`** — **el único módulo del sistema que nombra
  una unidad del LT25**. Traduce el descriptor a `{ modelo, fenderId, gain,
  treble, bass, mid, cadena, paraElAmpli }` — la forma que `app.js` ya sabe
  enviar — validando cada unidad y cada valor contra el catálogo.

### 3.3 La regla que sostiene el diseño

> El LT25 entra en escena **una sola vez, al final**. Ninguna fuente, ninguna
> evidencia y ningún campo del descriptor menciona un modelo, un FenderId ni un
> número de perilla.

Esto es lo que hace que la fase 5 (research/LLM) sea segura por construcción:
un modelo que sólo puede emitir términos de un vocabulario cerrado **no puede**
escribir `gain = 7.43`, porque `gain` numérico no existe en el vocabulario.

---

## 4. Modelo de datos

### 4.1 `ToneDescriptor`

Tu boceto es buena base. Propongo cuatro cambios, cada uno por una razón que ya
está en el código de este proyecto:

**(1) Ausente ≠ "ninguno".** En tu ejemplo, `delay: null` es ambiguo: ¿nadie
opinó, o alguien dijo que no hay delay? Para el renderer la diferencia es
enorme — "nadie opinó" y "sin delay" llevan a la misma ranura EMPTY hoy, pero
en cuanto haya presets de usuario dejan de ser lo mismo. Es la misma disciplina
que `paraElAmpli` ya aplica con las perillas (omitir ≠ mandar 0):

- **clave ausente** → nadie opinó.
- **`{ tipo: 'ninguno' }`** → alguien afirmó que no lleva.

**(2) Niveles ordinales, no adjetivos.** `"medium-high"` obliga a mantener una
tabla de sinónimos y no se puede acotar ni comparar. Propongo entero **0..4**
con constantes nombradas, y que el vocabulario provea la etiqueta legible. Es
deliberadamente grueso: cinco escalones es lo que las fuentes de verdad
soportan, y fingir más sería inventar precisión.

```js
export const NIVEL = { NADA: 0, BAJO: 1, MEDIO: 2, ALTO: 3, MAXIMO: 4 }
export const ETIQUETA_NIVEL = ['nada', 'bajo', 'medio', 'alto', 'máximo']
```

**(3) Cada campo carga su procedencia, no sólo su confianza.** Un número de
confianza no contesta "¿por qué?". El campo lleva de dónde salió; las trazas
llevan además qué se descartó.

**(4) El rol de la pista vive en el descriptor.** No es una decisión de tono,
pero es la que explica la mitad de las correcciones.

```js
{
  // --- Ampli -----------------------------------------------------------
  amp: { familia: 'british-crunch', caracter: 'tight', confianza: 0.75, de: 'comunidad-artista' },
  gain:   { nivel: 3, confianza: 0.75, de: 'comunidad-artista' },
  eq:     { bass: 2, mid: 3, treble: 3, confianza: 0.75, de: 'comunidad-artista' },

  // --- Efectos ---------------------------------------------------------
  drive:  { tipo: 'overdrive', papel: 'boost', confianza: 0.7,  de: 'comunidad-artista' },
  mod:    { tipo: 'chorus', cantidad: 2, confianza: 0.95, de: 'perfil-cancion' },
  delay:  { tipo: 'ninguno', confianza: 0.6, de: 'comunidad-artista' },
  reverb: { tipo: 'room', cantidad: 1, confianza: 0.5, de: 'reglas-genero' },
  // 'stomp' ausente = nadie opinó

  // --- Contexto --------------------------------------------------------
  pista: { rol: 'rhythm', familia: 'electrica-distorsion', afinacion: 'Drop D', confianza: 0.95 },

  // --- Explicación -----------------------------------------------------
  trazas: [ /* §6 */ ],
  correcciones: [ /* §5.3 */ ],
  anclado: null,        // §5.4
  incierto: false,      // alguna fuente ganadora venía marcada dudosa
}
```

### 4.2 Vocabulario cerrado

En `lib/tono/descriptor.js`. **Cada término tiene que mapear a al menos una
unidad real del catálogo, y hay un test que lo comprueba** (§9).

```js
export const FAMILIAS_AMP = {
  'american-clean':  ['TWIN CLEAN', 'SUPER CLEAN', 'DELUXE CLN', 'PRINCETON', 'CHAMPION', '50S TWIN'],
  'american-dirt':   ['DELUXE DIRT', 'BASSMAN', 'EXCELSIOR', 'SMALLTONE'],
  'british-clean':   ['60S UK CLEAN', '70S UK CLEAN'],
  'british-crunch':  ['70S ROCK', '80S ROCK'],
  'modern-hi-gain':  ['METAL 2000', 'ALT METAL', 'SUPER HEAVY', '90S ROCK'],
  'doom':            ['DOOM METAL'],
  'hot-rod':         ['BURN'],
}
```

Siete familias que cubren **los veinte modelos, sin sobrantes ni repetidos**
— verificado contra `MODELOS_LT25`: 20 de 20, ninguno falta, ninguno aparece
dos veces. El test que lo fija compara la unión de las familias con
`MODELOS_LT25`, así que si mañana el catálogo cambia, cae.

El resto del vocabulario (`caracter`, `drive.tipo`, `mod.tipo`, `delay.tipo`,
`reverb.tipo`, `rol`) se define igual: lista cerrada, cada término con sus
unidades candidatas, y un test que exige que existan.

### 4.3 `Evidencia`

Una afirmación suelta. Plana a propósito: una fuente que sabe del chorus y nada
más emite **una** evidencia.

```js
{
  fuente: 'comunidad-artista',   // id estable
  nivel: 5,                      // 1..8, la escala de §5.1
  confianza: 0.75,               // dentro del nivel
  campo: 'mod',                  // 'amp' | 'gain' | 'eq' | 'drive' | 'mod' | 'delay' | 'reverb'
  valor: { tipo: 'chorus', cantidad: 2 },
  nota: 'preset de la comunidad para The Police',   // frase ya lista para el usuario
  incierto: false,               // la planilla lo marcó dudoso
  ancla: null,                   // §5.4: la cadena cruda, si esta fuente la tiene
}
```

### 4.4 Presets del usuario

```sql
CREATE TABLE IF NOT EXISTS user_tone (
  song_id     INTEGER NOT NULL,
  track_index INTEGER NOT NULL,
  cadena      TEXT    NOT NULL,   -- JSON: la cadena LT25 tal cual quedó en el equipo
  descriptor  TEXT,               -- JSON: el descriptor del que salió, si lo hubo
  origen      TEXT    NOT NULL CHECK (origen IN ('leido','editado')),
  nota        TEXT,
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (song_id, track_index)
);
```

Dos decisiones que copian a `song_state` a propósito:

- **Sin foreign key hacia `songs`**, y el ETL no la escribe nunca. Es el mismo
  trato: el catálogo se puede rebajar entero sin perder lo que tú ajustaste.
- **Entra a zona protegida.** Es la segunda tabla que el ETL no puede
  reconstruir. Hay que agregarla a la tabla de zonas protegidas de CLAUDE.md y
  a `npm run backup` en el mismo commit que la crea, no después.

Se guarda la **cadena, no el descriptor**, como dato principal: lo que el
usuario aprobó son unidades y perillas concretas del equipo, y un descriptor
re-renderizado podría no reproducirlas. El descriptor se guarda al lado, sólo
para poder explicar de qué se partió y, en el futuro, aprender tendencias.

### 4.5 Perfiles de canción y de artista (fase 4)

```sql
CREATE TABLE IF NOT EXISTS tone_profile (
  ambito      TEXT NOT NULL CHECK (ambito IN ('cancion','artista')),
  clave       TEXT NOT NULL,     -- song_id, o el artista normalizado
  track_role  TEXT,              -- NULL = vale para toda la canción
  descriptor  TEXT NOT NULL,     -- JSON: descriptor PARCIAL
  fuente      TEXT NOT NULL,     -- 'manual' | 'research'
  procedencia TEXT NOT NULL,     -- de dónde salió; con URL si la hay
  confianza   REAL NOT NULL,
  creado_en   TEXT NOT NULL,
  PRIMARY KEY (ambito, clave, track_role)
);
```

`descriptor` aquí es **parcial**: un perfil que sólo sabe que Andy Summers usa
chorus guarda sólo `mod`. Es la representación natural de "esta fuente sabe una
cosa", y es lo que permite que un perfil de artista y un preset de canción
convivan sin pisarse.

---

## 5. Resolución de conflictos

### 5.1 La escala de fuentes

Tu orden, con **una corrección que importa**:

| nivel | fuente | peso base |
|---|---|---:|
| 1 | preset del usuario para `song + track` | 1.00 |
| 2 | perfil documentado de canción/pista | 0.90 |
| 3 | preset de comunidad específico de canción | 0.85 |
| 4 | perfil de rig del artista/época | 0.80 |
| 5 | preset genérico de comunidad por artista | 0.75 |
| 6 | preset de otra canción del mismo artista | 0.60 |
| 7 | metadata de la pista (nombre → rol) | 0.50 |
| 8 | reglas por género | 0.40 |

**La corrección:** la metadata de la pista aparece dos veces en el sistema, y
no son lo mismo.

- Como **evidencia** (nivel 7): una pista llamada "Clean Guitar" *sugiere*
  ganancia baja. Compite y puede perder contra un preset de artista.
- Como **restricción** (§5.3): que el instrumento sea `Acoustic Guitar (nylon)`
  no es una opinión sobre el tono, es un hecho sobre lo que vas a tocar, y
  **no compite con nada**.

Si la parte acústica quedara como evidencia de nivel 7, perdería contra
cualquier preset de comunidad (nivel 5) y volveríamos exactamente al fallo que
`lib/ampli.js` ya arregló: 504 canciones, 116 con gain ≥ 6, la de nylon con
BURN a gain 10. La distinción entre *evidencia* y *restricción* no es
cosmética: es lo que impide reintroducir ese fallo.

### 5.2 Combinación por grupos coherentes

**No** es winner-takes-all global — ése es el problema que abriste. Tampoco es
campo-por-campo libre, que trae un problema propio: `amp.familia =
american-clean` (del perfil del artista) con `gain = 4` (de las reglas de
thrash) es una combinación que **nadie avaló jamás**, y suena mal de una forma
que ninguna fuente predice.

La unidad de resolución es el **grupo coherente**:

| grupo | campos |
|---|---|
| `amp` | `amp.familia`, `amp.caracter`, `gain`, `eq` |
| `drive` | `drive.*` |
| `mod` | `mod.*` |
| `delay` | `delay.*` |
| `reverb` | `reverb.*` |

Algoritmo, en tres pasos deterministas:

1. **Por grupo**, gana la fuente con mayor `peso = nivel_base × confianza` de
   entre las que opinan **sobre ese grupo**. Empate → orden de la escala; si
   sigue el empate, orden de llegada de las fuentes (determinista, la misma
   disciplina que el `'artista (sin desempate de época)'` de hoy, y se dice
   igual que no hubo más criterio).
2. **Afinado dentro del grupo**: una fuente de nivel *estrictamente mejor* que
   la ganadora del grupo puede sobreescribir campos sueltos. Así el preset de
   usuario (nivel 1) baja el treble sin tirar el resto del grupo.
3. **Relleno**: los grupos que nadie reclamó quedan ausentes. **No se rellenan
   por descarte.** Un grupo ausente llega al renderer como "nadie opinó", que
   es distinto de `ninguno`.

Esto es exactamente tu escenario: el preset de artista gana el grupo `amp`, el
perfil de canción gana `mod` con su chorus, las reglas de género ganan `reverb`
porque nadie más opinó, y el rol `rhythm` corrige la ganancia en el paso
siguiente.

### 5.3 Restricciones de pista (post-resolución)

Se aplican **después**, siempre, y sólo pueden **acotar o sustituir** — nunca
inventar un campo que nadie afirmó. Cada una deja su propia traza.

| restricción | efecto | origen |
|---|---|---|
| pista acústica (`steel`/`nylon`) | familia → `american-clean`, `gain` → 0, se **conservan** `mod`, `delay`, `reverb` | hoy: tira el preset entero |
| pista eléctrica limpia | `gain` acotado a ≤ 1; si la familia es hi-gain, → `american-clean` | hoy: igual, pero sólo en la rama de reglas |
| rol `lead`/`solo` | `gain` +1 (tope 4), `mod`/`delay` conservados | **nuevo** |
| rol `rhythm` con hermana `lead` | `gain` −1 si el grupo vino de una fuente no específica de pista | **nuevo** |
| época 60s/70s con familia moderna | sustituye familia por la de la época, `gain` −1 | hoy: igual |
| afinación no estándar | `eq.bass` −1 | hoy: igual |

La ganancia inmediata está en la primera fila: las 504 canciones acústicas
dejan de perder el reverb y la modulación del preset, y siguen sin recibir el
gain 10.

### 5.4 El anclaje: cuándo NO combinar

Riesgo real de esta arquitectura: hoy, cuando existe un preset de comunidad
**para esa canción**, se envía **tal cual lo escribió esa persona** (3,3 es 3,3,
no se redondea). Pasarlo por vocabulario y volver a renderizarlo lo cambiaría —
una regresión en el 9,7% de las pistas donde más confianza hay.

Regla de anclaje:

> Cuando la fuente ganadora del grupo `amp` es de **nivel ≤ 3** (usuario,
> perfil de canción, preset de comunidad de canción) y trae una cadena
> completa, esa cadena se emite **verbatim**, sin pasar por el vocabulario. Los
> grupos que esa fuente **no** declara se siguen resolviendo normalmente y se
> agregan.

Es "se usa entera o no se usa" conservado exactamente donde está justificado
—alguien dialó *esa* cadena para *esa* canción— y abandonado donde no lo está
(un preset genérico de artista aplicado a las seis pistas de una canción).
`anclado` en el descriptor dice cuándo pasó, y la interfaz puede decirlo.

---

## 6. Trazabilidad

### 6.1 Estructura

```js
trazas: [
  { grupo: 'amp', gano: 'comunidad-artista', peso: 0.75,
    nota: 'preset de la comunidad para The Police',
    campos: ['amp.familia', 'amp.caracter', 'gain', 'eq'],
    descartadas: [ { fuente: 'reglas-genero', peso: 0.40, nota: 'tag "new wave"' } ] },
  { grupo: 'mod', gano: 'perfil-cancion', peso: 0.90,
    nota: 'chorus documentado para esta canción', campos: ['mod'], descartadas: [] },
],
correcciones: [
  { regla: 'pista-limpia', campo: 'gain', de: 3, a: 1,
    porque: 'la pista se llama "Clean Guitar"' },
],
omitidas: [   // del renderer
  { ranura: 'delay', motivo: 'la familia no tiene unidad equivalente en el LT25' },
]
```

### 6.2 Lo que ve el usuario

De ahí sale, sin escribir prosa nueva, exactamente lo que pediste:

- «amp según el preset de la comunidad para The Police»
- «chorus según el perfil específico de esta canción»
- «gain corregido: la pista se llama "Clean Guitar"»

El campo `procedencia` de hoy (una frase suelta) pasa a **derivarse** de las
trazas, así que la interfaz actual sigue funcionando mientras gana detalle. La
función `procedenciaDe()` de `lib/ampli.js` se convierte en el redactor de la
traza del grupo `amp` — las siete frases que ya escribe siguen siendo las
mismas.

### 6.3 `incierto` sigue vivo

La planilla marca sus filas dudosas (`{EXPERIMENTAL}`, `(INACCURATE)`, `?`) y
hoy eso viaja en `preset.incierto`. En el modelo nuevo viaja **por evidencia**,
y el descriptor queda `incierto: true` si alguna evidencia ganadora lo estaba.
Más fino que hoy: se puede decir "el chorus es dudoso, el amp no".

### 6.4 Compatibilidad: `sugerirAjustes` sobrevive

```js
export function sugerirAjustes(ctx) {
  const perfil = clasificarPista(ctx)
  const evidencias = FUENTES.flatMap(f => f.evidencias(ctx, perfil))
  const descriptor = resolver(evidencias, perfil)
  return renderizarLT25(descriptor)   // misma forma de salida que hoy
}
```

Firma igual, forma de salida igual. `db/queries.js`, `public/app.js`,
`public/tarjeta.js` y los 50 tests de `test/ampli.test.js` no se enteran.

---

## 7. Validación contra el equipo real

El renderer es el único que nombra unidades, así que toda la validación cabe en
un lugar. Tres reglas, las tres ya practicadas en este repo:

1. **Ninguna unidad inventada.** Todo FenderId sale de `resolverUnidad()` o del
   catálogo. Un término de vocabulario sin unidad → la ranura se **omite**, se
   anota en `omitidas`, y nunca se sustituye por "algo parecido"
   (`lt25-nombres.js` documenta por qué: un matcher por prefijo convirtió "5.0"
   en "50S TWIN", en silencio).
2. **Ningún valor fuera de rango.** Se reutiliza `rangoDeclarado()` — hoy
   privada de `presets-comunidad.js`, se mueve a un módulo compartido. Fuera de
   rango → la perilla queda en el default de la unidad, que es dato real del
   equipo.
3. **Ninguna perilla convertida a mano.** La conversión pasa por `aCable` de
   `crearCatalogo`, no por `(v-1)/9` escrito de nuevo. Y la disciplina de
   `paraElAmpli` se mantiene entera: **lo que no se sabe convertir se omite,
   nunca sale en 0**.

---

## 8. Alternativas

**A. Descriptor abstracto + renderer** (lo propuesto). Separa las cuatro
responsabilidades, permite mezclar fuentes por grupo, y deja la fase 5 segura
por construcción. Es la que recomiendo.

**B. Parche por campos, sin descriptor abstracto.** Mantener "preset entero de
una fuente" y permitirle a una capa posterior sobreescribir campos sueltos del
resultado LT25. Mucho más barato (≈1 módulo nuevo, sin vocabulario), resuelve
(a) y (d) del diagnóstico, y **no** resuelve (c): las reglas siguen sin poder
aportar efectos, porque el LT25 sigue siendo la representación interna y no hay
dónde poner "esta pista quiere chorus" sin elegir ya la unidad.
**Es la salida honesta si el proyecto no quiere cinco módulos nuevos**, y las
fases 1-2 se pueden detener ahí sin dejar nada a medias.

**C. Ranking de presets candidatos.** Puntuar los 87 presets de la planilla
contra la pista y elegir el mejor. Barato, y explicable. **Descartada**:
mantiene el LT25 como representación interna —justo lo que pides evitar—, no
puede combinar dos fuentes, y su techo es la planilla (87 filas para 25.061
pistas).

**Recomendación:** A, con la fase 1 y la 2 diseñadas para que detenerse después
de la 2 deje un sistema coherente, no un esqueleto.

---

## 9. Plan por fases

### Fase 1 — Clasificador de pista + extraer el renderer

**Sin cambio de comportamiento.** El objetivo es mover, no decidir.

- **Crear:** `public/track-classifier.js`, `test/track-classifier.test.js`.
- **Crear:** `lib/tono/lt25-renderer.js` con la parte LT25 de `lib/ampli.js`
  movida tal cual; empieza a usar `crearCatalogo` en vez de `(v-1)/9`.
- **Modificar:** `public/tarjeta.js` (que `etiquetasDePistas` use el
  vocabulario de roles del clasificador en vez de su propia regex),
  `lib/ampli.js` (delega en el renderer).
- **Riesgos:** bajos, y el que parecía mayor ya está descartado. Se temía que
  `aCable` no diera el mismo número que el `(v-1)/9` de `paraElAmpli`; medido
  sobre los veinte modelos × gain/treb/mid/bass × cinco puntos de la escala
  (1 / 3,3 / 5 / 7 / 10), **400 comparaciones y 0 diferencias**. Queda el
  riesgo normal de mover código: lo cubre el barrido de abajo.
- **Tests:** clasificador sobre nombres reales (fixtures, no `songs.db`);
  cobertura de los términos de rol; el renderer emite sólo FenderIds del
  catálogo.
- **Compatibilidad:** barrido de las 25.061 pistas antes y después y diff
  byte a byte de la salida. La misma prueba que se usó para el refactor de
  `vista-sortear.js`. Si el diff no es vacío, la fase no está terminada.

### Fase 2 — Descriptor + resolutor con las fuentes de hoy

- **Crear:** `lib/tono/descriptor.js` (vocabulario), `lib/tono/resolver.js`,
  `lib/tono/fuentes/reglas-genero.js`, `fuentes/comunidad.js`,
  `fuentes/metadata-pista.js`; sus tests.
- **Modificar:** `lib/ampli.js` → fachada (§6.4). `REGLAS` se muda a
  `fuentes/reglas-genero.js` **con sus 24 filas intactas**; lo que cambia es
  que cada fila emite evidencias (`amp.familia`, `gain`, `eq`) en vez de un
  modelo y cinco perillas. Hace falta una tabla modelo → familia: es
  `FAMILIAS_AMP` leída al revés, y el test de §4.2 garantiza que es total.
  `buscarPreset`/`presetDeGenero` **no se tocan**; `fuentes/comunidad.js` los
  llama y *descompila* la cadena a evidencias (unidad → término de
  vocabulario), salvo cuando aplica el anclaje (§5.4), donde pasa la cadena
  cruda.
- **Riesgos:** **el más alto de todo el plan.** (1) La descompilación cambia el
  resultado donde hoy es exacto — lo mitiga el anclaje, y hay que medir cuántas
  pistas quedan ancladas y cuántas descompiladas. (2) Las reglas de género
  ganan hoy el 54,5%; convertirlas a evidencias mueve ese 54,5% entero de una
  vez. (3) El resolutor corre por pista, hasta 11 veces por canción y en cada
  sorteo: la evidencia de artista y género es idéntica entre pistas de la misma
  canción y hay que memoizarla por canción, no recalcularla por pista.
- **Tests:** resolución por grupos con evidencias sintéticas; que una fuente de
  nivel peor nunca sobreescriba a una mejor; que las restricciones se apliquen
  siempre y dejen traza; el caso acústico (que **conserve** mod/delay/reverb y
  **corte** el gain); determinismo ante empates.
- **Compatibilidad:** el mismo barrido de 25.061 pistas, pero aquí el diff
  **no** puede ser vacío — cambiar el resultado es el punto. Lo que se exige es
  un **informe de diferencias** revisable: cuántas pistas cambian, en qué
  grupo, y una muestra por cada tipo de cambio. Y dos invariantes duras: ninguna
  pista acústica termina con `gain` > 1, y ninguna pista que hoy tiene
  sugerencia queda sin ella.

### Fase 3 — Presets del usuario

- **Crear:** migración de `user_tone`, `db/tono-usuario.js`,
  `fuentes/usuario.js`, endpoints `GET/PUT/DELETE /api/tono`.
- **Modificar:** `public/panel-ampli.js` y `public/app.js` (botón "Guardar mi
  tono", que llama a `ampli.leerPreset()` —ya existe— y persiste lo que el
  equipo **tiene de verdad**, no lo que se le mandó); `CLAUDE.md` (zona
  protegida); `npm run backup`.
- **Riesgos:** guardar lo enviado en vez de lo leído (registraría un tono que
  el equipo pudo no haber aceptado: el LT25 descarta en silencio lo que no
  entiende). Y el clásico: que un `git clean` o un ETL se lleve la tabla — de
  ahí la zona protegida y el backup **en el mismo commit**.
- **Tests:** prioridad máxima del preset de usuario; que sobreviva a un
  re-ETL; borrar vuelve a la sugerencia anterior; el round-trip
  leer → guardar → resolver → renderizar devuelve la misma cadena.
- **Compatibilidad:** total. Sin filas en `user_tone`, el sistema se comporta
  igual que en la fase 2.

### Fase 4 — Perfiles de canción y artista

- **Crear:** migración de `tone_profile`, `fuentes/perfil.js`, un formato de
  semilla en `data/` para perfiles escritos a mano.
- **Riesgos:** que los perfiles se llenen de datos sin procedencia. Mitigación:
  `procedencia` es `NOT NULL` y la interfaz la muestra siempre.
- **Tests:** parcialidad (un perfil que sólo declara `mod` no toca `amp`);
  precedencia contra comunidad; que un perfil por rol aplique sólo a ese rol.
- **Compatibilidad:** total, tabla vacía = sin cambios.

### Fase 5 — Research externo con caché

- **Crear:** `lib/tono/research/` (cliente + caché en `tone_profile` con
  `fuente = 'research'`), y un **validador de entrada** que rechace todo lo que
  no sea vocabulario cerrado.
- **Riesgos:** el central, y ya está mitigado por construcción — el modelo no
  puede emitir un número de perilla porque el esquema del descriptor no tiene
  ninguno. El riesgo que queda es de *plausibilidad*: un modelo que afirma
  "chorus" para una canción que no lo tiene. Mitigación: `fuente = 'research'`
  entra siempre con `incierto: true` y por debajo de toda fuente humana, se
  cachea con fecha, y nunca se aplica en vivo durante un sorteo.
- **Tests:** que una respuesta con un término fuera de vocabulario se rechace
  entera y quede registrada; que la caché no se consulte en el camino del
  sorteo; que `incierto` llegue hasta la interfaz.
- **Compatibilidad:** total, es una fuente más.

---

## 10. Trade-offs

**A favor**

- Resuelve las cuatro consecuencias medidas, y la (a) —72,3% de canciones con
  un solo tono para todas sus pistas— es la que abriste tú con Fade to Black.
- Recupera el 52,1% de señal de rol que hoy se tira.
- El 54,5% que hoy no recibe **ninguna** información de efectos pasa a poder
  recibirla de una fuente distinta de la que le da el amplificador.
- La explicabilidad deja de ser una frase y pasa a ser estructura.
- La fase 5 queda segura por diseño, no por disciplina.

**En contra**

- Cinco módulos nuevos y un vocabulario que mantener, en un proyecto de un solo
  usuario. La alternativa B cuesta un módulo y resuelve dos de los cuatro
  problemas.
- El vocabulario es **juicio musical**, igual que las 24 filas de `REGLAS`:
  "80S ROCK es `british-crunch`" es una opinión. La diferencia es que ahora es
  una opinión explícita, en un solo lugar y con test.
- Los ordinales 0..4 pierden el 3,3 exacto que alguien escribió en la planilla.
  Por eso existe el anclaje; pero cualquier pista que caiga fuera del anclaje
  pierde esa precisión. Es una pérdida real, y es la contraparte de poder
  combinar.
- Riesgo concentrado en la fase 2: mueve el 54,5% de las pistas de una vez. El
  informe de diferencias es obligatorio, no opcional.
- Más superficie de tests: estimo entre 40 y 60 casos nuevos sobre los 359 de
  hoy.

**Lo que NO mejora**

El acierto. No hay forma de medirlo: no existe fuente de verdad del tono de una
grabación, y ésa es la premisa desde la primera línea de `lib/ampli.js`. Esto
mejora la resolución (más tonos distintos, más ajustados a la pista) y la
honestidad (se puede decir de dónde salió cada parte). Si alguna vez algo aquí
dice que "acierta más", está mintiendo.
