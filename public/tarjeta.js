/* ---------------------------------------------------------------------------
   Lógica pura de la tarjeta de sugerencia.

   Puro a propósito, igual que catalogo-lt25.js: vive en public/ porque el
   navegador lo carga como módulo servido, pero test/ lo importa directo desde
   disco. El resto de app.js no tiene tests automatizados por decisión de
   diseño -- tiene un `addEventListener` a nivel de módulo que llama a
   `document` en el import, y con eso no hay forma de importarlo en Node --
   este módulo es la excepción: es exactamente el código que costó las rondas
   de revisión 2, 3 y 4 sobre lo que la tarjeta promete y lo que el botón de
   verdad manda al amplificador, verificado leyendo el código a mano en vez de
   con un test.

   app.js importa de acá. El comportamiento visible de la tarjeta no cambia
   por esta extracción -- si algún texto cambia para una canción real de hoy,
   el extracto está mal. La única excepción es `resumenEnvioAmpli`, que al
   escribirle test agregó el guardia de `enviaModelo` sobre las perillas (ver
   su comentario): cierra un caso hoy inalcanzable con los datos del catálogo,
   ninguna canción real cambia de texto por eso. */

import { esRol } from './track-classifier.js'

export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/* Ronda de revision 4: que parametros del nodo `amp` va a escribir DE VERDAD
   este envio -- y el UNICO origen para las dos cosas que necesitan saberlo:
   la frase de la tarjeta (que perillas nombrar) y el salto del envio real
   (`enviar-ampli`, en app.js, que recorre `u.valores` para la ranura `amp`).

   Antes cada sitio hacia su propia cuenta. `paraElAmpli()` (lib/ampli.js,
   con test) solo convierte gain/treb/bass -- por diseno, volume y mid quedan
   fuera de esa funcion por razones DISTINTAS (volume esta en decibeles y no
   sabemos su curva; mid simplemente no lo escribe esa funcion aunque su curva
   SI se sepa) -- y la frase de la tarjeta se quedaba solo con esas tres,
   mientras el envio de mas abajo recorria la cadena entera y mandaba
   cualquier perilla de `amp` que no fuera `volume` y no estuviera ya en
   `paraElAmpli`. Eso incluye `mid`: la planilla lo declara en las 86 filas
   que traen bloque de amp, el envio lo manda de verdad (curva lineal, igual
   que gain/treb/bass), y la tarjeta nunca lo decia -- 3.582 canciones con un
   ajuste de medios invisible.

   `perillasAmpli` son las claves YA convertidas por el servidor (paraElAmpli,
   escala de cable); lo que la cadena de la planilla trae ADEMAS para esa
   misma ranura, sin `volume` (el tuyo, no el de la planilla) y sin repetir
   una clave que perillasAmpli ya cubre, es `extra`. Mutar esta funcion mueve
   la frase Y el envio juntos: no hay una segunda lista que pueda quedar
   desincronizada. */
export function parametrosAmpQueViajan(cadena, perillasAmpli) {
  const yaConvertidas = new Set(Object.keys(perillasAmpli ?? {}))
  const extra = Object.keys(cadena?.amp?.valores ?? {})
    .filter(p => p !== 'volume' && !yaConvertidas.has(p))
  return { yaConvertidas, extra }
}

// Nombre visible de cada parametro de `amp`, para la frase de la tarjeta.
// Una clave que este mapa no conoce NO desaparece (ver el `??` de abajo): se
// nota con su propio nombre crudo antes que perderse en silencio, porque
// despues de esta ronda el helper de arriba ya no esta limitado a tres
// pares fijos y una clave nueva algun dia va a llegar sin nombre.
export const NOMBRE_PERILLA_AMPLI = { gain: 'Gain', treb: 'Treble', bass: 'Bass', mid: 'Mid' }
export const nombrePerillaAmpli = clave => NOMBRE_PERILLA_AMPLI[clave] ?? clave

// Une una lista de frases con "y" antes de la ultima, sin Oxford comma --
// con 0 o 1 pieza no hay nada que unir.
export const conjuncion = piezas => piezas.length <= 1
  ? (piezas[0] ?? '')
  : `${piezas.slice(0, -1).join(', ')} y ${piezas[piezas.length - 1]}`

/* Ronda de revision 3: "los efectos" (aca y en la frase de `queSeManda`) no
   puede depender de `a.cadena` a secas -- "Number Girl / Mukai Shutoku,
   Ryhthm" (hoy inalcanzable, ningun artista del catalogo calza) trae una
   cadena con SOLO `amp`, sin ninguna ranura de efectos, y con `a.cadena`
   a secas la tarjeta diria "los efectos" arriba y "sin efectos: este tono
   es el ampli pelado" cuatro lineas mas abajo. La condicion correcta es que
   haya al menos una ranura de efectos, que es lo mismo que ya calculaba
   cadenaHtml en app.js para elegir entre la lista y el aviso -- se comparte,
   no se duplica.

   Ronda de revision 2: la frase de "que se manda" tiene que nombrar
   exactamente lo que viaja, en las DOS ramas -- la ronda 1 solo lo arreglo
   para la ruta sin cadena.

   - El modelo solo viaja si `a.modelo` no es null: sin fenderId que poner,
     el paso 1 del envio nunca carga esa ranura.
   - Los efectos solo existen si `hayEfectos`.
   - Las perillas de los efectos NO se prometen aqui: cuales se pudieron
     convertir de verdad solo se sabe al enviar (Task 7 ya lo dice en la
     linea de estado). La tarjeta promete lo que puede prometer antes de
     apretar el boton, no mas.

   Ronda de revision 3: "las perillas de Gain, Treble y Bass" prometia las
   tres como bloque fijo, y 168 canciones alcanzables rompen eso en una sola
   perilla (155 Metallica sin bass, 6 Santana sin treble, 7 mas sin gain).
   Igual que el Reverb, amp.volume y el Volume antes, el arreglo no es
   escribir a mano una lista mejor: esta pieza se DERIVA de `a.paraElAmpli`,
   el MISMO objeto que usa el envio (paraElAmpli() omite la clave que llega
   en null, que es justo por lo que existe la omision), asi que la promesa
   no puede desviarse del envio -- las dos leen el mismo dato. Si queda una
   perilla, la frase dice una; si quedan dos, dos; si no queda ninguna, la
   pieza entera desaparece (el `> 0` explicito corta eso, en vez de
   imprimir "las perillas de ." colgando).

   Ronda de revision 4: `paraElAmpli` no es TODO lo que este envio manda al
   nodo `amp` -- `mid` viaja por la cadena (Step 3 del envio en app.js), no
   por aqui, y se habia escapado de esta cuenta por eso mismo. Ahora la
   pieza sale de `parametrosAmpQueViajan`, el mismo helper que usa el salto
   del Step 3: no puede desviarse porque las dos lecturas son la misma
   llamada.

   Las perillas del ampli SI dependen de `enviaModelo`, a diferencia de los
   efectos: en app.js, `objetivo('amp')` cae a `sugerencia.fenderId` cuando la
   cadena no trae su propio fenderId para esa ranura, y sin uno de los dos el
   Step 1 nunca entra a esa ranura -- `conUnidad.has('amp')` queda falso y el
   Step 2 (las perillas ya convertidas) no corre ninguna iteracion. Prometer
   perillas sin modelo seria la interfaz afirmando algo que el boton no hace.
   Hoy no es alcanzable (en los dos origenes de sugerencia -- reglas y
   comunidad -- `modelo` y las perillas nacen del mismo dato: si no hay
   `cadena.amp`, gain/treble/bass/mid llegan null y `modelo` tambien), pero se
   guarda igual, como el `esc()` del punto 4 y el guardia del punto 9: que
   quede cierto por codigo, no por una casualidad de los datos de hoy. */
export function resumenEnvioAmpli(a) {
  const ranurasDeEfectos = a?.cadena ? ['stomp', 'mod', 'delay', 'reverb'].filter(r => a.cadena[r]) : []
  const hayEfectos = ranurasDeEfectos.length > 0

  const enviaModelo = a?.modelo != null
  const { yaConvertidas, extra } = parametrosAmpQueViajan(a?.cadena, a?.paraElAmpli)
  const nombresPerillasQueViajan = enviaModelo ? [...yaConvertidas, ...extra].map(nombrePerillaAmpli) : []
  const piezasEnvio = [
    enviaModelo && 'el <strong>modelo</strong>',
    hayEfectos && 'los <strong>efectos</strong>',
    nombresPerillasQueViajan.length > 0
      && `las perillas de ${conjuncion(nombresPerillasQueViajan.map(n => `<strong>${n}</strong>`))}`,
  ].filter(Boolean)
  const queSeManda = piezasEnvio.length
    ? `Al ampli se mandan ${conjuncion(piezasEnvio)}.`
    : 'Sin modelo declarado, esta canción no manda nada al ampli por sí sola.'

  return { ranurasDeEfectos, hayEfectos, piezasEnvio, queSeManda }
}

/* Como se nombra una pista en el selector.

   El nombre crudo del catalogo es lo mas util cuando existe ("Kirk Hammett |
   Gibson Flying V | Lead Guitar" dice mas que "Distortion Guitar"), pero el
   catalogo trae nombres vacios y en otros alfabetos. Sin nombre se cae al
   instrumento: una opcion en blanco no se puede elegir a proposito.

   La afinacion solo aparece cuando describeTuning devolvio algo -- estandar
   es null y no se dice, misma regla que la tarjeta ya usaba. */
export function etiquetaDePista(pista) {
  const nombre = pista.name?.trim() || pista.instrument
  return [nombre, `dificultad ${pista.difficulty}`, pista.tuning]
    .filter(Boolean)
    .join(' · ')
}

/* El selector de pista de la tarjeta: el bloque entero, o vacio cuando no hay
   nada que elegir.

   Devuelve HTML, igual que `resumenEnvioAmpli` devuelve la frase del pie: lo
   que decide QUE dice la tarjeta vive aca, con test, y app.js solo lo pega en
   su sitio. Con una sola pista no se dibuja nada -- ofrecer un desplegable de
   una opcion es prometer una eleccion que no existe.

   El `esc()` es de esta funcion y no de quien la llama: `name` sale del
   catalogo, es texto de terceros, y no puede depender de que cada sitio de
   uso se acuerde.

   Las pistas que no cumplen el filtro se listan igual, marcadas: quien mira
   tiene que poder ver por que salio esta cancion y cual pista no fue el
   motivo. */
export function selectorDePistas(pistas, elegida) {
  if (pistas.length <= 1) return ''
  const opciones = pistas.map((p, i) => `
          <option value="${i}"${i === elegida ? ' selected' : ''}${p.califica ? '' : ' class="no-califica"'}>
            ${esc(etiquetaDePista(p))}${p.califica ? '' : ' — fuera del filtro'}
          </option>
        `).join('')
  return `
    <div class="pistas">
      <label for="pista">Pista</label>
      <select id="pista">${opciones}</select>
    </div>
  `
}

/* Las palabras que distinguen el rol viven en `track-classifier.js`, no aqui:
   este archivo las usaba para elegir una etiqueta legible y la fase 2 las
   necesita para decidir un tono, y dos vocabularios en dos archivos se
   desvian -- la primera vez que lo hicieran, el sintoma seria que la etiqueta
   dice una cosa y el tono se calcula con otra. */
const segmentos = nombre => String(nombre ?? '').split('|').map(s => s.trim()).filter(Boolean)

/* Devuelve etiquetas cortas y distintas para todas las pistas de una cancion.
   El catalogo no mantiene el mismo orden para musico, equipo y rol, por eso
   primero se descarta lo comun y solo despues se busca el rol. */
export function etiquetasDePistas(pistas) {
  const listas = pistas.map(p => segmentos(p.name))
  let base = pistas.map((p, i) => {
    const lista = listas[i]
    if (!lista.length) return p.instrument
    const comunes = pistas.length > 1
      ? new Set(lista.filter(x => listas.every(hermana => hermana.includes(x))))
      : new Set()
    const quedan = lista.filter(x => !comunes.has(x))
    const candidatas = quedan.length ? quedan : lista
    return candidatas.find(x => esRol(x)) ?? candidatas.at(-1)
  })

  base = base.map((etiqueta, i) => {
    const choques = base.map((otra, j) => j !== i && otra === etiqueta ? j : -1).filter(j => j >= 0)
    if (!choques.length) return etiqueta
    const ajenos = new Set(choques.flatMap(j => listas[j]))
    const propio = listas[i].find(x => x !== etiqueta && !ajenos.has(x))
    return propio ? `${propio} · ${etiqueta}` : etiqueta
  })

  const cantidad = {}
  for (const etiqueta of base) cantidad[etiqueta] = (cantidad[etiqueta] ?? 0) + 1
  return base.map((etiqueta, i) => cantidad[etiqueta] > 1 ? `${etiqueta} · ${i + 1}` : etiqueta)
}

const familiaInstrumento = instrumento => {
  const i = String(instrumento ?? '').toLowerCase()
  if (i.includes('acoustic')) return 'ACÚSTICA'
  if (i.includes('distortion')) return 'DISTORSIÓN'
  if (i.includes('clean')) return 'LIMPIA'
  return 'OTRAS'
}

/* Lista visible de pistas. La posicion es la promesa que usan los atajos 1-9. */
export function listaDePistas(pistas, elegida) {
  if (pistas.length <= 1) return ''
  const etiquetas = etiquetasDePistas(pistas)
  const grupos = new Map()
  pistas.forEach((pista, indice) => {
    const familia = familiaInstrumento(pista.instrument)
    if (!grupos.has(familia)) grupos.set(familia, [])
    grupos.get(familia).push({ pista, indice })
  })
  let posicion = 0
  const orden = ['ACÚSTICA', 'DISTORSIÓN', 'LIMPIA', 'OTRAS']
  const contenido = [...grupos].sort(([a], [b]) => orden.indexOf(a) - orden.indexOf(b)).map(([familia, filas]) => `
    <section class="grupo-pistas" data-familia="${familia}"><h3>${familia} <span>· ${filas.length}</span></h3>
      ${filas.map(({ pista, indice }) => {
        posicion += 1
        const ampli = pista.ampli?.modelo ? ` · ${esc(pista.ampli.modelo)}` : ''
        return `<button type="button" class="fila-pista${indice === elegida ? ' elegida' : ''}${pista.califica ? '' : ' fuera-filtro'}"
          data-pista="${indice}" title="${esc(pista.name || pista.instrument)}" aria-pressed="${indice === elegida}">
          <b>${posicion}</b><span class="nombre-pista">${esc(etiquetas[indice])}</span>
          <small>${esc(pista.instrument)} · ${esc(pista.tuning ?? 'E estándar')}${ampli}</small>
          <em>${pista.califica ? '' : '<span class="fuera-etiqueta">fuera del filtro</span>'}${pista.difficulty != null ? `<span class="medidor" role="img" aria-label="Dificultad ${esc(pista.difficulty)} de 10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < pista.difficulty ? 'on' : ''}"></i>`).join('')}</span><span>${esc(pista.difficulty)}</span>` : ''}</em>
        </button>`
      }).join('')}
    </section>`).join('')
  const cuantas = `${pistas.length} pista${pistas.length === 1 ? '' : 's'}`
  return `<div class="pistas-lista"><p class="pistas-titulo">Pistas de la canción<span>${cuantas}</span></p><div class="pistas-filas">${contenido}</div></div>`
}

/* Un enlace a la BUSQUEDA de Ultimate Guitar, no a una tab concreta.

   No puede ser mejor que eso. Apuntar a la tab exacta exigiria consultar su
   catalogo con la sesion del suscriptor, que es justo lo que esa suscripcion
   paga. Y traer su pagina dentro de la nuestra tampoco es posible: su cabecera
   declara `content-security-policy: frame-ancestors 'self' www.911tabs.com`,
   asi que el navegador se niega a renderizarla en un iframe servido desde
   localhost. Comprobado contra el sitio real el 2026-09-12; no es una
   limitacion de este codigo sino una decision de ellos que el navegador aplica.

   La banda viaja junto al titulo porque el catalogo tiene artistas oscuros
   donde el titulo solo no alcanza. Contra el buscador real, las dos formas
   ponen la correcta primera ("fear of the dark" y "iron maiden fear of the
   dark"), asi que incluirla no cuesta nada y en los casos raros salva.

   El titulo va TAL CUAL. Iba a limpiarle los parentesis hasta medirlo: de los
   944 titulos del catalogo que los traen, casi todos son parentesis de verdad
   -- "Welcome Home (Sanitarium)", "Snow (Hey Oh)", "My Own Summer (Shove It)"
   -- y quitarlos empeoraria la busqueda. Los que repiten el nombre de la banda,
   que si serian ruido, son 23 de 10.011: no valen un caso especial. */
export function urlUltimateGuitar(artist, title) {
  const banda = String(artist ?? '').trim()
  const tema = String(title ?? '').trim()
  // Sin uno de los dos no hay busqueda util: mandaria a una pagina de
  // resultados vacia. Quien llama decide si dibuja el enlace o no.
  if (!banda || !tema) return null
  const q = encodeURIComponent(`${banda} ${tema}`)
  return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`
}
