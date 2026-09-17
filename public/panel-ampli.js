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

/* Las cuatro ranuras de EFECTOS, siempre las cuatro -- `amp` queda afuera de
   esta grilla porque ya se muestra arriba, en `.modelo`: repetirla aca abajo
   era la misma informacion dos veces.

   Se recorren desde `RANURAS` y no desde las claves de `a.cadena` porque
   `cadena` SOLO trae las ranuras usadas: las vacias no llegan como null, no
   llegan. Y que una ranura salga "vacía" es justo lo que hay que ver, porque el
   envio la vacia de verdad y borra lo que hubiera dialado a mano ahi. */
const ranuras = a => RANURAS.filter(r => r !== 'amp').map(ranura => {
  const nombre = a.cadena?.[ranura]?.nombre ?? null
  const texto = nombre ?? 'vacía'
  /* El `title` no es decorativo: con la ficha apretada las cuatro ranuras
     pasan a una sola fila y un nombre largo ("SMALL ROOM") se corta con
     elipsis. Ahi es la unica forma de leerlo entero. */
  return `<li class="${nombre ? 'ocupada' : 'ranura-vacia'}"><span>${ranura}</span><strong title="${esc(texto)}">${esc(texto)}</strong></li>`
}).join('')

/* De donde sale este tono. Un preset de la comunidad es OPINION de alguien, no
   una medicion de la grabacion, y el panel lo dice en vez de presentarlo como
   un hecho. */
const procedencia = a => a.fuente === 'comunidad'
  ? `${esc(a.procedencia ?? 'Preset de la comunidad')}. Es lo que a alguien le funcionó, no el tono de la grabación.`
  : `Punto de partida, no el tono del disco.${a.motivos?.length ? ` Deducido de: ${a.motivos.map(esc).join(', ')}.` : ''}`

/* La contra, desplegada aparte. No se esconde por incomoda: se guarda plegada
   porque es larga, y quien va a pulsar el boton tiene derecho a leerla antes. */
const queSePisa = a => {
  const reverbSuelto = a.reverb != null && !a.cadena?.reverb
    ? `<p>Reverb ${esc(a.reverb)}/10 es una sugerencia manual: no se envía y este tono vacía esa ranura, incluso si la ajustaste a mano.</p>`
    : ''
  /* La frase de "que se manda" entro aca dentro: decia lo mismo que este
     desplegable -- que hace el boton -- y suelta ocupaba tres lineas fijas
     en un panel que no daba abasto. Va primero porque es la promesa; lo que
     sigue son las consecuencias. */
  /* El cuerpo va en su propia caja porque al desplegarse mide mas que la
     ficha entera, y ningun nivel de densidad puede absorber eso. Cuando no
     cabe scrollea ESTA caja, no la columna: el desplegable lo abriste tu y
     el resto del panel se queda donde estaba. */
  return `<details class="panel-detalles"><summary>Qué se manda y qué se pisa</summary><div class="panel-detalles-cuerpo"><p>${resumenEnvioAmpli(a).queSeManda}</p><p>Las ranuras de efectos que este tono no usa quedan vacías: esto borra lo que hayas ajustado a mano en ellas. Cargar una unidad devuelve sus otras perillas a los valores de fábrica. Tu volumen se lee y se restaura; si no se puede leer, el modelo no cambia.</p>${reverbSuelto}<p>${procedencia(a)}</p></div></details>`
}

/* `estado` lo pone app.js: si hay equipo conectado, si el boton puede pulsarse,
   y que POSICION ocupa la pista elegida en la lista visible -- la misma que
   nombran los atajos 1-9, no su indice en el catalogo. */
export function pintarPanelAmpli(pista, estado = {}) {
  const a = pista?.ampli
  const cabecera = `<div class="panel-cabecera"><h2>Ampli · Mustang LT25</h2><span id="panel-conexion" class="${estado.conectado ? 'conectado' : ''}">${estado.conectado ? 'Ampli conectado' : 'Sin conectar'}</span></div>`

  if (!a) {
    return `${cabecera}<div class="panel-vacio"><p>Sin sugerencia de ampli</p><span>Esta pista no trae ajustes para mandar. Puedes preparar tu tono en el editor.</span></div>`
  }

  const dibujadas = perillas(a)
  const modelo = a.modelo != null ? esc(a.modelo) : 'no declarado'
  /* "Ideal para esta pista" no es una medicion: es el tono que esta cancion
     trae asignado, mostrado con confianza SOLO cuando la planilla no lo marco
     como dudoso. Con `incierto`, el aviso rojo de mas abajo ya dice lo que hay
     que decir -- poner las dos frases juntas se contradiria. */
  const ideal = a.modelo != null && !a.incierto ? '<span class="badge-ideal">Ideal para esta pista</span>' : ''

  /* El cabezal es decorativo y vive JUNTO al nombre del modelo, no en un
     bloque aparte: cuando estaba abajo repetia ese mismo nombre en un campo
     "Modelo" y se llevaba 88px de una ficha que ya no daba abasto -- el
     panel desbordaba en 93 de cada 100 canciones. El dato estaba dos veces;
     el sitio, una sola. */
  const cabezal = `<svg class="ampli-icono" width="46" height="52" viewBox="0 0 72 80" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="70" height="78" rx="5" fill="#141414" stroke="#3a3a3a"></rect>
      <rect x="7" y="7" width="58" height="52" rx="3" fill="#0b0b0b"></rect>
      <circle cx="20" cy="20" r="6" fill="#181818" stroke="#333"></circle>
      <circle cx="52" cy="20" r="6" fill="#181818" stroke="#333"></circle>
      <circle cx="36" cy="40" r="11" fill="#181818" stroke="#333"></circle>
      <rect x="7" y="63" width="58" height="3" rx="1.5" fill="#f5a623"></rect>
    </svg>`

  return `${cabecera}
    <div class="modelo">
      ${cabezal}
      <div class="modelo-texto">
        <span>Modelo · pista ${esc(estado.posicion ?? 1)}</span>
        <strong>${modelo}</strong>
      </div>
      ${ideal}
    </div>
    ${dibujadas ? `<div class="perillas-panel">${dibujadas}<p class="volumen-nota">Volume no viaja al ampli.</p></div>` : ''}
    <div class="efectos-bloque">
      <h3>Efectos</h3><ul class="cadena cadena-panel">${ranuras(a)}</ul>
    </div>
    ${a.incierto ? '<p class="envio-estado mal">La planilla marca este preset como dudoso.</p>' : ''}
    ${queSePisa(a)}
    <div class="panel-envio"><button type="button" id="enviar-ampli" class="btn btn-primary btn-block enviar-ampli" ${estado.puedeEnviar ? '' : 'disabled'}>Enviar al ampli <kbd>E</kbd></button><p id="envio-estado" class="envio-estado" role="status">Sin enviar todavía</p></div>`
}
