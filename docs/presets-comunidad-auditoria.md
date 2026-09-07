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
| `artista` (preset de artista con desempate de época, o único preset del artista) | 867 |
| `artista (sin desempate de epoca)` | 45 |
| `artista (desde el preset de otra cancion)` | 13 |
| `genero` (tono de género, hoja 2) | 2.650 |
| **Cubiertas (suma de las anteriores)** | **3.582** |
| Track representativo acústico (§6.4 de la spec bloquea el preset de comunidad, cae a reglas) | 1.619 |
| Sin preset de ningún tipo (incluye las acústicas) | 6.154 |
| **Universo total** | **9.736** |

> **Corrección de la revisión final de rama (2026-09-07).** Dos etiquetas de
> esta tabla se corrigieron:
> - La fila `artista` decía "con o sin desempate de época", pero la fila
>   siguiente ya separa el caso "sin desempate" (45): la etiqueta se
>   contradecía con su propia tabla. Los 867 son sólo los que sí desempataron
>   por época o tenían un único preset genérico.
> - "Track representativo acústico (excluido del preset de comunidad)" daba a
>   entender que las 1.619 perdieron algo por la regla de §6.4. No es así: de
>   esas 1.619, sólo **504** habrían recibido un preset de comunidad si no
>   existiera la excepción acústica (119 de banda + 385 de tono de género, ver
>   spec §6.4) — las otras 1.115 no tenían ni preset de artista ni tono de
>   género que perder, acústicas o no.

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

### 3.3 Las 27 filas de la hoja 1 que no calzan con ningún artista: dos categorías

`partirClave` toma el **último** segmento de la clave tras `/` como la banda —
correcto como regla (§4 de la spec): en `Alex Lifeson / Rush` el guitarrista es
lo primero y la banda, que es lo que indexa el catálogo, va al final. La spec
§10 (punto 4) asume que las 27 filas sin calce son todas ausencias legítimas
del catálogo (Fela, PJ Harvey, Sunn O))), Tom Waits…). **Dos no lo son:**

| Fila del CSV | `partirClave` deriva | El catálogo sí tiene | Canciones perdidas |
|---|---|---|---|
| `Ennio Morricone / Spaghetti Western` | "Spaghetti Western" | **Ennio Morricone** (3 canciones) | 3 |
| `Nile Rogers / Chi` (truncado en la fuente, verificado byte a byte en `data/presets-lt25-bandas.csv:55`) | "Chi" | **Chic** (4 canciones) | 4 |

Estas dos filas calzarían si la clave no viniera truncada (Chic) o si el
guitarrista, no la banda, fuera el segmento correcto para esta fila puntual
(Ennio Morricone es su propio nombre artístico, no una banda con guitarrista
aparte) — pero cambiar la regla para estos dos casos rompería el resto: el
guitarrista siempre yendo primero y la banda al final es lo que permite leer
`Alex Lifeson / Rush`, `Keith Richards / Rolling Stones` y las demás 25 filas
de esta forma. **No se cambia la regla.** Lo que hace falta es no confundir
esta categoría con la otra: estas 7 canciones no son una ausencia legítima del
catálogo, son una clave truncada o mal segmentada en la fuente. La fila de
Ennio Morricone es además el residuo de la discrepancia "51 → 50" de §4 más
abajo: contando "calza" por cualquier segmento de la clave (no sólo el último)
esta fila sí cuenta, porque la exploración original que produjo el "51" la
acreditó por el lado del guitarrista.

(`Stephen O'Malley / Sunn ` también llega truncado desde la fuente —le falta
el resto de "Sunn O)))"— pero "Sunn" no calza contra ningún artista del
catálogo de todos modos, así que no cuesta cobertura y no entra en esta
categoría.)

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
y de la tabla `songs` completa, y aun así no cerraron contra lo medido hoy.

> **Corrección de la revisión final de rama (2026-09-07): la causa no es que
> el catálogo creciera.** `enriched = total = 10.011` en el `songs.db` de hoy
> — no existe un universo `enriched_at IS NOT NULL` más chico que el total que
> pudiera haber "crecido" hasta él, y las fechas de modificación de los
> archivos lo confirman. Son **dos cambios de definición de medición**, cada
> uno aislado y reproducido por separado, más una tercera cifra (5→7) que es
> una mejora intencional y no una discrepancia:
>
> **(a) 1.063 → 1.067 y Metallica 169 → 171: cambio de denominador, no de
> dato.** Mismo código (`buscarPreset`/`presetDeGenero`), misma base de datos,
> tres universos distintos:
>
> | Universo | Filas | Calzan artista | Cubiertas | Metallica |
> |---|---|---|---|---|
> | `songs` completo (esta auditoría, §3.2) | 10.011 | 50 | 1.067 | 171 |
> | `+ is_junk=0 + is_blank=0` (medición original de la spec §1, "9.974") | 9.974 | 50 | 1.063 | 169 |
> | `BASE_FROM` completo (§3.1 arriba) | 9.736 | 50 | 1.051 | 166 |
>
> Las tres son correctas para su propio universo: la spec midió sobre 9.974 en
> su momento, esta auditoría sobre 10.011. Las 37 filas de diferencia entre
> 9.974 y 10.011 aportan exactamente las 4 canciones "por artista" de más y
> las 2 de Metallica — no un catálogo que creció, un filtro distinto aplicado
> al mismo catálogo.
>
> **(b) 5 → 7 presets que nombran una canción: cambio de parseo, y es una
> mejora, no un error.** Repitiendo el conteo con el parseo de antes de la
> Task 3 —que no despoja `{…}`/`(…)` de la clave— da exactamente 5. Los dos
> presets que aparecen con el parseo actual son `Pearl Jam - Yellow Ledbetter
> {EXPERIMENTAL}` y `Radiohead - Creep {EXPERIMENTAL}`: sin despojar la marca,
> el título queda pegado a ella y no calza contra el catálogo. La cifra "5" se
> escribió en el commit de diseño, antes de que existiera `partirClave`.
>
> **(c) 51 → 50: cambio de regla de conteo, y la única que revela una pérdida
> real.** Contando un preset como "calza" si **cualquier** segmento de la
> clave calza un artista (no sólo el último) da exactamente 51, y el extra es
> uno solo: `Ennio Morricone / Spaghetti Western`. La exploración original que
> produjo el "51" acreditó esa fila por el lado del guitarrista;
> `partirClave` se queda con la banda (regla correcta: es la que hace que
> `Alex Lifeson / Rush` indexe por Rush, no por Lifeson — ver el comentario de
> `partirClave` en `lib/presets-comunidad.js`). El 50 es la cifra honesta bajo
> la regla que el código implementa, y las 3
> canciones de Ennio Morricone son el residuo real: ver §3.3 arriba.

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
