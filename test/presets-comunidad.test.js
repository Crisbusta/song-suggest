import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS_BANDA, PRESETS_TONO, auditoria } from '../lib/presets-comunidad.js'
import { resolverUnidad } from '../lib/lt25-nombres.js'

test('se leen las 77 filas de bandas y las 10 de tonos', () => {
  const a = auditoria()
  assert.equal(a.leidas.bandas, 77)
  assert.equal(a.leidas.tonos, 10)
})

test('nada se pierde en silencio: leidas = importadas + descartadas', () => {
  const a = auditoria()
  assert.equal(a.importadas + a.descartadas.length, a.leidas.bandas + a.leidas.tonos)
})

test('cada descarte dice por que', () => {
  for (const d of auditoria().descartadas) {
    assert.ok(d.motivo && d.motivo.length > 5, `descarte sin motivo: ${JSON.stringify(d)}`)
  }
})

test('un preset conocido llega entero', () => {
  const p = PRESETS_BANDA.find(x => /enter sandman/i.test(x.cancion ?? ''))
  assert.equal(p.artista.toLowerCase(), 'metallica')
  // La fila "Metallica - Enter Sandman" de la planilla trae el amp "90s Rock",
  // no "Metal 2000" (ese es el amp de otra fila, "Bodom Tone (INACCURATE)").
  // Verificado contra data/presets-lt25-bandas.csv linea 50.
  assert.equal(p.cadena.amp.nombre, '90S ROCK')
  assert.ok(Number.isFinite(p.cadena.amp.valores.gain))
})

test('las marcas de incertidumbre de la planilla se conservan', () => {
  const inciertos = PRESETS_BANDA.filter(p => p.incierto)
  assert.ok(inciertos.length >= 4, 'la planilla marca al menos cuatro filas como dudosas')
  assert.ok(inciertos.some(p => /radiohead/i.test(p.artista)))
})

test('los valores se leen posicionalmente y en el orden del catalogo', () => {
  // La invariante que hizo creible toda la decodificacion: ningun preset puede
  // declarar un parametro que su unidad no tenga.
  for (const p of [...PRESETS_BANDA, ...PRESETS_TONO]) {
    for (const [ranura, u] of Object.entries(p.cadena)) {
      const real = resolverUnidad(u.nombre)
      for (const k of Object.keys(u.valores)) {
        assert.ok(real.parametros.includes(k),
          `${p.clave}: ${ranura}=${u.nombre} declara "${k}", que no es una perilla suya`)
      }
    }
  }
})

test('del bloque de amplificador solo entran las cinco perillas reales', () => {
  // Las columnas 6 y 7 traen valores negativos y no sabemos que son (spec 3.1.1).
  for (const p of PRESETS_BANDA) {
    if (!p.cadena.amp) continue
    assert.ok(Object.keys(p.cadena.amp.valores).length <= 5)
    for (const v of Object.values(p.cadena.amp.valores)) assert.ok(v >= 0, 'una perilla nunca es negativa')
  }
})

test('un guion no se convierte en cero', () => {
  for (const p of [...PRESETS_BANDA, ...PRESETS_TONO])
    for (const u of Object.values(p.cadena))
      for (const [k, v] of Object.entries(u.valores))
        assert.ok(v !== null && Number.isFinite(v), `${p.clave}: ${k} quedo en ${v}`)
})

test('los duplicados por banda conservan su epoca, que es lo que los distingue', () => {
  const rush = PRESETS_BANDA.filter(p => /rush/i.test(p.artista))
  assert.equal(rush.length, 3)
  assert.equal(new Set(rush.map(p => p.epoca)).size, 3)
})
