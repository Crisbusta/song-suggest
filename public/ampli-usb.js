/* ---------------------------------------------------------------------------
   Conexion con el Fender Mustang LT25 por WebHID.

   Solo el ciclo de vida: permiso, apertura, handshake, heartbeat y espera de
   ACK. Todo el formato de mensajes vive en fender-protocolo.js, que si esta
   cubierto por tests.
   --------------------------------------------------------------------------- */
import {
  empaquetar, crearReensamblador, interpretar,
  SYNC_BEGIN, SYNC_END, HEARTBEAT, mensajePonerParametro,
  mensajePedirPreset, mensajeReemplazarNodo, mensajePedirRanura, mensajeGuardarEn,
} from './fender-protocolo.js'

const VENDOR = 0x1ed8, PRODUCT = 0x0037
const ESPERA_ACK = 2000        // ms antes de dar por perdida una escritura
const ESPERA_PRESET = 4000     // el preset viaja en varios paquetes; tarda mas que un ACK
/* Reemplazar una unidad DSP (incluido el modelo de ampli) es mas pesado que
   fijar un parametro: carga un nodo entero, no un solo valor. Con ESPERA_ACK
   (2s) un ACK que tarda un poco mas hace vencer la operacion, anota una
   deuda, y esa deuda se come el ACK del reintento -- que si funciono --
   reportandolo tambien como "sin confirmar". El costo de ser generoso es
   solo tardar mas en reportar un fallo real; el de quedarse corto es
   reportar como fallida una operacion que si ocurrio, que es peor. Medido en
   una sola muestra contra el equipo: el replaceNode del slot `amp` respondio
   dentro de 1,8s, pero una muestra no alcanza para confiar en el margen
   angosto de ESPERA_ACK. */
const ESPERA_REEMPLAZO = 4000
/* Leer una ranura guardada (retrievePreset, 105) es, por definicion, la misma
   familia de mensaje que leer el preset activo (currentPresetRequest, 104):
   una consulta que devuelve el preset completo en varios paquetes. No hay
   ninguna medicion propia contra el equipo -- el Step 4 de esta tarea que la
   mide quedo fuera de alcance a proposito, sin hardware -- asi que se reusa
   el mismo margen que ya se midio para la consulta hermana en vez de
   inventar uno. */
const ESPERA_RANURA = ESPERA_PRESET
/* Guardar (saveCurrentPresetTo, 54) escribe en almacenamiento persistente de
   la ranura, no en un nodo en memoria: es plausible que tarde mas que
   reemplazarUnidad (ESPERA_REEMPLAZO), que solo mide una escritura en RAM. No
   hay ninguna muestra contra el equipo real -- esta operacion nunca se
   probo, a proposito (ver el docblock de guardarEn) -- asi que el margen es
   una decision, no una medicion: al doble de ESPERA_REEMPLAZO, siguiendo la
   misma logica que ya justifica VENTANA_DESCARTE mas abajo. Reportar de
   menos ("no confirmó" sobre un guardado que sí ocurrió) es tolerable;
   reportar de mas sobre la unica operacion irreversible del proyecto no lo
   es, asi que el margen generoso importa aca mas que en cualquier otro lado.
   Debe recalibrarse con una medicion real en el Step 6 de esta tarea. */
const ESPERA_GUARDAR = 8000
const LATIDO = 1000            // el equipo cierra la conexion sin heartbeat

let dispositivo = null
let conectando = false        // hay un conectar()/reconectarSiSePuede() en curso
let latido = null
let reensamblador = null
const pendientes = []          // { nodo, parametro, resolver, rechazar, temporizador }
/* Espera de replaceNodeStatus. Correlaciona por nodo (la ranura: 'amp',
   'stomp', 'mod', 'delay', 'reverb'): el equipo no manda mas identificador
   que ese, junto con el FenderId que quedo puesto. Misma limitacion de fondo
   que `pendientes` -- sin identificador de correlacion, ver el comentario
   largo de `descartar` mas abajo -- asi que lleva la misma defensa de deuda,
   en `descartarNodo`. */
const pendientesNodo = []      // { nodo, resolver, rechazar, temporizador }
/* Espera de CurrentPresetStatus. No hace falta clave: el equipo responde en
   el mismo orden en que le llegan los pedidos (un solo cable, un solo canal),
   asi que un FIFO simple alcanza -- a diferencia de los ACK de parametro y de
   nodo, leer el preset no "confirma" una escritura con un valor que podria
   ser el de otra: es una consulta, y peor que le llegue tarde es que le
   llegue el preset de un pedido abandonado en vez del propio, lo cual solo
   pasa si el preset cambio en el medio. */
const pendientesPreset = []    // { resolver, rechazar, temporizador }
/* Espera de presetJSONMessage (respuesta a retrievePreset, 105). A
   DIFERENCIA de pendientesPreset (que es un FIFO simple, ver su comentario
   arriba), esto SI necesita correlacionarse por ranura -- ronda de revision
   de esta tarea, reproducido con un dispositivo simulado: una respuesta
   tardia de una lectura de ranura ABANDONADA describe OTRA ranura, no una
   version vieja de la MISMA, asi que un FIFO le entregaria a la lectura
   siguiente el contenido de una ranura distinta a la pedida -- y esto
   alimenta la unica operacion irreversible del proyecto (el usuario ve "la
   ranura 60 tiene X" con el X de otra ranura, y confirma un guardado sobre
   un preset que nunca vio).

   No hace falta un mapa de deuda como el de pendientesGuardado, mas abajo,
   pero el argumento tiene un limite y hay que decirlo con precision: una
   respuesta tardia de la ranura N sigue describiendo el contenido REAL de
   la ranura N SOLO SI nadie escribio esa ranura entre el pedido abandonado
   y esta respuesta tardia -- y guardarEn() es exactamente esa escritura.
   Si N se guarda de por medio, la respuesta tardia trae el preset ANTERIOR
   al guardado, no una ranura ajena: la propiedad de seguridad de fondo se
   sostiene (sigue siendo la ranura correcta, nunca otra), pero lo que se ve
   puede estar desactualizado. Ronda de revision de esta tarea: no cambia el
   mecanismo (una lectura no arriesga confirmar de mas, que es lo que la
   deuda existe para evitar), pero el alcance del argumento es ese y no mas.
   Sigue habiendo una precondicion: no puede haber dos llamadas a
   leerRanura() vivas a la vez, porque comparten `reensamblador` con
   leerPreset()/reemplazarUnidad() y reiniciarlo a mitad de una transferencia
   descartaria lo que llevaba juntado -- pero esa precondicion ya no es lo
   que hace segura la correlacion, es la correlacion por ranura la que lo
   hace. */
const pendientesRanura = []    // { ranura, resolver, rechazar, temporizador }
/* Espera de presetSavedStatus (respuesta a saveCurrentPresetTo, 54). A
   diferencia de las lecturas de arriba, esto SI confirma una escritura -- la
   unica irreversible del proyecto -- asi que se correlaciona por ranura
   (el unico dato que el equipo devuelve) igual que pendientesNodo se
   correlaciona por nodo, y lleva la misma deuda (anotarDeudaGuardar, mas
   abajo) para que el ACK atrasado de un intento abandonado no confirme
   falsamente un reintento sobre la misma ranura. */
const pendientesGuardado = []  // { ranura, resolver, rechazar, temporizador }
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
   normal.

   Ojo con la premisa de arriba, "como mucho UN ACK todavia en el aire" por
   escritura abandonada: eso es una suposicion sobre el equipo, no un hecho
   medido. Vale porque asumimos que el amplificador solo emite un
   `ackParametro` como respuesta a una escritura nuestra. Si en algun momento
   emitiera uno que ninguna escritura nuestra provoco -- girar una perilla
   fisica, recargar un preset, mandar dos status por cada set -- ese ACK
   entraria por el lado del equipo en vez del lado del reintento: se comeria
   una deuda ajena, o resolveria de una una entrada pendiente que el equipo
   todavia no confirmo. Es el mismo problema de fondo (falta un identificador
   de correlacion) y este mecanismo no lo cierra para ese caso. Si alguna vez
   aparece una confirmacion falsa inexplicable, es aca donde hay que mirar
   primero. */
const descartar = new Map()    // clave -> ms de caducidad de cada deuda, en orden creciente
/* Por que 2 * ESPERA_ACK y no mas: agrandar la ventana aleja el escape (un ACK
   que llega mas tarde que eso, con una entrada viva de la misma clave justo en
   ese instante), pero lo mide contra lo que se observo -- todo responde en
   ~1,4 s y el modo de falla conocido del equipo es el silencio total, no la
   lentitud -- asi que ese escape ya es remoto con el doble. Y agrandarla tiene
   un costo en el camino comun: reintentar es la reaccion natural a leer "sin
   confirmar", y una ventana mas ancha reporta ese reintento -- que suele
   funcionar -- como no confirmado durante toda esa ventana. A 2x, la molestia
   dura menos que la paciencia de quien reintenta, y el escape sigue exigiendo
   un ACK mas de 3x fuera de plazo (>6s cuando ESPERA_ACK son 2s). */
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

/* Misma deuda que la de arriba, pero para replaceNodeStatus: reemplazarUnidad
   tiene el mismo problema de fondo que ponerParametro -- sin identificador de
   correlacion, un ACK atrasado de un intento abandonado (por ejemplo, elegir
   un modelo de ampli, que tarda, y reintentar) puede confirmar falsamente el
   intento siguiente sobre el mismo nodo -- asi que lleva la misma defensa.
   Va en un mapa aparte, no en `descartar`, porque se cuenta por nodo solo:
   replaceNodeStatus no trae parametro. */
const descartarNodo = new Map()   // nodo -> ms de caducidad de cada deuda, en orden creciente
function anotarDeudaNodo(nodo) {
  const lista = descartarNodo.get(nodo)
  const vence = Date.now() + VENTANA_DESCARTE
  if (lista) lista.push(vence)
  else descartarNodo.set(nodo, [vence])
}

/* Misma deuda otra vez, ahora para presetSavedStatus: guardarEn tiene el
   mismo problema de fondo que reemplazarUnidad -- sin identificador de
   correlacion propio, solo la ranura que el equipo devuelve -- asi que un
   reintento (la reaccion natural a un "no confirmó") puede recibir el ACK
   atrasado del intento anterior sobre la misma ranura. Se cuenta por ranura,
   igual que descartarNodo cuenta por nodo. Esta es la unica operacion
   irreversible del proyecto: la deuda importa aca mas que en cualquier otro
   lado, porque la alternativa -- confirmar de mas -- no se puede deshacer. */
const descartarGuardar = new Map()   // ranura -> ms de caducidad de cada deuda, en orden creciente
function anotarDeudaGuardar(ranura) {
  const lista = descartarGuardar.get(ranura)
  const vence = Date.now() + VENTANA_DESCARTE
  if (lista) lista.push(vence)
  else descartarGuardar.set(ranura, [vence])
}

/* Las deudas caducan solas: un ACK que no llega nunca dejaria esa clave
   envenenada para siempre, y todo reintento posterior sobre esa perilla se
   reportaria como no confirmado. Se purga con cada mensaje que entra. Como
   VENTANA_DESCARTE es igual para todas, cada lista queda ordenada por
   caducidad y basta sacar del frente. Purga los tres mapas -- `descartar`,
   `descartarNodo` y `descartarGuardar` -- por la misma razon: ninguno se
   limpia solo. */
function purgarDescartes() {
  const ahora = Date.now()
  for (const mapa of [descartar, descartarNodo, descartarGuardar]) {
    for (const [k, lista] of mapa) {
      while (lista.length && lista[0] <= ahora) lista.shift()
      if (!lista.length) mapa.delete(k)
    }
  }
}

function alRecibir(e) {
  const mensaje = reensamblador.recibir(new Uint8Array(e.data.buffer))
  if (!mensaje) return
  purgarDescartes()
  const r = interpretar(mensaje)
  if (r.tipo === 'presetActivo') {
    const p = pendientesPreset.shift()
    if (!p) return
    clearTimeout(p.temporizador)
    p.resolver({ preset: r.preset, ranura: r.ranura, editado: r.editado })
    return
  }
  if (r.tipo === 'ackNodo') {
    /* Misma logica que la deuda de ackParametro, mas abajo: si al nodo le
       queda una deuda vigente, este ACK puede ser el rezagado de un intento
       abandonado y no hay como distinguirlo del de la escritura viva. */
    const deudasNodo = descartarNodo.get(r.nodo)
    if (deudasNodo) {
      deudasNodo.shift()
      if (!deudasNodo.length) descartarNodo.delete(r.nodo)
      return
    }
    const i = pendientesNodo.findIndex(p => p.nodo === r.nodo)
    if (i < 0) return
    const [p] = pendientesNodo.splice(i, 1)
    clearTimeout(p.temporizador)
    /* Un replaceNodeStatus truncado deja fenderId en null (ver interpretar()
       en fender-protocolo.js). Bajo la regla de la casa -- sin confirmacion
       no se afirma nada --, un id nulo no es una confirmacion de que unidad
       quedo puesta: se rechaza en vez de resolver con un valor que miente
       por omision. */
    if (r.fenderId == null) p.rechazar(new Error(`El amplificador confirmó el cambio de ${r.nodo} sin decir qué unidad quedó puesta`))
    else p.resolver(r.fenderId)
    return
  }
  if (r.tipo === 'presetDeRanura') {
    // Correlacionado por ranura, NO por FIFO -- ver el comentario largo de
    // pendientesRanura, mas arriba, sobre por que esto es distinto de
    // 'presetActivo'. Una ranura null (mensaje truncado) no calza con
    // ninguna entrada real -- todas se crean con un numero -- asi que cae
    // en el `if (i < 0) return` de abajo, igual que cualquier respuesta que
    // no es la que se esperaba: se trata como falta de confirmacion.
    const i = pendientesRanura.findIndex(p => p.ranura === r.ranura)
    if (i < 0) return
    const [p] = pendientesRanura.splice(i, 1)
    clearTimeout(p.temporizador)
    p.resolver({ preset: r.preset, ranura: r.ranura })
    return
  }
  if (r.tipo === 'ackGuardado') {
    /* Misma logica que la deuda de ackNodo, arriba: si a esta ranura le
       queda una deuda vigente, este ACK puede ser el rezagado de un intento
       de guardado abandonado y no hay como distinguirlo del de la escritura
       viva. Con la unica operacion irreversible del proyecto de por medio,
       tragarselo es la unica opcion honesta. */
    const deudasGuardar = descartarGuardar.get(r.ranura)
    if (deudasGuardar) {
      deudasGuardar.shift()
      if (!deudasGuardar.length) descartarGuardar.delete(r.ranura)
      return
    }
    const i = pendientesGuardado.findIndex(p => p.ranura === r.ranura)
    if (i < 0) return
    const [p] = pendientesGuardado.splice(i, 1)
    clearTimeout(p.temporizador)
    // Una ranura que no calza con la pedida -- incluida la null de un
    // presetSavedStatus truncado (ver interpretar() en fender-protocolo.js)
    // -- ya se descarto arriba, en el `if (i < 0) return`: el findIndex
    // busca exactamente `r.ranura`, asi que solo se llega aca cuando
    // coincide. En efecto, cualquier ranura que no es la pedida se trata
    // como falta de confirmacion, igual que un timeout -- nunca como un
    // guardado confirmado sobre datos que no se pidieron.
    p.resolver({ nombre: r.nombre, ranura: r.ranura })
    return
  }
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
   silencio absoluto. Un SYNC_BEGIN nuevo la destraba. La regla nunca fue "no
   leer el preset" sino "no dejar la sesion trabada": leerPreset(), mas abajo,
   destraba ella misma antes de devolver el control, asi que quien la llama no
   tiene que saber nada de esto. */
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
  for (const p of pendientesNodo.splice(0)) { clearTimeout(p.temporizador); p.rechazar(new Error('se corto la conexion')) }
  for (const p of pendientesPreset.splice(0)) { clearTimeout(p.temporizador); p.rechazar(new Error('se corto la conexion')) }
  for (const p of pendientesRanura.splice(0)) { clearTimeout(p.temporizador); p.rechazar(new Error('se corto la conexion')) }
  for (const p of pendientesGuardado.splice(0)) { clearTimeout(p.temporizador); p.rechazar(new Error('se corto la conexion')) }
  // La sesion siguiente empieza limpia: ningun ACK de la anterior puede
  // sobrevivir al cierre, asi que arrastrar deudas viejas solo lograria
  // reportar como no confirmadas escrituras nuevas que si funcionaron.
  descartar.clear()
  descartarNodo.clear()
  descartarGuardar.clear()
  if (dev) {
    // El listener se saca ANTES del SYNC_END: mientras ese await esta en
    // vuelo el listener seguiria atado, y un ACK que llegara justo en esa
    // ventana se procesaria con `pendientes` y `descartar` ya limpios de
    // arriba. Practicamente inalcanzable -- cerrar el dispositivo descarta
    // los reportes encolados --, pero el orden correcto no cuesta nada.
    dev.removeEventListener('inputreport', alRecibir)
    try { await dev.sendReport(0, empaquetar(SYNC_END)) } catch { /* ya se fue */ }
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

/* ---------------------------------------------------------------------------
   Turno exclusivo de las operaciones que le hablan al equipo.

   Todo el estado de mas arriba -- `reensamblador`, las listas de pendientes,
   los mapas de deuda -- es estado de MODULO, y desde que existe el editor hay
   dos llamadores que lo comparten sin poder verse entre si: public/app.js (el
   envio de la tarjeta, con su guarda `enviando`) y public/editor.js (con la
   suya, `operando`). Cada guarda serializa a su propio llamador y ninguna sabe
   de la otra. Reproducido con un dispositivo falso, en las dos direcciones:

   - Una escritura que arranca a mitad de la transferencia multi-paquete de
     leerPreset() llama a reensamblador.reiniciar() y le tira lo acumulado: la
     lectura muere por su propio timeout, segundos despues, sin ninguna razon
     visible en pantalla.
   - Un ACK de parametro que llega entre el primer paquete del preset y el
     ultimo entra en el reensamblador con la secuencia ABIERTA: se lo toma por
     terminador y se lo pega al preset. La escritura se reporta "sin confirmar"
     sobre una perilla que el equipo SI movio -- la mentira exacta contra la
     que existe todo este diseño, solo que al reves --, la lectura tambien
     falla, y encima queda una deuda que se come el ACK del reintento.

   Por eso la exclusion vive aca y no en una tercera guarda del lado del
   llamador: la precondicion pasa a ser una propiedad del estado que protege,
   en vez de un contrato delegado a llamadores que no pueden coordinarse. Las
   guardas de app.js y editor.js se quedan como estan -- sirven para la
   interfaz, que necesita saber cuando deshabilitar controles --, pero dejan de
   ser la unica defensa.

   Se ENCOLA, no se rechaza: que el envio de la tarjeta este en curso no puede
   hacer fallar la lectura del editor, solo retrasarla. El orden es el de
   llamada (FIFO), que es el que el usuario espera.

   El turno cubre la ESPERA, no solo el envio: `enTurno` adopta lo que devuelve
   la operacion, asi que el eslabon siguiente no arranca hasta que el equipo
   confirmo -- o hasta que vencio el plazo. Soltarlo al terminar el sendReport
   no serviria de nada: la ventana peligrosa es justo la espera.

   Y liberarlo no depende de que ningun camino se acuerde de bajar una bandera:
   `cola` se reasigna en el mismo instante en que se encola, y ese eslabon se
   traga el rechazo, asi que una operacion que lanza -- o que espera un ACK que
   nunca llega y vence -- deja pasar a la siguiente igual. Es el `finally` que
   hace falta, sin la bandera que algun camino podria olvidar.

   Lo que queda AFUERA del turno, a proposito:

   - desconectar(), que es la que corta todo. Encolarla detras de una operacion
     que quiza nunca termine seria peor que la carrera que esto arregla. Y no
     hace falta: rechaza todos los pendientes, asi que la operacion que tenga
     el turno se cae sola y lo suelta, y las que estaban encoladas arrancan y
     mueren en su primera linea, la que exige `dispositivo`.
   - conectar() y reconectarSiSePuede(), por el mismo motivo de fondo: tampoco
     pueden quedar esperando a una operacion ajena. No comparten el estado
     protegido (abrir() arma un `reensamblador` nuevo), y ya se serializan
     entre ellas con `conectando`.
   --------------------------------------------------------------------------- */
let cola = Promise.resolve()

function enTurno(operacion) {
  const turno = cola.then(operacion)
  /* El eslabon que encadena al siguiente se traga el resultado, bueno o malo:
     `cola` no puede quedar rechazada -- seria un unhandled rejection, y ademas
     saltearia la operacion siguiente. Quien llamo recibe `turno` tal cual, con
     su error si lo hubo. */
  cola = turno.then(() => {}, () => {})
  return turno
}

/* Cierra el modo sync. Cada escritura lo abre con SYNC_BEGIN, y mientras este
   abierto el amplificador muestra en su pantalla "sync with Fender Tone" en
   vez del preset. Se cierra al terminar la tanda para que el equipo vuelva a
   su pantalla normal; la siguiente tanda lo reabre sola, que es lo que
   ponerParametro ya hace por cada perilla.
   No lanza: que la pantalla quede en sync es un detalle cosmetico y no tiene
   por que hacer fracasar un envio que si funciono.

   Tambien pasa por el turno, aunque no toque el reensamblador ni ninguna lista
   de pendientes: lo que toca es el estado de sync DEL EQUIPO, que es
   exactamente de lo que dependen las otras cinco. Un SYNC_END de app.js (su
   `finally { await ampli.cerrarSync() }`) que caiga en el hueco entre el
   SYNC_BEGIN habilitador de una lectura del editor y su pedido real puede
   dejar ese pedido en silencio, y la lectura vence sin motivo visible. El
   editor ya se defiende de su PROPIO cierre -- la guarda `!operando` de
   alTerminar dice justamente esto -- pero no tiene forma de defenderse del de
   app.js. El turno cuesta poco aca: esta operacion no espera ninguna
   confirmacion, y no puede trabarse porque ninguna de las otras la llama. */

async function opCerrarSync() {
  if (!dispositivo) return
  try { await dispositivo.sendReport(0, empaquetar(SYNC_END)) } catch { /* se fue el equipo */ }
}

/* Escribe un parametro y espera la confirmacion del equipo.
   El amplificador ignora en silencio lo que no entiende, asi que sin ACK no
   hay ninguna garantia de que algo haya cambiado: esta funcion rechaza en vez
   de mentir.

   No puede haber dos llamadas vivas a la vez para la misma (nodo, parametro):
   alRecibir() busca el ACK con findIndex por esa clave y se queda con la
   primera coincidencia, asi que una segunda escritura sobre la misma perilla
   mientras la primera todavia espera su ACK podria resolver la entrada
   equivocada. Eso ya NO es una precondicion delegada al llamador. Lo era
   cuando app.js era el unico que llamaba aca -- y esa nota quedo mintiendo
   apenas aparecio el segundo llamador, el despachador de public/editor.js --;
   hoy lo garantiza el turno de `enTurno`, que serializa esta funcion consigo
   misma y con las otras cinco, cubriendo tambien la espera del ACK. Un control
   que mande la perilla mientras el usuario la arrastra no rompe la garantia:
   se encola. */

async function opPonerParametro(nodo, parametro, valor) {
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  /* Medido contra el equipo: cada SYNC_BEGIN habilita UNA sola escritura; la
     segunda y las siguientes caen en silencio. Reenviarlo antes de cada
     parametro es lo que permite mandar las tres perillas. No hace falta
     SYNC_END: basta con volver a abrir el sync. */
  reensamblador.reiniciar()
  await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
  /* Entre la guarda de arriba y este punto hay un await: el equipo se puede
     desenchufar justo ahi. Si eso pasa, desconectar() corre entero mientras
     seguimos esperando -- incluido su descartar.clear() -- y `dispositivo`
     queda en null antes de que retomemos. Sin este segundo chequeo,
     seguiriamos de largo y creariamos una entrada y una deuda para una
     sesion que ya termino: al reconectar, esa deuda huerfana se comeria el
     primer ACK legitimo de la sesion nueva, reportando "sin confirmar" una
     perilla que el ampli si aplico. */
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
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
}

/* Lee el preset activo completo. Llega en varios paquetes: el
   reensamblador ya los junta.

   Pedir el preset TRABA las escrituras del resto de la sesion -- medido
   contra el equipo -- y un SYNC_BEGIN nuevo las destraba. La regla nunca
   fue "no leer" sino "no dejar la sesion trabada", asi que destrabar es
   responsabilidad de esta funcion y no de quien la llama. Va en un
   `finally` para que tambien destrabe cuando la lectura falla o se cae por
   el timeout: sin esto, toda escritura posterior a la primera lectura de
   preset se perderia en silencio, indistinguible de un equipo
   desconectado.

   El SYNC_BEGIN de aca abajo, antes de pedir el preset, es una habilitacion
   distinta de la del finally: cada SYNC_BEGIN habilita UNA sola operacion,
   asi que si hubo una escritura antes en la sesion, ese permiso ya esta
   gastado y pedir el preset sin reabrirlo puede caer en silencio. Medido
   contra el equipo: todas las lecturas que funcionaron en las pruebas
   mandaron SYNC_BEGIN justo antes de mensajePedirPreset(); no hay ninguna
   medicion de una lectura sin sync previo.

   Los llamadores son montarEditor() y el flujo de guardado de
   public/editor.js. No tienen que garantizar nada: esta funcion comparte
   `reensamblador` con leerRanura(), reemplazarUnidad(), guardarEn() y
   ponerParametro(), y reiniciarlo a mitad de esta transferencia -- que no es
   de uno o dos paquetes sino de varios segundos -- tiraria lo acumulado, pero
   de eso se ocupa el turno de `enTurno`. Ese `reiniciar()` corre DENTRO del
   turno, no antes de tomarlo. */

async function opLeerPreset() {
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  reensamblador.reiniciar()
  try {
    await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
    // Entre la guarda de arriba y este punto hay un await: mismo motivo
    // que en ponerParametro, el equipo se puede desenchufar justo ahi.
    if (!dispositivo) throw new Error('El amplificador no está conectado.')
    let entrada
    const promesa = new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        const i = pendientesPreset.indexOf(entrada)
        if (i >= 0) pendientesPreset.splice(i, 1)
        rechazar(new Error('El amplificador no mandó el preset'))
      }, ESPERA_PRESET)
      entrada = { resolver, rechazar, temporizador }
      pendientesPreset.push(entrada)
    })
    try {
      await dispositivo.sendReport(0, empaquetar(mensajePedirPreset()))
    } catch (err) {
      // Mismo motivo que en ponerParametro: si no se saca la entrada de
      // aca, queda viva hasta que la gaste su propio timeout (un
      // unhandledRejection, porque `promesa` no se devuelve y nadie la
      // sostiene) y mientras tanto una lectura siguiente la encontraria
      // primero en la FIFO -- pendientesPreset.shift() le entregaria a
      // esta entrada huerfana el preset que le llego a la lectura nueva,
      // y la lectura nueva se quedaria esperando sus 4s completos sin
      // motivo. Sin deuda: a diferencia de un ACK de parametro o de nodo,
      // esto no arriesga confirmar de mas -- es una consulta, no la
      // confirmacion de un valor -- asi que alcanza con sacarla.
      const i = pendientesPreset.indexOf(entrada)
      if (i >= 0) pendientesPreset.splice(i, 1)
      clearTimeout(entrada.temporizador)
      throw err
    }
    return await promesa
  } finally {
    // Destraba, pase lo que pase. No lanza: si el equipo ya se fue, no hay
    // nada que destrabar y no tiene sentido que ese sendReport tape el
    // error real de la lectura.
    try { await dispositivo?.sendReport(0, empaquetar(SYNC_BEGIN)) } catch { /* se fue el equipo */ }
  }
}

/* Lee el preset GUARDADO en una ranura del equipo (retrievePreset, 105) --
   no el activo en memoria. No es destructiva: solo consulta, igual que
   leerPreset(). Es la lectura que el flujo de guardado necesita para
   mostrarle al usuario que preset va a pisar antes de que confirme, y la
   unica lectura de ranura que existe en este modulo (navegar o cargar
   otros presets guardados esta fuera de alcance, ver la spec).

   Misma forma que leerPreset(), a proposito -- ver el docblock de arriba
   -- incluido el `finally` que reenvia SYNC_BEGIN: se asume que pedir una
   ranura traba la sesion igual que pedir el preset activo, porque las dos
   son la misma familia de mensaje (una consulta que devuelve el preset
   completo, multi-paquete). Esto NO esta medido contra el equipo -- el
   Step 4 de esta tarea, que lo mide, quedo fuera de alcance sin hardware
   -- asi que es la asuncion mas conservadora, no un hecho verificado.

   A diferencia de leerPreset(), lo que devuelve no trae `editado`: la
   respuesta a retrievePreset (presetJSONMessage, 31) no tiene ese campo en
   su definicion -- el estado "editado sin guardar" solo tiene sentido para
   el preset activo en memoria, no para uno guardado en una ranura.

   El llamador es el dialogo de guardado de public/editor.js, y no tiene que
   garantizar nada: la serializacion con las otras cuatro la impone el turno
   de `enTurno`. */

async function opLeerRanura(indice) {
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  reensamblador.reiniciar()
  try {
    await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
    // Mismo motivo que en leerPreset(): el equipo se puede desenchufar
    // durante el await de arriba.
    if (!dispositivo) throw new Error('El amplificador no está conectado.')
    let entrada
    const promesa = new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        const i = pendientesRanura.indexOf(entrada)
        if (i >= 0) pendientesRanura.splice(i, 1)
        rechazar(new Error(`El amplificador no mandó la ranura ${indice}`))
      }, ESPERA_RANURA)
      entrada = { ranura: indice, resolver, rechazar, temporizador }
      pendientesRanura.push(entrada)
    })
    try {
      await dispositivo.sendReport(0, empaquetar(mensajePedirRanura(indice)))
    } catch (err) {
      // Mismo motivo que en leerPreset(): se saca por referencia para no
      // dejar una entrada huerfana que se coma la respuesta de una
      // lectura de ranura posterior.
      const i = pendientesRanura.indexOf(entrada)
      if (i >= 0) pendientesRanura.splice(i, 1)
      clearTimeout(entrada.temporizador)
      throw err
    }
    return await promesa
  } finally {
    // Destraba, pase lo que pase -- mismo motivo que en leerPreset().
    try { await dispositivo?.sendReport(0, empaquetar(SYNC_BEGIN)) } catch { /* se fue el equipo */ }
  }
}

/* Cambia la unidad de una ranura -- incluido `amp`, que es como se cambia
   el modelo de amplificador. Espera la confirmacion del equipo y devuelve
   el FenderId que el equipo dice que quedo puesto, no el que se pidio: son
   iguales cuando todo sale bien, pero es la respuesta del equipo la que
   cuenta.

   Igual que las perillas: cada SYNC_BEGIN habilita una sola operacion, asi
   que se reenvia antes de cada pedido. Y la misma limitacion de fondo que
   ponerParametro -- sin identificador de correlacion, un ACK atrasado de un
   intento abandonado podria confirmar falsamente el siguiente -- asi que
   lleva la misma defensa de deuda (anotarDeudaNodo), no solo el ACK feliz.

   Usa ESPERA_REEMPLAZO, no ESPERA_ACK: reemplazar una unidad DSP carga un
   nodo entero, no un solo valor, y es mas pesado que una perilla -- ver el
   comentario de la constante.

   El llamador es el <select> de unidades de public/editor.js. No tiene que
   garantizar nada: comparte `reensamblador` con las lecturas, y reiniciarlo a
   mitad de una de ellas descartaria lo que llevaban juntado, pero de eso se
   ocupa el turno de `enTurno`. */

async function opReemplazarUnidad(nodo, fenderId) {
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  reensamblador.reiniciar()
  await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
  // Mismo motivo que en ponerParametro: el equipo se puede desenchufar
  // durante el await de arriba.
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  let entrada
  const promesa = new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      const i = pendientesNodo.indexOf(entrada)
      if (i >= 0) pendientesNodo.splice(i, 1)
      anotarDeudaNodo(nodo)
      rechazar(new Error(`El amplificador no confirmó el cambio de ${nodo}`))
    }, ESPERA_REEMPLAZO)
    entrada = { nodo, resolver, rechazar, temporizador }
    pendientesNodo.push(entrada)
  })
  try {
    await dispositivo.sendReport(0, empaquetar(mensajeReemplazarNodo(nodo, fenderId)))
  } catch (err) {
    // Mismo motivo que en ponerParametro: se saca por referencia, no por
    // nodo, y se le anota la deuda antes de relanzar.
    const i = pendientesNodo.indexOf(entrada)
    if (i >= 0) pendientesNodo.splice(i, 1)
    clearTimeout(entrada.temporizador)
    anotarDeudaNodo(nodo)
    throw err
  }
  return promesa
}

/* Guarda el tono actual en una ranura del equipo (saveCurrentPresetTo, 54).

   ES LA UNICA OPERACION IRREVERSIBLE DE TODO EL PROYECTO: pisa lo que haya
   en esa ranura sin posibilidad de deshacer, y este mensaje NUNCA se probo
   contra el equipo real -- la prueba (Step 6 de la tarea que agrega esta
   funcion) requiere al usuario y al amplificador delante, y quedo fuera de
   alcance a proposito. Todo lo de aca abajo sigue la regla de la casa --
   nunca declarar exito sin confirmacion -- pero esa regla protege contra
   mentir sobre si el equipo confirmo, no contra que el mensaje mismo este
   mal armado; eso solo lo cierra la prueba real.

   Esta funcion NO decide que ranura pisar, ni lee la que hay ahi, ni sabe que
   tono va a quedar escrito: guarda LO QUE ESTE VIVO EN EL EQUIPO en el
   momento en que llega el mensaje, que no tiene por que ser lo que el editor
   muestra -- la rueda del equipo lo puede haber cambiado. Quien la llama es
   responsable de las dos mitades del "mirar antes de pisar": mostrar con
   leerRanura() que se va a pisar, y con leerPreset() que se va a escribir.
   guardarEn() en si mismo no mira nada antes de escribir.

   Espera la confirmacion del equipo (presetSavedStatus, 50) con la misma
   estructura que reemplazarUnidad(): mismo problema de fondo -- sin
   identificador de correlacion propio, solo la ranura que el equipo
   devuelve --, misma defensa de deuda (anotarDeudaGuardar) para que el ACK
   atrasado de un intento abandonado no confirme falsamente un reintento
   sobre la misma ranura. Con la unica operacion irreversible del proyecto
   de por medio, esta defensa importa mas aca que en cualquier otro lado.

   Usa ESPERA_GUARDAR, no ESPERA_REEMPLAZO -- ver el comentario de la
   constante: no hay ninguna medicion real de cuanto tarda escribir en
   almacenamiento persistente, asi que el margen es una decision
   deliberadamente generosa, no un dato medido.

   A diferencia de leerPreset()/leerRanura(), no reenvia SYNC_BEGIN en un
   `finally`: ese trabamiento esta medido solo para las consultas que piden
   un preset completo (currentPresetRequest, retrievePreset), y guardar es,
   como reemplazarUnidad, una escritura -- no hay ninguna razon para
   esperar que trabe la sesion igual. Sigue siendo una suposicion sin
   medir: si el Step 6 de esta tarea encuentra que si traba, hay que
   agregar el mismo `finally` que tiene leerRanura().

   El llamador es el dialogo de guardado de public/editor.js. La
   serializacion con las otras cuatro la impone el turno de `enTurno`, no el
   llamador. */

async function opGuardarEn(indice, nombre) {
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  reensamblador.reiniciar()
  await dispositivo.sendReport(0, empaquetar(SYNC_BEGIN))
  // Mismo motivo que en reemplazarUnidad: el equipo se puede desenchufar
  // durante el await de arriba.
  if (!dispositivo) throw new Error('El amplificador no está conectado.')
  let entrada
  const promesa = new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      const i = pendientesGuardado.indexOf(entrada)
      if (i >= 0) pendientesGuardado.splice(i, 1)
      anotarDeudaGuardar(indice)
      rechazar(new Error(`El amplificador no confirmó el guardado en la ranura ${indice}`))
    }, ESPERA_GUARDAR)
    entrada = { ranura: indice, resolver, rechazar, temporizador }
    pendientesGuardado.push(entrada)
  })
  try {
    await dispositivo.sendReport(0, empaquetar(mensajeGuardarEn(indice, nombre)))
  } catch (err) {
    // Mismo motivo que en reemplazarUnidad: se saca por referencia y se
    // le anota la deuda antes de relanzar.
    const i = pendientesGuardado.indexOf(entrada)
    if (i >= 0) pendientesGuardado.splice(i, 1)
    clearTimeout(entrada.temporizador)
    anotarDeudaGuardar(indice)
    throw err
  }
  return promesa
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

  /* Las cinco operaciones de dispositivo y el cierre de sync pasan SIEMPRE por
     `enTurno`, que es el unico lugar donde se toma el turno: asi no queda
     ningun camino que llegue al estado compartido sin el. Ver el comentario
     largo de `enTurno` mas arriba, y el de cada operacion para lo suyo. */
  cerrarSync: () => enTurno(() => opCerrarSync()),
  ponerParametro: (nodo, parametro, valor) => enTurno(() => opPonerParametro(nodo, parametro, valor)),
  leerPreset: () => enTurno(() => opLeerPreset()),
  leerRanura: indice => enTurno(() => opLeerRanura(indice)),
  reemplazarUnidad: (nodo, fenderId) => enTurno(() => opReemplazarUnidad(nodo, fenderId)),
  guardarEn: (indice, nombre) => enTurno(() => opGuardarEn(indice, nombre)),
}
