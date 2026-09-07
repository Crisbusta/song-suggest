# Auditoría del import de presets de la comunidad

**Medido:** 2026-09-07, contra `lib/presets-comunidad.js` (rama
`feat/presets-comunidad`, HEAD en el momento de medir: `280042e`) y el
`songs.db` real del repo (raíz, no `data/songs.db`), incluyendo su WAL vivo
(`songs.db-wal`, última escritura 2026-09-06 17:26).

**De dónde sale el dato importado.** Los dos CSV en `data/` son una copia
exacta, sin reformatear, de una planilla que **mantiene la comunidad de
usuarios del Fender Mustang LT25**, no este proyecto:
<https://docs.google.com/spreadsheets/d/1KWvjJ6q6Ora2MqmxtUAWjq9Uerp0Ycza5ouuKuol5HQ/edit?gid=1647190216>
(exportada el 2026-09-06; ver `data/PROCEDENCIA.md`). Los ajustes de ampli y
efectos de este documento son **opinión de esas personas** — lo que a alguien
le funcionó, no una medición del tono real de la grabación — y se citan como
tal, no se apropian. El repositorio es local y no está publicado.

Este documento responde una sola pregunta: **qué entró de verdad en el
import**, para que un import que pierde filas en silencio no pase
desapercibido. La sección de avisos, no la de descartes, es la que hay que
leer.

## 1. Filas leídas e importadas

| | leídas | importadas | descartadas |
|---|---|---|---|
| `presets-lt25-bandas.csv` (hoja 1, "bandas") | 77 | 77 | 0 |
| `presets-lt25-tonos.csv` (hoja 2, "tonos") | 10 | 10 | 0 |
| **Total** | **87** | **87** | **0** |

Cero descartes de fila entera. Una fila se descarta completa sólo cuando
ninguna de sus cinco ranuras (amp, stomp, mod, delay, reverb) produce nada
reconocible (`lib/presets-comunidad.js`, `descartes`); no ocurrió en ninguna
de las 87 filas. Esto **no** significa que el CSV sea limpio: significa que
cada fila con problemas igual rescató al menos una ranura utilizable, y sus
problemas puntuales viven en la lista de avisos de abajo.

## 2. Avisos — la lista completa (27)

Cada aviso es una anomalía real del corpus que no vacía la fila entera pero
tampoco se puede callar: una ranura con valores pero sin nombre de unidad
(los valores se tiran), un nombre de unidad que no resuelve (la ranura entera
se omite), una celda que no es un número y no se pudo rescatar por su unidad
declarada (la perilla queda en el default del catálogo), o un valor numérico
fuera del rango que el catálogo declara para esa perilla (se descarta igual
que un no-numérico, para no mandarle al ampli un valor que sería un dedazo de
la planilla, no un ajuste real).

| # | Archivo | Línea | Fila | Ranura | Motivo |
|---|---|---|---|---|---|
| 1 | bandas | 10 | Beabadoobee | delay | hay valores (2.5, 316, 3.0, 4.5) pero la columna de unidad está vacía |
| 2 | bandas | 13 | Bob Mould / Husker Du | stomp | "level" de FUZZ no es un número en la planilla: "LOOSE" |
| 3 | bandas | 14 | Carlos Santana | mod | hay valores (LO-DO) pero la columna de unidad está vacía |
| 4 | bandas | 17 | Curtis Mayfield | mod | "mode" de TOUCH WAH no es un número en la planilla: "HI-UP" |
| 5 | bandas | 17 | Curtis Mayfield | mod | "type" de TOUCH WAH no es un número en la planilla: "BPF" |
| 6 | bandas | 18 | Custom User - Horse N Buggy | amp | "bass" de DELUXE CLN queda fuera del rango que el catálogo declara (0 a 10): 44.2 |
| 7 | bandas | 20 | Devin Townsend | stomp | "level" de FUZZ no es un número en la planilla: "TIGHT" |
| 8 | bandas | 21 | Eddie Hazel / Funkadelic | stomp | "level" de FUZZ no es un número en la planilla: "LOOSE" |
| 9 | bandas | 21 | Eddie Hazel / Funkadelic | mod | "mode" de TOUCH WAH no es un número en la planilla: "LO-DO" |
| 10 | bandas | 21 | Eddie Hazel / Funkadelic | mod | "type" de TOUCH WAH no es un número en la planilla: "LPF" |
| 11 | bandas | 22 | Eddie Van Halen / Van Halen | amp | "volume" de 80S ROCK no es un número en la planilla: "?" |
| 12 | bandas | 23 | Ennio Morricone / Spaghetti Western | amp | "bass" de 50S TWIN no es un número en la planilla: "?" |
| 13 | bandas | 35 | Jimi Hendrix | stomp | "level" de FUZZ no es un número en la planilla: "LOOSE" |
| 14 | bandas | 35 | Jimi Hendrix | mod | "mode" de TOUCH WAH no es un número en la planilla: "HI-UP" |
| 15 | bandas | 35 | Jimi Hendrix | mod | "type" de TOUCH WAH no es un número en la planilla: "BPF" |
| 16 | bandas | 36 | Joey Santiago / The Pixies | delay | unidad no reconocida: "80s" |
| 17 | bandas | 41 | Keith Richards / Rolling Stones | mod | hay valores (...) pero la columna de unidad está vacía |
| 18 | bandas | 43 | Kurt Cobain (Distorted) / Nirvana | stomp | "tone" de FUZZ no es un número en la planilla: "TIGHT" |
| 19 | bandas | 46 | Mac DeMarco | amp | "gain" de TWIN CLEAN no es un número en la planilla: "as" |
| 20 | bandas | 58 | Page Hamilton / Helmet | mod | "mode" de TOUCH WAH no es un número en la planilla: "HI-UP" |
| 21 | bandas | 58 | Page Hamilton / Helmet | mod | "type" de TOUCH WAH no es un número en la planilla: "BPF" |
| 22 | bandas | 68 | SLASH / GUNS N ROSES? | mod | "mode" de TOUCH WAH no es un número en la planilla: "LO-UP" |
| 23 | bandas | 68 | SLASH / GUNS N ROSES? | mod | "type" de TOUCH WAH no es un número en la planilla: "HPF" |
| 24 | bandas | 69 | Stephen O'Malley / Sunn | stomp | "level" de FUZZ no es un número en la planilla: "LOOSE" |
| 25 | bandas | 71 | Super Clean | amp | hay valores (4.0, 7.0, 9.3, 8.1, 4.0, 6.0, 7.2) pero la columna de unidad está vacía |
| 26 | tonos | 5 | Sexy Flanger | stomp | "type" de COMPRESSOR no es un número en la planilla: "Low" |
| 27 | tonos | 9 | Chorus + Drive | stomp | "type" de COMPRESSOR no es un número en la planilla: "Low" |

Notas de lectura:

- **FUZZ / "level"/"tone" en texto** (8 avisos: #2, #7, #8, #13, #18, #24, y las
  dos de TOUCH WAH que acompañan varias de estas filas) — la planilla anota la
  perilla de fuzz con palabras (`LOOSE`, `TIGHT`) en vez de un número. Queda en
  el default de la unidad.
- **TOUCH WAH "mode"/"type" en texto** (10 avisos entre #4, #5, #9, #10, #14,
  #15, #20, #21, #22, #23) — mismo patrón: la planilla anota el modo del wah
  con siglas (`HI-UP`, `BPF`, `LO-DO`, `LPF`, `LO-UP`, `HPF`) en vez del número
  de posición.
- **Columna de unidad vacía con valores sueltos** (#1, #3, #17, #25) — la fila
  trae números (o "...") en las columnas de valor pero no dice a qué unidad
  pertenecen; sin nombre no hay dónde ponerlos, y se tiran en vez de
  adivinarlos. La de la fila 71 ("Super Clean") es la más llamativa: siete
  valores completos, ninguno usable, porque la columna de unidad del bloque de
  ampli quedó en blanco.
- **Signos de interrogación literales** (#11, #12) — la propia planilla marca
  su incertidumbre escribiendo "?" en la celda del valor, no sólo en el nombre
  de la fila.
- **Fuera de rango del catálogo** (#6) — el único caso real: "Custom User -
  Horse N Buggy" trae `bass 44.2` en un DELUXE CLN, que declara 0–10. Se
  descarta en vez de acotarlo, porque acotarlo mandaría el bass AL TOPE por un
  error ajeno.
- **Unidad no reconocida** (#16) — "80s" no es ningún nombre de unidad del
  catálogo ni un alias declarado; la ranura completa (delay) de esa fila se
  omite.
- **Palabra suelta que no es número** (#19) — "as" en la celda de gain.

Ninguno de estos 27 avisos vació una fila entera: cada una de las filas
afectadas retuvo al menos una ranura utilizable (por eso `descartadas` es 0 y
no 27).

## 3. Cobertura del catálogo

**Advertencia de comparabilidad.** El universo de canciones se encoge con el
uso: cada canción que la persona marca como aprendida, saltada o en cola sale
del sorteo real (`st.status IS NULL` en `db/queries.js`). Un número de
cobertura sin su filtro y su fecha no es comparable con la próxima medición —
este proyecto ya midió el mismo universo dos veces con 10 canciones de
diferencia por esa cláusula sola (ver `docs/superpowers/specs/2026-09-06-presets-comunidad-design.md`
§5). Por eso cada cifra de abajo va con su filtro exacto.

### 3.1 Universo real de la app: `BASE_FROM` (`db/queries.js:6-14`), dificultad 1-10

Filtro exacto: `s.enriched_at IS NOT NULL AND s.is_junk=0 AND s.ai_generated=0
AND s.is_blank=0 AND s.is_published=1 AND st.status IS NULL AND r.difficulty
BETWEEN 1 AND 10` — el mismo `WHERE` que usa `roll()` en modo `surprise` con
el rango de dificultad completo, o sea el universo real que sortea la app
hoy. Medido sobre `sugerirAjustes` completo: `buscarPreset(...) ??
presetDeGenero(tags)`, con la excepción de §6.4 de la spec (un track
representativo acústico no usa el preset de comunidad y cae a la tabla de
reglas).

| Motivo | Canciones |
|---|---|
| `cancion` (preset de canción exacta) | 7 |
| `artista` (preset de artista, con o sin desempate de época) | 867 |
| `artista (sin desempate de epoca)` | 45 |
| `artista (desde el preset de otra cancion)` | 13 |
| `genero` (tono de género, hoja 2) | 2.650 |
| **Cubiertas (suma de las anteriores)** | **3.582** |
| Track representativo acústico (excluido del preset de comunidad, cae a reglas) | 1.619 |
| Sin preset de ningún tipo (incluye las acústicas) | 6.154 |
| **Universo total** | **9.736** |

**Cobertura: 3.582 de 9.736, 36,8%.** Coincide exacto con la cifra ya
corregida en la spec §5 ("9.736 sorteables, 3.582 cubiertas, 36,8%") — no hizo
falta corregir esa sección; ver la nota de re-verificación fechada 2026-09-07
que se agregó ahí mismo.

### 3.2 Universo sin filtrar (las 10.011 filas de `songs`, ninguna exclusión)

Sólo para contrastar contra la tabla de la §5 de la spec, que se midió sobre
**todas** las filas de `songs` sin aplicar `is_junk`/`is_blank`/`ai_generated`/
`is_published`/`st.status`/dificultad:

| Motivo | Canciones |
|---|---|
| `cancion` | 7 |
| `artista` | 882 |
| `artista (sin desempate de epoca)` | 45 |
| `artista (desde el preset de otra cancion)` | 13 |
| `genero` | 2.720 |
| **Cubiertas** | **3.667** |
| **Universo total** | **10.011** |

**Cobertura: 3.667 de 10.011, 36,6%.** También coincide exacto con la spec.

## 4. Discrepancias encontradas contra la spec (§3)

La sección de precedencia (§5, "cerca de la línea 248" del diseño) reprodujo
exacto — ver §3.1 y §3.2 arriba. La sección de mediciones previas a la
decisión (§3) **no** reprodujo exacto, y se corrigió en la spec en el mismo
commit que este documento:

| Celda de la spec §3 | Decía | Mide hoy (2026-09-07) |
|---|---|---|
| Presets de la hoja 1 que calzan con un artista del catálogo | 51 de 77 | **50 de 77** |
| Canciones que cubren esos presets | 1.063 (10,7%) | **1.067 (10,7%)** — 7 canción exacta, 984 artista, 61 sin desempate, 15 desde otra canción |
| Presets que nombran una canción concreta que existe en el catálogo | 5 | **7** |
| Canciones de Metallica en el catálogo (anécdota de cobertura) | 169 | **171** |

Estas cuatro cifras son de las secciones de la spec que **no** dependen de
`st.status` ni de la dificultad — dependen sólo de `lib/presets-comunidad.js`
y de la tabla `songs` completa, y aun así no cerraron contra lo medido hoy. La
diferencia es consistente con que el catálogo creció un poco entre el
2026-09-06 (fecha de la spec) y hoy: el conteo de Metallica subió en 2, y el
conteo "por artista" subió en 4 — mismo orden de magnitud. La caída de 51 a 50
presets que calzan un artista no se pudo aislar contra una lista de referencia
de la medición original (no quedó registrada en la spec cuál era el artista
número 51), así que no se puede afirmar con certeza si es sólo crecimiento del
catálogo o si además cambió algo en el resolvedor de nombres en una tarea
posterior a cuando se escribió esa sección. Ver la nota fechada 2026-09-07 que
se agregó en la spec junto a la tabla de §3, con el detalle completo y la
regla que decide esto (**el número que manda es el medido, con su filtro y su
fecha**).

## 5. Cómo se generaron estos números

`node` con `--input-type=module`, contra el `songs.db` real de la raíz del
repo (no una copia — el WAL vivo se lee directo así, sin arrastrar un
snapshot viejo), usando `openDb()` de `db/open.js` (la misma apertura que usa
`server.js`) y `buscarPreset`/`presetDeGenero`/`auditoria` de
`lib/presets-comunidad.js` sin modificar. El script no escribió nada en la
base: sólo `SELECT`.

## 6. Concerns para quien revise

- **El "número que manda" puede volver a cambiar mañana.** El propio §4 de
  este documento es la prueba: dos mediciones de la misma sección, un día de
  diferencia, ya no cerraron. Cualquier cifra de cobertura que se cite en el
  futuro (en un PR, en una demo, en otro documento) debería repetir esta
  medición en vez de copiar un número de aquí — este documento es una foto de
  2026-09-07, no una constante.
- **Los avisos de TOUCH WAH y FUZZ (18 de los 27) son el mismo patrón
  repetido**, no 18 problemas independientes: la planilla anota esas dos
  unidades con palabras en vez de números en varias filas. Si en el futuro se
  quisiera "rescatar" ese dato (mapear `LOOSE`/`TIGHT`/`HI-UP`/etc. a un valor
  numérico), sería una decisión de producto nueva —inventar una escala que la
  planilla no declaró— y no algo que este documento recomienda.
- **La fila "Super Clean" (línea 71, bandas) sigue perdiendo 7 valores
  completos** por la columna de unidad vacía del bloque de ampli. Es una
  anomalía de la fuente, no del parser: no hay nada que corregir en el código,
  pero vale la pena que quien mantenga la planilla lo sepa si algún día se le
  puede preguntar.
- **Esto es trabajo de terceros, no nuestro.** Los 87 presets importados son
  el criterio de una comunidad de usuarios del Fender Mustang LT25 dialando
  sus propios tonos, citados con su fuente (`data/PROCEDENCIA.md`) y su URL.
  Ningún número de este documento debe leerse como si esta app hubiera medido
  o validado esos tonos: son opinión ajena, marcada como tal en el código
  (`preset.incierto`) y en la interfaz.
