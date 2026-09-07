# De dónde salieron estos archivos

Planilla mantenida por la comunidad de usuarios del Fender Mustang LT:
https://docs.google.com/spreadsheets/d/1KWvjJ6q6Ora2MqmxtUAWjq9Uerp0Ycza5ouuKuol5HQ/edit?gid=1647190216

Exportada el 2026-09-06. Copiada aquí **tal cual**, sin reformatear, para que
cualquiera pueda contrastar lo que la app hace contra lo que la planilla dice.

- `presets-lt25-bandas.csv` — 77 presets indexados por guitarrista y/o banda.
- `presets-lt25-tonos.csv` — 10 tonos con nombre genérico.

**Es trabajo de otras personas.** Se cita, no se apropia. Este repositorio es
local y no se publica; si algún día se publicara, hay que revisar antes en qué
términos la planilla permite redistribuirse.

**Es opinión, no medición.** Son los ajustes que a alguien le funcionaron, no el
tono de la grabación. La planilla marca su propia incertidumbre en varias filas
(`{EXPERIMENTAL}`, `(INACCURATE)`, `Pearl jam?`) y esa incertidumbre viaja
hasta la pantalla, pero **no** pegada al nombre: `lib/ampli.js` la limpia del
nombre (`limpiarMarcaDeNombre`) y la manda estructurada en `preset.incierto`,
que la tarjeta declara explícito ("la propia planilla marca este preset como
dudoso"). Un lector viendo "GUNS N ROSES?" lo leería como un typo nuestro, no
como la advertencia de la planilla que es — por eso se separa el dato de su
presentación en vez de copiar la marca tal cual.

Dos columnas del bloque de amplificador (la 6ª y la 7ª) **no se usan**: los
veinte modelos declaran cinco perillas y esas columnas traen valores negativos,
así que no son perillas. Su significado se desconoce. Ver §3.1.1 de la spec.

---

**Pendiente si este repositorio se publica alguna vez:** `public/lt25-unidades.json`
(138 KB) es un volcado del catálogo DSP del firmware del Fender Mustang LT25,
versionado sin nota de procedencia propia. Va al mismo análisis de terceros que
la planilla de esta comunidad — no se resuelve en esta ronda, sólo se deja
anotado aquí para que no se pierda.
