import { RANURAS } from './catalogo-lt25.js'
import { esc, resumenEnvioAmpli } from './tarjeta.js'

const perilla = (nombre, valor) => `<div class="perilla"><span class="nombre">${nombre}</span><meter min="0" max="10" value="${esc(valor)}" aria-label="${nombre} ${esc(valor)} de 10"></meter><span class="num">${esc(valor)}</span></div>`

/* La conexion se puede actualizar sin reemplazar los avisos del envio. */
export function pintarPanelAmpli(pista, estado = {}) {
  const a = pista?.ampli
  const cabecera = `<div class="panel-cabecera"><h2>Ampli · Mustang LT25</h2><span id="panel-conexion" class="${estado.conectado ? 'conectado' : ''}">${estado.conectado ? 'Ampli conectado' : 'Sin conectar'}</span></div>`
  if (!a) return `${cabecera}<div class="panel-vacio"><p>Sin sugerencia de ampli</p><span>Esta pista no trae ajustes para mandar. Puedes preparar tu tono en el editor.</span></div>`
  const { queSeManda } = resumenEnvioAmpli(a)
  const perillas = [['Gain', a.gain], ['Treble', a.treble], ['Bass', a.bass], ['Mid', a.mid]]
    .filter(([, valor]) => valor != null).map(([nombre, valor]) => perilla(nombre, valor)).join('')
  const ranuras = RANURAS.map(ranura => {
    const unidad = a.cadena?.[ranura]
    const nombre = unidad?.nombre ?? (ranura === 'amp' ? a.modelo : null)
    const texto = nombre ?? (ranura === 'amp' ? 'sin cambiar' : 'vacía')
    return `<li class="${nombre ? 'ocupada' : 'ranura-vacia'}"><span>${ranura}</span><strong>${esc(texto)}</strong></li>`
  }).join('')
  const fuente = a.fuente === 'comunidad'
    ? `${esc(a.procedencia ?? 'Preset de la comunidad')}. Es lo que a alguien le funcionó, no el tono de la grabación.`
    : `Punto de partida, no el tono del disco.${a.motivos?.length ? ` Deducido de: ${a.motivos.map(esc).join(', ')}.` : ''}`
  return `${cabecera}
    <div class="modelo"><span>Modelo · pista ${esc(estado.posicion ?? 1)}</span><strong>${a.modelo != null ? esc(a.modelo) : 'no declarado'}</strong></div>
    ${perillas ? `<div class="perillas-panel">${perillas}</div>` : ''}
    <p class="volumen-nota">Volume no viaja al ampli.</p>
    <h3>Ranuras</h3><ul class="cadena cadena-panel">${ranuras}</ul>
    ${a.incierto ? '<p class="envio-estado mal">La planilla marca este preset como dudoso.</p>' : ''}
    <details class="panel-detalles"><summary>Qué se pisa al enviar</summary><p>Las ranuras de efectos que este tono no usa quedan vacías: esto borra lo que hayas ajustado a mano en ellas. Cargar una unidad devuelve sus otras perillas a los valores de fábrica. Tu volumen se lee y se restaura; si no se puede leer, el modelo no cambia.</p>${a.reverb != null && !a.cadena?.reverb ? `<p>Reverb ${esc(a.reverb)}/10 es una sugerencia manual: no se envía y este tono vacía esa ranura, incluso si la ajustaste a mano.</p>` : ''}<p>${fuente}</p></details>
    <div class="panel-envio"><button type="button" id="enviar-ampli" class="enviar-ampli" ${estado.puedeEnviar ? '' : 'disabled'}>Enviar al ampli <kbd>E</kbd></button><p id="envio-estado" class="envio-estado" role="status">Sin enviar todavía</p><p class="descargo">${queSeManda}</p></div>`
}
