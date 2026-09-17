import { test, expect } from '@playwright/test'

/* ---------------------------------------------------------------------------
   Que nada se salga de su sitio, a cualquier ancho.

   Esto NO comprueba que la interfaz se vea bien -- eso es un juicio y no cabe en
   un assert. Comprueba lo MEDIBLE, que es donde estan los fallos que se cuelan:
   que la pagina no scrollee en horizontal, que ningun elemento se salga de la
   ventana, que ninguno desborde la caja que lo contiene, y que lo que tiene que
   verse se vea.

   Un desborde horizontal es el sintoma clasico de un ancho fijo que alguien
   escribio pensando en su propio monitor. A 2560 el fallo es al reves: el
   contenido se estira hasta que las filas quedan vacias por el medio.
   --------------------------------------------------------------------------- */

// De un monitor grande a una ventana estrecha. 1280 y 1024 estan a proposito
// justo por debajo de los cortes (84rem = 1344, 68rem = 1088): un breakpoint mal
// puesto se nota en el pixel siguiente, no en el redondo.
const ANCHOS = [2560, 1920, 1600, 1440, 1280, 1136, 1024, 944, 860, 768, 640]

/* Cualquier caja cuyo contenido se le salga por el costado.

   Es `scrollWidth > clientWidth`: el ancho de lo que hay dentro contra el ancho
   util de la caja. Si sobra, o hay barra de scroll horizontal o hay contenido
   cortado -- las dos cosas que no deben pasar nunca.

   La primera version de esto comprobaba caja contra padre y SALTABA a los hijos
   de cualquier contenedor con overflow distinto de `visible`. No cazaba nada:
   las dos columnas llevan `overflow-y: auto`, y el navegador calcula entonces
   tambien `overflow-x: auto`, asi que el filtro se saltaba justo el contenido
   principal. Y como esas columnas scrollean por dentro, ABSORBEN el desborde en
   vez de empujar la pagina, de modo que el scroll del documento tampoco lo
   delataba. Verificado metiendo un `min-width: 900px` a proposito: la version
   vieja daba verde.

   Se deja 1px de tolerancia por los redondeos subpixel del navegador. */
const desbordes = () => {
  const malos = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    /* Los textos para lector de pantalla miden 1px con `clip-path`: que su
       contenido no quepa ahi es el mecanismo, no un fallo. */
    if (el.clientWidth <= 1) continue
    /* Lo mismo con lo que se trunca A PROPOSITO: `text-overflow: ellipsis`
       SIEMPRE mide `scrollWidth > clientWidth` cuando actua -- es la
       definicion de que hay algo que truncar. Los nombres de pista y las
       etiquetas del catalogo son texto de terceros, largo y sin cortes
       posibles, y por eso se declaran truncables: la elipsis se ve y dice
       que hay mas. Sin esta excepcion el chequeo delata el mecanismo en vez
       del fallo, y solo pasaba de casualidad porque los nombres del fixture
       son cortos. */
    if (cs.textOverflow === 'ellipsis') continue
    const sobra = el.scrollWidth - el.clientWidth
    if (sobra > 1) {
      malos.push({
        el: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        sobra,
      })
    }
  }
  return malos
}

/* Contenido cortado y ademas inalcanzable.

   `overflow: hidden` recorta y no da barra: lo que no cabe no existe para quien
   mira. Una caja asi cuyo contenido no quepa es siempre un fallo, y no se
   parece a un desborde horizontal -- la pagina se ve entera y correcta, solo
   que le faltan cosas. Asi entraron dos pistas invisibles: la capa vieja dejaba
   un `max-height: 22rem` y la nueva le puso `overflow: hidden` encima, de modo
   que el scroll que rescataba las dos ultimas desaparecio sin que nada lo
   delatara.

   Solo se mira `hidden` y `clip`. Con `auto` o `scroll` el contenido sobra pero
   se alcanza, y con `visible` se sale a la vista, que es otro problema y lo caza
   la comprobacion de arriba. */
const recortados = () => {
  const malos = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (!['hidden', 'clip'].includes(cs.overflowY)) continue
    /* Los textos para lector de pantalla miden 1px: que su contenido no quepa
       ahi es el mecanismo, no un fallo. */
    if (el.clientHeight <= 1) continue
    const sobra = el.scrollHeight - el.clientHeight
    if (sobra > 1) {
      malos.push({
        el: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        sobra,
      })
    }
  }
  return malos
}

/* Abre SIEMPRE la misma cancion, la de seis pistas.

   Sin esto los tests median lo que el sorteo diera, y nueve de las doce del
   fixture tienen una sola pista -- que se dibuja como `.pista-unica` y no como
   la lista. O sea que la pieza mas ancha de la interfaz entraba en la medicion
   una de cada doce veces, y un desborde metido a proposito en ella pasaba
   desapercibido. Verificado: con la version anterior, un `min-width: 900px` en
   `.pistas-lista` daba verde. */
const abrirSeisPistas = async page => {
  await page.goto('/')
  await page.fill('#cancion-q', 'Seis Pistas')
  await page.locator('#cancion-sug li[data-valor]').first().waitFor()
  await page.keyboard.press('Enter')
  await page.locator('.pistas-lista').waitFor()
}

for (const ancho of ANCHOS) {
  test(`a ${ancho}px nada se sale de su sitio`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 })
    await abrirSeisPistas(page)

    // 1. La pagina no scrollea en horizontal. Nunca, a ningun ancho.
    const scrollH = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(scrollH, 'la pagina scrollea en horizontal').toBeLessThanOrEqual(0)

    // 2. Nada desborda su contenedor.
    const fuera = await page.evaluate(desbordes)
    expect(fuera, `contenido que se sale de su caja: ${JSON.stringify(fuera)}`).toEqual([])

    // 3. Nada queda cortado sin forma de llegar a ello.
    const cortado = await page.evaluate(recortados)
    expect(cortado, `contenido recortado e inalcanzable: ${JSON.stringify(cortado)}`).toEqual([])

    /* 4. Lo que tiene que verse, se ve.

       Lo exigible en cualquier ancho es que se LLEGUE: que exista y que bajar
       lo traiga a la vista. Que ademas no haga falta bajar DENTRO de una
       columna lo cubre el test de mas abajo, que es donde vive esa promesa. */
    await expect(page.locator('.panel-ampli')).toBeVisible()
    await page.locator('#otra').scrollIntoViewIfNeeded()
    await expect(page.locator('#otra')).toBeInViewport()
    await expect(page.locator('.panel-ampli')).toBeVisible()
  })
}

/* La identidad y el ampli no scrollean por dentro; la lista de pistas SI.

   La distincion no es un detalle: la identidad y el panel del ampli son dos
   bloques de datos sueltos, sin orden que seguir, y uno partido por una barra
   de scroll se lee como una ficha rota -- por eso lo que no cabe ahi se
   resuelve bajando de densidad (`ajustarDensidad()` en app.js). La lista de
   pistas es una lista numerada: scrollearla es el gesto que cualquiera espera,
   y apretarla hasta que quepan nueve filas las dejaba ilegibles.

   Se prueba a lo ALTO, no a lo ancho: el alto de la ventana es lo que aprieta,
   y 700px es un portatil corriente. */
for (const alto of [900, 800, 700]) {
  test(`con la ventana de ${alto}px de alto solo scrollea la lista de pistas`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: alto })
    await abrirSeisPistas(page)

    const scrollan = await page.evaluate(() =>
      [...document.querySelectorAll('.columnas > .ficha:not(#col-pistas)')]
        .map(c => ({ col: c.id || c.className, sobra: c.scrollHeight - c.clientHeight }))
        .filter(x => x.sobra > 1))
    expect(scrollan, `columnas con scroll propio: ${JSON.stringify(scrollan)}`).toEqual([])
  })
}

/* Y cuando la lista scrollea, su cabecera se queda arriba sin tapar nada.

   Es exactamente el bug que se veia con "Fight Fire With Fire" (9 pistas): la
   cabecera se colocaba con un margen negativo que `sticky` luego ignoraba al
   repintarla, asi que acababa 26px por debajo de donde el flujo la habia
   dejado y la primera fila quedaba medio escondida detras. Nada lo cazaba
   porque no es un desborde: las dos cajas miden bien, solo se solapan. */
test('la cabecera de la lista no tapa la primera pista al scrollear', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 })
  await abrirSeisPistas(page)

  const m = await page.evaluate(() => {
    const col = document.querySelector('#col-pistas')
    const tit = () => col.querySelector('.pistas-titulo').getBoundingClientRect()
    const primera = () => col.querySelector('.fila-pista').getBoundingClientRect()
    /* Sin scrollear: la primera fila empieza DEBAJO de la cabecera. Una fila
       que se mete bajo una cabecera opaca porque la has scrolleado es lo
       correcto; que lo este de entrada es el bug. */
    const solapeEnReposo = Math.round(tit().bottom - primera().top)
    col.scrollTop = 80
    return {
      scrollea: col.scrollHeight - col.clientHeight > 1,
      solapeEnReposo,
      // Y scrolleada sigue pegada al borde de la ficha, no se va con las filas.
      separacion: Math.round(tit().top - col.getBoundingClientRect().top),
    }
  })
  expect(m.scrollea, 'el fixture no llega a scrollear: el test no prueba nada').toBe(true)
  expect(m.solapeEnReposo, `la cabecera pisa la primera pista ${m.solapeEnReposo}px`).toBeLessThanOrEqual(0)
  expect(m.separacion, `la cabecera se despega del borde: ${m.separacion}px`).toBeLessThanOrEqual(2)
})

/* En un monitor ancho el contenido se capa y se centra en vez de estirarse: una
   fila de pista de 2400px deja el nombre a la izquierda y la dificultad a la
   derecha con medio metro de nada en medio. */
test('en un monitor ancho el contenido se capa y queda centrado', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 900 })
  await abrirSeisPistas(page)

  const m = await page.evaluate(() => {
    const c = document.querySelector('.columnas').getBoundingClientRect()
    return { ancho: Math.round(c.width), izq: Math.round(c.left), der: Math.round(window.innerWidth - c.right) }
  })
  expect(m.ancho, 'el cuerpo se estira sin tope').toBeLessThanOrEqual(1700)
  // Centrado: los dos margenes iguales, con 2px de tolerancia por redondeo.
  expect(Math.abs(m.izq - m.der), `margenes desiguales: ${m.izq} / ${m.der}`).toBeLessThanOrEqual(2)
})

/* Por debajo del corte el panel deja de ir al lado y pasa debajo, a lo ancho.
   Si siguiera en dos columnas, la de la cancion quedaria impracticable. */
test('en una ventana estrecha el panel del ampli pasa debajo', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 900 })
  await abrirSeisPistas(page)

  const m = await page.evaluate(() => {
    const t = document.querySelector('#tarjeta').getBoundingClientRect()
    const p = document.querySelector('.panel-ampli').getBoundingClientRect()
    return { tarjetaAbajo: Math.round(t.bottom), panelArriba: Math.round(p.top) }
  })
  expect(m.panelArriba, 'el panel sigue al lado en vez de debajo').toBeGreaterThanOrEqual(m.tarjetaAbajo - 1)
})
