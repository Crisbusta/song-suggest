import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearDespachador } from '../public/despachador.js'

const diferido = () => { let r, j; const p = new Promise((res, rej) => { r = res; j = rej }); return { p, r, j } }

test('la primera escritura sale de inmediato', async () => {
  const vistas = []
  const d = crearDespachador(async (c, v) => { vistas.push([c, v]) })
  await d.poner('amp.gain', 0.5)
  assert.deepEqual(vistas, [['amp.gain', 0.5]])
})

test('mientras una escritura esta en vuelo, solo sobrevive el ultimo valor', async () => {
  const vistas = []
  const primera = diferido()
  let n = 0
  const d = crearDespachador(async (c, v) => { vistas.push([c, v]); if (++n === 1) await primera.p })
  d.poner('amp.gain', 0.1)
  d.poner('amp.gain', 0.2)
  d.poner('amp.gain', 0.3)
  assert.deepEqual(vistas, [['amp.gain', 0.1]], 'nada mas sale mientras la primera no vuelve')
  primera.r()
  await new Promise(r => setImmediate(r))
  assert.deepEqual(vistas, [['amp.gain', 0.1], ['amp.gain', 0.3]], 'el 0.2 se descarta')
})

test('claves distintas no se pisan entre si', async () => {
  const vistas = []
  const primera = diferido()
  let n = 0
  const d = crearDespachador(async (c, v) => { vistas.push([c, v]); if (++n === 1) await primera.p })
  d.poner('amp.gain', 0.1)
  d.poner('amp.treb', 0.9)
  primera.r()
  await new Promise(r => setImmediate(r))
  assert.deepEqual(vistas, [['amp.gain', 0.1], ['amp.treb', 0.9]])
})

test('nunca hay dos escrituras en vuelo a la vez', async () => {
  let vivas = 0, maximo = 0
  const d = crearDespachador(async () => {
    maximo = Math.max(maximo, ++vivas)
    await new Promise(r => setTimeout(r, 5))
    vivas--
  })
  for (let i = 0; i < 10; i++) d.poner(`k${i}`, i)
  while (d.enVuelo()) await new Promise(r => setTimeout(r, 5))
  assert.equal(maximo, 1)
})

test('una escritura que falla no deja el despachador trabado', async () => {
  const vistas = []
  let n = 0
  const d = crearDespachador(async (c, v) => {
    vistas.push([c, v])
    if (++n === 1) throw new Error('el equipo no confirmo')
  })
  d.poner('amp.gain', 0.1)
  d.poner('amp.gain', 0.2)
  while (d.enVuelo()) await new Promise(r => setTimeout(r, 5))
  assert.deepEqual(vistas, [['amp.gain', 0.1], ['amp.gain', 0.2]])
})

test('avisa el resultado de cada escritura, con la clave y el valor que salio', async () => {
  const eventos = []
  const d = crearDespachador(async () => { throw new Error('sin confirmar') })
  d.alTerminar((clave, valor, error) => eventos.push([clave, valor, error?.message]))
  d.poner('amp.gain', 0.4)
  while (d.enVuelo()) await new Promise(r => setTimeout(r, 5))
  assert.deepEqual(eventos, [['amp.gain', 0.4, 'sin confirmar']])
})
