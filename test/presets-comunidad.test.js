import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PRESETS_BANDA, PRESETS_TONO, auditoria, buscarPreset, presetDeGenero, MAPEO_TONO_GENERO } from '../lib/presets-comunidad.js'
import { resolverUnidad } from '../lib/lt25-nombres.js'
import { parsearCsv, numeroCsv } from '../lib/csv.js'

// Los mismos bloques que usa lib/presets-comunidad.js, copiados a mano para
// que estos tests no dependan de su implementacion: si el import corriera un
// indice, el test tiene que notarlo con SUS propios indices, no los suyos.
const BLOQUES_BANDA = { amp: [3, 4, 7], stomp: [11, 12, 5], mod: [17, 18, 5], delay: [23, 24, 4], reverb: [28, 29, 3] }
const BLOQUES_TONO  = { amp: [1, 2, 5], stomp: [7, 8, 5], mod: [13, 14, 5], delay: [19, 20, 4], reverb: [24, 25, 3] }

test('se leen las 77 filas de bandas y las 10 de tonos', () => {
  const a = auditoria()
  assert.equal(a.leidas.bandas, 77)
  assert.equal(a.leidas.tonos, 10)
})

test('nada se pierde en silencio: leidas = importadas + descartadas', () => {
  const a = auditoria()
  assert.equal(a.importadas + a.descartadas.length, a.leidas.bandas + a.leidas.tonos)
})

test('cada descarte y cada aviso dice por que', () => {
  // "descartadas" hoy queda vacio (ninguna fila de estos dos CSV pierde TODAS
  // sus ranuras), asi que la cobertura real de este test la dan los avisos:
  // ahi es donde estan las anomalias de verdad (unidades no reconocidas,
  // celdas no numericas, ranuras con valores sin nombre de unidad).
  const a = auditoria()
  assert.ok(a.avisos.length > 0, 'este CSV real trae anomalias conocidas; si esto da 0 el test ya no prueba nada')
  for (const d of [...a.descartadas, ...a.avisos]) {
    assert.ok(d.motivo && d.motivo.length > 5, `sin motivo: ${JSON.stringify(d)}`)
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

test('un guion (o cualquier celda no numerica) NO se convierte en cero: falta la clave, no vale 0', () => {
  // Este es el test que un bug real (valores[k] = v ?? 0 en vez de "if (v !==
  // null)") hace pasar en falso si solo se le pide finitud: convertir un
  // blanco en 0 da un numero finito. Hay que pedir la AUSENCIA de la clave.
  //
  // "Bob Mould / Husker Du" trae el stomp "Fuzz,LOOSE,,,,,": el catalogo dice
  // que FUZZ tiene 3 perillas (level, gain, tone) y la planilla solo escribe
  // texto ("LOOSE") en la primera y deja las otras dos en blanco -- ninguna
  // de las tres es un numero, asi que "valores" tiene que quedar VACIO, no
  // {level: 0, gain: 0, tone: 0}.
  const husker = PRESETS_BANDA.find(p => /husker du/i.test(p.artista))
  assert.ok(husker, 'deberia existir el preset de Husker Du')
  assert.deepEqual(husker.cadena.stomp.valores, {})

  // Version general, celda por celda, para las 87 filas de ambos CSV: se
  // recalcula el valor esperado con numeroCsv directamente (sin pasar por
  // leerBloque) y se exige que la clave este presente si y solo si numeroCsv
  // (o el rescate declarado por el catalogo para celdas como "290ms", ver
  // mas abajo) dio un numero real.
  const specs = [
    ['presets-lt25-bandas.csv', PRESETS_BANDA, BLOQUES_BANDA],
    ['presets-lt25-tonos.csv', PRESETS_TONO, BLOQUES_TONO],
  ]
  for (const [archivo, presets, bloques] of specs) {
    const filas = parsearCsv(readFileSync(new URL(`../data/${archivo}`, import.meta.url), 'utf8'))
      .slice(1).filter(f => f[0]?.trim())
    assert.equal(filas.length, presets.length, `${archivo}: hoy ninguna fila se descarta entera, asi que fila y preset corresponden 1 a 1`)
    filas.forEach((fila, i) => {
      const p = presets[i]
      for (const [ranura, [, iValor, ancho]] of Object.entries(bloques)) {
        const u = p.cadena[ranura]
        if (!u) continue
        const real = resolverUnidad(u.nombre)
        const cuantos = Math.min(ancho, real.parametros.length)
        for (let k = 0; k < cuantos; k++) {
          const clave = real.parametros[k]
          const crudo = fila[iValor + k]
          const numero = numeroCsv(crudo)
          const esNumeroConSufijo = numero === null && /^-?\d+(?:[.,]\d+)?\s*[a-zA-Z%]+$/.test(String(crudo ?? '').trim())
          if (numero === null && !esNumeroConSufijo) {
            assert.ok(!(clave in u.valores),
              `${p.clave}: ${ranura}.${clave} deberia estar AUSENTE (celda "${crudo}" no numerica) pero vale ${u.valores[clave]}`)
          } else if (numero !== null) {
            assert.equal(u.valores[clave], numero, `${p.clave}: ${ranura}.${clave} deberia ser ${numero}`)
          }
          // El caso "numero con sufijo" (ej. "290ms") se verifica aparte, mas
          // abajo, porque rescatarlo depende de la unidad que declare el
          // catalogo para ese controlId puntual -- no algo que este test
          // quiera reimplementar en general.
        }
      }
    })
  }
})

test('una cadena entera, fijada contra el CSV: "Texas Blues" (tonos, linea 2)', () => {
  // Copiado a mano de data/presets-lt25-tonos.csv linea 2:
  // Texas Blues,80's Rock,2.1,6.9,7.1,6.7,6.6,5-Band EQ,"9,0","7,0","4,0","9,0",8.5,
  // Vibratone,6.8,1.3,4.3,7.1,6.5,Delay,9.8,66,1.1,"10,0",Sm. Room,7.2,3.7,8.4
  // Un desplazamiento de +1 en cualquiera de las cuatro ranuras de efecto
  // corre estos numeros contra la clave vecina y este test lo nota.
  const p = PRESETS_TONO.find(x => x.clave === 'Texas Blues')
  assert.ok(p, 'deberia existir el tono "Texas Blues"')
  assert.deepEqual(p.cadena, {
    amp:    { fenderId: 'DUBS_Jcm800',              nombre: '80S ROCK',   valores: { gain: 2.1, volume: 6.9, treb: 7.1, mid: 6.7, bass: 6.6 } },
    stomp:  { fenderId: 'DUBS_MustangFiveBandEq1',  nombre: '5-BAND EQ',  valores: { low: 9, lowmid: 7, mid: 4, highmid: 9, high: 8.5 } },
    mod:    { fenderId: 'DUBS_Vibratone',           nombre: 'VIBRATONE',  valores: { level: 6.8, rotor: 1.3, depth: 4.3, feedback: 7.1, phase: 6.5 } },
    delay:  { fenderId: 'DUBS_MonoDelay',           nombre: 'DELAY',      valores: { level: 9.8, time: 66, feedback: 1.1, brite: 10 } },
    reverb: { fenderId: 'DUBS_SmallRoomReverb',     nombre: 'SMALL ROOM', valores: { level: 7.2, decay: 3.7, tone: 8.4 } },
  })
})

test('TOUCH WAH: los dos valores de texto caen siempre en mode y type, nunca desplazados', () => {
  // TOUCH WAH declara level | thresh | mode | type | q. Cinco filas de la
  // hoja de bandas escriben "Wah,<num>,<num>,<texto>,<texto>,<num>": los dos
  // textos caen siempre en las posiciones 3 y 4 (mode, type). Un
  // desplazamiento de +1 en la ranura "mod" pondria un texto en "thresh" o un
  // numero en "mode", y esto no sobreviviria a ninguna de las cinco filas.
  const claves = ['Curtis Mayfield', 'Eddie Hazel / Funkadelic', 'Jimi Hendrix', 'Page Hamilton / Helmet', 'SLASH / GUNS N ROSES?']
  const wahs = PRESETS_BANDA.filter(p => claves.includes(p.clave))
  assert.equal(wahs.length, 5)
  for (const p of wahs) {
    const v = p.cadena.mod.valores
    assert.equal(p.cadena.mod.nombre, 'TOUCH WAH')
    assert.ok(Number.isFinite(v.level), `${p.clave}: level deberia ser numero`)
    assert.ok(Number.isFinite(v.thresh), `${p.clave}: thresh deberia ser numero`)
    assert.ok(!('mode' in v), `${p.clave}: mode es texto en la planilla, no deberia tener clave`)
    assert.ok(!('type' in v), `${p.clave}: type es texto en la planilla, no deberia tener clave`)
    assert.ok(Number.isFinite(v.q), `${p.clave}: q deberia ser numero`)
  }
})

test('los duplicados por banda conservan su epoca, que es lo que los distingue', () => {
  const rush = PRESETS_BANDA.filter(p => /rush/i.test(p.artista))
  assert.equal(rush.length, 3)
  assert.equal(new Set(rush.map(p => p.epoca)).size, 3)
})

test('un valor con unidad declarada por el catalogo se rescata, no se descarta ni se inventa', () => {
  // mk.gee / delay "Echo,1.5,290ms,4.4,6.8": dlyTime de ECHO (DUBS_TapeDelayLite)
  // esta declarado en el catalogo con units:"ms" -- por eso "290ms" se lee
  // como 290 y no se pierde en el default de la unidad. El rescate solo mira
  // la unidad que el propio catalogo declaro para ESE controlId: no es
  // adivinar, y por eso no aparece como aviso.
  const p = PRESETS_BANDA.find(x => /mk\.gee/i.test(x.clave))
  assert.ok(p, 'deberia existir el preset de mk.gee')
  assert.equal(p.cadena.delay.valores.dlyTime, 290)
  assert.ok(!auditoria().avisos.some(a => a.fila === p.clave && /dlyTime/.test(a.motivo)),
    'el "290ms" se rescato: no deberia quedar como aviso')
})

test('auditoria().avisos: cada uno es rastreable (archivo, linea, ranura, motivo) y nada se pierde ahi tampoco', () => {
  const { avisos } = auditoria()
  assert.ok(avisos.length > 0)
  for (const a of avisos) {
    assert.ok(['bandas', 'tonos'].includes(a.archivo), `aviso sin archivo valido: ${JSON.stringify(a)}`)
    assert.ok(Number.isInteger(a.linea) && a.linea >= 2, `aviso sin linea util: ${JSON.stringify(a)}`)
    assert.ok(a.fila, `aviso sin fila: ${JSON.stringify(a)}`)
    assert.ok(a.motivo && a.motivo.length > 5, `aviso sin motivo: ${JSON.stringify(a)}`)
  }
  // El caso que motivo separar "avisos" de "descartadas": la unidad de la
  // columna de delay de "Joey Santiago / The Pixies" no resuelve ("80s"), y
  // sin embargo esa fila SI se importa (amp, stomp y mod si resuelven). Si
  // esto no apareciera aca, se habria perdido en silencio.
  assert.ok(avisos.some(a => a.fila === 'Joey Santiago / The Pixies' && a.ranura === 'delay' && /80s/.test(a.motivo)))
})

test('una ranura con valores pero sin nombre de unidad tambien es un aviso, no un silencio', () => {
  // La fila 71 de la hoja de bandas esta malformada: el nombre del ampli cayo
  // en la columna Band ("Super Clean" es en realidad un modelo de ampli) y la
  // columna Amp quedo vacia -- pero las siete columnas de valores del bloque
  // de ampli siguen ahi, llenas. Sin nombre de unidad no hay donde poner esos
  // valores, pero tirarlos sin decir nada seria perderlos en silencio.
  const p = PRESETS_BANDA.find(x => x.clave === 'Super Clean')
  assert.ok(p, 'deberia existir la fila (malformada) "Super Clean"')
  assert.ok(!('amp' in p.cadena), 'sin nombre de unidad no puede haber ranura de ampli')
  const { avisos } = auditoria()
  assert.ok(avisos.some(a => a.fila === 'Super Clean' && a.ranura === 'amp' && /sin nombre de unidad|columna de unidad esta vacia/.test(a.motivo)))
})

test('una cancion nombrada gana sobre el preset de su artista', () => {
  // Metallica trae DOS filas en la planilla: "James Hetfield / Metallica"
  // (generica) y "Metallica - Enter Sandman" (de esta cancion puntual).
  // Verificado contra data/presets-lt25-bandas.csv, lineas 34 y 50.
  const r = buscarPreset({ artist: 'Metallica', title: 'Enter Sandman', tags: [] })
  assert.equal(r.motivo, 'cancion')
  assert.match(r.preset.clave, /Enter Sandman/i)
})

test('otra cancion del mismo artista cae en el preset de artista, no en el de otra cancion suya', () => {
  // "Master of Puppets" no esta en la planilla: tiene que caer en el preset
  // GENERICO de Metallica ("James Hetfield / Metallica"), no en el de
  // "Enter Sandman" disfrazado de "el tono de Metallica" -- un preset de
  // cancion puntual no es candidato generico de su artista.
  const r = buscarPreset({ artist: 'Metallica', title: 'Master of Puppets', tags: [] })
  assert.equal(r.motivo, 'artista')
  assert.equal(r.preset.artista.toLowerCase(), 'metallica')
  assert.equal(r.preset.clave, 'James Hetfield / Metallica')
  assert.notEqual(r.preset.cancion, 'Enter Sandman')
})

test('el nombre se normaliza: mayusculas, acentos y el articulo inicial', () => {
  // La planilla escribe "Keith Richards / Rolling Stones" (sin articulo);
  // el catalogo puede traer "The Rolling Stones". Mayuscula, articulo y
  // acento no pueden decidir si el guitarrista tiene o no su tono.
  const base = buscarPreset({ artist: 'Rolling Stones', title: 'x', tags: [] })
  assert.ok(base)
  assert.deepEqual(buscarPreset({ artist: 'THE ROLLING STONES', title: 'x', tags: [] }).preset, base.preset)
  // El acento es lo que se normaliza, no una coincidencia aproximada: sin
  // strip de acentos esta variante NO calzaria con "Rolling Stones" (no hay
  // ninguna regla de substring o distancia de edicion detras).
  assert.deepEqual(buscarPreset({ artist: 'Röllîng Stönes', title: 'x', tags: [] }).preset, base.preset)
})

test('con varios presets del mismo artista, la epoca de la cancion desempata', () => {
  // Rush tiene tres presets (70s, 80s, 90s: data/presets-lt25-bandas.csv
  // lineas 4-6). Se piden las tres decadas para que un desempate que
  // simplemente devolviera "el primero de la lista" (que en el CSV es el de
  // los 80s) no pase por casualidad.
  const r80 = buscarPreset({ artist: 'Rush', title: 'x', tags: ['80s'] })
  assert.match(r80.preset.epoca, /80/)
  assert.equal(r80.motivo, 'artista')

  const r70 = buscarPreset({ artist: 'Rush', title: 'x', tags: ['70s'] })
  assert.match(r70.preset.epoca, /70/)
  assert.equal(r70.motivo, 'artista')

  const r90 = buscarPreset({ artist: 'Rush', title: 'x', tags: ['90s'] })
  assert.match(r90.preset.epoca, /90/)
  assert.equal(r90.motivo, 'artista')

  assert.notEqual(r70.preset, r80.preset)
  assert.notEqual(r70.preset, r90.preset)
})

test('sin epoca que calce se elige uno, y se dice que fue sin desempate', () => {
  const r = buscarPreset({ artist: 'Rush', title: 'x', tags: [] })
  assert.equal(r.motivo, 'artista (sin desempate de epoca)')
  assert.ok(PRESETS_BANDA.includes(r.preset))
})

test('un artista sin preset no devuelve uno parecido', () => {
  assert.equal(buscarPreset({ artist: 'Los Prisioneros', title: 'x', tags: [] }), null)
  assert.equal(buscarPreset({ artist: '', title: '', tags: [] }), null)
})

test('sin fila generica, otra cancion del mismo artista sirve de respaldo (y lo dice)', () => {
  // The Police solo tiene una fila en la planilla, "The Police - Every
  // Breath You Take" (data/presets-lt25-bandas.csv linea 74) -- no hay
  // ninguna fila generica de la banda. El catalogo trae otras 15 canciones
  // de The Police: perder el preset para todas ellas seria tirar una pista
  // real (mismo guitarrista, misma banda, misma epoca) por las reglas de
  // genero, que son peores. "Every Breath You Take" sigue ganando por
  // cancion exacta; cualquier otra cancion de la banda cae al respaldo.
  const exacta = buscarPreset({ artist: 'The Police', title: 'Every Breath You Take', tags: [] })
  assert.equal(exacta.motivo, 'cancion')

  const r = buscarPreset({ artist: 'The Police', title: 'Message In A Bottle', tags: [] })
  assert.equal(r.motivo, 'artista (desde el preset de otra cancion)')
  assert.equal(r.preset.clave, 'The Police - Every Breath You Take')
})

test('cada tono mapeado existe de verdad en la hoja de tonos', () => {
  // Un mapeo que apunta a un tono inexistente es una regla muerta y silenciosa.
  for (const tono of Object.values(MAPEO_TONO_GENERO)) {
    assert.ok(PRESETS_TONO.some(p => p.clave === tono), `"${tono}" no esta en la hoja de tonos`)
  }
})

test('un tag mapeado devuelve su tono', () => {
  const r = presetDeGenero(['blues'])
  assert.equal(r.motivo, 'genero')
  assert.equal(r.preset.clave, 'Texas Blues')
})

test('gana el tag mas especifico, no el primero de la lista de la cancion', () => {
  const r = presetDeGenero(['rock', 'doom metal'])
  assert.equal(r.preset.clave, 'Doom Wizard')

  // La prueba de arriba no distingue "gana el orden del mapeo" de "gana el
  // primero de la lista", porque 'rock' ni siquiera esta mapeado: cualquier
  // implementacion que recorra la lista de tags encuentra 'doom metal' igual.
  // Aqui los DOS tags de la cancion estan mapeados, y en el orden inverso al
  // del mapeo ('blues' esta antes que 'doom metal' en MAPEO_TONO_GENERO):
  // si gana el orden de la lista de la cancion, esto devolveria Doom Wizard;
  // como tiene que ganar el orden del mapeo, devuelve Texas Blues.
  const r2 = presetDeGenero(['doom metal', 'blues'])
  assert.equal(r2.preset.clave, 'Texas Blues')
})

test('un genero sin mapeo no inventa un tono', () => {
  assert.equal(presetDeGenero(['reggaeton']), null)
  assert.equal(presetDeGenero([]), null)
})
