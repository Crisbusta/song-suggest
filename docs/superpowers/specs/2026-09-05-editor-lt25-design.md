# Editor completo del Fender Mustang LT25 — diseño

**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Fecha:** 2026-09-05
**Antecede a:** la afinidad por canción (proyecto B), que usa este editor como motor.
**Se apoya en:** `2026-09-05-ampli-usb-design.md`, que estableció el transporte
WebHID, el protocolo y la regla de honestidad.

---

## 1. Qué se construye y qué no

`song-suggest` ya manda tres perillas del amplificador (`gain`, `treb`, `bass`)
derivadas de la canción sorteada. Este proyecto construye la capacidad que falta
debajo: **control completo del equipo desde la app** — el modelo de amplificador,
las cuatro ranuras de efectos, y todas las perillas de cada unidad.

El pedido original era que la sugerencia por canción incluyera los efectos. Se
partió en dos porque la capacidad y el criterio musical son problemas distintos
y se verifican distinto:

- **Proyecto A (esta spec):** control completo del equipo. Se verifica solo — o
  mueve el amplificador o no.
- **Proyecto B (después):** que la tabla de reglas de `lib/ampli.js` decida qué
  cadena le va a cada canción y maneje este editor. Es juicio musical, y merece
  su propia spec cuando el equipo ya esté bajo control.

**Fuera de alcance, explícitamente:** la sugerencia por canción de efectos;
navegar por los presets guardados del amplificador o cargar uno; renombrar
presets; el modo audition; cualquier cosa que no sea el preset activo, salvo la
operación de guardado de §7 y la lectura de una sola ranura que esa operación
necesita para mostrar qué se está por pisar.

---

## 2. Lo que está medido contra el equipo

Todo lo de esta sección se probó contra el Mustang LT25 del usuario el
2026-09-05, no se dedujo de documentación. Es la base sobre la que se apoya el
resto.

| Hecho | Cómo se verificó |
|---|---|
| El preset activo se puede leer (mensaje 104, respuesta 32, multi-paquete) | Se leyó el preset "EMPTY" completo con sus cinco nodos |
| Se puede escribir **después** de leer, reenviando `SYNC_BEGIN` | `amp.gain = 0.700` confirmado por ACK, y restaurado |
| `replaceNode` (mensaje 39) funciona | `mod` → FLANGER: llegó `replaceNodeStatus` (40) y el cambio se confirmó **releyendo el preset** |
| Se puede mover una perilla de la unidad recién cargada | `mod.depth = 0.800` confirmado |
| Se puede cambiar el **modelo de amplificador** | `amp` → METAL 2000 (`DUBS_Evh3`), confirmado releyendo |
| Todo es reversible | Las cinco ranuras volvieron a su estado inicial, verificado releyendo |

Números de mensaje, tomados de las definiciones protobuf del proyecto LtAmp
(GPL-3.0) y confirmados contra los que ya usábamos:

- `currentPresetStatus` = 32 · `loadPreset` = 33 · `setDspUnitParameter` = 34
- `setDspUnitParameterStatus` = 35 · `replaceNode` = **39** · `replaceNodeStatus` = **40**
- `currentPresetSet` = 45 · `saveCurrentPresetTo` = **54** · `currentPresetRequest` = 104
- `retrievePreset` = 105 · `modalStatusMessage` = 113 · `unsupportedMessageStatus` = 200

Estructura de los dos mensajes nuevos, ambos de campos de texto:

```
ReplaceNode        campo 1: nodeIdToReplace       campo 2: fenderIdToReplaceWith
ReplaceNodeStatus  campo 1: nodeIdReplaced        campo 2: fenderIdReplaced
```

La cadena del equipo tiene cinco ranuras fijas, con estos identificadores:
`stomp`, `mod`, `amp`, `delay`, `reverb`.

---

## 3. El catálogo de unidades

### 3.1 Qué contiene

48 unidades: 20 amplificadores, 11 stomp, 7 mod, 3 delay, 5 reverb, más `EMPTY`
(`DUBS_Passthru`, que es la ranura en bypass). Cada una trae su `FenderId`, su
nombre de pantalla, la ranura a la que pertenece, sus parámetros por defecto, y
—lo importante— una especificación de interfaz por parámetro: tipo de control,
rango en el cable, rango de pantalla, unidades, curva (`taper`) y, para los
discretos, la lista de valores.

Los 192 parámetros del catálogo usan sólo tres tipos de control: 183 continuos,
5 listas y 4 interruptores. El editor son tres widgets, no 48 formularios.

### 3.2 Procedencia, y por qué no nos apoyamos en ella

El archivo se obtuvo en una sesión anterior y **su origen no se pudo
reconstruir**: la aplicación Fender Tone LT Desktop instalada es un binario
único, sin recursos JSON, así que no salió de ahí.

Esto importa por un antecedente concreto de este mismo proyecto. Los nombres de
los 20 modelos de amplificador salieron una vez de extraer texto de un PDF; tres
estaban mal y afectaban el 36% de las sugerencias, y el test que debía cazarlo
comparaba contra la misma lista equivocada, así que pasaba en verde.

Por eso el catálogo **no se valida contra su origen sino contra el equipo**:

> **Verificación obligatoria:** un script carga las 48 unidades en su ranura
> correspondiente, una por una, y relee el preset para confirmar que el
> amplificador aceptó cada `FenderId`. Deja el resultado por escrito. Cualquier
> unidad que el equipo no acepte se marca en el catálogo y no se ofrece.

El archivo se commitea **crudo, sin recortar ni transformar**, para que sea
auditable. Son ~138 KB servidos desde `localhost`: el tamaño no es un problema y
recortarlo sólo agregaría un paso de transformación que habría que confiar.

### 3.3 Dos consecuencias sobre decisiones ya tomadas

**El `volume` deja de estar prohibido.** La spec anterior lo excluyó por
seguridad física: está en dB, y mandar `0.4` como "4 de 10" podía ser un salto
brutal de volumen. La causa real era no conocer la escala. El catálogo la
declara: en el cable va de **−60 a 0 dB** y se muestra como 1–10. Con el mapeo
del catálogo, mandarlo es tan seguro como el gain.

**La conversión actual está bajo sospecha.** `paraElAmpli` en `lib/ampli.js`
convierte "7 de 10" a `0.667` linealmente. El catálogo declara `taper: "t50"` en
todos los controles continuos. Hay que determinar qué curva es —midiendo contra
el equipo, no suponiendo— y usarla. Si resulta lineal, no cambia nada y lo
sabremos; si no, lo que mandamos hoy está corrido.

---

## 4. Arquitectura

El servidor **no cambia**. El catálogo es un archivo estático y el editor le
habla al amplificador directo por WebHID. Todo el proyecto vive en el front.

| Pieza | Responsabilidad | Tests |
|---|---|---|
| `public/lt25-unidades.json` | El catálogo crudo | — |
| `public/catalogo-lt25.js` | Lógica pura: unidades por ranura, parámetros de una unidad, conversión cable ↔ pantalla | **Sí** |
| `public/fender-protocolo.js` | Suma los mensajes 104, 39 y el parseo de 32 y 40 | **Sí** |
| `public/ampli-usb.js` | Suma `leerPreset()`, `reemplazarUnidad()` y (§7) `guardarEn()` | No, por diseño |
| `public/editor.js` + markup y estilos | La vista, generada del catálogo | No, por diseño |
| `public/app.js` | Sólo aprende a cambiar a la vista nueva | No |

**Leer el preset deja de ser una prohibición y pasa a ser una responsabilidad.**
`public/ampli-usb.js` dice hoy "este módulo NO lee el preset", porque pedirlo
traba las escrituras del resto de la sesión. La regla útil nunca fue "no leer"
sino "no dejar la sesión trabada": `leerPreset()` destraba con un `SYNC_BEGIN`
antes de devolver, y esa garantía queda en una función en vez de en una regla
que cada llamador debe recordar.

**La lógica falible vive donde hay tests.** El editor es cableado de DOM y no
lleva tests automáticos, igual que el resto del front. Pero la conversión
cable ↔ pantalla es exactamente donde un error se esconde en silencio —un
número plausible y equivocado—, así que vive en un módulo puro y probado. Es el
mismo reparto que ya funcionó con `fender-protocolo.js`.

---

## 5. El modelo de interacción

El editor escribe **en vivo**: se mueve un control y el amplificador suena.

### 5.1 El despachador

Cada cambio cuesta dos mensajes —el `SYNC_BEGIN` que habilita la escritura, más
la escritura— y espera confirmación, que en las pruebas llegó en unos 120 ms.
Arrastrar un control genera del orden de 60 eventos por segundo. Mandarlos todos
es imposible.

- Una sola escritura en vuelo a la vez.
- Por cada parámetro se guarda únicamente el **último** valor pendiente; los
  intermedios se descartan.
- Al soltar el control se manda el valor final sin excepción, para que lo que
  quedó en pantalla sea lo que quedó en el equipo.

Esto rinde del orden de 8 actualizaciones por segundo durante un arrastre, que
para una perilla se percibe continuo.

**No es sólo una optimización: es lo que cumple una precondición ya
documentada.** El docblock de `ponerParametro` advierte que dos escrituras vivas
sobre la misma perilla dejarían que la correlación de ACK resuelva la
equivocada, y nombra justamente "un control futuro que mande la perilla mientras
el usuario la arrastra" como el caso que la rompe. El despachador es lo que
impide que este editor sea ese caso.

### 5.2 Cuando falla

El control muestra dónde lo puso el usuario. Si la escritura final no se
confirma, el control **vuelve al último valor que el amplificador confirmó** y lo
dice. Es la regla de honestidad de la spec anterior aplicada a un control que se
mueve: la pantalla no afirma nada que el equipo no haya confirmado.

Cambiar la unidad de una ranura se confirma igual, contra `replaceNodeStatus`,
que devuelve la ranura y el `FenderId` que quedó puesto.

### 5.3 Sincronía con el equipo

Si el usuario gira la rueda del amplificador, el editor queda desactualizado. Va
un botón de releer, y el editor relee al abrir la vista.

**Incógnita a resolver con una prueba corta:** si el equipo anuncia por su cuenta
los cambios de preset (`currentLoadedPresetIndexStatus` = 37,
`presetEditedStatus` = 38). Una medición previa registró cero mensajes
espontáneos, pero se corrió sin tocar el equipo, así que no concluye nada. Si
anuncia, el editor se suscribe y el botón sobra.

---

## 6. Reversibilidad

Todo lo del editor toca el preset activo **en memoria**. Girar la rueda del
amplificador para reseleccionar el preset devuelve el equipo a como estaba,
porque nunca se escribió nada a disco. Es la misma promesa que la función actual
ya cumple y que la prueba manual confirmó.

La única excepción es §7, y por eso se trata aparte.

---

## 7. Guardar en una ranura

Es la única operación irreversible del proyecto.

**Se construye al final**, con el editor ya funcionando. `saveCurrentPresetTo`
(54) nunca se probó, y un mensaje destructivo sin probar no va en el camino
crítico de la función principal.

**El flujo obliga a mirar antes de pisar:** el usuario elige la ranura destino,
la app **lee esa ranura primero** (`retrievePreset`, 105) y muestra qué preset
hay ahí con su nombre, y recién entonces se confirma. No existe un guardado de un
clic.

**Ranura de pruebas: la 60**, designada por el usuario como sacrificable. Ningún
ensayo de esta operación toca otra ranura.

Antes de la primera prueba hay que confirmar dos cosas contra el equipo, porque
equivocarse en cualquiera pisa un preset que sí importa:

- **Cómo indexa las ranuras** (base 0 o base 1).
- **Que la ranura 60 existe y es la que el usuario quiere decir.** El archivo de
  presets de fábrica de referencia trae 101 presets, pero esa es la biblioteca,
  no las ranuras del equipo. La confirmación se hace leyendo esa ranura con
  `retrievePreset` (105), que no es destructivo, y mostrándole al usuario qué
  preset apareció antes de escribir nada.

---

## 8. Verificación

Tres niveles, deliberadamente distintos entre sí:

1. **Tests automáticos** sobre lo puro: el catálogo, la conversión cable ↔
   pantalla, y los mensajes nuevos del protocolo contra bytes capturados del
   equipo real. Es donde un error se esconde en silencio.
2. **Verificación del catálogo contra el hardware** (§3.2): las 48 unidades,
   cargadas y releídas.
3. **Prueba a mano con el usuario y el amplificador**: la única que puede decir
   si suena.

Ninguno reemplaza al anterior. El antecedente que lo justifica está en §3.2: un
test puede pasar en verde validando contra la misma fuente equivocada.

---

## 9. Restricciones que siguen vigentes

Heredadas de la spec anterior y del proyecto:

- **Node ≥ 24. Cero dependencias npm.** ESM. Sin paso de build.
- **WebHID sólo existe en Chrome y Edge.** Donde no está, el editor no se
  ofrece: un control inerte es peor que ninguno.
- **El amplificador acepta un cliente a la vez**; Fender Tone LT Desktop tiene
  que estar cerrada.
- **Nunca declarar éxito sin confirmación.** El equipo ignora en silencio lo que
  no entiende.
- **Idioma:** interfaz, mensajes y comentarios en español. El vocabulario que
  espeja algo externo no se traduce: los identificadores de ranura (`amp`,
  `stomp`, `mod`, `delay`, `reverb`), los nombres de parámetro (`gain`, `treb`,
  `bass`, `time`, `feedback`…) y los `FenderId` van tal cual.

---

## 10. Incógnitas abiertas al cerrar este diseño

Ninguna bloquea el plan; todas se resuelven dentro de él, con el equipo delante.

1. **Qué curva es `taper: "t50"`** (§3.3). Afecta la exactitud de lo que se
   manda, incluida la función que ya existe.
2. **Si el equipo anuncia los cambios de preset** (§5.3).
3. **Cómo indexa las ranuras de preset** (§7), a confirmar antes del primer
   guardado.
4. **Si el equipo acepta las 48 unidades del catálogo** (§3.2), que es
   justamente lo que la verificación obligatoria responde.
