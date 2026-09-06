/* ---------------------------------------------------------------------------
   Parser de CSV, escrito a mano porque este proyecto no tiene dependencias.

   No es un `split(',')` por una razon concreta: los CSV de la comunidad traen
   comas dentro de campos entrecomillados, saltos de linea dentro de celdas y
   decimales con coma. Un split los rompe en silencio, corriendo las columnas
   -- y como esas columnas son posicionales, correrlas asigna el valor de una
   perilla a otra sin que nada avise.
   --------------------------------------------------------------------------- */

/* Devuelve las filas tal cual, celdas vacias incluidas. Las vacias importan:
   en la hoja de bandas las columnas son fijas y una celda vacia significa "esta
   perilla no se especifico", asi que colapsarlas correria el bloque entero. */
export function parsearCsv(texto) {
  const filas = []
  let fila = [], campo = '', dentro = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (dentro) {
      if (c !== '"') { campo += c; continue }
      if (texto[i + 1] === '"') { campo += '"'; i++ } else dentro = false
    } else if (c === '"') dentro = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

/* Un numero, o null. Nunca 0 por descarte: el guion es como las hojas dicen
   "esta ranura no se usa", y convertirlo en 0 le mandaria al amplificador un
   valor que nadie escribio. */
export function numeroCsv(celda) {
  const s = String(celda ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
