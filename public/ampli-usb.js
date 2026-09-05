/* ---------------------------------------------------------------------------
   Conexion con el Fender Mustang LT25 por WebHID.

   Solo el ciclo de vida: permiso, apertura, handshake, heartbeat y espera de
   ACK. Todo el formato de mensajes vive en fender-protocolo.js, que si esta
   cubierto por tests.
   --------------------------------------------------------------------------- */
import {
  empaquetar, crearReensamblador, interpretar,
  SYNC_BEGIN, SYNC_END, HEARTBEAT, mensajePonerParametro,
} from './fender-protocolo.js'

const VENDOR = 0x1ed8, PRODUCT = 0x0037
const ESPERA_ACK = 2000        // ms antes de dar por perdida una escritura
const LATIDO = 1000            // el equipo cierra la conexion sin heartbeat

let dispositivo = null
let conectando = false        // hay un conectar()/reconectarSiSePuede() en curso
let latido = null
let reensamblador = null
const pendientes = []          // { nodo, parametro, resolver, rechazar, temporizador }
const oyentes = []

const avisar = () => { for (const fn of oyentes) fn(!!dispositivo) }

/* Deuda de ACKs rezagados, por clave (nodo, parametro).

   El protocolo no lleva identificador de correlacion y el reintento suele
   mandar el mismo valor, asi que un ACK no se puede atar a la escritura que lo
   provoco: comparar valores no distingue nada. Sin esto, el ACK atrasado de la
   escritura A calza contra la entrada pendiente del reintento B y lo resuelve.
   El usuario leeria "confirmado" sobre un valor que el ampli ignoro en
   silencio, que es exactamente la mentira contra la que existe todo este
   diseño.

   Por eso se CUENTA, no se marca. Cada escritura abandonada deja como mucho UN
   ACK todavia en el aire, asi que la deuda de una clave es un numero: la lista
   de instantes en que caduca cada uno de esos ACK posibles. Un booleano por
   entrada no alcanza -- con tres escrituras seguidas sobre la misma perilla, la
   segunda se traga el ACK de la primera y da su propia deuda por saldada, y
   entonces el ACK propio de la segunda queda suelto y confirma falsamente a la
   tercera, que el ampli nunca aplico.

   El costo esta puesto a proposito y hay que asumirlo: contra un amplificador
   que responde sistematicamente cerca del limite de los 2 s, reintentar rapido
   hace que TODAS las escrituras se reporten "sin confirmar" aunque el equipo
   las este aplicando, porque cada ACK que llega es el de la escritura anterior
   y se lo come la deuda. Entre reportar de menos y mentir, se reporta de menos:
   ese "sin confirmar" repetido es una decision, no un bug. Y no queda
   envenenado para siempre -- las deudas caducan a 2 * ESPERA_ACK, asi que
   esperar unos segundos antes de reintentar deja la perilla funcionando
   normal. */
const descartar = new Map()    // clave -> ms de caducidad de cada deuda, en orden creciente
const VENTANA_DESCARTE = 2 * ESPERA_ACK
const clave = (nodo, parametro) => `${nodo}\u0000${parametro}`

/* Una escritura abandonada, una deuda. Se anota SIEMPRE, sin mirar si mientras
   tanto se consumio algun ACK de la misma clave: ese ACK consumido era de otra
   escritura anterior, y esta puede producir el suyo igual. */
function anotarDeuda(nodo, parametro) {
  const k = clave(nodo, parametro)
  const lista = descartar.get(k)
  const vence = Date.now() + VENTANA_DESCARTE
  if (lista) lista.push(vence)
  else descartar.set(k, [vence])
}

/* Las deudas caducan solas: un ACK que no llega nunca dejaria esa clave
   envenenada para siempre, y todo reintento posterior sobre esa perilla se
   reportaria como no confirmado. Se purga con cada mensaje que entra. Como
   VENTANA_DESCARTE es igual para todas, la lista queda ordenada por caducidad
   y basta sacar del frente. */
function purgarDescartes() {
  const ahora = Date.now()
  for (const [k, lista] of descartar) {
    while (lista.length && lista[0] <= ahora) lista.shift()
    if (!lista.length) descartar.delete(k)
  }
}

function alRecibir(e) {
  const mensaje = reensamblador.recibir(new Uint8Array(e.data.buffer))
  if (!mensaje) return
  purgarDescartes()
  const r = interpretar(mensaje)
  if (r.tipo !== 'ackParametro') return
  const k = clave(r.nodo, r.parametro)
  /* Si a esta clave le queda alguna deuda vigente -- las caducadas ya se
     purgaron arriba --, este ACK puede ser el rezagado de cualquiera de las
     escrituras abandonadas y no hay como distinguirlo del propio de la
     escritura viva. Se lo traga la deuda mas antigua y no llega a resolver
     nada. Solo con la deuda en cero un ACK puede confirmar una entrada
     pendiente. */
  const deudas = descartar.get(k)
  if (deudas) {
    deudas.shift()
    if (!deudas.length) descartar.delete(k)
    return
  }
  const i = pendientes.findIndex(p => p.nodo === r.nodo && p.parametro === r.parametro)
  if (i < 0) return
  const [p] = pendientes.splice(i, 1)
  clearTimeout(p.temporizador)
  p.resolver(r.valor)
}

/* Medido contra el equipo: si se envia `currentPresetRequest`, el amplificador
   deja de aceptar escrituras durante el resto de la sesion y responde con
   silencio absoluto. Un SYNC_BEGIN nuevo la destraba. Por eso este modulo NO
   lee el preset: solo escribe, que es todo lo que la funcion necesita. */
async function abrir(dev) {
  dispositivo = dev
  reensamblador = crearReensamblador()
  dev.addEventListener('inputreport', alRecibir)
  let abierto = false
  try {
    await dev.open()
    abierto = true
    reensamblador.reiniciar()
    await dev.sendReport(0, empaquetar(SYNC_BEGIN))
  } catch (err) {
    // Para que conectar() sepa en que paso se cayo: un open() que falla y un
    // SYNC_BEGIN que falla tienen causas probables distintas.
    err.enApertura = !abierto
    // Si open() o el SYNC_BEGIN fallan, no dejamos un dispositivo "conectado"
    // a medias: sin esto, dispositivo quedaba asignado y el heartbeat nunca
    // arrancaba, y conectado() mentia diciendo que si hay conexion.
    dev.removeEventListener('inputreport', alRecibir)
    dispositivo = null
    try { await dev.close() } catch { /* nunca llego a abrirse, o ya se fue */ }
    throw err
  }
  // Mientras esperabamos los awaits de arriba (open() y el SYNC_BEGIN) pudo
  // correr un desconectar() -- por ejemplo, el navegador emitio 'disconnect'
  // porque desenchufaron el equipo a mitad del handshake. Ese desconectar()
  // ya puso dispositivo en null, saco el listener y cerro dev. Si seguimos
  // de largo igual, armariamos un setInterval nuevo contra un dispositivo
  // que ya nadie referencia: el latido llamaria a dispositivo?.sendReport,
  // que no hace nada porque dispositivo es null, y el intervalo quedaria
  // vivo para siempre sin que nada lo cancele. No es un error del usuario,
  // es una desconexion que ya se atendio: salimos sin avisar() ni latido.
  if (dispositivo !== dev) {
    dev.removeEventListener('inputreport', alRecibir)
    try { await dev.close() } catch { /* ya lo cerro el otro desconectar() */ }
    return
  }
  // El equipo cierra la conexion si deja de recibir latidos.
  latido = setInterval(() => {
    dispositivo?.sendReport(0, empaquetar(HEARTBEAT)).catch(() => desconectar())
  }, LATIDO)
  avisar()
}

async function desconectar() {
  if (latido) { clearInterval(latido); latido = null }
  const dev = dispositivo
  dispositivo = null
  for (const p of pendientes.splice(0)) { clearTimeout(p.temporizador); p.rechazar(new Error('se corto la conexion')) }
  // La sesion siguiente empieza limpia: ningun ACK de la anterior puede
  // sobrevivir al cierre, asi que arrastrar deudas viejas solo lograria
  // reportar como no confirmadas escrituras nuevas que si funcionaron.
  descartar.clear()
  if (dev) {
    try { await dev.sendReport(0, empaquetar(SYNC_END)) } catch { /* ya se fue */ }
    dev.removeEventListener('inputreport', alRecibir)
    try { await dev.close() } catch { /* ya se fue */ }
  }
  avisar()
}

// El navegador avisa cuando desenchufan el equipo.
if (typeof navigator !== 'undefined' && navigator.hid) {
  navigator.hid.addEventListener('disconnect', e => {
    if (e.device === dispositivo) desconectar()
  })
}

export const ampli = {
  soportado: () => typeof navigator !== 'undefined' && 'hid' in navigator,
  conectado: () => !!dispositivo,
  alCambiarEstado(fn) { oyentes.push(fn) },

  async conectar() {
    if (!this.soportado()) throw new Error('Este navegador no soporta WebHID. Necesitas Chrome o Edge.')
    /* Una segunda llamada con la conexion ya abierta dejaria el setInterval
       anterior latiendo contra un dispositivo que nadie referencia. Pero
       `dispositivo` solo se asigna dentro de abrir(), asi que ese chequeo
       solo no alcanza: dos clics seguidos SIEMPRE pasan la guarda mientras el
       primero todavia esta esperando el selector de Chrome (que tarda lo que
       tarde el usuario), porque ninguno de los dos vio `dispositivo` puesto
       todavia. Verificado con un dispositivo simulado: sin `conectando`, dos
       llamadas concurrentes efectivamente abren dos dispositivos y una gana
       la carrera por `latido`, dejando la otra huerfana para siempre. */
    if (dispositivo || conectando) return
    conectando = true
    try {
      let dev
      try {
        ;[dev] = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR, productId: PRODUCT }] })
      } catch (err) {
        throw new Error(`No pude pedir el dispositivo: ${err.message}`)
      }
      /* Cerrar el selector sin elegir nada no es un error: Chrome devuelve un
         arreglo vacio y el usuario ya sabe lo que hizo. Se sale en silencio,
         sin conectar y sin escribirle nada al `#hint`. */
      if (!dev) return
      try {
        await abrir(dev)
      } catch (err) {
        /* Si `open()` falla despues de que requestDevice() ya resolvio con un
           dispositivo, la causa abrumadoramente mas probable es que el equipo
           acepte un solo cliente y Fender Tone LT Desktop lo tenga tomado.
           No se puede detectar por el texto: Chrome lanza un DOMException
           generico ("Failed to open the device.") que no dice exclusividad ni
           nada parecido, asi que filtrar por palabras dejaba este caso -- el
           mas probable de todos -- cayendo en el mensaje generico, que no le
           dice al usuario que hacer. Se presume exclusividad y se deja el
           error real al final, para no perder el diagnostico.
           Si en cambio el que fallo fue el SYNC_BEGIN, el equipo ya era
           nuestro: ahi la exclusividad esta descartada y el mensaje generico
           es el honesto. */
        throw new Error(err.enApertura
          ? `El amplificador ya está en uso. Cierra Fender Tone LT Desktop y vuelve a intentar. (${err.message})`
          : `No pude abrir el amplificador: ${err.message}`)
      }
    } finally {
      conectando = false
    }
  },

  // WebHID recuerda los permisos por origen: si ya se autorizo antes, se
  // reconecta sin mostrarle el selector al usuario otra vez.
  async reconectarSiSePuede() {
    if (!this.soportado() || dispositivo || conectando) return !!dispositivo
    conectando = true
    try {
      const previos = await navigator.hid.getDevices()
      const dev = previos.find(d => d.vendorId === VENDOR && d.productId === PRODUCT)
      if (!dev) return false
      /* `abrir()` puede volver sin lanzar y sin haber conectado: si un
         desconectar() corrio durante el handshake, sale por la salida limpia.
         Devolver `true` a ciegas ahi haria que quien reconecta al cargar la
         pagina pinte "conectado" sobre una conexion que ya no existe. */
      try { await abrir(dev); return !!dispositivo } catch { return false }
    } finally {
      conectando = false
    }
  },

  desconectar,

  /* Escribe un parametro y espera la confirmacion del equipo.
     El amplificador ignora en silencio lo que no entiende, asi que sin ACK no
     hay ninguna garantia de que algo haya cambiado: esta funcion rechaza en vez
     de mentir. */
  async ponerParametro(nodo, parametro, valor) {
    if (!dispositivo) throw new Error('El amplificador no está conectado.')
    /* Medido contra el equipo: cada SYNC_BEGIN habilita UNA sola escritura; la
       segunda y las siguientes caen en silencio. Reenviarlo antes de cada
       parametro es lo que permite mandar las tres perillas. No hace falta
       SYNC_END: basta con volver a abrir el sync. */
    reensamblador.reiniciar()
    await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
    let entrada
    const promesa = new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        const i = pendientes.findIndex(p => p.resolver === resolver)
        if (i >= 0) pendientes.splice(i, 1)
        /* Damos esta escritura por perdida, pero su ACK todavia puede llegar
           tarde. Si llega, no puede quedar disponible para el reintento que el
           usuario esta por hacer -- que es la reaccion natural a leer
           "sin confirmar" --, porque lo confirmaria con la respuesta de una
           escritura anterior. La deuda se anota sin excepciones: esta escritura
           puede producir su propio ACK tardio, y esa posibilidad es exactamente
           lo que la deuda representa. */
        anotarDeuda(nodo, parametro)
        rechazar(new Error(`El amplificador no confirmó ${parametro}`))
      }, ESPERA_ACK)
      entrada = { nodo, parametro, resolver, rechazar, temporizador }
      pendientes.push(entrada)
    })
    try {
      await dispositivo.sendReport(0, empaquetar(mensajePonerParametro(nodo, parametro, valor)))
    } catch (err) {
      // Este sendReport fallo despues de haber empujado la entrada a
      // pendientes. Si la dejamos ahi, sigue viva hasta que su propio
      // setTimeout la rechace a los 2s (un unhandled rejection, porque
      // `promesa` no se devuelve y nadie la sostiene), y mientras tanto un
      // reintento del usuario para el mismo (nodo, parametro) -- interaccion
      // perfectamente normal -- puede hacer que alRecibir encuentre esta
      // entrada vieja primero (busca por findIndex, se queda con la primera
      // coincidencia) y le entregue el ACK del reintento, dejando al
      // reintento real esperando un ACK que ya se gasto. Por eso se saca la
      // entrada por referencia -- no por (nodo, parametro): buscar por esa
      // clave tiene el mismo problema de "primera coincidencia" y podria
      // sacar la entrada de otro pedido igual que si este en curso -- y se
      // le cancela el timeout antes de relanzar. No rechazamos `promesa` a
      // mano: como nadie la sostiene, rechazarla produciria el mismo
      // unhandled rejection que estamos evitando; queda pendiente y sin
      // referencias, que es justamente lo que buscamos.
      const i = pendientes.indexOf(entrada)
      if (i >= 0) pendientes.splice(i, 1)
      clearTimeout(entrada.temporizador)
      /* Y se le anota su deuda, igual que a una escritura vencida. Que
         sendReport rechace no prueba que el equipo no haya recibido nada: dice
         que la transferencia no se pudo confirmar, no que no haya salido. Bajo
         la regla de la casa -- sin confirmacion no se afirma nada -- esta
         escritura queda abandonada con un ACK tardio posible, que sin la deuda
         confirmaria falsamente al reintento. Cuesta casi nada: un sendReport
         que falla suele ser el equipo yendose, y desconectar() limpia el mapa
         entero. */
      anotarDeuda(nodo, parametro)
      throw err
    }
    return promesa
  },
}
