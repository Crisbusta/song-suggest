import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TERMINOS_DE_ROL, esRol, rolDe } from '../public/track-classifier.js'

test('reconoce como rol los terminos del vocabulario, y no otra cosa', () => {
  assert.equal(esRol('Lead Guitar'), true)
  assert.equal(esRol('Rhythm Guitar'), true)
  assert.equal(esRol('Guitar Solo'), true)
  assert.equal(esRol('Gibson Flying V'), false, 'un equipo no es un rol')
  assert.equal(esRol('Kirk Hammett'), false, 'un musico tampoco')
  assert.equal(esRol(''), false)
  assert.equal(esRol(null), false)
})

test('cada termino del vocabulario se reconoce a si mismo', () => {
  // Sin esto, un termino se puede colar en la lista sin que la expresion
  // regular lo recoja -- y nadie lo notaria, porque el fallo es que una
  // etiqueta sale peor, no que algo reviente.
  for (const t of TERMINOS_DE_ROL) {
    assert.equal(esRol(`Guitar ${t}x`), true, `el vocabulario declara "${t}" pero no lo reconoce`)
  }
})

test('rolDe agrupa los terminos en las familias de rol', () => {
  assert.equal(rolDe('Lead Guitar'), 'lead')
  assert.equal(rolDe('Guitar Solo'), 'lead')
  assert.equal(rolDe('Harmonies'), 'lead')
  assert.equal(rolDe('Rhythm Guitar'), 'ritmica')
  assert.equal(rolDe('Main Riff'), 'ritmica')
  assert.equal(rolDe('Acoustic Guitar (12 String)'), 'acustica')
  assert.equal(rolDe('Clean Guitar'), 'limpia')
})

test('un nombre sin senal de rol devuelve null, no una suposicion', () => {
  assert.equal(rolDe('Gibson Flying V'), null)
  assert.equal(rolDe(''), null)
  assert.equal(rolDe(null), null)
})

test('el rol sale del nombre completo, con sus segmentos', () => {
  // El catalogo escribe "musico | equipo | rol" en cualquier orden.
  assert.equal(rolDe('Kirk Hammett | Gibson Flying V | Lead Guitar'), 'lead')
  assert.equal(rolDe('James Hetfield | Rhythm Guitar'), 'ritmica')
})

test('lo mas especifico gana cuando un nombre trae dos senales', () => {
  // "Acoustic Rhythm Guitar" es antes acustica que ritmica: el instrumento
  // decide mas del tono que el papel dentro de la cancion.
  assert.equal(rolDe('Acoustic Rhythm Guitar'), 'acustica')
  assert.equal(rolDe('Clean Lead'), 'limpia')
})
