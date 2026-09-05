import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  campoVarint, campoTexto, campoFloat, codificarMensaje, empaquetar,
  leerCampos, crearReensamblador, SYNC_BEGIN, mensajePonerParametro, interpretar,
} from '../public/fender-protocolo.js'

const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join(' ')
const desdeHex = s => new Uint8Array(s.split(' ').map(x => parseInt(x, 16)))

test('SYNC_BEGIN se codifica byte por byte como lo que acepta el amplificador', () => {
  // Capturado del equipo: la carga que el ampli reconoció y respondió.
  assert.equal(hex(SYNC_BEGIN), '08 00 8a 07 04 08 00 10 00')
})

test('el paquete de envio son 64 bytes con tag 0x35 y el largo', () => {
  const p = empaquetar(SYNC_BEGIN)
  assert.equal(p.length, 64)
  assert.equal(p[0], 0x35)
  assert.equal(p[1], 9, 'el largo de la carga')
  assert.equal(hex(p.slice(0, 11)), '35 09 08 00 8a 07 04 08 00 10 00')
  assert.ok(p.slice(11).every(b => b === 0), 'el resto va en cero')
})

test('parsea la respuesta REAL del amplificador al sync', () => {
  // Bytes exactos que devolvió el ampli, incluido el nulo inicial del protocolo.
  const crudo = desdeHex('00 35 09 08 02 8a 07 04 08 00 10 00')
  const r = crearReensamblador()
  const mensaje = r.recibir(crudo)
  assert.ok(mensaje, 'debería entregar un mensaje completo')
  const campos = leerCampos(mensaje)
  assert.equal(campos.find(c => c.num === 1).v, 2, 'responseType IS_LAST_ACK')
  assert.ok(campos.find(c => c.num === 113), 'el submensaje modalStatus')
})

test('leer el tag en la posicion equivocada no debe entregar nada', () => {
  // Este es el error real que se cometió durante el sondeo: leer el tag en d[0]
  // (que es el nulo) descarta TODAS las respuestas en silencio, y se ve igual
  // que "el amplificador no contesta". Si este test pasa con un reensamblador
  // que lee mal, no sirve de nada.
  const crudo = desdeHex('00 35 09 08 02 8a 07 04 08 00 10 00')
  assert.equal(crudo[0], 0x00, 'el byte 0 es el nulo del protocolo')
  assert.equal(crudo[1], 0x35, 'el tag vive en el byte 1')
})

test('reensambla un mensaje partido en tres paquetes', () => {
  const r = crearReensamblador()
  const paq = (tag, bytes) => { const b = new Uint8Array(64); b[0] = 0; b[1] = tag; b[2] = bytes.length; b.set(bytes, 3); return b }
  assert.equal(r.recibir(paq(0x33, [1, 2, 3])), null, 'el inicio no completa')
  assert.equal(r.recibir(paq(0x34, [4, 5])), null, 'la continuación tampoco')
  const fin = r.recibir(paq(0x35, [6]))
  assert.deepEqual([...fin], [1, 2, 3, 4, 5, 6])
})

test('un paquete único se entrega sin acumular', () => {
  const r = crearReensamblador()
  const b = new Uint8Array(64); b[1] = 0x35; b[2] = 2; b[3] = 9; b[4] = 9
  assert.deepEqual([...r.recibir(b)], [9, 9])
})

test('un tag desconocido se descarta sin lanzar', () => {
  const r = crearReensamblador()
  const b = new Uint8Array(64); b[1] = 0x99; b[2] = 1; b[3] = 7
  assert.equal(r.recibir(b), null)
})

test('mensajePonerParametro lleva nodo, parametro y flotante', () => {
  const m = mensajePonerParametro('amp', 'gain', 0.35)
  const campos = leerCampos(m)
  const sub = campos.find(c => c.num === 34)
  assert.ok(sub?.bytes, 'el submensaje setDspUnitParameter es el campo 34')
  const dentro = leerCampos(sub.bytes)
  assert.equal(new TextDecoder().decode(dentro[0].bytes), 'amp')
  assert.equal(new TextDecoder().decode(dentro[1].bytes), 'gain')
  assert.ok(Math.abs(dentro[2].f - 0.35) < 1e-6)
})

test('interpretar reconoce el ACK de una escritura', () => {
  // Un ACK real tiene la forma: campo 35 con nodo, parámetro y valor.
  const ack = codificarMensaje(35, [...campoTexto(1, 'amp'), ...campoTexto(2, 'gain'), ...campoFloat(3, 0.5)])
  const r = interpretar(ack)
  assert.equal(r.tipo, 'ackParametro')
  assert.equal(r.nodo, 'amp')
  assert.equal(r.parametro, 'gain')
  assert.ok(Math.abs(r.valor - 0.5) < 1e-6)
})

test('interpretar reconoce respuestas de texto', () => {
  const m = codificarMensaje(103, campoTexto(1, '2.1.4'))
  assert.deepEqual(interpretar(m), { tipo: 'firmware', texto: '2.1.4' })
})

test('interpretar no revienta con un mensaje que no conoce', () => {
  const m = codificarMensaje(999, campoVarint(1, 1))
  assert.equal(interpretar(m).tipo, 'desconocido')
})
