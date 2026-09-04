const defaultSleep = ms => new Promise(r => setTimeout(r, ms))

const UA = 'song-suggest/1.0 (proyecto personal)'

export async function fetchJson(url, opts = {}) {
  const { retries = 3, baseDelayMs = 500, sleep = defaultSleep } = opts
  let ultimoError

  for (let intento = 0; intento < retries; intento++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })

      // 4xx que no sea 429 es culpa nuestra: reintentar no ayuda.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} en ${url}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)

      return await res.json()
    } catch (err) {
      ultimoError = err
      if (/HTTP 4(?!29)\d\d/.test(err.message)) throw err
      if (intento === retries - 1) break

      // Ante 429 bajamos el ritmo mucho mas que ante un error transitorio.
      const esRateLimit = err.message.includes('429')
      const factor = esRateLimit ? 8 : 1
      await sleep(baseDelayMs * factor * Math.pow(2, intento))
    }
  }

  throw ultimoError
}

export async function runPool(items, concurrency, worker) {
  let siguiente = 0
  const obreros = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      await worker(items[i], i)
    }
  })

  // allSettled y no all: con `all`, el primer worker que lanza hace que este
  // await retorne de inmediato mientras los otros obreros siguen corriendo en
  // segundo plano, mutando estado despues de que el llamador ya creyo haber
  // terminado. Drenamos todos los obreros y recien ahi propagamos el error.
  //
  // CONTRATO: runPool propaga el primer error del worker. Quien necesite
  // tolerar fallos por item -- como enrichPending, que debe seguir pese a que
  // una cancion falle -- captura dentro del propio worker.
  const resultados = await Promise.allSettled(obreros)
  const fallo = resultados.find(r => r.status === 'rejected')
  if (fallo) throw fallo.reason
}
