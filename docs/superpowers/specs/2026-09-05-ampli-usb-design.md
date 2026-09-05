# Enviar los ajustes al Fender Mustang LT25 — Diseño

**Fecha:** 2026-09-05
**Estado:** aprobado, listo para plan de implementación
**Depende de:** `docs/superpowers/specs/2026-09-03-song-suggest-design.md`

## 1. Objetivo

Que la app mande al amplificador las perillas que sugiere, en vez de que el usuario las
copie a mano.

Alcance de esta versión: **escribir tres parámetros del nodo `amp` del preset activo**, sin
guardar. Las etapas siguientes (§10) quedan fuera.

## 2. Qué se verificó antes de diseñar

Todo lo de abajo se midió contra el amplificador real del usuario el 2026-09-04/05, no se
dedujo de documentación.

| Hecho | Cómo se verificó |
|---|---|
| Vendor `0x1ed8`, product `0x0037` | `ioreg` sobre el equipo del usuario |
| Página de uso `0xff00`, fuera de la lista de bloqueo de Chrome | WebHID lo enumeró y abrió |
| Paquetes de 64 bytes, `reportId` 0 | Se probaron 63/64/65 bytes: 65 lo rechaza Chrome |
| Framing: tag `0x35` paquete único, `0x33`/`0x34` multi-paquete | Preset de 2.300 bytes reensamblado |
| **Handshake obligatorio** | Sin `SYNC_BEGIN`, una petición recibe 0 respuestas |
| Lectura completa | `mustang-lt-25`, firmware `2.1.4`, preset entero — por WebHID |
| **Escritura con ACK** | `SetDspUnitParameter` → `["amp","gain",0.35]` (por node-hid) |
| Acceso exclusivo | Con Fender Tone abierto, el dispositivo no se puede abrir |
| El ampli **ignora en silencio** lo malformado | Un mensaje sin `responseType` y un nodo inexistente: ambos, cero respuesta |

**Lo único no verificado:** escribir desde WebHID. La lectura sí se probó por ambos caminos
y el framing quedó resuelto, así que el riesgo es bajo — pero es una suposición, no una
medición, y el plan debe verificarlo antes que nada.

## 3. Arquitectura

```
lib/ampli.js  ──(convierte 1-10 → 0-1)──>  payload de /api/roll
                                                    │
public/fender-protocolo.js  ─(puro: protobuf, framing, parseo)─┐
                                                                │
public/ampli-usb.js  ─(WebHID: permiso, handshake, heartbeat, ACK)─>  amplificador
```

**La separación entre protocolo puro y ciclo de vida no es estética.** El front no tiene
tests por decisión de la spec anterior (§9), pero el código de protocolo es justo donde se
esconden los errores: durante el sondeo, un desfase de un byte en la lectura no reventaba —
descartaba todas las respuestas en silencio y se veía idéntico a "el ampli no contesta".

Poniendo la parte pura en su propio archivo, `test/` la importa **directo desde disco**
aunque viva en `public/`, y queda cubierta por la suite. El navegador la carga como módulo
servido; Node la importa por ruta. Un solo archivo, dos consumidores, sin duplicar nada.

Esto no contradice la decisión anterior de no testear el front: la respeta y sigue su propia
recomendación. La §9 de aquella spec cierra diciendo que *"si crece más, extraer el armado a
una función pura y ponerle aserciones sería el primer paso"*. Esto es ese paso.

### Superficie de `ampli-usb.js`

```js
ampli.soportado()                          // hay navigator.hid?
ampli.conectado()                          // estado actual
await ampli.conectar()                     // permiso, apertura, handshake, heartbeat
await ampli.desconectar()
await ampli.ponerParametro(nodo, param, valor)   // resuelve al llegar el ACK
ampli.alCambiarEstado(fn)                  // la UI reacciona a conexiones y caídas
```

**`ponerParametro` espera el ACK y rechaza por timeout.** No es opcional: el amplificador
ignora en silencio lo que no entiende (§2), así que dar por buena una escritura sin
confirmación es exactamente el error que se cometió durante el sondeo. Sin ACK, no hubo
cambio, y la interfaz lo dice.

## 4. Qué se manda y qué no

La sugerencia viaja en escala 1–10; el amplificador quiere flotantes. La conversión ocurre
**en el servidor**, siguiendo la regla que ya rige para la afinación y los videos: el
servidor decide, el front dibuja. `lib/ampli.js` agrega al payload:

```
ampli.paraElAmpli = { gain: 0.78, treb: 0.67, bass: 0.33 }
```

Mapeo: `(v - 1) / 9`, de modo que 1 → 0.0 y 10 → 1.0.

### Los tres que se mandan

`gain`, `treb`, `bass` del nodo `amp`. Son continuos, van de 0 a 1, y equivocarse en ellos
se corrige de oído girando la perilla.

### Los que NO se mandan, y por qué

- **`volume`: está en decibeles**, no en 0–1. Los valores por defecto observados van de
  `-1.17` a `-13.88` y el rango real se desconoce. Mandar `0.4` creyendo que es "4 de 10"
  puede significar un salto de volumen brutal — con audífonos puestos o el parlante
  sufriendo. **Es la única decisión de este diseño tomada por seguridad física, no técnica.**
  Además el volumen depende de la pieza, no de la canción: lo pone el usuario.
- **`mid`**: la tabla de `lib/ampli.js` no lo produce. Se queda en el valor por defecto del
  modelo en vez de inventarle uno.
- **`reverb`**: no es un parámetro del amplificador. Vive en un **nodo aparte**, que además
  puede estar ocupado por `DUBS_Passthru` (sin reverb cargado), en cuyo caso escribirlo no
  haría nada.
- **El modelo de amplificador**: cambiarlo requiere `ReplaceNode`, sin probar. La app dice
  qué modelo poner y ajusta las perillas sobre el que esté cargado.

Que la sugerencia muestre cinco perillas y solo se manden tres es una **discrepancia
visible**: la interfaz debe decir cuáles manda y cuáles no, no dejar que el usuario lo
descubra.

## 5. Interfaz

**El control de conexión va en el encabezado**, junto a las estadísticas: es estado global,
no de una canción. "Conectar ampli" → "Ampli conectado", con opción de desconectar.

**Si el navegador no soporta WebHID, el control no aparece.** Nada de botones inertes: en
Safari o Firefox no está, y el bloque de ajustes explica en una línea que esa función
requiere Chrome.

**"Enviar al ampli" vive en el bloque de ajustes**, junto a las perillas que va a mandar.
Sin conexión no se deshabilita a secas — eso es misterioso — sino que dice "Conecta el ampli
primero".

Dos acciones deliberadas y separadas, en lugar de que enviar dispare el diálogo de permisos
a mitad de camino.

**Reconexión silenciosa:** WebHID recuerda los dispositivos autorizados por origen.
`getDevices()` los devuelve sin volver a mostrar el selector, así que se da permiso una vez
y las siguientes veces la página reconecta sola al cargar.

**Tras enviar, la interfaz informa lo que el amplificador confirmó**, no lo que se intentó.
Si falta el ACK de `bass`, lo nombra.

## 6. Manejo de errores

| Situación | Qué ve el usuario |
|---|---|
| Sin WebHID | el control no aparece; el bloque explica que requiere Chrome |
| Cancela el selector | nada; sigue desconectado |
| **Fender Tone abierto** | mensaje que la nombra explícitamente. Es el caso más probable: le ocurrió a quien construyó esto |
| Amplificador desenchufado | evento `disconnect`; el estado se actualiza solo |
| Un ACK no llega en 2 s | nombra qué parámetros no se confirmaron; nunca declara éxito |
| El heartbeat falla | se trata como desconexión |

## 7. Pruebas

**`public/fender-protocolo.js` se prueba con bytes reales capturados del amplificador**, no
con valores inventados:

- codificar `SYNC_BEGIN` debe dar la secuencia exacta que se verificó
- parsear `00 35 09 08 02 8a 07 04 08 00 10 00` debe reconocerlo como el ACK del sync
- reensamblar un mensaje multi-paquete a partir de `0x33`/`0x34`/`0x35`
- un paquete con tag desconocido se descarta sin lanzar
- **el desfase de un byte**: parsear leyendo el tag en la posición 0 debe fallar el test.
  Es el error real que se cometió, y merece su propio caso

**`lib/ampli.js`**: la conversión 1 → 0.0, 10 → 1.0, y que los valores queden acotados.

**No es testeable** el ciclo WebHID: permiso, apertura, heartbeat, desconexión. Queda como
verificación manual con el amplificador conectado, con lista de pasos escrita en el plan.

## 8. Riesgos

- **Escribir por WebHID no está verificado** (§2). El plan debe probarlo antes de construir
  la interfaz encima: si falla, cambia el enfoque completo.
- **El protocolo es de ingeniería inversa.** LtAmp no advierte sobre daño al equipo, pero
  ausencia de advertencia no es evidencia de seguridad. Los tres parámetros elegidos son
  continuos y acotados a 0–1, que es el subconjunto más inocuo disponible.
- **Solo Chrome y Edge.** El resto de la app sigue funcionando en cualquier navegador.
- **Exclusividad con Fender Tone.** No es un fallo a corregir: es cómo funciona el
  amplificador, y la interfaz debe explicarlo cuando ocurra.

## 9. Procedencia de los datos

Los nombres de los modelos y el catálogo de unidades DSP salen del repositorio
[LtAmp](https://github.com/brentmaxwell/LtAmp), que es **GPL-3.0**. Para uso personal es
irrelevante; si esto alguna vez se publica, importa.

El protocolo en sí se reimplementa desde su documentación, no copiando su código C#: un
formato de cable son hechos, no una obra.

## 10. Etapas siguientes, fuera de esta versión

1. **Guardar en un slot dedicado.** Requiere `SaveCurrentPresetTo` y `LoadPreset`, ambos sin
   probar, y **sobrescribe permanentemente** lo que haya en ese slot. Se secuenció después a
   propósito: lo irreversible entra cuando el resto ya funcione.
2. **Cambiar el modelo de amplificador** (`ReplaceNode` + mapa de `FenderId`).
3. **Efectos**: stomp, mod, delay y reverb. El catálogo tiene 48 unidades; es un proyecto
   propio, no una función de esta app.
4. **Volumen y medios**, si aparece una forma segura de acotar el rango real del volumen.
