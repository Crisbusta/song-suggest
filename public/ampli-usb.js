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

function alRecibir(e) {
  const mensaje = reensamblador.recibir(new Uint8Array(e.data.buffer))
  if (!mensaje) return
  const r = interpretar(mensaje)
  if (r.tipo !== 'ackParametro') return
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
  try {
    await dev.open()
    reensamblador.reiniciar()
    await dev.sendReport(0, empaquetar(SYNC_BEGIN))
  } catch (err) {
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
      if (!dev) throw new Error('No elegiste ningún amplificador.')
      try {
        await abrir(dev)
      } catch (err) {
        // El caso mas probable con diferencia: el equipo acepta un solo cliente.
        const exclusivo = /exclusive|already open|in use/i.test(err.message)
        throw new Error(exclusivo
          ? 'El amplificador ya está en uso. Cierra Fender Tone LT Desktop y vuelve a intentar.'
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
      throw err
    }
    return promesa
  },
}
