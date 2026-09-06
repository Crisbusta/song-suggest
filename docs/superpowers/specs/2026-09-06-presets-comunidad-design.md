# Presets de la comunidad y cadenas de efectos por canción — diseño

**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Fecha:** 2026-09-06
**Se apoya en:** `2026-09-05-editor-lt25-design.md` (control completo del equipo) y
`2026-09-05-ampli-usb-design.md` (transporte y regla de honestidad).

---

## 1. El problema, medido

La app ya sugiere ajustes de amplificador por canción y sabe mandarlos. Pero el
usuario notó que "para varios es la misma recomendación", y tenía razón. Medido
sobre su catálogo de 9.974 canciones:

| | |
|---|---|
| Canciones que reciben sugerencia | 8.887 (89,1%) |
| **Combinaciones distintas** | **63** |
| Las 8 más repetidas cubren | **54,6%** |
| Modelos de amplificador nunca usados | 6 de 20 |

Tres causas, todas medidas:

1. **Se usa un solo tag y se descarta el resto.** Cada canción tiene 9,6 tags de
   promedio (algunas 52). La tabla de reglas ordena de específico a genérico y
   **gana la primera que calza**; lo demás se ignora. `[thrash metal, 80s]` y
   `[thrash metal, 2010s, djent]` reciben ajustes idénticos.
2. **El ajuste acústico pisa el género por completo.** 1.641 canciones (16,5%)
   tienen track representativo acústico y todas terminan en CHAMPION gain 1, sea
   cual sea el género. Es la combinación más repetida del catálogo.
3. **La tabla es de grano grueso a propósito.** `rock` (7.407 canciones) y
   `pop/rock` (2.735) están excluidos porque no dicen nada del tono. La decisión
   es correcta, pero deja el peso sobre pocos tags.

Además, la tabla sólo decide el modelo y cinco perillas. **No usa las cuatro
ranuras de efectos**, que es lo que de verdad hace reconocible un tono: la
diferencia entre gain 6 y 7 es sutil; tener slapback o no, no lo es.

---

## 2. La fuente

Una planilla mantenida por la comunidad de usuarios del Mustang LT, exportada en
dos hojas:

> **Procedencia:** https://docs.google.com/spreadsheets/d/1KWvjJ6q6Ora2MqmxtUAWjq9Uerp0Ycza5ouuKuol5HQ/edit?gid=1647190216
> Obtenida el 2026-09-06. Trabajo de otras personas: se cita, no se apropia.
> Este repositorio es local y no se publica; si algún día se publicara, hay que
> revisar antes en qué términos la planilla permite redistribuirse.

**Hoja 1 — por banda (77 filas).** Columnas: `Band`, `Genre`, `Era`, y luego
`Amp` con cinco perillas, `Stompbox`, `Modulation`, `Delay` y `Reverb`, cada una
con sus valores. La clave es el guitarrista y/o la banda, en formatos mezclados:
`Alex Lifeson / Rush`, `Deftones`, `Metallica - Enter Sandman`,
`General Motown Sound`.

**Hoja 2 — por tono (10 filas).** Clave: un nombre de tono (`Texas Blues`,
`Heavy Distortion`, `Doom Wizard`). No se puede atar a una canción, pero sí a un
género.

### 2.1 Por qué esta fuente sí, cuando antes se rechazó otra

`lib/ampli.js` lleva escrito desde el primer día que no existe fuente accesible
de ajustes verificados por canción, y que se descartó que un modelo inventara los
valores porque "un número inventado que parece plausible es peor que no tener el
dato". Eso sigue en pie. Lo que se rechazó entonces eran servicios que venden
ajustes **por canción**, sin API, con miles de filas sacadas de foros que nadie
puede auditar.

Esto es otra cosa, y la diferencia es verificable:

- **77 filas.** Caben en una pantalla y se pueden revisar a mano.
- **Indexada por banda**, que es como el tono funciona de verdad. Un guitarrista
  suena parecido a través de su discografía; una canción suelta no tiene un tono
  "correcto" documentado.
- **Declara su propia incertidumbre.** Hay filas marcadas `{EXPERIMENTAL}`, una
  `(INACCURATE)`, un `Pearl jam?`. Una fuente que admite lo que no sabe es
  distinta de una que no lo admite.
- **El usuario puede verificarla de oído**, que es la única verificación que
  existe para esto.

Sigue siendo **opinión, no medición**, y el diseño la trata así en todas partes.

### 2.2 Calidad del dato: lo que hay que asumir

Medido sobre las dos hojas:

- **Decimales con coma** mezclados con punto (`"9,0"` junto a `8.5`).
- **Celdas `-`** para "esta ranura no se usa".
- **Duplicados por banda** que se distinguen por época: Rush tiene tres presets
  (70s, 80s, 90s), Keith Richards dos, Fela dos.
- **Al menos un error de copiado**: una fila de Rush trae `Era = "70s (Van Halen I)"`.
  Van Halen no es Rush. Es un recordatorio de por qué la procedencia va a la
  vista y no se da por buena a ciegas.
- **Abreviaturas propias** de nombres de unidad: `60s UK CLN`, `Champ`,
  `Sm. Room`, `Myth`. Coinciden con las del manual en PDF — el mismo manual del
  que salieron tres nombres mal en su día. **Los nombres que mandan son los del
  catálogo del equipo**, y la traducción es explícita (§4).
- **Dos columnas del bloque de amplificador cuyo significado se desconoce.** La
  hoja reserva 7 columnas para el amplificador, pero los veinte modelos declaran
  exactamente 5 perillas (`gain, volume, treb, mid, bass`). 56 de las 75 filas
  con amplificador usan la 6ª y la 7ª. **No son perillas**: traen valores
  negativos, hasta −12, y las perillas de este equipo van de 0 a 10. Tampoco son
  el reverb del panel: 36 de las 39 filas que usan la 6ª traen además su propio
  bloque de reverb. Ver §3.1.1.

---

## 3. Lo que se midió antes de decidir

Todo lo de esta sección se calculó contra el catálogo real y el CSV real.

| Comprobación | Resultado |
|---|---|
| Presets de la hoja 1 que calzan con un artista del catálogo | **51 de 77** |
| Canciones que cubren esos 51 | **~1.050 (10,5%)** |

> **Corrección del 2026-09-06.** Esta tabla decía antes **1.461 (14,6%)**, y era
> un error de conteo del autor: sumaba las canciones **por preset** en vez de
> **por artista**. Metallica tiene dos presets, así que sus 169 canciones se
> contaron dos veces; Rush tiene tres, Nirvana, Radiohead, Arctic Monkeys,
> Rolling Stones y Pearl Jam dos cada uno. En total, 501 canciones contadas de
> más. La cifra medida corriendo el calce real sobre el catálogo entero es
> **1.048 canciones, un 10,5%**, repartidas en 7 por canción exacta, 980 por
> artista y 61 por artista sin desempate de época.
>
> La diferencia no cambia ninguna decisión de este diseño —la fuente sigue
> valiendo la pena y sigue cubriendo justo donde el usuario toca— pero un
> número inflado en un documento vinculante es exactamente lo que este proyecto
> se niega a tolerar en el código, así que tampoco se tolera aquí.
| Presets que nombran una canción concreta que existe en el catálogo | 5 |
| Nombres de unidad distintos en ambas hojas | 46 |
| Nombres que resuelven contra el catálogo con alias explícitos | **41**; los 5 restantes son alias triviales |
| Filas con época declarada | 71 de 77 |

Y cubre donde el usuario toca: Metallica 169 canciones, Megadeth 96, Nirvana 94,
Deftones 76, Black Sabbath 58, Arctic Monkeys 57, Radiohead 54.

### 3.1 La decodificación posicional de la hoja 2, y su prueba

La hoja 2 da los parámetros de stomp y modulación como `Set 1`…`Set 5`, **sin
nombre**. Si el orden no fuera recuperable, esos números no servirían.

Hipótesis: el orden es el de `ui.uiParameters` del catálogo, que es el orden en
que el amplificador muestra las perillas en pantalla.

Es falsable, y se comprobó: **la cantidad de `Set` con valor tiene que coincidir
con la cantidad de perillas que el catálogo declara para esa unidad.** Resultado:
**20 de 20**, incluidos los casos límite — COMPRESSOR tiene 1 perilla y trae 1
valor, Sustain 2 y 2, CHORUS 3 y 3, FLANGER 4 y 4, 5-BAND EQ 5 y 5.

Esa igualdad se convierte en un test permanente: si alguien reordena el catálogo
o edita el CSV, salta.

### 3.1.1 La hoja 1 y sus dos columnas de más

La misma comprobación se corrió sobre la hoja 1, con un resultado que decide
cómo se importa:

| Ranura | Filas que usan menos columnas que perillas | Las mismas | **Más** |
|---|---|---|---|
| stomp | 58 | 6 | **0** |
| mod | 1 | 50 | **0** |
| delay | 2 | 33 | **0** |
| reverb | 4 | 64 | **0** |
| amp | 0 | 19 | **56** |

En las cuatro ranuras de efectos la decodificación posicional se cumple **sin una
sola excepción** — usar menos columnas de las disponibles es legítimo, significa
"sólo especifiqué estas perillas". La anomalía está aislada en el bloque de
amplificador.

**Decisión: del bloque de amplificador se usan las cinco primeras columnas
—`gain`, `volume`, `treb`, `mid`, `bass`, en el orden del catálogo— y las dos
últimas se descartan**, dejando constancia de que no sabemos qué son. Se pierde
información de 56 filas y no se inventa nada, que es el intercambio que este
proyecto viene haciendo desde el principio.

Es recuperable sin código: la planilla original es una hoja de cálculo y muy
probablemente tiene una fila de encabezado combinada que nombra esas columnas y
que la exportación a CSV aplanó. Mirarla es cosa de medio minuto y está en la
lista de incógnitas (§10).

### 3.2 Lo que todavía no se puede convertir

De los 114 parámetros continuos de las unidades que los CSV usan, **94 son
convertibles hoy y 20 no** — son los que declaran una curva distinta para el
cable y para la escala de pantalla, y cuya conversión sigue sin medirse contra el
equipo (ver `2026-09-05-editor-lt25-design.md` §3.3).

No están repartidos al azar:

- Los ocho `volume` de amplificador. Irrelevante: ya se decidió no mandarlos.
- **La ranura de modulación es la más golpeada**: `CHORUS.level`, `CHORUS.rateHz`,
  `FLANGER.level`, `FLANGER.rate`, `TREMOLO.level`, `VIBRATONE.level`,
  `VIBRATONE.rotor`, `PHASER.rate`. Y el CHORUS aparece en casi todas las filas
  de la hoja 2.
- `OVERDRIVE.gain`, `OVERDRIVE.level`, `FUZZ.gain`, `FUZZ.level`.

Delay, reverb, ecualizador, compresor y las perillas del amplificador **sí** se
pueden mandar.

**La regla, que es la misma de siempre en otra forma:** lo que no se sabe
convertir **no se manda**. La perilla queda en el valor por defecto de la unidad
—dato real del catálogo— y la interfaz lo dice. No se aproxima, no se interpola,
no se inventa.

Consecuencia práctica: la medición de curvas dejó de ser un pendiente cómodo y
pasó a ser lo que desbloquea la mitad expresiva de los efectos.

---

## 4. Resolución de nombres

Los CSV usan abreviaturas propias; el equipo entiende los `FenderId` del
catálogo. La traducción es una tabla de **alias explícitos**, y eso no es
pedantería: en la primera exploración un resolvedor por prefijo convirtió el
valor `5.0` en el modelo `50S TWIN`, silenciosamente. **Nada de adivinar por
prefijo, por distancia de edición ni por parecido.** Un nombre que no está en la
tabla de alias y no calza exacto **no resuelve**, y su fila se descarta con un
aviso, no se aproxima.

El test que lo sostiene: todo nombre presente en cualquiera de los dos CSV
resuelve, o está en una lista explícita de descartados con su motivo escrito.

---

## 5. Precedencia

De lo más específico a lo más genérico. Gana el primero que calza:

1. **Preset de canción exacta** (hoja 1, filas tipo `Metallica - Enter Sandman`).
2. **Preset de artista** (hoja 1). Si hay varios para el mismo artista, desempata
   la **época**: la columna `Era` del CSV contra los tags de década de la canción
   (`70s`, `80s`, `90s`, que están entre los tags más frecuentes del catálogo).
   Sin coincidencia de época, gana el primero y se dice que se eligió sin
   desempate.
3. **Tono de género** (hoja 2, mapeado por el autor de esta spec a las reglas
   existentes). Este mapeo **es juicio, no dato**, y queda marcado como tal.
4. **La tabla de reglas actual**, que sigue siendo el suelo para el 85% restante.

La sugerencia viaja con su **procedencia** y con la **incertidumbre que la fuente
declaró**. Un `{EXPERIMENTAL}` de la planilla llega hasta la pantalla; no se
limpia. "Preset de la comunidad para Metallica (marcado como experimental)" y
"deducido de tus tags de género" merecen palabras distintas.

---

## 6. Qué se manda al amplificador

### 6.1 Orden

1. Leer el preset activo y **guardar el `volume`** del nodo `amp`.
2. Reemplazar las unidades de las cinco ranuras.
3. Devolver el `volume` guardado.
4. Escribir los parámetros de cada unidad.

El orden importa: cargar una unidad trae sus parámetros por defecto, así que
escribir perillas antes de reemplazar unidades las pisaría. Y el `volume` se
devuelve porque los defaults de los veinte modelos van de −15,88 dB a 0 —
cambiar de modelo sin devolverlo puede ser un salto de casi 16 dB con la guitarra
enchufada. Esto ya está implementado y probado para el modelo; aquí se extiende a
la cadena completa.

### 6.2 Las ranuras que el preset no menciona

Quedan en `EMPTY`. Razón: el botón promete "el tono de esta canción". Si el
usuario sortea surf, manda, y después thrash, el slapback del surf seguiría
sonando encima del thrash — que es exactamente el efecto arbitrario que este
diseño existe para evitar.

**Contra, que hay que asumir:** borra lo que el usuario haya dialado a mano en el
editor. Se acepta porque un tono a medias entre dos canciones no es el tono de
ninguna, y **se dice en la interfaz** antes de que ocurra.

> Esta decisión es la que el usuario debe confirmar al revisar la spec: la
> alternativa es respetar lo que haya en las ranuras que el preset no nombra.

### 6.3 Cuánto tarda

Medido sobre cadenas reales: cinco `replaceNode` más los parámetros que el preset
declara. Declarando sólo lo que la fuente trae (y no las perillas que quedan en
su valor por defecto), una cadena típica son 9–13 escrituras, del orden de 2–3
segundos. El envío ya avisa mientras corre y ya sobrevive a sortear otra canción.

---

## 7. Restricciones que siguen vigentes

- **Node ≥ 24. Cero dependencias npm.** ESM. Sin paso de build. El parseo de CSV
  se escribe a mano, como el protobuf: los CSV traen comillas, comas dentro de
  campos y saltos de línea dentro de celdas, así que un `split(',')` no sirve.
- **WebHID sólo en Chrome y Edge.**
- **Nunca declarar éxito sin confirmación del equipo.**
- **Idioma:** interfaz, mensajes y comentarios en español. No se traducen los
  nombres de ranura (`amp`, `stomp`, `mod`, `delay`, `reverb`), los de parámetro,
  ni los `FenderId`.
- **Reversibilidad:** nada se escribe al almacenamiento del equipo. Reseleccionar
  el preset en la rueda lo deja como estaba.

---

## 8. Verificación

1. **Tests automáticos** sobre lo puro: el parseo de ambos CSV, la resolución de
   nombres, la precedencia, el desempate por época, y la invariante de §3.1
   (`Set` poblados == perillas del catálogo).
2. **Una auditoría escrita** del import: cuántas filas entraron, cuántas se
   descartaron y por qué, qué nombres no resolvieron. Un import silencioso que
   pierde filas es peor que uno que falla.
3. **Prueba a mano con el amplificador**: sortear una canción de Metallica, de
   Radiohead y de un artista sin preset, y confirmar de oído que las tres suenan
   distinto y que la de Metallica suena a Metallica.

---

## 9. Fuera de alcance

- Editar los presets de la comunidad desde la app.
- Que el usuario guarde sus propios tonos por artista. Es la idea que quedó
  pendiente en la conversación —"que la app aprenda de ti"— y merece su propia
  spec: el editor ya existe, así que es un proyecto corto, pero es distinto de
  este.
- Volver a bajar la planilla automáticamente. Se importa una vez, con su fecha.
- Arreglar las tres causas de repetición de §1 (usar varios tags, la década, el
  aplastamiento acústico). Siguen ahí y siguen siendo la mejora que más
  canciones tocaría; esta spec cubre el 14,6% con datos y el resto con cadenas.

---

## 10. Incógnitas abiertas al cerrar este diseño

1. **Las curvas** (§3.2). No bloquea el import, pero mantiene mudas las perillas
   de modulación hasta que se midan con el equipo.
2. **El mapeo de los 10 tonos de la hoja 2 a las reglas de género** es juicio del
   autor de esta spec, no dato. Queda marcado en el código y el usuario puede
   discutir fila por fila.
3. **Qué son las columnas 6 y 7 del bloque de amplificador** (§3.1.1). Se
   resuelve abriendo la planilla original y mirando si hay una fila de
   encabezado que la exportación aplanó. Hasta entonces se descartan.
4. **Los 25 presets que no calzan** con ningún artista del catálogo (Fela, PJ
   Harvey, Sunn O))), Tom Waits…) se importan igual: si algún día el catálogo
   crece, ya están. No cuestan nada y su ausencia sería una pérdida silenciosa.
