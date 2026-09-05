# song-suggest

Una web local, de un solo usuario, que sortea canciones de guitarra para
aprender de un catálogo de Songsterr. Nace de un problema simple: con miles
de tablaturas disponibles, elegir qué aprender es más difícil que aprenderlo.
`song-suggest` sortea una canción al azar (con filtros de modo y dificultad)
y lleva la cuenta de lo que ya aprendiste, descartaste, dejaste para después
o te gustó — para no volver a sortear lo mismo. Para cada canción sugiere
además un punto de partida de perillas para un Fender Mustang LT25, y sabe
mandárselo al amplificador por USB (ver [Enviar los ajustes al
amplificador](#enviar-los-ajustes-al-amplificador)).

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

La tarjeta de cada canción trae unos ajustes sugeridos para un **Fender
Mustang LT25**, y un botón que se los manda al equipo por USB — sin
intermediarios: el navegador le habla directo por WebHID.

Para que aparezca el botón:

- **Necesitas Chrome o Edge.** WebHID no existe en Firefox ni en Safari; ahí
  los ajustes se ven igual, pero hay que poner las perillas a mano.
- **Cierra Fender Tone LT Desktop** antes de conectar. El amplificador acepta
  un solo cliente a la vez, y si la aplicación de Fender lo tiene tomado, la
  conexión falla.
- Conecta con el botón del encabezado. El permiso queda recordado por origen:
  la próxima vez reconecta solo, sin volver a mostrarte el selector de Chrome.

Qué se manda y qué no:

- Solo **`gain`, `treb` y `bass`** (los nombres son los del amplificador, para
  que calcen con lo que ves en el equipo).
- El **volumen queda fuera a propósito**: el equipo lo recibe en dB, así que
  mandarle un 0.4 como si fuera "4 de 10" puede ser un salto brutal de nivel.
  Ese lo pones tú, que sabes en qué pieza estás tocando.
- El **modelo de amplificador hay que ponerlo a mano**: eso se elige en la
  rueda del equipo.
- **No se guarda nada.** Los valores se escriben sobre el preset activo y
  nunca se graban: reseleccionar el preset en la rueda deja el ampli como
  estaba.

El amplificador ignora en silencio lo que no entiende, así que la app no da
por buena ninguna escritura sin confirmación: cada perilla espera el ACK del
equipo y, si no llega en 2 segundos, se reporta como `sin confirmar` en vez de
decirte que se aplicó. Si ves eso, vuelve a pulsar el botón.

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

La excepción es `public/fender-protocolo.js`, que `test/protocolo.test.js`
importa directo desde disco. Ahí la regla no aplica: es código puro, sin DOM
ni WebHID de por medio, y lo que verifica son bytes capturados del
amplificador real. Además es justo el código donde equivocarse no revienta —
un desfase de un byte no lanza nada, el equipo descarta el mensaje en silencio
y el síntoma se ve idéntico a "el amplificador no contesta". Eso no se caza a
mano; los tests son la única forma de saber que el formato sigue siendo el que
el equipo acepta.
