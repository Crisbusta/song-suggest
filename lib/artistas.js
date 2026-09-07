/* Agrupar las escrituras de un mismo artista.

   El catalogo escribe algunos nombres de dos formas, y no son casos de borde
   inventados: medido sobre las 9.736 canciones sorteables al 2026-09-07, hay
   37 artistas con mas de una escritura y elegir una sola dejaria 55 canciones
   afuera. Los peores en proporcion son `Кино` 21 + `КИНО` 8 (se perderia el
   28% de sus canciones), `blink-182` 34 + `Blink-182` 3, y `Motörhead` 23 +
   `Motorhead` 2. De ahi que el filtro por bandas calce por nombre normalizado
   y no por el texto exacto.

   Este modulo es puro a proposito -- sin base de datos, sin DOM -- para que
   `test/` lo importe directo desde disco, igual que catalogo-lt25.js. */

/* Conserva TODA letra de cualquier alfabeto: `\p{L}`, no `a-z`.

   Esto no es celo: la version `[^a-z0-9 ]` de esta misma idea se escribio dos
   veces en este proyecto y las dos veces borro los alfabetos no latinos
   enteros, dejando a los ~90 temas en cirilico del catalogo normalizando a la
   cadena VACIA -- o sea todos colapsados en un grupo, calzando con el primer
   artista de la lista. La revision final lo encontro en presets-comunidad.js y
   yo lo repeti en el script con que medi las cifras de arriba. `\p{M}` quita
   las tildes que `NFD` acaba de separar de su letra. */
export function normalizarArtista(nombre) {
  return String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* La clave con que se agrupa. Un nombre cuya normalizacion queda vacia -- en
   el catalogo real hay exactamente uno, un `-` -- recibe una clave propia
   derivada de su texto crudo: si todos compartieran la clave vacia volveriamos
   al mismo colapso que el normalizador evita, por otra puerta.

   El prefijo `crudo:` no puede colisionar con una clave normal porque
   `normalizarArtista` borra los dos puntos. Vive aqui y no repetido en cada
   sitio de uso porque `construirIndice` y `expandirArtistas` tienen que
   calcular la MISMA clave para el mismo nombre; si se desviaran, elegir una
   banda dejaria de encontrar su propio grupo. */
function claveDe(nombre) {
  const norm = normalizarArtista(nombre)
  return norm === '' ? `crudo:${nombre}` : norm
}

/* `filas` viene de un GROUP BY artist: `[{ artist, c }]`.

   El nombre visible de cada grupo es la escritura con mas canciones, que es la
   que el usuario reconoce: entre `blink-182` (34) y `Blink-182` (3) gana la
   primera. Con empate gana la que llego antes, que es la de mas canciones por
   el ORDER BY de la consulta. */
export function construirIndice(filas) {
  const grupos = new Map()

  for (const { artist, c } of filas ?? []) {
    /* Un nombre cuya normalizacion queda vacia -- en el catalogo real hay
       exactamente uno, un `-` -- se guarda bajo una clave propia derivada de
       su texto crudo. Si compartieran la clave vacia volveriamos al mismo
       colapso que el normalizador evita, por otra puerta. */
    const clave = claveDe(artist)

    const g = grupos.get(clave)
    if (g) { g.variantes.push(artist); g.canciones += c }
    else grupos.set(clave, { clave, nombre: artist, variantes: [artist], canciones: c })
  }

  for (const g of grupos.values()) {
    g.nombre = g.variantes.reduce((mejor, v) => {
      const cv = (filas.find(f => f.artist === v)?.c) ?? 0
      const cm = (filas.find(f => f.artist === mejor)?.c) ?? 0
      return cv > cm ? v : mejor
    }, g.variantes[0])
  }

  return [...grupos.values()].sort((a, b) => b.canciones - a.canciones)
}

/* Los nombres elegidos se traducen a TODAS sus escrituras, que es lo que la
   consulta necesita para su `IN (...)`.

   Un nombre desconocido no aporta ninguna escritura, en vez de aportar algo
   parecido: misma regla que `resolverUnidad` en lt25-nombres.js, donde
   adivinar por prefijo convirtio una vez el valor `5.0` en el modelo
   `50S TWIN`. Aca el costo de adivinar seria peor, porque el usuario esta
   pidiendo explicitamente ciertas bandas: colarle otra rompe justamente lo que
   pidio. Si nada calza, la cuenta de "cuantas calzan" da cero y el aviso lo
   explica -- que es la verdad, no un error que haya que tapar. */
export function expandirArtistas(indice, elegidos) {
  /* Basta indexar por `g.clave`: todas las variantes de un grupo derivan esa
     misma clave, porque es exactamente el criterio con que `construirIndice`
     las junto. Una version anterior agregaba ademas un `set(claveDe(v))` por
     variante, y era redundante -- pero sobre todo era un segundo camino para
     calcular la clave, o sea la unica forma de que las dos funciones se
     desviaran. Con un camino no hay divergencia posible que testear. */
  const porClave = new Map((indice ?? []).map(g => [g.clave, g]))

  const fuera = new Set()
  for (const nombre of elegidos ?? []) {
    const g = porClave.get(claveDe(nombre))
    if (g) for (const v of g.variantes) fuera.add(v)
  }
  return [...fuera]
}
