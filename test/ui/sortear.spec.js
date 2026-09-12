import { test, expect } from '@playwright/test'

/* ---------------------------------------------------------------------------
   Las invariantes que un rediseño rompe sin querer.

   No son tests de aspecto: ninguno comprueba un color ni una medida. Comprueban
   las promesas que el proyecto lleva documentadas en CLAUDE.md y que costaron
   rondas de revision -- las que se "arreglan" por error porque parecen bugs.

   Corren contra `test/ui/servidor-fixture.mjs`, una base en memoria con datos
   inventados: nunca tocan tu songs.db.
   --------------------------------------------------------------------------- */

const abrirCancion = async (page, texto) => {
  await page.fill('#cancion-q', texto)
  await page.locator('#cancion-sug li[data-valor]').first().waitFor()
  await page.keyboard.press('Enter')
  await page.locator('.cancion-identidad h2').waitFor()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('#tarjeta').waitFor()
})

/* El contador describe los FILTROS, no la cancion que estas viendo. Buscar una
   cancion no sale de los controles, asi que no puede moverlo. */
test('abrir una cancion buscada no mueve el contador', async ({ page }) => {
  const antes = await page.locator('#calzan').textContent()
  await abrirCancion(page, 'Seis Pistas')
  await expect(page.locator('.cancion-identidad h2')).toHaveText('Cancion De Seis Pistas')
  await expect(page.locator('#calzan')).toHaveText(antes)
})

/* Misma regla para "Sortear de todo", y ademas no puede tocar los controles:
   al volver, tu configuracion sigue donde la dejaste. */
test('sortear de todo no mueve el contador ni toca los controles', async ({ page }) => {
  await page.selectOption('#modo', 'riffs')
  const modo = await page.locator('#modo').inputValue()
  const contador = await page.locator('#calzan').textContent()

  await page.click('#todo')
  await expect(page.locator('.cancion-identidad h2')).toBeVisible()

  await expect(page.locator('#modo')).toHaveValue(modo)
  await expect(page.locator('#calzan')).toHaveText(contador)
})

/* Se muestran igual, marcadas: asi se ve POR QUE salio esta cancion y cual
   pista no fue el motivo. Esconderlas seria esconder el criterio.

   Ojo con como se llega aqui: una cancion ABIERTA DESDE EL BUSCADOR no tiene
   filtro contra el que calificar, asi que todas sus pistas califican y el test
   pasaria en vacio. Tiene que venir de un SORTEO con filtro.

   Con la dificultad en 1-3 el fixture deja una sola candidata -- la de seis
   pistas, cuatro faciles y dos dificiles -- asi que el sorteo es determinista
   y las dos dificiles tienen que verse marcadas. */
test('las pistas que no cumplen el filtro se ven, marcadas', async ({ page }) => {
  await page.selectOption('#min', '1')
  await page.selectOption('#max', '3')
  await expect(page.locator('.cancion-identidad h2')).toHaveText('Cancion De Seis Pistas')

  const fuera = page.locator('.fila-pista.fuera-filtro')
  await expect(fuera).toHaveCount(2)
  await expect(fuera.first().locator('.fuera-etiqueta')).toHaveText('fuera del filtro')
  // Y siguen estando: marcadas, no escondidas.
  await expect(page.locator('.fila-pista')).toHaveCount(6)
})

/* La mas vista DE LAS QUE CALIFICAN, no la primera de la lista. La lista agrupa
   por instrumento y las acusticas van arriba, pero la mas vista es el Lead con
   distorsion: si algun dia esto elige la fila 1, la invariante se rompio. */
test('la pista elegida es la mas vista, no la primera de la lista', async ({ page }) => {
  await abrirCancion(page, 'Seis Pistas')

  const elegida = page.locator('.fila-pista.elegida')
  await expect(elegida).toHaveCount(1)
  await expect(elegida.locator('.nombre-pista')).toHaveText('Lead Guitar')

  // Y no es la primera fila: la lista abre con las acusticas.
  await expect(page.locator('.fila-pista').first().locator('.nombre-pista'))
    .not.toHaveText('Lead Guitar')
})

/* El tono de cada pista ya viaja en la respuesta: cambiar de pista es puro
   cliente. Si alguna vez pide algo al servidor, se rompio el diseño. */
test('cambiar de pista no genera ninguna peticion', async ({ page }) => {
  await abrirCancion(page, 'Seis Pistas')

  const peticiones = []
  page.on('request', r => { if (r.url().includes('/api/')) peticiones.push(r.url()) })

  await page.locator('.fila-pista').first().click()
  await expect(page.locator('.fila-pista').first()).toHaveClass(/elegida/)
  await page.waitForTimeout(300)

  expect(peticiones).toEqual([])
})

/* El panel del ampli es donde se ve el beneficio de la feature -- comparar el
   tono de dos pistas. Si se cierra en cada cambio, comparar cuesta un clic
   extra cada vez. Se arreglo una vez; que no vuelva. */
test('cambiar de pista no cierra el panel del ampli', async ({ page }) => {
  await abrirCancion(page, 'Seis Pistas')
  const detalles = page.locator('.panel-detalles')
  await detalles.locator('summary').click()
  await expect(detalles).toHaveAttribute('open', '')

  await page.locator('.fila-pista').first().click()
  await expect(detalles).toHaveAttribute('open', '')
})

/* Con una sola pista no hay nada que elegir: la lista entera sobra. */
test('una cancion de una sola pista no muestra la lista', async ({ page }) => {
  await abrirCancion(page, 'Una Pista')
  await expect(page.locator('.pista-unica')).toBeVisible()
  await expect(page.locator('.fila-pista')).toHaveCount(0)
})

/* El alto se reparte: la pagina no scrollea y la botonera nunca se va de la
   vista. Antes esto lo decidia un `calc(100vh - 12rem)` que no cuadraba con lo
   que las barras miden de verdad, y sobraban 16px de scroll vacio. */
test('la pagina cabe en la pantalla y la botonera se ve siempre', async ({ page }) => {
  await abrirCancion(page, 'Seis Pistas')

  const desborde = await page.evaluate(() =>
    document.documentElement.scrollHeight - window.innerHeight)
  expect(desborde).toBeLessThanOrEqual(0)

  await expect(page.locator('.acciones')).toBeInViewport()
})
