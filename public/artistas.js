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

/* Normaliza CUALQUIER texto del catalogo para compararlo: nombres de artista
   y tambien titulos de cancion. Nada en ella es de artistas -- baja caja, quita
   tildes y puntuacion -- y se llamo `normalizarArtista` hasta que el buscador
   de canciones la necesito para los titulos. El nombre viejo habria mentido
   sobre lo que hace.

   Conserva TODA letra de cualquier alfabeto: `\p{L}`, no `a-z`.

   Esto no es celo: la version `[^a-z0-9 ]` de esta misma idea se escribio dos
   veces en este proyecto y las dos veces borro los alfabetos no latinos
   enteros, dejando a los ~90 temas en cirilico del catalogo normalizando a la
   cadena VACIA -- o sea todos colapsados en un grupo, calzando con el primer
   artista de la lista. La revision final lo encontro en presets-comunidad.js y
   yo lo repeti en el script con que medi las cifras de arriba. `\p{M}` quita
   las tildes que `NFD` acaba de separar de su letra. */
export function normalizarTexto(texto) {
  return String(texto ?? '')
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
   `normalizarTexto` borra los dos puntos. Vive aqui y no repetido en cada
   sitio de uso porque `construirIndice` y `expandirArtistas` tienen que
   calcular la MISMA clave para el mismo nombre; si se desviaran, elegir una
   banda dejaria de encontrar su propio grupo. */
export function claveDeArtista(nombre) {
  const norm = normalizarTexto(nombre)
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
    const clave = claveDeArtista(artist)

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
     las junto. Una version anterior agregaba ademas un `set(claveDeArtista(v))` por
     variante, y era redundante -- pero sobre todo era un segundo camino para
     calcular la clave, o sea la unica forma de que las dos funciones se
     desviaran. Con un camino no hay divergencia posible que testear. */
  const porClave = new Map((indice ?? []).map(g => [g.clave, g]))

  const fuera = new Set()
  for (const nombre of elegidos ?? []) {
    const g = porClave.get(claveDeArtista(nombre))
    if (g) for (const v of g.variantes) fuera.add(v)
  }
  return [...fuera]
}

/* Busca en el indice lo que el usuario esta escribiendo.

   Aca SI se calza por fragmento, al reves que `expandirArtistas` de arriba y
   que `resolverUnidad` en lt25-nombres.js. No es una inconsistencia: la regla
   de no adivinar existe porque ahi el programa RESUELVE solo y el usuario no
   ve lo que eligio por el, asi que un calce parecido se le cuela sin que nada
   lo diga. Un buscador es lo contrario -- muestra los candidatos y el usuario
   toca el que queria -- y ahi lo peligroso seria lo estricto: obligar a
   escribir "Mötley Crüe" con dieresis para encontrarlo.

   LIMITE CONOCIDO: no hay transliteracion. Escribir "kino" en un teclado
   latino encuentra `Kino` (3 canciones) y NO `Кино` (29), porque son cadenas
   distintas -- y agruparlas seria peor, porque son bandas distintas. Con un
   teclado latino esos ~90 temas en cirilico del catalogo quedan practicamente
   inalcanzables desde el buscador. Se arregla con un mapa de transliteracion,
   que es su propio trabajo y tiene su propio riesgo de calces falsos.

   El orden pone primero lo que EMPIEZA con lo escrito y luego lo de mas
   canciones: escribir "metal" tiene que ofrecer Metallica antes que Metal
   Church, y escribir "maiden" tiene que ofrecer Maiden United antes que Iron
   Maiden, aunque Iron Maiden tenga mas canciones. */
export function buscarArtistas(indice, consulta, limite = 8, yaElegidas = []) {
  const q = normalizarTexto(consulta)
  if (q === '') return []

  const fuera = new Set((yaElegidas ?? []).map(claveDeArtista))

  return (indice ?? [])
    .filter(g => !fuera.has(g.clave))
    .map(g => {
      // Se busca en TODAS las escrituras: "motorhead" tiene que encontrar el
      // grupo cuyo nombre visible es "Motörhead".
      const posicion = g.variantes.reduce((mejor, v) => {
        const i = normalizarTexto(v).indexOf(q)
        return i === -1 ? mejor : (mejor === -1 ? i : Math.min(mejor, i))
      }, -1)
      return { g, posicion }
    })
    .filter(({ posicion }) => posicion !== -1)
    .sort((a, b) => (a.posicion - b.posicion) || (b.g.canciones - a.g.canciones))
    .slice(0, limite)
    .map(({ g }) => g)
}
