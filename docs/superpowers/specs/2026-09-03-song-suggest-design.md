# song-suggest — Diseño

**Fecha:** 2026-09-03
**Estado:** aprobado, listo para plan de implementación

## 1. Objetivo

Una web local que sortea al azar canciones con guitarra interesante para aprender,
filtrables por dificultad y por tipo de guitarra, que recuerda qué ya aprendí y qué
descarté para no repetírmelas.

El problema real: aprendo canciones más rápido que antes y me quedo sin ideas de qué
tocar. La app resuelve el descubrimiento, no la enseñanza — para aprender la canción
se enlaza a Songsterr.

## 2. Fuente de datos: Songsterr

Verificado en vivo el 2026-09-03 durante el sondeo de factibilidad.

    GET https://www.songsterr.com/api/songs?pattern=&size=200&from=N
    GET https://www.songsterr.com/api/meta/{songId}

Sin API key, sin registro, sin OAuth. Lo relevante:

- Cada track trae `instrument` y `difficulty` (1–10). En una muestra de 200 canciones,
  **200 tenían track de guitarra con dificultad asignada**.
- Distribución observada de dificultad: 1→3, 2→75, 3→64, 4→39, 5→11, 6→2, 7→2, 8→4.
- `/api/meta/{id}` agrega `tags`, `fingerstyle`, `views`, `videos` (IDs de YouTube) y
  banderas de calidad (`isJunk`, `aiGenerated`, `isBlank`, `isPublished`).
- El link a la canción se arma solo con el ID: `/a/wa/song?id={songId}` redirige (301)
  a la página real. No hace falta guardar slugs.

### Límites confirmados

| Límite | Detalle |
|---|---|
| Paginación | `from` tope ~9998 (ventana Elasticsearch). `size` acepta al menos 200. |
| CORS | No hay `Access-Control-Allow-Origin`. **El navegador no puede llamar la API directo.** |
| Tablatura | La API expone metadata, no notación. Se enlaza a Songsterr para leerla. |

Como el ETL corre aparte y la app solo lee la base local, la falta de CORS deja de ser
un problema.

### Descartado

- **Spotify** — `audio-features`, `audio-analysis` y `/recommendations` cerrados para apps
  nuevas desde 2024-11-27, sin ruta de acceso. Febrero 2026 endureció más el acceso.
- **AcousticBrainz** — apagado desde 2022; solo queda un dump congelado.
- **Ultimate Guitar** — sin API pública; solo scrapers no oficiales de su API móvil, y su
  ToS cubre APIs y contenido. No vale el riesgo teniendo Songsterr.

## 3. Arquitectura

    ETL (ocasional)  →  songs.db  ←  servidor local  ←  navegador

Una sola dirección de dependencia, y **solo el ETL habla con Songsterr**. La app nunca
toca la red.

Alcance: **local, un usuario, un dispositivo.** Sin hosting, sin auth, sin sincronización.

### Stack

Node 25 y nada más. `node:sqlite`, `node:http` y `node:test` vienen built-in — verificado
que `node:sqlite` funciona en este equipo. **Cero dependencias npm.** El front es HTML +
JS vanilla, sin build step.

    etl/
      index.js          orquesta las dos fases, reanudable
      catalog.js        fase 1: paginación del catálogo
      meta.js           fase 2: enriquecimiento por canción
      parse.js          transformación pura (testeada contra fixtures)
      http.js           fetch con reintentos, backoff y límite de concurrencia
      fixtures/         respuestas reales de Songsterr, para los tests
    db/
      schema.sql
      queries.js        construcción de las consultas de sorteo (testeada)
    server.js
    public/
      index.html  app.js  style.css
    test/
      parse.test.js  queries.test.js  server.test.js
    songs.db            (en .gitignore)

## 4. Modelo de datos

```sql
CREATE TABLE songs (
  song_id      INTEGER PRIMARY KEY,
  artist_id    INTEGER NOT NULL,
  artist       TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  views        INTEGER,
  catalog_rank INTEGER,                    -- posición en el listado por popularidad
  fingerstyle  INTEGER NOT NULL DEFAULT 0,
  has_chords   INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  is_junk      INTEGER NOT NULL DEFAULT 0,
  is_blank     INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  videos       TEXT,                       -- JSON: [{videoId, feature}]
  enriched_at  TEXT                        -- NULL = falta fase 2
);

CREATE TABLE tracks (
  song_id       INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  track_index   INTEGER NOT NULL,
  instrument_id INTEGER,
  instrument    TEXT    NOT NULL,
  name          TEXT,
  difficulty    INTEGER,                   -- puede venir ausente
  views         INTEGER,
  tuning        TEXT,                      -- JSON: array de notas MIDI
  PRIMARY KEY (song_id, track_index)
);

CREATE TABLE tags (
  song_id INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (song_id, tag)
);

CREATE TABLE song_state (
  song_id     INTEGER PRIMARY KEY,         -- sin FK, a propósito (ver abajo)
  status      TEXT CHECK (status IN ('learned','skipped','queued')),
  liked       INTEGER NOT NULL DEFAULT 0,
  shown_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX idx_tracks_song ON tracks(song_id);
CREATE INDEX idx_tags_tag    ON tags(tag);
CREATE INDEX idx_songs_todo  ON songs(enriched_at) WHERE enriched_at IS NULL;
```

### Dos decisiones que importan

**`song_state` no tiene foreign key hacia `songs`, y el ETL nunca la toca.** Es la única
tabla que escribe la app. Así puedo borrar y rebajar el catálogo completo sin perder meses
de historial. Esta separación es la razón principal por la que elegimos SQLite sobre
`localStorage`.

**`status` y `liked` son ejes independientes.** Puedo aprender algo que me aburrió, o amar
algo que todavía no me sale. Cruzarlos es lo que da señal: *me gustó pero la descarté*
(demasiado difícil por ahora) es un dato distinto de *la aprendí pero no me gustó*, y
ninguno de los dos se expresa con un solo campo.

`shown_count` guarda el denominador. Sin él solo sé qué me gustó; con él sé que "me ofreció
40 de thrash y descarté 38", que es lo que después permite aprender el patrón.

`tags` es tabla porque se filtra; `videos` es columna JSON porque solo se muestra.

### Track representativo

Una canción tiene varios tracks de guitarra ("Master of Puppets" tiene cuatro). Se guardan
todos, pero para filtrar y mostrar dificultad se elige **el de más `views` entre los de
guitarra con `difficulty` no nula** — el que la gente efectivamente toca.

Instrumentos considerados guitarra: `Distortion Guitar`, `Overdriven Guitar`,
`Electric Guitar (clean)`, `Electric Guitar (jazz)`, `Electric Guitar (muted)`,
`Acoustic Guitar (steel)`, `Acoustic Guitar (nylon)`, `Guitar Harmonics`.

## 5. ETL

Corre a demanda, no en cada uso. Dos fases:

1. **Catálogo** — pagina `from=0..9800` con `size=200`: ~50 requests para ~10.000 canciones
   con sus tracks. Guarda `catalog_rank` según la posición.
2. **Enriquecimiento** — un `/api/meta/{songId}` por canción, **en orden de `catalog_rank`**.
   Tras las primeras ~300 la app ya es usable; el resto se completa después.

Reglas:

- 2–3 requests concurrentes, con backoff exponencial y 3 reintentos. Ante 429, baja el ritmo
  en vez de insistir.
- Una canción que falla definitivamente se registra y **el proceso sigue**. Nunca abortar
  10.000 por una.
- Escrituras en transacciones: la fase 1 por página, la **fase 2 por canción**. Un Ctrl-C
  nunca deja la base a medias. (La versión original de esta spec pedía lotes de 200 también
  en la fase 2; la granularidad por canción resultó mejor — reanudabilidad más fina, y es lo
  que hizo posible contener las excepciones sin abortar la corrida. Corregido el 2026-09-03.)
- Reanudable vía `enriched_at`: al arrancar retoma lo pendiente.

## 6. API del servidor

    GET  /api/roll?mode=&minDifficulty=&maxDifficulty=
         → { song: {...} | null, matching: <int>, hint: <string|null> }
         Incrementa shown_count de la canción devuelta.

    POST /api/mark   { songId, status?: 'learned'|'skipped'|'queued'|null, liked?: boolean }
         → { ok: true }
         status: null borra la disposición y devuelve la canción al sorteo.

    GET  /api/lists?list=learned|skipped|queued|liked
         → { songs: [...] }

    GET  /api/stats  → { total, enriched, pending, available }

`matching` es cuántas canciones calzan con los filtros actuales *después* de las exclusiones
permanentes. Viaja siempre junto a la canción, no solo cuando no hay resultados: es lo que
permite avisar que quedan pocas antes de que se acaben.

`hint` es texto para mostrar tal cual, y solo viene cuando hay algo que sugerir: `matching`
en cero, o por debajo de 10. En ambos casos propone el ajuste más barato — típicamente
ampliar el rango de dificultad, indicando cuántas canciones se ganarían con ello.

`available` en `/api/stats` es el total de canciones sorteables sin ningún filtro de modo ni
dificultad, o sea el catálogo enriquecido menos las exclusiones permanentes. Es el número que
baja a medida que uso la app, y el que avisa cuándo toca re-correr el ETL.

**Dónde se ven estos dos números** (esta spec no lo decía, y esa omisión permitió construir
el front sin ellos mientras cada revisión por tarea pasaba): `available` va en el encabezado
de la página, visible siempre. `matching` va en la tarjeta, junto a la canción sorteada. Un
número que la API calcula y la interfaz nunca muestra no cumple ninguna función: la spec
tiene que nombrar al consumidor, no solo al productor.

### Modos

| modo | filtro sobre el track representativo |
|---|---|
| `surprise` (default) | Cualquier canción con track de guitarra. Sin sesgo. |
| `riffs` | `instrument IN ('Distortion Guitar','Overdriven Guitar')` y `fingerstyle = 0` |
| `acoustic` | `fingerstyle = 1` OR `instrument IN ('Acoustic Guitar (nylon)','Acoustic Guitar (steel)')` |
| `solos` | `name` del track menciona *Lead* o *Solo* (la data real trae `"Kirk Hammett \| ... \| Lead Guitar"`) |

Más el rango de dificultad (1–10) sobre el track representativo.

El modo `solos` además **sesga al extremo alto del rango elegido**, y eso significa algo
concreto: sortea solo entre el tercio superior por dificultad de las que calzan, con mínimo
20 candidatas. Si calzan menos de 20, se sortea entre todas — sin el mínimo, un rango angosto
dejaría el sorteo eligiendo siempre entre dos o tres canciones.

### Exclusiones permanentes

Aplican siempre, sin que el usuario las pida:

- `song_state.status IS NOT NULL` — ya aprendida, descartada o encolada. Las `queued`
  quedan fuera del azar a propósito: ya las elegí, no necesito que el sorteo me las repita.
  Se llega a ellas por la vista de listas.
- `is_junk`, `ai_generated`, `is_blank`, o `is_published = 0` — el catálogo trae
  transcripciones automáticas y borradores.
- Canciones sin enriquecer (`enriched_at IS NULL`), porque les falta `fingerstyle` y tags.

### Sorteo

`ORDER BY RANDOM() LIMIT 1` sobre el conjunto filtrado. Azar plano, sin ponderar por
popularidad: las ~10.000 del catálogo ya vienen ordenadas por popularidad de origen, así que
ponderar de nuevo solo encerraría el sorteo en los mismos veinte clásicos.

## 7. Interfaz

Una pantalla. Controles arriba, tarjeta al centro, botones abajo.

La tarjeta muestra: artista y título, dificultad e instrumento del track representativo,
tags, link a Songsterr, y el backing track de YouTube si existe.

**Afinación:** si el track no está en Mi estándar (`[64,59,55,50,45,40]`), se avisa arriba,
para saber antes de agarrar la guitarra si esto implica reafinar. Detección:

- Todas las cuerdas con el mismo offset *n* → "n semitonos abajo/arriba" (Eb, D estándar…).
- Las cinco primeras con el mismo offset y la 6ª más grave todavía → **"Drop X"** según la
  nota de la 6ª. Nótese que *n no tiene que ser cero*: Drop C es la quinta afinación más
  común del catálogo (396 canciones) y consiste en bajar todo un tono **y además** soltar la
  sexta. Detectar solo el caso *n = 0* dejaría fuera a Drop C, C#, B, A# y A — 938 canciones,
  casi el 10% de las que tienen guitarra, que recibirían una lista de notas en vez del nombre
  que cualquier guitarrista reconoce. Medido contra el catálogo real el 2026-09-03.
- Cualquier otro caso → mostrar los nombres de las notas tal cual.

**Botones**, siguiendo los dos ejes del estado: una fila de disposición
(*Ya la aprendí* · *No me tinca* · *Después* · *Otra*) y aparte un corazón para *me gustó*,
marcable junto con cualquiera de los otros.

### Vista de listas

Una segunda vista, misma página, con cuatro listas: **aprendidas**, **me gustaron**,
**para después** y **descartadas**. Cada fila muestra artista, título, dificultad y el link
a Songsterr, y permite deshacer la marca — un `POST /api/mark` con `status: null` devuelve la
canción al sorteo, que es la salida cuando descarto algo por error.

Sin esta vista, `queued` no tendría cómo consultarse y las marcas serían irreversibles.

## 8. Manejo de errores

| Situación | Comportamiento |
|---|---|
| ETL: red caída, 429, 5xx, JSON inesperado | Reintentos con backoff; la canción que falla se anota y el proceso sigue. |
| Base ausente o vacía | El servidor lo detecta al arrancar y dice qué comando correr. No revienta en la primera consulta. |
| Filtros sin resultados | **Caso frecuente, no excepcional.** No es error: la tarjeta informa cuántas quedan y qué aflojar ("con dificultad hasta 4 hay 312"). |
| Catálogo agotado para un modo | Mismo tratamiento; se sugiere ampliar rango o cambiar de modo. |

## 9. Pruebas

TDD con `node:test`.

- **El ETL no toca la red en los tests.** Fixtures con respuestas reales de Songsterr
  (una página de 200 canciones y varios `/api/meta` ya capturados). Esto además congela el
  contrato: si Songsterr cambia el formato, el test falla con un diff legible en vez de que
  la app empiece a devolver cosas raras.
- **Lógica pura contra una DB `:memory:`:**
  - elección del track representativo — caso real "Master of Puppets": cuatro guitarras,
    debe salir el de Kirk Hammett con dificultad 4;
  - cada modo traducido a SQL, con casos que calzan y casos que no;
  - exclusiones: una `skipped` no vuelve nunca; una con `liked` pero sin `status` sí puede salir;
  - el caso de cero resultados.
- **Test de humo del servidor:** levantar, pedir `/api/roll`, verificar la forma de la respuesta.
- **Fuera:** el front, con una salvedad honesta. Cuando escribí esto era "una pantalla con
  tres controles y cuatro botones". Terminó siendo ~140 líneas con una máquina de estados de
  botones deshabilitados, sujeción de sliders, un toggle de corazón, dos vistas y delegación
  de eventos — y los dos defectos que sobrevivieron a todas las revisiones por tarea vivían
  ahí. La decisión se mantiene (no monto testing de browser para esto), pero se asume
  explícitamente: **el front no tiene red de seguridad automatizada, y sus regresiones se
  encuentran usándolo.** Si crece más, extraer el armado de la tarjeta a una función pura y
  ponerle cuatro aserciones sería el primer paso.

## 10. Fuera de alcance

Explícitamente **no** se construye ahora:

- **El recomendador.** Se captura la señal (`liked`, `status`, `shown_count`) para que exista
  después; construirlo hoy sería adivinar sin datos.
- Sincronización entre dispositivos, hosting, autenticación.
- Descarga o renderizado de tablaturas — se enlaza a Songsterr.
- Integración con Spotify, Last.fm o MusicBrainz.
- Descubrimiento más allá de las ~10.000 del catálogo paginable.

## 10-bis. Respaldo y recuperación

Este apartado faltaba, y era el hueco más grande de los documentos: toda la razón de ser de
la §4 es no perder meses de historial, y no había ni una línea sobre cómo protegerlo.

`songs.db` está en `.gitignore` y contiene dos cosas de naturaleza muy distinta:

- El **catálogo** (`songs`, `tracks`, `tags`): reemplazable. Se vuelve a bajar en ~1 hora
  corriendo el ETL.
- **`song_state`**: irreemplazable. Es lo único del proyecto que no se puede reconstruir
  desde ninguna fuente.

De ahí dos requisitos:

- Un `npm run backup` que copie la base con fecha en el nombre. Los `.db.bak` van al
  `.gitignore` — son respaldos locales, no contenido del repo.
- Un `README.md` que diga cómo se pone en marcha esto, qué hace cada bandera del ETL, y que
  `song_state` es lo único irrecuperable. Sin él, el proyecto solo es operable de memoria.

## 11. Riesgos y cosas no verificadas

- ~~**Rate limiting de Songsterr: desconocido.**~~ **RESUELTO el 2026-09-03**, corriendo el
  ETL real durante la implementación: 50 páginas de catálogo más 50 enriquecimientos con la
  concurrencia por defecto de 3, **cero 429 y cero errores HTTP de cualquier tipo**. El
  servidor tolera el ritmo sin quejarse. La concurrencia 3 se mantiene: no hay motivo para
  subirla y el margen no cuesta nada.
- **Cifras reales del catálogo** (misma corrida): 9.999 canciones — confirmando la ventana de
  paginación de 10.000 — con 64.551 tracks, de los cuales **9.776 canciones (97,8%) tienen
  track de guitarra representativo con dificultad**. La premisa del proyecto se sostiene con
  el catálogo completo, no solo con la muestra de 200 del sondeo. La base ocupa 7,1 MB.
- **`difficulty` es el criterio del transcriptor**, no una medida objetiva. Sirve para
  ordenar, no como verdad absoluta.
- **La ventana de 10.000** limita el catálogo al tramo más popular. Si se agota, la salida
  es consultar por `pattern=` de artista, no está en este alcance.
- El catálogo cambia con el tiempo; re-correr el ETL es la forma de actualizar, y por diseño
  no afecta `song_state`. **Corrección del 2026-09-03:** eso era dos tercios cierto. Un
  segundo `npm run etl` refresca artista, título y tracks, pero **no** tags, views ni las
  banderas de calidad, porque la fase 2 solo mira las canciones con `enriched_at` en NULL.
  Refrescar la metadata requiere la bandera `--re-enriquecer`, que pone `enriched_at` en NULL
  antes de la fase 2 — y que sigue sin tocar `song_state`.
