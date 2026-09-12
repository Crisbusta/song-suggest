# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **`AGENTS.md` es un enlace simbólico a este archivo.** Si llegaste por ahí,
> estás en el sitio correcto: las convenciones son las mismas para cualquier
> agente. Se mantiene una sola copia a propósito — dos archivos de reglas se
> desvían, y entonces cada agente obedece una versión distinta.

## Comandos

```bash
npm start                      # servidor en http://localhost:3000
npm test                       # suite completa (node:test), ninguna toca la red
node --test test/roll.test.js  # un archivo suelto
npm run test:ui                # tests de navegador (Playwright, aparte)
npm run etl                    # baja y enriquece el catalogo (2-3 h la 1a vez)
npm run backup                 # copia songs.db a songs-<fecha>.db.bak
```

El ETL corre en dos fases y es reanudable (Ctrl-C en cualquier momento). Banderas
útiles al desarrollar: `--limit N`, `--solo-catalogo`, `--solo-meta`,
`--re-enriquecer`. `npm start` y `npm run etl` pueden convivir sobre el mismo
`songs.db` (usa WAL).

## Reglas duras

- **Cero dependencias de npm.** Sólo módulos `node:` (`node:sqlite`, `node:http`,
  `node:test`). Requiere **Node ≥ 24**. No hay paso de build: el front son módulos
  ES servidos tal cual desde `public/`.
- **Comentarios en español SIN tildes dentro de `.js`.** El Markdown sí las lleva.
- **Nunca inventar un número.** Si la fuente no trae un dato, viaja como `null` y
  la interfaz no lo dibuja. Toda cifra citada en documentación está medida contra
  el `songs.db` real; si vas a escribir una, mídela.
- **`npm test` no abre navegador ni toca la red.** Los tests de navegador viven
  aparte, en `npm run test:ui`: Playwright es la única dependencia del proyecto y
  es de desarrollo — `dependencies` está vacío y así se queda.
- **Los tests de navegador cubren invariantes, no aspecto.** Ninguno comprueba un
  color ni una medida. Corren contra una base en memoria
  (`test/ui/servidor-fixture.mjs`), nunca contra `songs.db`: sortear escribe
  `shown_count`, y un test no debe ensuciar tu historial.
- Aun así, `editor.js` y `ampli-usb.js` siguen **sin cobertura**: se verifican a
  mano contra el equipo real.

## Zonas protegidas

| Qué | Por qué |
|---|---|
| Tabla `song_state` (esquema y PK) | Lo único que el ETL no puede reconstruir: meses de historial de aprendidas, descartadas y me-gusta. Nunca migrar sin una razón enorme. |
| `public/fender-protocolo.js`, `despachador.js`, `ampli-usb.js` | Bytes capturados del amplificador real. Equivocarse aquí no lanza: el equipo descarta el mensaje en silencio y el síntoma es idéntico a "no contesta". Los tests son la única forma de saber que el formato sigue siendo el que acepta. |
| `data/*.csv`, `public/lt25-unidades.json` | Trabajo de terceros copiado tal cual (planilla de la comunidad del Mustang LT y volcado del firmware de Fender). No reformatear. Ver `data/PROCEDENCIA.md`. Por esto el repo es privado. |

## Arquitectura

**Flujo del dato:** `etl/` baja el catálogo de Songsterr a `songs.db` →
`db/queries.js` lo consulta y lo hidrata → `server.js` lo sirve por `/api/*` →
`public/app.js` lo dibuja → opcionalmente viaja al amplificador por WebHID.

**La unidad es la PISTA, no la canción.** Una canción tiene entre 1 y 11 pistas de
guitarra, cada una con su dificultad, afinación y tono de amplificador. El
predicado del sorteo (`BASE_FROM` + `MODE_SQL` en `db/queries.js`) exige que modo y
dificultad se cumplan **sobre la misma fila** de `guitar_tracks`; escribirlo como
dos existenciales sueltos admite 178 canciones donde ninguna sola pista sirve.
`unaPorCancion()` hace dos trabajos a la vez: elige la pista por defecto (la más
vista *de las que califican*) y deduplica, para que el sorteo sea uniforme por
canción y no favorezca a las que tienen más pistas.

**`lib/` vs `public/`:** `lib/` es lógica de servidor. `public/` es lo que el
navegador carga — pero varios de sus módulos son **puros a propósito** para que
`test/` los importe directo desde disco. Vive ahí y no en `lib/` cuando el
navegador también lo necesita y tener dos copias las haría desviarse
(`artistas.js` es el caso claro: agrupar escrituras y buscar tienen que coincidir
exactamente entre lo que se ofrece y lo que se filtra).

**Qué está testeado de `public/`:** `artistas.js`, `catalogo-lt25.js`,
`despachador.js`, `fender-protocolo.js`, `tarjeta.js` — y la vista Sortear
entera, por comportamiento, desde `test/ui/`. **Qué no, y por qué no se
puede:** `app.js`, `ampli-usb.js`, `editor.js` tienen efectos a nivel de módulo
(llaman a `document` en el import), así que Node no puede importarlos. Si necesitas
testear lógica nueva de la tarjeta, **extráela a `tarjeta.js`** — es lo que ese
módulo es.

`vista-sortear.js` y `panel-ampli.js` producen fragmentos HTML sin efectos de
módulo; su integración visual y sus eventos se verifican en el navegador real.

**El amplificador:** el LT25 tiene 5 ranuras (`stomp`, `mod`, `amp`, `delay`,
`reverb`). Cada envío las reescribe todas; las que la pista no usa quedan vacías, a
propósito. Ninguna escritura se da por buena sin el ACK del equipo: sin
confirmación se reporta `sin confirmar`, y lo que no se pudo escribir se avisa en
rojo. `crearDespachador()` serializa las escrituras (~120 ms cada una, medido) y
fusiona las que se atropellan.

## Invariantes de comportamiento

Parecen bugs si no las conoces. Cambiarlas es un retroceso:

- El contador "cuántas calzan" describe **los filtros**, no la canción en pantalla.
  Buscar una canción y "Sortear de todo" a propósito **no lo mueven**.
- Marcar aprendida marca la **canción entera**, no la pista.
- Las pistas que no cumplen el filtro se muestran igual, **marcadas**: así se ve
  por qué salió esa canción.
- El buscador de canciones encuentra lo que **ya descartaste** (lo pediste por
  nombre) y **no escribe nada** en `song_state`. El sorteo sí las excluye.
- El **volumen** queda fuera de la sugerencia del ampli a propósito: el equipo lo
  recibe en dB y mandarle un 0.4 como "4 de 10" puede ser un salto brutal.
- Una pista **acústica** anula el preset de banda de la comunidad y cae a la tabla
  de reglas (`lib/ampli.js`): el tono de una banda es el de su equipo eléctrico.

## Documentación

`README.md` es la referencia de comportamiento y documenta límites, no sólo
funciones. `docs/superpowers/specs/` tiene el diseño de cada feature con sus
mediciones y lo que se descartó; `plans/` el plan de implementación.
`docs/brief-visual.md` es el brief del rediseño pendiente.

## Commits

Prefijo en minúscula (`feat:`, `fix:`, `docs:`, `merge:`, `chore:`), asunto en
español. El cuerpo explica **por qué**, con las cifras que lo sostienen — mira
`git log` antes de escribir el primero. Se ramifica desde `main` y se mergea con
`--no-ff`.
