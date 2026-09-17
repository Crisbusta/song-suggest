import { test, expect } from '@playwright/test'

/* El fixture no tiene amplificador conectado -- WebHID no existe en el
   navegador de pruebas --, asi que aqui se comprueba lo que NO depende del
   equipo: que el boton de guardar existe y esta deshabilitado sin ampli, y
   que no se pide un veredicto antes de que haya sonado nada.

   Se abre SIEMPRE la misma cancion, por el mismo motivo que en
   responsive.spec.js: el sorteo es aleatorio y el panel solo dibuja sus
   botones cuando la cancion tiene sugerencia de ampli. Sin fijar la cancion,
   este archivo pasaba o fallaba segun lo que saliera. */
const abrirSeisPistas = async page => {
  await page.goto('/')
  await page.fill('#cancion-q', 'Seis Pistas')
  await page.locator('#cancion-sug li[data-valor]').first().waitFor()
  await page.keyboard.press('Enter')
  await page.locator('.pistas-lista').waitFor()
}

test('sin ampli conectado, "Guardar mi tono" existe pero no se puede pulsar', async ({ page }) => {
  await abrirSeisPistas(page)
  const boton = page.locator('#guardar-tono')
  await expect(boton).toBeVisible()
  await expect(boton).toBeDisabled()
})

test('el veredicto solo aparece despues de enviar, no antes', async ({ page }) => {
  await abrirSeisPistas(page)
  // Preguntar "como sono" antes de que suene es pedir una opinion sobre nada.
  await expect(page.locator('.veredicto')).toHaveCount(0)
  await expect(page.locator('#envio-estado')).toHaveText('Sin enviar todavía')
})
