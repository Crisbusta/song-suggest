# Rediseño de la vista Sortear (v2) — diseño

**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Fecha:** 2026-09-12
**Referencia visual:** `docs/mock-v2.html` (bundle de React, **sólo de referencia**)
**Brief que lo originó:** `docs/brief-visual.md`

---

## 1. Qué cambia y qué no

Cambia **sólo la capa de presentación** de la vista Sortear. El servidor, las
consultas y `lib/` no se tocan: la API que `hidratar()` devuelve ya trae todo lo
que este diseño necesita.

> **La referencia visual es un bundle de React de 436 KB.** Este proyecto es
> vainilla, cero dependencias, sin paso de build. **No se porta ni se adapta: se
> reimplementa.** El bundle sirve para mirar, no para copiar.

## 2. Lo que el rediseño resuelve

Del brief, los cuatro problemas y cómo los cierra la propuesta:

| problema | solución |
|---|---|
| Cambiar de pista es difícil; el `<select>` esconde que hay un intro acústico | Lista de pistas **siempre visible**, agrupada por instrumento, con dificultad, afinación y modelo de ampli por pista |
| Los ajustes del ampli parecen un pie de página | **Columna derecha permanente**, con modelo, perillas y las cinco ranuras |
| La tarjeta arranca bajo el pliegue | Controles colapsados a **una barra de una línea**; la canción empieza arriba |
| Dos sliders para un rango | **Fichas 1–10** clicables |

Añade además atajos de teclado visibles (`1–9` pistas, `A/N/D/L`, `espacio`,
`E` enviar, `/` buscar), que para tocar con la guitarra en las manos valen más
que cualquier decisión visual.

## 3. Datos que el mock inventa y que se eliminan

Verificado contra `songs.db` el 2026-09-12. **Nada de esto existe en el catálogo
y no se va a buscar a ninguna fuente nueva** — el repo ya arrastra dos conjuntos
de terceros y no vale un tercero por decoración:

| en el mock | realidad |
|---|---|
| `Ride the Lightning · 1984` | No hay columna de álbum ni de año en `songs`, `tracks` ni `tags` |
| Recuadro de portada | No hay carátulas. Ese recuadro estaría **siempre vacío** |
| Etiquetas `intro acústico`, `solo` | No son etiquetas reales de esa canción (`i own this` sí lo es) |

**Se eliminan del diseño.** La cabecera de la tarjeta queda: título, artista, y
el número de pistas de guitarra — que sí es dato real.

## 4. La etiqueta de pista

El mock muestra nombres limpios (`Intro acústico`, `Rítmica`, `Lead`) que el
catálogo no tiene. Los reales son cadenas separadas por barras:
`Kirk Hammett | Gibson Flying V | Lead Guitar`, y **959 de las 25.061 pistas no
tienen nombre**.

**Decisión:** se deriva una etiqueta corta, y el nombre crudo completo viaja en
el `title` del elemento para que nada se pierda.

### 4.1 La regla, medida

El catálogo **no tiene un orden fijo de segmentos**. En *Fade to Black* es
`Músico | Equipo | Rol`; en *Tears In Heaven* es `Músico | Rol | Equipo`. Por eso
la regla obvia —quedarse con el último segmento— falla: deja las cuatro pistas de
Clapton llamadas `C.F. Martin 000-42`.

Tres pasos, en orden:

1. **Quitar los segmentos que aparecen en TODAS las pistas de la canción.** Eso
   elimina el músico y el modelo de guitarra cuando son comunes, y deja lo que
   distingue.
2. **De lo que queda, preferir el segmento que contiene una palabra de rol**
   (`lead`, `rhythm`, `solo`, `clean`, `acoustic`, `electric`, `harmon`, `extra`,
   `overdub`, `intro`, `outro`, `slide`, `fingerstyle`, `nylon`, `steel`, `riff`,
   `melody`, `arpegg`, `chord`). Si ninguno la tiene, el último segmento.
3. **Si dos pistas de la misma canción quedan iguales**, añadir delante el primer
   segmento que la hermana con la que choca **no** tiene. Si aun así coinciden,
   añadir el número de pista.

Sin nombre en absoluto → el nombre del instrumento.

### 4.2 Resultados medidos sobre las 25.061 pistas reales

| | |
|---|---|
| Colisiones dentro de una misma canción | **0 (0,00%)** |
| Largo medio de la etiqueta | 15,8 caracteres |
| Pistas que necesitan el número como último recurso | 1.188 (4,74%) |

Ejemplos:

```
Kirk Hammett | Gibson Flying V | Lead Guitar          ->  Lead Guitar
James Hetfield | Morris Tornado 12 String | ...       ->  Acoustic Guitar (12 String)
Eric Clapton | Lead Nylon Guitar | C.F. Martin 000-42 ->  Lead Nylon Guitar
JayDee Maness | 1st Guitar | Pedal Steel Guitar ...   ->  1st Guitar · Pedal Steel Guitar ...
```

**Dónde vive:** `public/tarjeta.js`, puro y con tests — es exactamente la clase de
lógica que ese módulo existe para alojar. Necesita ver **todas** las pistas de la
canción a la vez (los pasos 1 y 3 son por canción, no por pista), así que la
firma es `etiquetasDePistas(pistas) -> string[]`, no una función por pista.

## 5. Decisiones que toma esta spec

El mock no las resuelve. Se deciden aquí; cambiarlas es una conversación, no un
descuido del implementador.

### 5.1 Numeración contra selección por defecto

El mock trae seleccionada la pista 1 (el intro acústico). La invariante vigente
es **"la pista por defecto es la más vista de las que cumplen el filtro"**, y en
*Fade to Black* ésa es el Lead de Kirk (2.984.809 vistas contra 246.001).

**Decisión:** la invariante manda. La lista se agrupa por instrumento —eso es
presentación— pero la pista que viene elegida sigue siendo la más vista que
califica, **esté en la posición que esté**. Los números `1..N` y sus atajos de
teclado son **posiciones visibles en la lista**, no identidades de pista: lo que
el usuario ve como "3" es la tercera fila, y ésa es la promesa que el atajo
cumple.

### 5.2 El filtro de bandas

El mock lo reduce a `Bandas todas` y hace desaparecer el buscador con fichas y
los atajos, que son una feature entera y funcionan.

**Decisión:** `Bandas todas` es un **botón** que despliega un panel con el
buscador existente, sus fichas removibles y sus atajos, tal cual están hoy. El
rótulo refleja el estado (`todas` / `Metallica` / `3 bandas`).

### 5.3 Scroll

A 1024px el mock tiene tres regiones de scroll compitiendo: la lista de pistas,
el panel del ampli y la página. Las ranuras del ampli quedan cortadas a media
palabra.

**Decisión:** **la página scrollea; el panel del ampli no.** El panel es
`position: sticky` y se muestra entero. La lista de pistas puede scrollear por
dentro **sólo** cuando pasa de 6 filas — lo que afecta a **104 canciones de
9.788 (1,1%)**, las que tienen 7 pistas o más. Para el 98,9% restante no hay
scroll interno en ninguna parte.

## 6. Estados que hay que resolver

El mock muestra una canción de 6 pistas, que es el **1,9%** del catálogo. Los
casos que hay que diseñar y verificar son otros:

| estado | frecuencia | qué debe pasar |
|---|---|---|
| **1 sola pista** | 1.897 canciones (19,4%) | No se dibuja la lista ni la cabecera `PISTAS · N`. La pista única se describe en línea. |
| **2 o 3 pistas** | 5.996 (61,3%) | El caso común. El diseño se valida aquí, no en el de 6. |
| **7 o más** | 104 (1,1%) | La lista scrollea por dentro; los atajos cubren las primeras 9. |
| **Nombres largos** | — | `1st Guitar · Pedal Steel Guitar FingerPicked with slide` son 54 caracteres. Truncar con elipsis y el crudo en `title`. |
| **Envío fallido** | — | Los avisos **en rojo** del ampli (`sin confirmar`, perilla que quedó en su valor por defecto) tienen sitio propio en el panel. El mock sólo muestra "Sin enviar todavía". |
| **Sin sugerencia de ampli** | — | Canciones cuyos tags no dan señal: el panel dice que no hay nada que mandar, no dibuja perillas inventadas. |
| **Ampli desconectado** | — | El panel se ve igual pero el botón de enviar está deshabilitado con su motivo. |

## 7. Invariantes que el rediseño NO puede romper

Están en `CLAUDE.md` y cada una costó rondas de revisión:

- El contador **"cuántas calzan" describe los filtros**, no la canción en
  pantalla. Buscar una canción y "Sortear de todo" no lo mueven.
- Las pistas que **no cumplen el filtro se muestran igual, marcadas**. El mock lo
  respeta (`fuera del filtro`): mantenerlo.
- **El volumen no viaja al ampli.** El mock lo dice explícito: mantenerlo.
- Marcar aprendida marca **la canción entera**, no la pista.
- **Ninguna escritura al ampli se da por buena sin ACK.** Lo que no se confirma se
  reporta, y lo que quedó en su valor de fábrica se avisa en rojo.
- El **panel del ampli abierto y un video sonando sobreviven al cambio de pista**
  (se arregló en la rama anterior; el rediseño no puede reintroducir la pérdida).

## 8. Estructura del código

`public/app.js` tiene 1.362 líneas y este rediseño lo reescribe casi entero. **Es
el momento de partirlo**, no antes ni después:

| módulo | responsabilidad | tests |
|---|---|---|
| `public/tarjeta.js` | Lógica pura de presentación: etiquetas de pista, resumen de envío, fragmentos de HTML | sí, ya los tiene |
| `public/vista-sortear.js` | Dibujar la vista y cablear sus eventos | no (DOM) |
| `public/panel-ampli.js` | El panel derecho y su estado de envío | no (DOM) |
| `public/app.js` | Arranque, conmutación de vistas, estado compartido | no (DOM) |

Todo lo que pueda ser puro va a `tarjeta.js`. Lo que toca el DOM no se puede
testear en Node y se verifica en el navegador.

## 9. Tests

- **`etiquetasDePistas`** en `test/tarjeta.test.js`: los tres pasos de la regla,
  los dos casos reales de §4.1, la pista sin nombre, y **la ausencia de
  colisiones** dentro de una canción.
- **Navegador (Playwright, `devDependency` nueva)**: se escriben **durante** el
  rediseño, contra el marcado nuevo, no antes. Cubren la lista del §7: que el
  contador no se mueve al buscar, que las pistas fuera del filtro se ven
  marcadas, que cambiar de pista no cierra el panel del ampli, y que la pista por
  defecto es la más vista que califica.
- Los 355 tests existentes deben seguir verdes sin tocarse: este rediseño no
  toca servidor ni consultas.

## 10. Fuera de alcance

- Las vistas **Mis listas** y **Ampli** (el editor). Se rediseñarán después, con
  el lenguaje visual que salga de ésta.
- Buscar álbum, año o carátulas.
- TypeScript. Se evaluó y se descartó para esta ronda: de los cinco bugs reales
  de la ronda anterior, habría atajado dos, y ninguno de los dos está en la capa
  que este rediseño toca.
