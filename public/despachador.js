/* ---------------------------------------------------------------------------
   Serializa las escrituras al amplificador y fusiona las que se atropellan.

   Arrastrar un control genera del orden de 60 eventos por segundo, y cada
   escritura cuesta dos mensajes mas su confirmacion (~120 ms medidos contra el
   equipo). Mandarlas todas es imposible, y mandarlas en paralelo es peor: el
   docblock de ponerParametro advierte que dos escrituras vivas sobre la misma
   perilla dejan que la correlacion de ACK resuelva la equivocada.

   Regla: una sola escritura en vuelo, y por cada clave se guarda unicamente el
   ultimo valor pendiente. Los intermedios de un arrastre se descartan; el
   ultimo siempre sale.

   Este modulo es PURO a proposito, igual que public/fender-protocolo.js: no
   sabe nada de WebHID ni del DOM, solo recibe la funcion `escribir(clave,
   valor)` y la llama. Eso es lo que permite testearlo sin equipo ni navegador.
   --------------------------------------------------------------------------- */
export function crearDespachador(escribir) {
  const cola = new Map()      // clave -> ultimo valor pendiente
  const oyentes = []
  let corriendo = false

  async function vaciar() {
    if (corriendo) return
    corriendo = true
    try {
      while (cola.size) {
        // El Map conserva el orden de inserción: sale la clave que espera hace
        // más tiempo, así una perilla que se arrastra no deja a otra en ayunas.
        const [clave, valor] = cola.entries().next().value
        cola.delete(clave)
        let fallo = null
        try { await escribir(clave, valor) } catch (err) { fallo = err }
        for (const fn of oyentes) fn(clave, valor, fallo)
      }
    } finally {
      corriendo = false
    }
  }

  return {
    /* Encola un valor. Si ya habia uno pendiente para esa clave, lo reemplaza:
       el valor viejo de un arrastre no le sirve a nadie. */
    poner(clave, valor) {
      cola.set(clave, valor)
      return vaciar()
    },
    alTerminar(fn) { oyentes.push(fn) },
    enVuelo: () => corriendo || cola.size > 0,
  }
}
