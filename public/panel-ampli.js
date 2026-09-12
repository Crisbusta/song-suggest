/* ---------------------------------------------------------------------------
   El HTML del panel del amplificador: la columna derecha.

   Devuelve cadenas y no toca el DOM. Quien lo inserta, escucha el boton y habla
   con el equipo por WebHID es `app.js` con `ampli-usb.js`; aqui no hay
   transporte, solo lo que se ve.

   El panel se dibuja SIEMPRE, incluso sin sugerencia y sin equipo conectado: el
   estado vacio explica por que no hay nada que mandar, que es informacion. Un
   panel que desaparece deja al usuario preguntandose si la app se rompio.
   --------------------------------------------------------------------------- */
import { RANURAS } from './catalogo-lt25.js'
import { esc, resumenEnvioAmpli } from './tarjeta.js'

const perilla = (nombre, valor) =>
  `<div class="perilla"><span class="nombre">${nombre}</span><meter min="0" max="10" value="${esc(valor)}" aria-label="${nombre} ${esc(valor)} de 10"></meter><span class="num">${esc(valor)}</span></div>`

/* Las cuatro perillas que VIAJAN al equipo. El volumen no esta, y no es un
   olvido: el amplificador lo recibe en decibelios, asi que mandarle un 0.4 como
   si fuera "4 de 10" puede ser un salto brutal de nivel. Lo pones tu.

   Una perilla que el preset no declara no se dibuja en vez de dibujarse en
   cero: cero es un valor, y la fuente no lo dijo. */
const perillas = a => [['Gain', a.gain], ['Treble', a.treble], ['Bass', a.bass], ['Mid', a.mid]]
  .filter(([, valor]) => valor != null)
  .map(([nombre, valor]) => perilla(nombre, valor))
  .join('')

/* Las cinco ranuras, siempre las cinco.

   Se recorren desde `RANURAS` y no desde las claves de `a.cadena` porque
   `cadena` SOLO trae las ranuras usadas: las vacias no llegan como null, no
   llegan. Y que una ranura salga "vacía" es justo lo que hay que ver, porque el
   envio la vacia de verdad y borra lo que hubiera dialado a mano ahi.

   `amp` es la excepcion: nunca queda vacia -- no existe un amplificador sin
   modelo -- asi que cuando el preset no lo declara dice "sin cambiar". */
const ranuras = a => RANURAS.map(ranura => {
  const nombre = a.cadena?.[ranura]?.nombre ?? (ranura === 'amp' ? a.modelo : null)
  const texto = nombre ?? (ranura === 'amp' ? 'sin cambiar' : 'vacía')
  return `<li class="${nombre ? 'ocupada' : 'ranura-vacia'}"><span>${ranura}</span><strong>${esc(texto)}</strong></li>`
}).join('')

/* De donde sale este tono. Un preset de la comunidad es OPINION de alguien, no
   una medicion de la grabacion, y el panel lo dice en vez de presentarlo como
   un hecho. */
const procedencia = a => a.fuente === 'propio'
  ? `${esc(a.procedencia)}. Lo elegiste tu: pisa la sugerencia de la pista hasta que sortees otra canción.`
  : a.fuente === 'comunidad'
  ? `${esc(a.procedencia ?? 'Preset de la comunidad')}. Es lo que a alguien le funcionó, no el tono de la grabación.`
  : `Punto de partida, no el tono del disco.${a.motivos?.length ? ` Deducido de: ${a.motivos.map(esc).join(', ')}.` : ''}`

/* La contra, desplegada aparte. No se esconde por incomoda: se guarda plegada
   porque es larga, y quien va a pulsar el boton tiene derecho a leerla antes. */
const queSePisa = a => {
  const reverbSuelto = a.reverb != null && !a.cadena?.reverb
    ? `<p>Reverb ${esc(a.reverb)}/10 es una sugerencia manual: no se envía y este tono vacía esa ranura, incluso si la ajustaste a mano.</p>`
    : ''
  return `<details class="panel-detalles"><summary>Qué se pisa al enviar</summary><p>Las ranuras de efectos que este tono no usa quedan vacías: esto borra lo que hayas ajustado a mano en ellas. Cargar una unidad devuelve sus otras perillas a los valores de fábrica. Tu volumen se lee y se restaura; si no se puede leer, el modelo no cambia.</p>${reverbSuelto}<p>${procedencia(a)}</p></details>`
}

/* La paleta de tonos manuales, siempre a la vista.

   Son doce y no crecen, asi que no se esconden detras de un clic: cuando el
   tono sugerido no pega con lo que suena -- que pasa, porque se deduce de las
   etiquetas de la CANCION y no de lo que toca la pista -- el remedio tiene que
   estar donde ya estas mirando.

   La primera ficha devuelve a la sugerencia automatica y solo aparece cuando
   hay un tono manual puesto: ofrecer "volver" a lo que ya tienes seria ruido. */
const paleta = (tonos, tonoManual) => {
  if (!tonos?.length) return ''
  const fichas = tonos.map(t => {
    const puesto = tonoManual?.clave === t.clave
    return `<button type="button" class="ficha-tono${puesto ? ' puesto' : ''}${t.fuente === 'propio' ? ' propio' : ''}" data-tono="${esc(t.clave)}" aria-pressed="${puesto}" title="${esc(t.modelo ?? '')}">${esc(t.clave)}</button>`
  }).join('')
  const volver = tonoManual
    ? '<button type="button" class="ficha-tono volver" data-tono="">← la sugerencia de la pista</button>'
    : ''
  return `<h3>Tonos</h3><div class="paleta-tonos">${fichas}</div>${volver}`
}

/* `estado` lo pone app.js: si hay equipo conectado, si el boton puede pulsarse,
   que POSICION ocupa la pista elegida en la lista visible -- la misma que
   nombran los atajos 1-9, no su indice en el catalogo -- y la paleta de tonos
   con el que este puesto a mano.

   Un tono manual PISA la sugerencia de la pista: es el objeto que se dibuja y
   el que se manda. Por eso no se lee `pista.ampli` aqui directamente. */
export function pintarPanelAmpli(pista, estado = {}) {
  const a = estado.tonoManual ?? pista?.ampli
  const cabecera = `<div class="panel-cabecera"><h2>Ampli · Mustang LT25</h2><span id="panel-conexion" class="${estado.conectado ? 'conectado' : ''}">${estado.conectado ? 'Ampli conectado' : 'Sin conectar'}</span></div>`

  /* Sin sugerencia la paleta se ofrece IGUAL, y es cuando mas sirve: esta
     pista no trae tono, asi que elegir uno a mano es la unica salida que no
     pasa por el editor. */
  if (!a) {
    return `${cabecera}<div class="panel-vacio"><p>Sin sugerencia de ampli</p><span>Esta pista no trae ajustes para mandar. Elige un tono de abajo, o preparalo en el editor.</span></div>${paleta(estado.tonos, estado.tonoManual)}`
  }

  const dibujadas = perillas(a)
  const modelo = a.modelo != null ? esc(a.modelo) : 'no declarado'

  return `${cabecera}
    <div class="modelo"><span>${estado.tonoManual ? 'Tono elegido por ti' : `Modelo · pista ${esc(estado.posicion ?? 1)}`}</span><strong>${modelo}</strong></div>
    ${paleta(estado.tonos, estado.tonoManual)}
    ${dibujadas ? `<div class="perillas-panel">${dibujadas}</div>` : ''}
    <p class="volumen-nota">Volume no viaja al ampli.</p>
    <h3>Ranuras</h3><ul class="cadena cadena-panel">${ranuras(a)}</ul>
    ${a.incierto ? '<p class="envio-estado mal">La planilla marca este preset como dudoso.</p>' : ''}
    ${queSePisa(a)}
    <div class="panel-envio"><button type="button" id="enviar-ampli" class="enviar-ampli" ${estado.puedeEnviar ? '' : 'disabled'}>Enviar al ampli <kbd>E</kbd></button><p id="envio-estado" class="envio-estado" role="status">Sin enviar todavía</p><p class="descargo">${resumenEnvioAmpli(a).queSeManda}</p></div>`
}
