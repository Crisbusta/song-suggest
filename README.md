# song-suggest

Una web local, de un solo usuario, que sortea canciones de guitarra para
aprender de un catálogo de Songsterr. Nace de un problema simple: con miles
de tablaturas disponibles, elegir qué aprender es más difícil que aprenderlo.
`song-suggest` sortea una canción al azar (con filtros de modo, dificultad y
bandas, que miran las pistas de guitarra de la canción, no sólo la más tocada)
y lleva la cuenta de lo que ya aprendiste, descartaste, dejaste para después
o te gustó — para no volver a sortear lo mismo. Para la pista que elijas
practicar sugiere además un punto de partida de perillas para un Fender
Mustang LT25, y sabe mandárselo al amplificador por USB (ver [Enviar los
ajustes al amplificador](#enviar-los-ajustes-al-amplificador)). Y trae un
editor del amplificador entero, con sus cinco ranuras y todas sus perillas
(ver [El editor del amplificador](#el-editor-del-amplificador)).

Cero dependencias de npm: usa `node:sqlite`, `node:http` y `node:test`,
todos incluidos en Node. Requiere **Node ≥ 24**.

## Puesta en marcha

```
npm run etl     # una vez, baja y enriquece el catalogo (2-3 horas la primera vez)
npm start       # levanta el servidor en http://localhost:3000
```

El ETL se puede cortar con Ctrl-C en cualquier momento — es reanudable, y
retoma donde quedó la próxima vez que corra. Tras las primeras ~300
canciones enriquecidas la app ya es usable: `npm start` y `npm run etl`
pueden convivir sobre el mismo `songs.db` sin pisarse (usa WAL).

## Filtrar por bandas

Debajo de los sliders hay una caja donde escribes unas letras y eliges bandas
del catálogo; cada una queda como una ficha removible, y el sorteo se limita a
las elegidas. Sin ninguna, sortea de todo. Se combina con el modo y la
dificultad, y la línea de abajo te dice cuántas canciones calzan con la
combinación completa.

Tres cosas que conviene saber:

- **Las escrituras se agrupan.** El catálogo escribe 37 artistas de dos formas
  o más, así que elegir `Кино` trae también las de `КИНО`, y `blink-182` trae
  las de `Blink-182` y `Blink 182`. Elegir una sola escritura dejaría 55
  canciones afuera.
- **No hay transliteración.** Escribir `kino` con teclado latino encuentra
  `Kino` (3 canciones), no `Кино` (29): son cadenas distintas y probablemente
  bandas distintas, así que agruparlas sería un error. Con teclado latino los
  temas en cirílico quedan difíciles de encontrar desde el buscador.
- **El número al lado de cada banda es sorteable, no total.** Cuenta sobre el
  mismo universo que el botón: excluye lo que ya descartaste, y se actualiza
  cuando marcas una canción. Una banda cuya última canción descartas desaparece
  de la lista.

La elección **no se recuerda** entre recargas, igual que el modo y la
dificultad.

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

## Banderas del ETL

`npm run etl -- <banderas>`

| Bandera | Para qué sirve |
|---|---|
| `--limit N` | Enriquece como máximo N canciones pendientes. Útil para una prueba rápida. |
| `--concurrency N` | Cuántas descargas de metadata corren en paralelo (por defecto 3). |
| `--solo-catalogo` | Solo baja el catálogo (fase 1); no enriquece nada. |
| `--solo-meta` | Salta la fase 1; solo enriquece lo que ya está en la base. |
| `--re-enriquecer` | Antes de la fase 2, marca todas las canciones para volver a enriquecerse (borra `enriched_at`, no toca `song_state`). Úsala para refrescar tags, vistas y banderas de calidad tras un tiempo — el catálogo (artista, título, tracks) ya se actualiza solo en cada corrida. |

`N` en `--limit` y `--concurrency` tiene que ser un entero mayor que 0: un
typo (`--limit abc`, `--limit -5`) aborta con un mensaje en vez de disparar
una corrida completa por accidente.

## Enviar los ajustes al amplificador

La tarjeta trae unos ajustes sugeridos para un **Fender Mustang LT25** — los de
la **pista que tengas elegida**, no los de la canción entera — y un botón que se
los manda al equipo por USB, sin intermediarios: el navegador le habla directo
por WebHID.

Para que aparezca el botón:

- **Necesitas Chrome o Edge.** WebHID no existe en Firefox ni en Safari; ahí
  los ajustes se ven igual, pero hay que poner las perillas a mano.
- **Cierra Fender Tone LT Desktop** antes de conectar. El amplificador acepta
  un solo cliente a la vez, y si la aplicación de Fender lo tiene tomado, la
  conexión falla.
- Conecta con el botón del encabezado. El permiso queda recordado por origen:
  la próxima vez reconecta solo, sin volver a mostrarte el selector de Chrome.

Qué manda la tarjeta y qué no:

- **El botón sí cambia el modelo de amplificador.** Cada envío reemplaza la
  unidad de la ranura `amp` por la que la pista elegida sugiere (si la
  declara). Sigue pudiéndose cambiar a mano en la rueda del equipo o en el
  editor — pero el botón ya no lo deja quieto.
- **Y manda la cadena de efectos completa: las cinco ranuras** (`stomp`,
  `mod`, `amp`, `delay`, `reverb`), no sólo tres perillas. Las que la pista
  elegida usa cargan su propia unidad con sus valores; las que no usa
  **quedan vacías** — esto pasa en cada envío, tenga o no esa pista presets
  de la comunidad.
- **Contra que hay que asumir:** vaciar las ranuras que la pista elegida no usa
  **borra lo que hayas dialado a mano ahí**. Si sorteas surf y dejas puesto un
  slapback a mano, y después sorteas thrash, ese slapback no sobrevive al
  envío siguiente. Es a propósito: un tono a medias entre dos canciones no es
  el tono de ninguna.
- Del amplificador viajan `gain`, `treb`, `bass` y, cuando el preset lo
  declara, `mid` (los nombres son los del amplificador, para que calcen con
  lo que ves en el equipo).
- El **volumen queda fuera de la sugerencia a propósito**: el equipo lo recibe
  en dB, así que mandarle un 0.4 como si fuera "4 de 10" puede ser un salto
  brutal de nivel. El botón no lo toca — se lee antes de cambiar de modelo y
  se devuelve tal cual, así que cambiar de modelo no te mueve el volumen que
  tenías. Ese lo pones tú, que sabes en qué pieza estás tocando. (El editor sí
  te lo deja mover — ver más abajo —; lo que no hace nadie es adivinarlo por
  ti.)
- **La tarjeta no graba nada.** Todo se escribe sobre el preset activo, en
  memoria del equipo, y no se guarda en ninguna ranura: reseleccionar el
  preset en la rueda deja el ampli como estaba.
- Las perillas cuya curva todavía no se sabe convertir **no se mandan**: la
  perilla queda en el valor por defecto de la unidad, que es dato real del
  equipo, no un número inventado. Si esa unidad la acaba de cargar este mismo
  envío, el estado del envío lo avisa **en rojo** — el default de fábrica no
  es lo que el tono pedía, y en una perilla de drive se nota.

El amplificador ignora en silencio lo que no entiende, así que la app no da
por buena ninguna escritura sin confirmación: cada perilla espera el ACK del
equipo y, si no llega en 2 segundos, se reporta como `sin confirmar` en vez de
decirte que se aplicó. Si ves eso, vuelve a pulsar el botón.

### De dónde salen los presets por banda y por género

Cuando el catálogo tiene un artista o un género que calza, la sugerencia no
sale de una tabla propia: sale de una planilla que mantiene la **comunidad de
usuarios del Fender Mustang LT25** —
<https://docs.google.com/spreadsheets/d/1KWvjJ6q6Ora2MqmxtUAWjq9Uerp0Ycza5ouuKuol5HQ/edit?gid=1647190216>
— con los ajustes de amplificador y de las cuatro ranuras de efectos que a
esas personas les funcionaron para esa banda o ese tono. **Es opinión de esa
comunidad, no una medición del tono de la grabación**, y la tarjeta lo dice
explícito junto a cada sugerencia, incluida la incertidumbre que la propia
planilla marcó en algunas filas. Detalle de qué se citó, cómo y con qué
límites: `data/PROCEDENCIA.md`. Qué entró de verdad en el import, fila por
fila: `docs/presets-comunidad-auditoria.md`.

## El editor del amplificador

El botón **Ampli** de la barra abre el editor: lee el preset activo del equipo
y dibuja sus cinco ranuras — `stomp`, `mod`, `amp`, `delay`, `reverb` — con la
unidad que tiene cada una y todas sus perillas, incluido el volumen y el
modelo de amplificador. Todo se escribe en vivo, con la misma regla de
siempre: el control muestra dónde lo pusiste, pero si el equipo no confirma,
vuelve al último valor confirmado y lo dice.

Mientras el editor está ocupado — una lectura, un cambio de unidad, un
guardado — sus controles se deshabilitan. Y si mandas los ajustes de una
canción con el editor a mitad de una lectura (o al revés), no se pisan: las
operaciones hacen cola y salen una detrás de otra.

Girar la rueda del equipo sigue siendo tuyo, y sigue siendo el modo de
deshacer: recarga el preset y descarta lo que hayas escrito encima. El editor
no se entera solo de eso — usa **Releer del ampli** para volver a sincronizar
lo que ves con lo que el equipo tiene.

### Guardar en una ranura es lo único que no se deshace

Todo lo anterior se escribe sobre el preset activo, en memoria. **Guardar en
el ampli** es otra cosa: graba en una ranura del equipo, pisa lo que hubiera
ahí y no hay forma de recuperarlo desde esta app. Es la única operación
irreversible del proyecto, y el diálogo está hecho para obligarte a mirar
antes de pisar:

- La ranura de destino **no viene puesta**: la escribes tú.
- La app lee esa ranura y te dice qué preset hay ahí ahora mismo.
- La app lee también el preset activo del equipo y te dice con qué se va a
  pisar, incluida su ranura y si está editado sin guardar — porque lo que se
  graba es lo que esté vivo en el amplificador, no lo que el editor dibujó
  hace un rato.
- El botón de confirmar no se habilita hasta que las dos lecturas vuelvan, y
  justo antes de grabar se relee el preset activo: si cambió desde que lo
  miraste, no se guarda y te lo dice.

Si alguna de esas lecturas falla, no se guarda nada. Sin saber qué se va a
escribir no hay confirmación posible, y esta es la operación en la que
equivocarse cuesta caro.

## El invariante: respalda `songs.db`

`songs.db` es dato local — no está en git (ver `.gitignore`) — y se puede
reconstruir corriendo `npm run etl` de nuevo... excepto por una tabla:
`song_state`. Ahí vive todo lo que aprendiste, descartaste o te gustó: meses
de historial que ninguna corrida del ETL puede recrear. Si el archivo se
corrompe o se borra sin backup, ese historial se pierde para siempre.

Respáldalo de vez en cuando con:

```
npm run backup
```

Esto copia `songs.db` a `songs-<fecha>.db.bak` (ignorado por git también).
No hay respaldo automático — es responsabilidad de quien usa la app.

## Tests

```
npm test
```

Corre con `node:test`, ningún test toca la red. El front end (`public/`)
**casi no tiene tests automatizados**, por decisión de diseño: es vainilla, sin
build, y se verifica a mano contra el servidor real — el costo de un runner
de DOM no se justificaba para una interfaz de un solo usuario.

Las excepciones son los módulos puros de `public/`, que `test/` importa
directo desde disco: `fender-protocolo.js` (`test/protocolo.test.js`),
`catalogo-lt25.js` (`test/catalogo.test.js`), `despachador.js`
(`test/despachador.test.js`) y `tarjeta.js` (`test/tarjeta.test.js`) — la
lógica de la tarjeta sin DOM (qué perillas nombra la frase de envío, qué se
manda al ampli, cómo se etiqueta y arma el selector de pistas), extraída de
`app.js` porque ese archivo sí tiene efectos a
nivel de módulo y no se puede importar en Node. Ahí la regla no aplica: es
código sin DOM ni WebHID de por medio. `app.js`, `ampli-usb.js` y
`editor.js` sí quedan sin tests, por lo mismo de arriba.

El caso más claro es `fender-protocolo.js`, donde lo que se verifica son bytes
capturados del amplificador real. Además es justo el código donde equivocarse
no revienta —
un desfase de un byte no lanza nada, el equipo descarta el mensaje en silencio
y el síntoma se ve idéntico a "el amplificador no contesta". Eso no se caza a
mano; los tests son la única forma de saber que el formato sigue siendo el que
el equipo acepta.
