# Resolución de tono híbrida — diagnóstico y diseño

> Estado: **fase 0 implementada** el 2026-09-17 (ver
> `docs/superpowers/plans/2026-09-17-fase-0-corpus-y-marcador.md`). Las fases
> 1 a 5 siguen siendo propuesta.
>
> **Enmendada el 2026-09-16.** El catálogo casi se duplicó desde la primera
> redacción (de 10.011 canciones y 25.061 pistas de guitarra a **19.976 y
> 42.580**), así que las cifras que salen de `songs.db` están **re-medidas** a
> esa fecha: §1.2 (a), (b) y (c), y las que las citan en §9 y §10. Las que salen
> de los dos CSV de `data/` **no** se re-midieron y no hacía falta: ese
> directorio no se toca desde el 2026-09-06 (`git log -- data/`), es zona
> protegida, y sigue siendo el mismo trabajo de terceros. El diagnóstico no
> cambió de signo: donde cambió, empeoró.
>
> La enmienda además añade a `user_tone` una firma de pista contra la deriva del
> índice (§4.4), crea la tabla de juicios (§4.6), inserta la **fase 0 de
> medición** (§9) y reescribe el cierre sobre el acierto (§10), que era el
> límite declarado de la versión anterior.
>
> Los scripts de medición son de un solo uso y no quedaron en el repo; cada
> cifra dice contra qué se midió para poder rehacerla.

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

De las 15.400 canciones con dos o más pistas de guitarra, **12.501 (81,2%)
reciben exactamente el mismo tono en todas sus pistas**. El promedio es de
**1,22 tonos distintos para 2,52 pistas**. Es el problema que abriste con Fade
to Black, y no es un caso raro: es la norma — y en el catálogo ampliado es
**más** norma que antes (era 72,3%).

La razón es directa: los únicos datos por pista que entran a `sugerirAjustes`
son `instrument` y `tuning`. Dos pistas `Distortion Guitar` en E estándar son
indistinguibles para el resolutor, se llamen "Rhythm Guitar" o "Guitar Solo".

**(b) El nombre de la pista no se lee nunca.**

`sugerirAjustes` recibe `{ tags, instrument, tuning, artist, title }`. `name` no
está en esa lista y `pistasDeLaCancion` no se lo pasa. Sin embargo:

| señal en `track.name` | pistas | % de 42.580 |
|---|---:|---:|
| lead / solo / harmony / melody | 10.427 | 24,5% |
| rhythm / riff / chord | 8.961 | 21,0% |
| acoustic / nylon / classical | 1.168 | 2,7% |
| clean | 1.204 | 2,8% |
| dist / overdrive / crunch / heavy | 993 | 2,3% |
| **clasificable con regex simple** | **21.987** | **51,6%** |
| nombre sin señal de rol | 13.440 | 31,6% |
| sin nombre | 7.153 | 16,8% |

Las categorías se solapan (una pista puede decir "Clean Rhythm"), así que las
cinco primeras filas suman más que la de clasificables.

Más de la mitad del catálogo trae escrito el rol de la pista y hoy se tira.
`public/tarjeta.js` ya tiene una regex de roles (`ROLES`, línea 187) — pero la
usa para **elegir una etiqueta legible**, no para decidir el tono.

**(c) La elección es "preset entero o nada", y por debajo no hay efectos.**

Medido sobre las **26.696 pistas de guitarra de canciones ya enriquecidas**,
que es el universo correcto para juzgar la lógica de tono — ver el aviso de
abajo sobre las que faltan por enriquecer:

| fuente que gana | pistas | % |
|---|---:|---:|
| reglas de género | 14.162 | 53,0% |
| tono de la comunidad por género | 7.033 | 26,3% |
| preset de la comunidad (artista o canción) | 2.448 | 9,2% |
| sin sugerencia | 3.053 | 11,4% |

> **Aviso de medición.** 9.072 de las 19.976 canciones (15.884 pistas de
> guitarra) **nunca pasaron la fase meta del ETL** y por eso no tienen ningún
> tag. Contadas sobre el catálogo entero, las cifras salen 33,3% / 22,3% /
> 44,4% "sin sugerencia" — y ese 44,4% no describe la lógica de tono, describe
> un `npm run etl --solo-meta` pendiente. No confundir las dos lecturas: sobre
> el catálogo entero ninguna cifra de este documento es interpretable.

La tabla `REGLAS` **no opina sobre efectos**: produce modelo + gain, volume,
treble, bass, reverb, y `cadena: null`. O sea que **el 49,3% de las pistas
enriquecidas no recibe ninguna información de stomp, mod, delay ni reverb**,
aunque la planilla de la comunidad sí la tenga para ese artista:

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
  baja resolución y que hoy ganan el 53,0% de las veces sin poder combinarse
  con nada.
- No dice que haya que tocar el envío. El camino WebHID funciona y está en zona
  protegida.
- No hay ninguna medición de **acierto** aquí. La versión anterior de este
  documento concluía que no la podía haber, porque no existe fuente de verdad
  del tono de una grabación. Eso sigue siendo cierto y **la conclusión que se
  sacaba de ello era errónea**: esta app tiene un solo usuario, y la verdad
  operativa no es el disco, es *el tono que ese usuario dialó y aprobó*. Esa sí
  existe, es falsable, y el equipo ya la sabe leer (`ampli.leerPreset()`).
  Construirla es la **fase 0** (§9), y es lo que convierte el resto del plan de
  acto de fe en algo puntuable. Ver el cierre reescrito en §10.

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
| `public/ampli-usb.js` — `ampli.leerPreset()` | **intacto, reutilizado** | **Hallazgo relevante para la fase 0**: el editor ya lee el preset completo del equipo (`opLeerPreset`, línea 611, usado por `releerYRedibujar`). "Guardar mi tono" no necesita protocolo nuevo. |

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
  track_sig   TEXT    NOT NULL,   -- instrument + '\u001f' + name de la pista al guardar
  cadena      TEXT    NOT NULL,   -- JSON: la cadena LT25 tal cual quedó en el equipo
  descriptor  TEXT,               -- JSON: el descriptor del que salió, si lo hubo
  origen      TEXT    NOT NULL CHECK (origen IN ('leido','editado')),
  nota        TEXT,
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (song_id, track_index)
);
```

**`track_sig` es una corrección de la versión anterior, y es un fallo serio que
tenía.** `etl/catalog.js:32` hace `DELETE FROM tracks WHERE song_id = ?` y
reinserta con el `trackIndex` que venga de Songsterr. La clave
`(song_id, track_index)` protegía la fila del borrado pero **no de la deriva**:
si Songsterr reordena las pistas o inserta una, el tono guardado pasa a
aplicarse **a otra pista distinta, en silencio**. No lanza, no se nota, y el
síntoma es "el tono que guardé dejó de servir" — exactamente la clase de fallo
que este proyecto persigue en `resolverUnidad` y en los nombres de modelo.

La regla: al leer, `track_sig` se compara con la pista actual. Si no calza, la
fila **no se aplica** y se marca como desfasada para que la interfaz lo diga.
Se avisa, no se adivina, y no se borra: el tono sigue ahí por si la pista
vuelve, y porque un tono que costó dialar no se tira por una reordenación
ajena.

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

### 4.6 Juicios de tono (fase 0)

```sql
CREATE TABLE IF NOT EXISTS tone_judgment (
  id          INTEGER PRIMARY KEY,
  song_id     INTEGER NOT NULL,
  track_index INTEGER NOT NULL,
  track_sig   TEXT    NOT NULL,   -- igual que en user_tone, por la misma razón
  eje         TEXT    NOT NULL CHECK (eje IN ('global','suciedad','modulacion','delay','reverb')),
  direccion   TEXT    NOT NULL CHECK (direccion IN ('bien','sobra','falta')),
  juzgado     TEXT    NOT NULL,   -- JSON: la cadena que estaba en pantalla
  fuente      TEXT    NOT NULL,   -- quién la produjo: 'reglas' | 'comunidad' | 'usuario'
  sugeridor   TEXT    NOT NULL,   -- versión del sugeridor que la produjo
  creado_en   TEXT    NOT NULL,
  CHECK ((eje =  'global' AND direccion =  'bien')
      OR (eje <> 'global' AND direccion <> 'bien'))
);
```

Cuatro decisiones, cada una con su motivo:

**(1) El veredicto es DIRECCIONAL, no una nota.** "Está mal" no se puede
puntuar. "Sobra suciedad" sí, porque de cualquier candidato se puede preguntar
*¿se movió hacia donde pedía?* — y esa pregunta tiene respuesta sí/no sin
ambigüedad. El `CHECK` compuesto fija las dos únicas formas con sentido: o es
un `bien` global, o es una queja con eje y dirección.

**(2) `bien` es un veredicto de primera clase.** Un corpus que sólo registra
errores no puede castigar a un candidato que arruina lo que ya funcionaba. Sin
ejemplos positivos se aprende a huir, no a acertar.

**(3) Se guarda QUÉ se juzgó (`juzgado`, `fuente`, `sugeridor`).** Un
"sobra suciedad" sin la cadena que lo provocó es ininterpretable en cuanto el
sugeridor cambie: *¿más limpio que qué?* Es el mismo principio que `procedencia`
en el resto del documento, aplicado al juicio en vez de a la sugerencia.

**(4) Es un registro, no un estado: se acumula, no se pisa.** Sin clave por
pista y sin `UPDATE`. La misma pista juzgada tres veces a lo largo de tres
versiones del sugeridor son tres filas, y esa historia **es** el dato — es lo
que permite preguntar si una versión mejoró sobre la anterior.

Los ejes son los de §4.2 a propósito, no por comodidad: si el juicio habla el
idioma del descriptor, el evaluador puede comprobar el movimiento eje por eje,
y la fase 5 —que emite en ese mismo vocabulario— se puntúa con exactamente la
misma regla que las reglas de género. Un solo idioma de punta a punta.

Entra a **zona protegida** por la misma razón que `user_tone`, y con más fuerza:
el ETL no puede reconstruir horas de escucha.

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
puede combinar dos fuentes, y su techo es la planilla (87 filas para 42.580
pistas).

**Recomendación:** A, con la fase 1 y la 2 diseñadas para que detenerse después
de la 2 deje un sistema coherente, no un esqueleto.

---

## 9. Plan por fases

### Fase 0 — Corpus de juicios y marcador

**Sin cambio en la lógica de tono.** El objetivo es poder medir. Va primero
porque todas las fases siguientes cambian el resultado y **ninguna puede
demostrar hoy que lo mejora**: la 2 mueve el 53% de las pistas de una vez.

- **Crear:** migraciones de `user_tone` (§4.4) y `tone_judgment` (§4.6);
  `db/tono-usuario.js`; endpoints `GET/PUT/DELETE /api/tono` y
  `POST /api/juicio`; `lib/tono/ejes.js` — de una cadena LT25 a los ejes de
  §4.2 (familia del ampli, ordinal de suciedad, ocupación de cada ranura);
  `tools/evaluar-tono.mjs` y `npm run tono:evaluar`.
- **Modificar:** `public/panel-ampli.js` y `public/app.js` — el veredicto
  aparece **donde hoy vive `#envio-estado`**, al confirmar el ACK, y el botón
  "Guardar mi tono" junto a "Enviar al ampli", llamando al `ampli.leerPreset()`
  que ya existe; `CLAUDE.md` (dos tablas a zona protegida) y `npm run backup`,
  **en el mismo commit que las crea**; y `db/queries.js`, para el corto-circuito
  de abajo.
- **Tu tono guardado SÍ manda, desde la fase 0.** Y no hace falta el resolutor
  para eso: es un corto-circuito en `pistasDeLaCancion()` — si hay fila de
  `user_tone` con `track_sig` que calza, se devuelve esa cadena y no se llama a
  `sugerirAjustes`. Trivial de escribir y de quitar.

  Va aquí y no en la fase 3 por una razón que no es técnica: si capturar un tono
  no arregla la canción **hoy**, no vas a capturar cuarenta, y sin corpus no hay
  ninguna de las fases siguientes. La fase 3 sustituye este corto-circuito por
  una fuente de verdad en el resolutor; el comportamiento visible no cambia.
- **Cómo puntúa.** Dos verdades, dos reglas. Un **tono capturado** es un
  objetivo exacto y se mide la distancia *en ejes*, no en perillas crudas:
  `DELUXE CLN` contra `TWIN CLEAN` son los dos limpios y penalizarlo igual que
  confundir limpio con metal sería ruido. Un **veredicto** es una restricción:
  `(suciedad, sobra)` se cumple si el candidato es **estrictamente** más limpio
  que la cadena juzgada — empatar es fallar —, y un `bien` se cumple si el
  candidato no se aleja en ningún eje.
- **La salida es un informe, no una nota**: cumplidas / violadas / sin efecto,
  con ejemplos de cada tipo. Un número solo escondería las regresiones, que son
  lo que venimos a cazar.
- **Riesgos.** (1) **Sobreajuste**, y es el central: con ~50 juicios y una tabla
  de reglas editable a mano, hacer subir el marcador es trivial. Mitigación
  obligatoria: el informe lleva **siempre** al lado el recuento del barrido
  completo del catálogo; un cambio que mejora 12 pistas del corpus y mueve 8.000
  del catálogo no está probado, está sin probar. Un marcador sin ese contrapeso
  es peor que ninguno, porque da confianza falsa. (2) Guardar lo **enviado** en
  vez de lo **leído** — el LT25 descarta en silencio lo que no entiende, así que
  registraría un tono que el equipo pudo no haber aceptado. (3) Un veredicto sin
  su `juzgado` nace ininterpretable. (4) Que el panel del ampli crezca de alto:
  por eso el veredicto ocupa la línea del estado de envío en vez de añadir una.
- **Tests:** las funciones de puntuación contra un corpus sintético; que un
  `bien` detecte una regresión que los veredictos negativos no ven; que una
  `track_sig` desfasada no se aplique y se reporte; determinismo ante empates.
  El evaluador **no es un test** y no entra en `npm test`: lee `songs.db`, y
  `CLAUDE.md` lo prohíbe. Es una herramienta.
- **Compatibilidad:** total. Con las dos tablas vacías el sistema se comporta
  exactamente como hoy.
- **Relación con la fase 3.** La fase 0 se lleva la captura entera (tabla,
  botón y corto-circuito). Lo que queda en la fase 3 es cambiar **cómo** se
  aplica: de corto-circuito a fuente de máxima prioridad dentro del resolutor,
  que no existe hasta la fase 2. Mismo efecto visible, distinto sitio — y desde
  la fase 3 un tono tuyo parcial puede combinarse en vez de ganar entero.

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
- **Compatibilidad:** barrido de las 42.580 pistas antes y después y diff
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
  ganan hoy el 53,0%; convertirlas a evidencias mueve ese 53,0% entero de una
  vez. (3) El resolutor corre por pista, hasta 11 veces por canción y en cada
  sorteo: la evidencia de artista y género es idéntica entre pistas de la misma
  canción y hay que memoizarla por canción, no recalcularla por pista.
- **Tests:** resolución por grupos con evidencias sintéticas; que una fuente de
  nivel peor nunca sobreescriba a una mejor; que las restricciones se apliquen
  siempre y dejen traza; el caso acústico (que **conserve** mod/delay/reverb y
  **corte** el gain); determinismo ante empates.
- **Compatibilidad:** el mismo barrido de 42.580 pistas, pero aquí el diff
  **no** puede ser vacío — cambiar el resultado es el punto. Lo que se exige es
  un **informe de diferencias** revisable: cuántas pistas cambian, en qué
  grupo, y una muestra por cada tipo de cambio. Y dos invariantes duras: ninguna
  pista acústica termina con `gain` > 1, y ninguna pista que hoy tiene
  sugerencia queda sin ella.

### Fase 3 — Presets del usuario

> La tabla, los endpoints, el botón "Guardar mi tono" y el corto-circuito que
> lo aplica ya existen desde la fase 0. Aquí no se añade una capacidad nueva: se
> muda de sitio.

- **Crear:** `fuentes/usuario.js`.
- **Modificar:** el resolutor, para que `user_tone` entre con la prioridad
  máxima de la escala de §5.1; `db/queries.js`, para **retirar** el
  corto-circuito de la fase 0 en el mismo commit que lo sustituye — dejar los
  dos caminos vivos es garantizar que se desvíen.
- **Lo que esto habilita** (y es la razón de moverlo): dentro del resolutor, un
  tono tuyo puede ser **parcial**. Si lo único que corregiste fue la modulación,
  la fase 3 puede quedarse con esa opinión y dejar que el ampli lo siga
  decidiendo la comunidad. El corto-circuito no puede: gana entero o no gana.
- Una fila con `track_sig` desfasada (§4.4) no se aplica, aquí tampoco.
- **Riesgos:** que la mudanza cambie el resultado sin querer. El tono guardado
  ya se aplicaba en la fase 0, así que aquí **el diff del barrido tiene que ser
  vacío** sobre las pistas con fila en `user_tone` — si no lo es, la fase no
  está terminada. (Los riesgos de guardar lo enviado en vez de lo leído, y de
  que un `git clean` o un ETL se lleve la tabla, se resolvieron en la fase 0.)
- **Tests:** prioridad máxima del preset de usuario; que sobreviva a un
  re-ETL; borrar vuelve a la sugerencia anterior; el round-trip
  leer → guardar → resolver → renderizar devuelve la misma cadena; y que un
  tono **parcial** deje intacto lo que no declara.
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

- Resuelve las cuatro consecuencias medidas, y la (a) —81,2% de canciones con
  un solo tono para todas sus pistas— es la que abriste tú con Fade to Black.
- Recupera el 51,6% de señal de rol que hoy se tira.
- El 49,3% que hoy no recibe **ninguna** información de efectos pasa a poder
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
- Riesgo concentrado en la fase 2: mueve el 53,0% de las pistas de una vez. El
  informe de diferencias es obligatorio, no opcional.
- Más superficie de tests: estimo entre 40 y 60 casos nuevos sobre los 373 de
  `npm test` y los 25 de `npm run test:ui` de hoy, más los de la fase 0.

**Sobre el acierto** *(reescrito en la enmienda del 2026-09-16; la versión
anterior de este párrafo concluía que el acierto no se podía medir)*

Sigue sin existir fuente de verdad del tono de **la grabación**, y ésa es la
premisa desde la primera línea de `lib/ampli.js`. Pero de ahí no se sigue que no
haya nada medible, y la versión anterior de este documento dio ese paso de más.

Esta app tiene **un solo usuario**. La verdad que importa no es el disco: es *el
tono que ese usuario dialó y aprobó*. Eso existe, es falsable, y el equipo ya lo
sabe leer. La fase 0 lo captura y lo puntúa.

Así que a partir de la fase 0 sí se puede afirmar algo, y conviene decirlo con
las palabras exactas, porque la distancia entre las dos frases es todo lo que
este documento defiende:

> **Se puede demostrar** que un cambio coincide más con lo que aprobaste.
> **No se puede demostrar** que suene más como el disco.

Un informe que diga "acierta más" a secas sigue mintiendo. Uno que diga "cumple
47 de 52 de tus juicios, frente a 39 de 52 del anterior, moviendo 3.100 pistas
del catálogo" no miente, y alcanza para decidir.

Eso también reencuadra la fase 5. Sin marcador, un modelo que propone tonos es
exactamente lo que la cabecera de `lib/ampli.js` descartó: *acierta a veces y no
hay forma de saber cuándo*. Con marcador deja de ser un acto de fe — propone en
vocabulario cerrado y **entra sólo si le gana al sugeridor vigente sobre el
corpus**. El descarte del 2026-09-04 no se revierte: se le pone la condición que
le faltaba.
