import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  campoVarint, campoBytes, campoTexto, campoFloat, codificarMensaje, empaquetar,
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

test('el tag se lee en el byte 1, no en el 0', () => {
  // El error real: leer el tag en d[0] (que es el nulo del protocolo) hace que
  // el reensamblador descarte TODAS las respuestas sin lanzar nada, y el
  // síntoma es idéntico a "el amplificador no contesta".
  const crudo = desdeHex('00 35 09 08 02 8a 07 04 08 00 10 00')
  assert.equal(crudo[0], 0x00, 'el byte 0 es el nulo del protocolo')
  assert.equal(crudo[1], 0x35, 'el tag vive en el byte 1')
  // Y esto es lo que el test anterior no hacía: comprobar el comportamiento.
  const mensaje = crearReensamblador().recibir(crudo)
  assert.ok(mensaje, 'con el offset correcto, el mensaje sale')
  assert.deepEqual([...mensaje.slice(0, 2)], [0x08, 0x02], 'la carga empieza donde debe')
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

test('una continuación sin inicio no contamina el mensaje siguiente', () => {
  const r = crearReensamblador()
  const paq = (tag, bytes) => { const b = new Uint8Array(64); b[1] = tag; b[2] = bytes.length; b.set(bytes, 3); return b }
  assert.equal(r.recibir(paq(0x34, [66, 66])), null, 'la continuación huérfana se descarta')
  // El siguiente paquete único debe entregarse limpio, sin el fragmento anterior.
  assert.deepEqual([...r.recibir(paq(0x35, [7, 7]))], [7, 7])
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

test('interpretar no depende del orden de los campos', () => {
  // Mismo ACK, con los campos escritos en orden 3, 1, 2.
  const alReves = codificarMensaje(35, [
    ...campoFloat(3, 0.5), ...campoTexto(1, 'amp'), ...campoTexto(2, 'gain'),
  ])
  const r = interpretar(alReves)
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

test('reiniciar descarta una secuencia abierta que nunca se cerro', () => {
  const r = crearReensamblador()
  const paq = (tag, bytes) => { const b = new Uint8Array(64); b[1] = tag; b[2] = bytes.length; b.set(bytes, 3); return b }
  r.recibir(paq(0x33, [1, 2]))   // se abre una secuencia y queda a medias
  r.reiniciar()
  // El siguiente paquete unico debe salir limpio, sin el fragmento anterior.
  assert.deepEqual([...r.recibir(paq(0x35, [9]))], [9])
})

test('un campo fixed32 truncado no hace lanzar a leerCampos', () => {
  // Campo 1 completo y, detrás, un fixed32 al que le faltan dos bytes: el
  // parser tiene que devolver lo que alcanzó a leer en vez de reventar.
  const buf = new Uint8Array([...campoVarint(1, 7), (2 << 3) | 5, 0x00, 0x00])
  assert.deepEqual(leerCampos(buf), [{ num: 1, v: 7 }])
})

test('interpretar no lanza con un ACK cuyo flotante viene cortado', () => {
  // Lo que promete el docblock de interpretar: lo que no se entiende se
  // descarta, no se lanza. Un paquete cortado en el cable llegaba aquí como
  // RangeError y tumbaba el manejador de 'inputreport'.
  const ack = new Uint8Array([
    ...campoVarint(1, 0),
    ...campoBytes(35, [...campoTexto(1, 'amp'), ...campoTexto(2, 'gain'), (3 << 3) | 5, 0x00]),
  ])
  const r = interpretar(ack)
  assert.equal(r.tipo, 'ackParametro')
  assert.equal(r.nodo, 'amp')
  assert.equal(r.parametro, 'gain')
  assert.equal(r.valor, undefined, 'sin flotante completo, no hay valor')
})

test('empaquetar acepta los 62 bytes que caben y rechaza el 63', () => {
  // La carga arranca en b[2] de un reporte de 64: caben 62, no 61.
  const p = empaquetar(new Uint8Array(62).fill(0xab))
  assert.equal(p.length, 64)
  assert.equal(p[1], 62, 'el largo declarado')
  assert.equal(p[63], 0xab, 'el último byte de la carga cae en el último del reporte')
  assert.throws(() => empaquetar(new Uint8Array(63)), /no cabe/)
})
