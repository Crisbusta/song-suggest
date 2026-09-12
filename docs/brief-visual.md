# Propuesta visual para `song-suggest`

> Brief para entregarle a una herramienta de diseño. Escrito para ser
> **autosuficiente**: quien lo lea no tiene el contexto de este repositorio.
> Las cifras salen del `songs.db` real, medidas el 2026-09-12.

## Qué es

Una web **local, de un solo usuario**, que corre en `localhost` y ayuda a
elegir qué canción de guitarra aprender. Tiene un catálogo de 10.011 canciones
de Songsterr (9.734 sorteables). Hace tres cosas:

1. **Sortea** una canción al azar, con filtros (modo, rango de dificultad, bandas).
2. Para la **pista** que se elija de esa canción, sugiere ajustes de amplificador
   para un **Fender Mustang LT25**, y sabe **mandárselos al equipo por USB**
   (WebHID). Esto último es lo que ninguna otra app hace, y hoy está escondido.
3. Lleva la cuenta de lo aprendido, descartado, pospuesto y gustado.

El usuario es una persona, en un escritorio, con una guitarra en las manos y el
amplificador al lado. No hay onboarding, ni cuentas, ni móvil.

## Restricciones técnicas (duras, no negociables)

- **JavaScript vainilla, cero dependencias de npm, sin paso de build.** Módulos
  ES servidos tal cual desde `public/`. Nada de React/Tailwind/build step.
- **Navegador de escritorio**, Chrome o Edge (WebHID no existe en Firefox ni
  Safari). Móvil no importa.
- HTML + CSS + JS a mano. El CSS actual usa variables nativas, sin preprocesador.
- Las manos del usuario suelen estar ocupadas con la guitarra: el **teclado**
  importa más de lo normal.

## La paleta actual (medida con WCAG, ya cumple AA/AAA)

```
--fondo:   #14151a      --texto:  #e8e8ea
--panel:   #1e2029      --tenue:  #9a9aa5
--relieve: #2a2d38      --acento: #d4a24a   (ámbar)
--borde:   #424654
```

Escala de espaciado de 4px (4/8/16/24/40) y escala tipográfica modular
(12/13/15/17/28px). **Se puede cambiar, pero si se cambia hay que mantener los
contrastes**: la paleta de ahora se midió y pasa AA/AAA. Eso no se negocia.

## Qué hay hoy en pantalla

Una sola columna de 44rem centrada, tres vistas conmutables (**Sortear** /
**Mis listas** / **Ampli**). La vista Sortear, de arriba abajo:

1. **Cabecera**: título, "9.734 disponibles de 10.011 listas", botón *Conectar
   ampli*, y la navegación entre las tres vistas.
2. **Panel de controles** (grande): selector de modo (4 opciones), **dos sliders
   separados** para dificultad mínima y máxima, buscador de bandas con fichas
   removibles y atajos, y un contador "9.734 canciones calzan con estos filtros".
3. **Buscador de canción** (abre la tarjeta directo, sin sortear).
4. **La tarjeta**: título, artista, **selector de pista**, medidor de dificultad
   (1-10), instrumento, chips de etiquetas, **panel plegable de ajustes del
   amplificador**, miniatura de video de YouTube, y enlaces (Songsterr, Ultimate
   Guitar, pista de acompañamiento).
5. **Botonera**: Ya la aprendí · No me tinca · Después · **Otra** · Sortear de
   todo · ♡

## Los datos reales (esto condiciona el diseño)

- **Una canción tiene entre 1 y 11 pistas de guitarra.** Distribución real:
  1 pista 19,4% · 2 pistas 36,9% · 3 pistas 24,3% · 4 pistas 11,9% ·
  **5 o más, sólo 7,5%**. O sea: el 92,5% cabe en cuatro o menos.
- Cada pista tiene **su propia dificultad, su afinación y su tono de amplificador**.
  *Fade to Black* tiene 6: dos acústicas (el intro) y cuatro con distorsión.
  Elegir la acústica da un amplificador limpio; la eléctrica, alta ganancia.
- **Los nombres de pista son sucios**: vienen del catálogo como
  `Kirk Hammett | Gibson Flying V | Lead Guitar`. 959 pistas no tienen nombre y
  caen al nombre del instrumento.
- Las etiquetas son muchas (9,6 de promedio, algunas 52); hoy se muestran 5.
- El amplificador tiene **5 ranuras** (stomp, mod, amp, delay, reverb) y algunas
  escrituras **fallan o quedan sin confirmar**, y eso hay que avisarlo en rojo.

## Los problemas a resolver

1. **Cambiar de pista es difícil, y es lo que más urge arreglar.** Hoy es un
   `<select>` nativo. Con el desplegable cerrado **no se ve que la canción tenga
   un intro acústico** — el valor entero de la función es invisible hasta que se
   abre a ciegas. Además: dos clics para cambiar, imposible comparar dos tonos, y
   la etiqueta es el volcado crudo del catálogo.
2. **La jerarquía visual está invertida.** El elemento más grande de la tarjeta
   es la miniatura de YouTube, que es lo menos funcional. Los **ajustes del
   amplificador** — lo único que esta app hace y ninguna otra — son una línea
   gris en mayúsculas, plegada, con aspecto de pie de página.
3. **La tarjeta arranca debajo del pliegue.** El panel de controles ocupa media
   pantalla encima de ella. Los controles que se tocan una vez cada diez sorteos
   le están quitando el sitio a lo que se mira siempre.
4. **Dos sliders separados** es la forma más torpe de pedir un rango de 1 a 3.

## Lo que no se puede romper

- El contador "cuántas calzan" describe **los filtros**, no la canción que se
  está viendo. Hay caminos (buscar una canción, "Sortear de todo") que a
  propósito no lo mueven.
- Los avisos del amplificador en **rojo** cuando una perilla no se pudo escribir.
  La app nunca da por buena una escritura sin confirmación del equipo, y eso se ve.
- Marcar una canción como aprendida la marca **entera**, no por pista.
- Las pistas que no cumplen el filtro se muestran igual, **marcadas**, para que
  se vea por qué salió esa canción.

## Qué se espera de vuelta

Una propuesta visual de **la vista Sortear** (la principal), con foco en:

- **El selector de pista**: cómo hacer que se vea de un golpe qué pistas hay y
  qué las diferencia, y que cambiar sea un gesto y no dos clics. Contemplar el
  caso de 2-4 pistas (el 92,5%) y qué pasa con 11.
- **La tarjeta**: qué debería ser grande y qué chico. En particular, dónde vive
  el bloque del amplificador si deja de estar escondido.
- **El layout**: cómo hacer que la canción sea lo primero que se ve sin perder el
  acceso a los filtros.

Estados que interesa ver resueltos: canción de **una sola pista** (sin selector),
canción de **6 pistas** con dos instrumentos distintos, y el bloque del
amplificador **abierto** con sus cinco ranuras.

La app está en **español** y así se queda. Es de una sola persona: se prefiere
densidad y teclado antes que aire y onboarding.

---

## Nota para quien mantenga este archivo

Este brief describe **problemas**, no soluciones, a propósito. Prescribir el
control concreto ("usa pastillas segmentadas") devuelve la idea de quien escribe
dibujada, en vez de una propuesta. La distribución de pistas está para que quien
diseñe pueda llegar por su cuenta a algo equivalente — o a algo mejor.

Las cuatro reglas de "lo que no se puede romper" no son gustos: cada una costó
rondas de revisión y está documentada en `README.md` y en
`docs/superpowers/specs/`. Un rediseño que se las lleve por delante se vería
bien y sería un retroceso.
