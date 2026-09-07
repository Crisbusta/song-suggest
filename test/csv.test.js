import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsearCsv, numeroCsv } from '../lib/csv.js'

test('separa filas y columnas simples', () => {
  assert.deepEqual(parsearCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
})

test('respeta las comas dentro de comillas', () => {
  assert.deepEqual(parsearCsv('a,"b,c",d'), [['a', 'b,c', 'd']])
})

test('respeta los saltos de linea dentro de comillas', () => {
  // Pasa de verdad en la hoja 1: una celda con el nombre de la banda en dos lineas.
  assert.deepEqual(parsearCsv('a,"b\nc",d'), [['a', 'b\nc', 'd']])
})

test('unas comillas dobles dentro de un campo son una comilla', () => {
  assert.deepEqual(parsearCsv('a,"di ""hola""",b'), [['a', 'di "hola"', 'b']])
})

test('conserva las celdas vacias, que es donde vive el significado', () => {
  // La hoja 1 usa columnas fijas: una celda vacia dice "esta perilla no se
  // especifico". Colapsarlas correria todo el bloque y asignaria mal los valores.
  assert.deepEqual(parsearCsv('a,,,b'), [['a', '', '', 'b']])
})

test('tolera CRLF', () => {
  assert.deepEqual(parsearCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']])
})

test('la ultima fila sin salto final no se pierde', () => {
  assert.deepEqual(parsearCsv('a,b\n1,2\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']])
})

test('numeroCsv acepta el punto y la coma decimal', () => {
  assert.equal(numeroCsv('8.5'), 8.5)
  assert.equal(numeroCsv('9,0'), 9)      // asi viene en la hoja 2
  assert.equal(numeroCsv('10,0'), 10)
  assert.equal(numeroCsv('  4  '), 4)
  assert.equal(numeroCsv('-6'), -6)
})

test('numeroCsv devuelve null para lo que no es un numero, incluido el guion', () => {
  // El guion es como las dos hojas dicen "esta ranura no se usa". Convertirlo
  // en 0 seria mandarle al amplificador un valor que nadie pidio.
  assert.equal(numeroCsv('-'), null)
  assert.equal(numeroCsv(''), null)
  assert.equal(numeroCsv('   '), null)
  assert.equal(numeroCsv(undefined), null)
  assert.equal(numeroCsv('n/a'), null)
})
