/* Los tests de navegador son los unicos que necesitan algo instalado, y por eso
   corren aparte: `npm test` sigue siendo node:test puro, sin red y sin binarios.
   `npm run test:ui` es el que arranca esto. */
export default {
  testDir: './test/ui',
  testMatch: '**/*.spec.js',
  fullyParallel: false,      // el fixture es un solo servidor con una sola base
  use: {
    baseURL: 'http://localhost:3199',
    // Escritorio: esta app no tiene version movil (WebHID es de Chrome/Edge).
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node test/ui/servidor-fixture.mjs',
    url: 'http://localhost:3199',
    reuseExistingServer: false,
    timeout: 15000,
  },
}
