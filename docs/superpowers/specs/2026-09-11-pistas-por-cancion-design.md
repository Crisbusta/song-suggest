# Elegir la pista de la canción — diseño

**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Fecha:** 2026-09-11
**Se apoya en:** `2026-09-06-presets-comunidad-design.md` (de dónde sale el tono
de cada canción) y `2026-09-05-ampli-usb-design.md` (transporte y regla de
honestidad).

---

## 1. El problema

La conversación arrancó con una observación concreta: *Fade to Black* tiene un
intro suave y después riffs duros, y la app sugiere un solo tono para toda la
canción.

Resultó que el catálogo **ya tiene esa distinción**, y que la app la estaba
tirando a la basura. Songsterr entrega una pista por instrumento; la tabla
`tracks` las guarda todas. *Fade to Black* (`song_id 20`) tiene seis pistas de
guitarra:

| pista | instrumento | qué es | dificultad | views |
|---|---|---|---|---|
| 3 | Distortion Guitar | Kirk Hammett, lead | 2 | 2.984.809 |
| 2 | Acoustic Guitar (steel) | Hetfield, 12 cuerdas | 2 | 389.771 |
| 4 | Distortion Guitar | Hetfield, rítmica | 2 | 287.234 |
| 1 | Acoustic Guitar (steel) | Hetfield, acústica | 2 | 246.001 |
| 6 | Distortion Guitar | Hetfield, armonías | 3 | 29.570 |
| 5 | Distortion Guitar | Hetfield, extras | 2 | 12.320 |

La vista `representative_track` se queda con **una sola** — la más vista, la de
Kirk — y todo lo que la app muestra, filtra y manda al amplificador cuelga de
ahí. El intro acústico está en la base de datos, invisible.

**El tono ya sabe ser por pista.** `sugerirAjustes()` (`lib/ampli.js:130`) recibe
`instrument` y tiene reglas escritas y argumentadas: pista acústica → CHAMPION
gain 1, y anula el preset de la comunidad; pista limpia → recorta la ganancia a
3 y cambia a DELUXE CLN. Ese razonamiento ya existe. El problema no es que la
app no sepa tonar una pista: es que **sólo mira una**.

### 1.1 Cuánto pesa, medido

Dos universos distintos aparecen abajo, y conviene no confundirlos:

- **El catálogo:** las 9.788 canciones con alguna pista de guitarra, 25.061
  pistas. Es el universo de esta sección y del §5.1, porque describen la forma
  del dato.
- **El sorteable:** las **9.734** canciones que `BASE_FROM` deja pasar con la
  dificultad entera, al 2026-09-11. Es el universo del §1.2 y del §3.1, porque
  describen lo que el botón entrega. Se encoge con el uso: cada canción
  descartada sale del denominador.

Sobre el catálogo:

| | |
|---|---|
| Con 2 o más pistas de guitarra | **7.891** (81%) |
| Con una sola | 1.897 |
| Que mezclan limpio/acústico **con** distorsión | **2.669** |
| Con 2 o más instrumentos distintos | 4.209 |
| Con dificultades distintas entre pistas | **4.866** |
| Con afinaciones distintas entre pistas | 768 |

El 94% tiene cuatro pistas o menos; el máximo del catálogo es once.

### 1.2 Lo que el filtro estaba escondiendo

Éste es el hallazgo que cambió el alcance del diseño. `BASE_FROM` filtra por
`r.difficulty` y `MODE_SQL` por `r.instrument` / `r.name` — la pista
representativa. Si el predicado mirara **cualquier** pista:

| filtro | hoy | con cualquier pista | nuevas |
|---|---|---|---|
| fácil (1-2) | 4.844 | 6.987 | **+2.143** |
| medio (3-4) | 4.184 | 5.798 | +1.614 |
| difícil (4-5) | 1.813 | 2.965 | +1.152 |
| modo `riffs` | 6.474 | 7.404 | +930 |
| modo `acoustic` | 1.618 | 2.682 | **+1.064** |
| modo `solos` | 2.616 | 4.466 | **+1.850** |

**2.968 canciones tienen una pista más fácil que la representativa** — 1.827 por
un escalón, 752 por dos, 389 por tres o más. Son canciones que en el filtro
fácil nunca aparecieron, teniendo una pista de guitarra perfectamente
aprendible a ese nivel.

`solos` casi se duplica, y es obvio en retrospectiva: la pista de lead casi
nunca es la más vista.

El caso que cierra el argumento: **hoy *Fade to Black* no sale en modo
acústico.** Tiene dos pistas acústicas, pero su pista más vista es la distorsión
de Kirk, así que el modo la descarta. La canción que motivó todo el diseño es
invisible justo en el modo donde uno la buscaría.

---

## 2. Qué se decidió, y qué no

Tres decisiones tomadas en conversación, con lo que descartan:

1. **La unidad de estado sigue siendo la canción.** `song_state` no se toca:
   sigue con `PRIMARY KEY (song_id)`. Marcar *Fade to Black* como aprendida la
   saca entera del sorteo, hayas tocado el intro o el riff. Se descartó llevar
   la cuenta por pista — obligaría a migrar la única tabla que ninguna corrida
   del ETL puede reconstruir, y el valor no está demostrado.

2. **El selector es de pistas reales, no de tonos.** Se muestran las pistas con
   su nombre — "Kirk Hammett | Lead Guitar", "Hetfield | Rhythm" — y el tono se
   deriva del instrumento de la pista elegida. Se descartó agrupar por
   instrumento: perdería la distinción entre el lead de Kirk y la rítmica de
   Hetfield, que es justo la decisión que un guitarrista toma al sentarse a
   practicar. Elegir pista implica elegir tono; al revés no.

3. **El filtro mira todas las pistas.** Con la regla que lo mantiene honesto: la
   pista que viene seleccionada es la más vista **de las que cumplen el
   filtro**. Si pides fácil, la tarjeta abre en una pista fácil.

Queda **fuera** de este diseño, por decisión explícita:

- **El cambio de tono en vivo** (que el amplificador siga las secciones de la
  canción, o que la palanca de la guitarra cambie de pista). Ver §7.
- **Un recomendador** que deje de sortear uniforme y sugiera según lo que
  marcaste "me gustó". Es una feature grande y merece su propia ronda.

---

## 3. La consulta

`BASE_FROM` (`db/queries.js:14`) deja de unirse a `representative_track` y se une
a `guitar_tracks`.

**La invariante que sostiene todo:** modo y dificultad se evalúan sobre la
**misma fila** `g`.

```sql
FROM songs s
JOIN guitar_tracks g ON g.song_id = s.song_id
LEFT JOIN song_state st ON st.song_id = s.song_id
WHERE s.enriched_at IS NOT NULL
  AND s.is_junk = 0 AND s.ai_generated = 0 AND s.is_blank = 0 AND s.is_published = 1
  AND st.status IS NULL
  AND g.difficulty BETWEEN ? AND ?      -- la misma g que el modo de MODE_SQL
```

### 3.1 El bug que esto evita

Escribir el predicado como dos existenciales separados —"existe una pista
acústica **y** existe una pista fácil"— es incorrecto y el error es difícil de
ver. Medido sobre el universo sorteable, modo acústico con dificultad 1-2:

| | canciones |
|---|---|
| Correcto (una misma pista cumple ambas) | **1.881** |
| Ingenuo (pistas distintas cumplen cada una) | 2.059 |
| Fantasma | **178** |

Esas 178 canciones tienen una acústica difícil y una eléctrica fácil. Ninguna de
las dos pistas sirve para lo que pediste. **Esto lleva test.**

### 3.2 La pista por defecto

Sobre el conjunto ya filtrado:

```sql
ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY views DESC, track_index)
```

El desempate por `track_index` es para ser determinista, igual que en
`representative_track`.

### 3.3 Contar canciones, no filas

Una canción puede tener varias pistas que califican, así que todo lo que cuenta
pasa a `COUNT(DISTINCT s.song_id)`: el contador de "cuántas calzan", los números
de las fichas de bandas (`listarArtistas`) y `getStats`.

Esto no es cosmético. Sin el `DISTINCT`, la ficha de Metallica contaría *Fade to
Black* seis veces y prometería un catálogo que el botón no puede entregar — que
es exactamente la promesa que el docblock de `listarArtistas`
(`db/queries.js:37`) se compromete a no romper.

### 3.4 Lo que no cambia

- **`representative_track` no se borra.** `getList()` (`db/queries.js:228`) la
  sigue usando para las listas de aprendidas, descartadas y gustadas, donde no
  hay filtro y "la más vista" sigue siendo la respuesta correcta.
- El sesgo de `solos` (`db/queries.js:188`, el tercio superior por dificultad)
  pasa a ordenar por la dificultad de la pista elegida.

---

## 4. La respuesta del servidor

Se eligió **precalcular todo en el servidor**. `hidratar()` (`db/queries.js:86`)
devuelve `pistas`: **todas** las pistas de guitarra de la canción, ordenadas por
views descendente, cada una con:

| campo | qué es |
|---|---|
| `trackIndex` | índice en `tracks`, la clave |
| `instrument`, `name` | crudos del catálogo |
| `difficulty` | la de esa pista |
| `tuning` | ya pasada por `describeTuning()` |
| `views` | para ordenar y para que se vea el peso |
| `califica` | si cumple el filtro con el que saliste |
| `ampli` | `sugerirAjustes()` + `paraElAmpli()`, listo para el botón |

Más `pistaPorDefecto`, el índice de la elegida.

**Por qué precalcular y no pedir el tono al elegir:** es la única de las tres
alternativas que no agrega estados asíncronos nuevos a `app.js`, que es el
archivo más grande del front y el que no tiene tests. El ahorro de bytes de la
alternativa no vale nada sobre localhost. Mover `sugerirAjustes` al cliente
partiría en dos el lugar donde vive la lógica del tono, que hoy está sana y
testeada en `lib/`.

El costo que se paga: `hidratar()` hace una búsqueda de preset por pista en vez
de una por canción. Son como mucho once, en memoria, sobre tablas ya cargadas.

### 4.1 Se quitan los campos espejo

Desaparecen del nivel de la canción: `difficulty`, `instrument`, `trackName`,
`tuning`, `ampli`. La tarjeta lee siempre de `pistas[elegida]`.

Dejarlos duplicados sería dos fuentes de verdad para el mismo dato, y la primera
vez que el selector y la cabecera se desincronicen no habría forma de saber cuál
miente. Esto rompe a propósito `test/tarjeta.test.js` y `test/roll.test.js`: es
como el diseño quiere enterarse de quién dependía del campo viejo.

---

## 5. La tarjeta

**Se listan todas las pistas, ordenadas por views, sin corte.**

### 5.1 Por qué no hay corte de ruido

Se evaluó cortar las pistas de pocas views — los "Extras", las "Harmonies" — y
los datos lo descartan. La distribución de views está dominada por una pista
desbocada, así que cualquier corte relativo castiga pistas legítimas:

| corte | pistas cortadas | de ésas, únicas de su instrumento | de ésas, la más fácil de su canción |
|---|---|---|---|
| 2% del máximo | 3.523 | 849 | 1.318 |
| 5% | 5.657 | 1.484 | 1.950 |
| 10% | 7.798 | 2.131 | 2.492 |
| 20% | 10.364 | 2.877 | 3.111 |

(Medido sobre el catálogo, no sobre el universo sorteable — ver §1.1.)

Con un corte al 10%, *Fade to Black* **pierde la rítmica de Hetfield** (287.234
views contra los 2.984.809 de Kirk). La guitarra rítmica de *Fade to Black* es
justo lo que alguien querría aprender.

Peor: en cada corte, miles de las pistas cortadas son la pista más fácil de su
canción — o sea, exactamente las que justifican las +2.143 canciones nuevas del
filtro fácil. Un corte haría entrar canciones al sorteo por una pista que después
no se muestra.

**Ordenar por views hace solo el trabajo que el corte pretendía hacer:** el ruido
se hunde al fondo, y el 94% de las canciones tiene cuatro pistas o menos.

### 5.2 Las pistas que no califican se muestran igual, marcadas

Quien mira la tarjeta tiene que poder ver **por qué** salió esta canción, y cuál
pista no fue el motivo. Esconderlas dejaría un selector que a veces tiene dos
opciones y a veces cinco sin explicación visible.

### 5.3 Comportamiento

- Cambiar de pista re-dibuja dificultad, aviso de afinación y el bloque del
  amplificador. **Cero red, cero estado asíncrono nuevo.**
- El botón de mandar al amplificador toma la cadena de la pista elegida.
  `despachador.js`, `ampli-usb.js` y `fender-protocolo.js` **no se tocan**.
- La pista elegida **no se recuerda** entre sorteos ni entre recargas, igual que
  el modo, la dificultad y las bandas.

### 5.4 Lo que cae solo

Elegir una pista acústica de *Fade to Black* dispara la regla que ya está escrita
y argumentada en `lib/ampli.js:191`, y da CHAMPION gain 1 en vez del preset de
Metallica a gain 10. No hay código nuevo para esto: es la regla existente
recibiendo por fin la pista correcta.

---

## 6. El sorteo de todo

Un botón que sortea ignorando **modo, dificultad y bandas**, sin tocar los
controles: al volver, la configuración sigue donde se dejó.

El motivo es tener una salida de emergencia del filtrado sin perder lo
configurado. Hoy habría que arrastrar los sliders y volver a ponerlos.

Reusa `BASE_FROM` sin los tres filtros. No es un modo nuevo en `MODES`: los modos
son criterios de filtrado y éste es su ausencia.

> **Nota:** que ignore también las bandas es la lectura literal de "control
> total" y fue una decisión consciente, no un descuido. Si al usarlo resulta que
> las fichas de banda se sienten como una elección que merece respetarse, es un
> cambio de una línea.

---

## 7. Lo que se investigó y se descartó

Se exploró que el cambio de tono fuera automático. Queda documentado para no
volver a recorrerlo.

**La palanca de la guitarra no se puede leer.** El selector de pastillas es un
switch pasivo en el camino del audio: no emite datos. El amplificador recibe
audio y nada más. No es difícil — no existe la señal. Inferirlo del audio sería
adivinar una diferencia sutil de EQ, confundida por cómo y qué se toca.

**Sincronizar con las secciones de la canción tiene dos bloqueos
independientes:**

1. *No hay a qué sincronizarse.* El ETL baja catálogo y metadata
   (`etl/parse.js`), no la tablatura: no hay secciones ni tiempos. Y el
   reproductor de Songsterr es un enlace afuera, cross-origin: no hay forma de
   leer en qué compás va.
2. *Sería demasiado lento igual.* `public/despachador.js:5` trae una medición
   contra el equipo real: **~120 ms por escritura**, una sola en vuelo. El envío
   de *Fade to Black* son 5 reemplazos de unidad más 8 perillas ≈ **1,5-2
   segundos**. El golpe de distorsión cae en un tiempo fuerte; llegaría dos
   compases tarde.

**Lo que sí sería viable, si algún día se retoma:** un pedal — footswitch USB HID
o MIDI — que el navegador lee con la misma clase de API que ya usa para WebHID,
disparando el envío de la pista siguiente. Y antes de eso, un spike de diez
minutos con el equipo conectado para contestar la pregunta de la que depende toda
la familia: **¿cambiar el modelo de amplificador en vivo suena, o hace un
hueco?** Si hace un hueco, la respuesta correcta pasa a ser dejar los dos tonos
en dos ranuras del equipo y cambiar con el pie — lo que choca con que grabar en
una ranura es la única operación irreversible del proyecto.

---

## 8. Tests

La convención del repo: el front sin DOM se testea (`tarjeta.js`,
`despachador.js`), el front con DOM no.

1. **El predicado por pista.** Una canción con acústica difícil y eléctrica fácil
   **no** sale en acústico+fácil. Es el bug de las 178 de §3.1, y es el test más
   importante de este diseño.
2. **La pista por defecto siempre cumple el filtro** con el que se sorteó.
3. ***Fade to Black* sale en modo acústico.** Hoy no sale; es la regresión que
   mide si el diseño hizo lo que dijo.
4. **Su pista acústica da CHAMPION**, no el preset de comunidad de Metallica.
5. **Los contadores cuentan canciones distintas, no filas** — el `DISTINCT` de
   §3.3, verificado sobre una canción con varias pistas que califican.
6. **`tarjeta.js`:** la lógica pura del selector, sin DOM.

---

## 9. Documentación

El README queda desactualizado en dos sitios y hay que corregirlo con el cambio,
no después:

- La sección de filtros: la dificultad ya no es "la de la canción" sino "existe
  una pista así".
- La sección de envío al amplificador: lo que se manda es el tono de la pista
  elegida, no el de la canción.
