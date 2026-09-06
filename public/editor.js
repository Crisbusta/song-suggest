/* ---------------------------------------------------------------------------
   Editor del amplificador: las cinco ranuras del preset activo, con su unidad
   y sus perillas. Se genera del catalogo -- no hay una pantalla escrita a mano
   por unidad.

   Escribe en vivo, a traves del despachador. La regla de siempre: el control
   muestra donde lo puso el usuario, pero si el equipo no confirma, vuelve al
   ultimo valor confirmado y lo dice.
   --------------------------------------------------------------------------- */
import { ampli } from './ampli-usb.js'
import { crearCatalogo, RANURAS } from './catalogo-lt25.js'
import { crearDespachador } from './despachador.js'

const $ = s => document.querySelector(s)
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let catalogo = null
let confirmados = {}   // "nodo.parametro" -> ultimo valor que el equipo confirmo

const despachador = crearDespachador(async (clave, valor) => {
  const [nodo, parametro] = clave.split('.')
  await ampli.ponerParametro(nodo, parametro, valor)
})

// Si una escritura no se confirma, el control vuelve a lo ultimo confirmado: la
// pantalla no puede afirmar un valor que el equipo no aplico.
despachador.alTerminar((clave, valor, error) => {
  const campo = document.querySelector(`[data-clave="${clave}"]`)
  if (!error) { confirmados[clave] = valor; marcar(campo, ''); return }
  if (campo && confirmados[clave] != null) revertir(campo, confirmados[clave])
  marcar(campo, 'sin confirmar')
})

function marcar(campo, texto) {
  const aviso = campo?.closest('.perilla-editor')?.querySelector('.aviso')
  if (aviso) aviso.textContent = texto
}

// Vuelve el control al ultimo valor confirmado tras un rechazo. Cada tipo de
// control guarda su valor en un lugar distinto del DOM (value, checked,
// value de nuevo pero como texto): no hay una sola forma de "revertir" que
// sirva para los tres.
function revertir(campo, valor) {
  const p = campo.__descriptor
  if (p?.tipo === 'interruptor') { campo.checked = !!valor; return }
  if (p?.tipo === 'lista') { campo.value = valor; return }
  pintarValor(campo, valor)
}

function pintarValor(campo, cable) {
  const p = campo.__descriptor
  campo.value = String(cable)
  const salida = campo.closest('.perilla-editor').querySelector('output')
  salida.textContent = `${p.aPantalla(cable).toFixed(p.decimales)}${p.unidades ? ' ' + p.unidades : ''}`
}

// Lee el valor de un control segun su tipo: un `lista` trae un string, un
// `interruptor` un booleano de `checked`, y solo un `continuo` es un numero.
// `Number(campo.value)` es correcto solo para el tercero -- para los otros dos
// da NaN o el string tal cual, y ponerParametro() rechazaria en silencio ese
// valor mal tipado en vez de escribir lo que el usuario eligio.
function valorDe(campo) {
  const tipo = campo.__descriptor?.tipo
  if (tipo === 'interruptor') return campo.checked
  if (tipo === 'lista') return campo.value
  return Number(campo.value)
}

async function cargarCatalogo() {
  if (catalogo) return catalogo
  const r = await fetch('/lt25-unidades.json')
  catalogo = crearCatalogo(await r.json())
  return catalogo
}

export async function montarEditor() {
  const cont = $('#vista-editor')
  if (!ampli.conectado()) {
    cont.innerHTML = '<p class="vacio">Conecta el amplificador para editarlo.</p>'
    return
  }
  cont.innerHTML = '<p class="vacio">Leyendo el amplificador…</p>'
  const cat = await cargarCatalogo()
  let preset, editado
  try {
    ({ preset, editado } = await ampli.leerPreset())
  } catch (err) {
    cont.innerHTML = `<p class="vacio">${esc(err.message)}</p>`
    return
  }
  confirmados = {}
  dibujar(cont, cat, preset, editado)
}

function dibujar(cont, cat, preset, editado) {
  const nodos = Object.fromEntries((preset.audioGraph?.nodes ?? []).map(n => [n.nodeId, n]))
  cont.innerHTML = `
    <div class="editor-cabecera">
      <h2>${esc(preset.info?.displayName?.trim() ?? 'Preset activo')}</h2>
      ${editado ? '<span class="editado">editado sin guardar</span>' : ''}
      <button type="button" id="releer">Releer del ampli</button>
    </div>
    ${RANURAS.map(r => bloqueRanura(cat, r, nodos[r])).join('')}`

  $('#releer').addEventListener('click', montarEditor)

  for (const campo of cont.querySelectorAll('[data-clave]')) {
    const [nodo, parametro] = campo.dataset.clave.split('.')
    const fenderId = nodos[nodo]?.FenderId
    campo.__descriptor = cat.parametrosDe(fenderId).find(p => p.id === parametro)
    const valor = valorDe(campo)
    confirmados[campo.dataset.clave] = valor
    if (campo.__descriptor?.tipo === 'continuo') pintarValor(campo, valor)
  }

  cont.addEventListener('input', e => {
    const campo = e.target.closest('[data-clave]')
    if (!campo) return
    const valor = valorDe(campo)
    if (campo.__descriptor?.tipo === 'continuo') pintarValor(campo, valor)
    despachador.poner(campo.dataset.clave, valor)
  })

  cont.addEventListener('change', async e => {
    const selector = e.target.closest('[data-ranura]')
    if (!selector) return
    const ranura = selector.dataset.ranura
    selector.disabled = true
    try {
      await ampli.reemplazarUnidad(ranura, selector.value)
      await montarEditor()   // la unidad nueva tiene otras perillas: se redibuja
    } catch (err) {
      $('#vista-editor').querySelector('.editor-cabecera').insertAdjacentHTML(
        'beforeend', `<span class="aviso">${esc(err.message)}</span>`)
      selector.disabled = false
    }
  })
}

function bloqueRanura(cat, ranura, nodo) {
  const fenderId = nodo?.FenderId ?? ''
  const opciones = cat.deRanura(ranura)
    .map(u => `<option value="${esc(u.fenderId)}"${u.fenderId === fenderId ? ' selected' : ''}>${esc(u.nombre)}</option>`)
    .join('')
  const params = cat.parametrosDe(fenderId)
    .map(p => control(ranura, p, nodo?.dspUnitParameters?.[p.id]))
    .join('')
  return `
    <section class="ranura">
      <header>
        <span class="nombre-ranura">${esc(ranura)}</span>
        <select data-ranura="${esc(ranura)}">${opciones}</select>
      </header>
      <div class="perillas">${params || '<p class="vacio-ranura">Sin perillas.</p>'}</div>
    </section>`
}

function control(ranura, p, actual) {
  const clave = `${ranura}.${p.id}`
  if (p.tipo === 'continuo') {
    const paso = (p.max - p.min) / 100
    return `
      <label class="perilla-editor">
        <span class="nombre">${esc(p.nombre)}</span>
        <input type="range" data-clave="${esc(clave)}"
               min="${p.min}" max="${p.max}" step="${paso}" value="${actual ?? p.min}">
        <output></output><span class="aviso"></span>
      </label>`
  }
  if (p.tipo === 'interruptor') {
    return `
      <label class="perilla-editor">
        <span class="nombre">${esc(p.nombre)}</span>
        <input type="checkbox" data-clave="${esc(clave)}" ${actual ? 'checked' : ''}>
        <span class="aviso"></span>
      </label>`
  }
  const opciones = p.valores
    .map(v => `<option value="${esc(v.valor)}"${v.valor === actual ? ' selected' : ''}>${esc(v.nombre)}</option>`)
    .join('')
  return `
    <label class="perilla-editor">
      <span class="nombre">${esc(p.nombre)}</span>
      <select data-clave="${esc(clave)}">${opciones}</select>
      <span class="aviso"></span>
    </label>`
}
