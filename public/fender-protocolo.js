/* ---------------------------------------------------------------------------
   Protocolo del Fender Mustang LT (serie LT), reimplementado desde la
   documentación de LtAmp y verificado contra el equipo real.

   Este archivo es PURO a propósito: no toca WebHID ni el DOM. Vive en public/
   porque el navegador lo carga como módulo servido, pero `test/` lo importa
   directo desde disco. El front no tiene tests automatizados por decisión de
   diseño, y este es justo el código donde un desfase de un byte no revienta:
   descarta todo en silencio y se ve igual que "el amplificador no contesta".
   --------------------------------------------------------------------------- */

// --- protobuf, escrito a mano (no hay dependencias en este proyecto) --------
const varint = n => { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x) } while (n); return b }

export const campoVarint = (num, val) => [...varint((num << 3) | 0), ...varint(val)]
export const campoBytes = (num, bytes) => [...varint((num << 3) | 2), ...varint(bytes.length), ...bytes]
export const campoTexto = (num, str) => campoBytes(num, [...new TextEncoder().encode(str)])
export const campoFloat = (num, f) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setFloat32(0, f, true)
  return [...varint((num << 3) | 5), ...b]
}

/* Todo mensaje va envuelto en un FenderMessageLT: responseType (campo 1) más el
   submensaje del oneof. El responseType NO es opcional — se probó omitirlo
   contra el equipo y responde con silencio absoluto. */
export const codificarMensaje = (campo, subcampos) =>
  new Uint8Array([...campoVarint(1, 0), ...campoBytes(campo, subcampos)])

// --- framing HID ------------------------------------------------------------
export const TAG_INICIO = 0x33, TAG_CONTINUA = 0x34, TAG_UNICO = 0x35

/* Envío: 64 bytes limpios. WebHID recibe el reportId por separado, así que
   aquí NO va el byte de reportId. Medido: 63 y 64 funcionan, 65 lo rechaza
   Chrome por exceder el tamaño del reporte. */
export function empaquetar(carga) {
  if (carga.length > 61) throw new Error(`la carga no cabe en un paquete: ${carga.length} bytes`)
  const b = new Uint8Array(64)
  b[0] = TAG_UNICO
  b[1] = carga.length
  b.set(carga, 2)
  return b
}

/* Recepción: `e.data` SÍ trae el byte nulo inicial del protocolo, así que el
   tag está en el byte 1 y no en el 0. Leerlo en el 0 fue un error real durante
   el sondeo y no producía ninguna excepción: descartaba todas las respuestas.  */
export function crearReensamblador() {
  let partes = []
  let abierta = false   // ¿hubo un 0x33 que abriera esta secuencia?
  return {
    recibir(bytes) {
      const tag = bytes[1], largo = bytes[2]
      const carga = bytes.slice(3, 3 + largo)
      if (tag === TAG_INICIO) { partes = [carga]; abierta = true; return null }
      if (tag === TAG_CONTINUA) {
        // Una continuación sin inicio es basura: acumularla corrompería el
        // mensaje siguiente, que se entregaría como si fuera válido.
        if (!abierta) return null
        partes.push(carga); return null
      }
      if (tag !== TAG_UNICO) return null   // tag desconocido: se descarta
      if (!abierta) return carga           // paquete único
      partes.push(carga)
      const total = new Uint8Array(partes.reduce((a, p) => a + p.length, 0))
      let o = 0
      for (const p of partes) { total.set(p, o); o += p.length }
      partes = []; abierta = false
      return total
    },

    /* Descarta cualquier secuencia multi-paquete a medio armar. El protocolo no
       lleva identificador de correlacion, asi que un 0x33 que nunca recibio su
       cierre contaminaria el siguiente mensaje. Se llama al empezar cada
       operacion, donde sabemos que no hay nada legitimo a medias. */
    reiniciar() { partes = []; abierta = false },
  }
}

// --- lectura ----------------------------------------------------------------
export function leerCampos(buf) {
  const salida = []
  let i = 0
  while (i < buf.length) {
    let tag = 0, s = 0
    while (i < buf.length) { const b = buf[i++]; tag |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break }
    const num = tag >>> 3, tipo = tag & 7
    if (!num) break
    if (tipo === 0) {
      let v = 0, s2 = 0
      while (i < buf.length) { const b = buf[i++]; v |= (b & 0x7f) << s2; s2 += 7; if (!(b & 0x80)) break }
      salida.push({ num, v })
    } else if (tipo === 2) {
      let l = 0, s2 = 0
      while (i < buf.length) { const b = buf[i++]; l |= (b & 0x7f) << s2; s2 += 7; if (!(b & 0x80)) break }
      salida.push({ num, bytes: buf.slice(i, i + l) }); i += l
    } else if (tipo === 5) {
      salida.push({ num, f: new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true) }); i += 4
    } else break
  }
  return salida
}

// --- mensajes concretos -----------------------------------------------------
export const SYNC_BEGIN = codificarMensaje(113, [...campoVarint(1, 0), ...campoVarint(2, 0)])
export const SYNC_END   = codificarMensaje(113, [...campoVarint(1, 1), ...campoVarint(2, 0)])
export const HEARTBEAT  = codificarMensaje(201, campoVarint(1, 1))

export const mensajePonerParametro = (nodo, parametro, valor) =>
  codificarMensaje(34, [...campoTexto(1, nodo), ...campoTexto(2, parametro), ...campoFloat(3, valor)])

const texto = b => new TextDecoder().decode(b)

/* Traduce un mensaje crudo a algo con nombre. Solo reconoce lo que está
   función necesita hoy; el resto cae en 'desconocido' sin lanzar. */
export function interpretar(mensaje) {
  const campos = leerCampos(mensaje)
  const sub = campos.find(c => c.num !== 1)
  if (!sub) return { tipo: 'desconocido' }
  const dentro = sub.bytes ? leerCampos(sub.bytes) : []
  switch (sub.num) {
    case 35: {
      // Por número de campo, no por posición: el orden en el cable no está
      // garantizado, y equivocarse aquí asignaría mal nodo/parámetro/valor
      // sin lanzar nada.
      const busca = n => dentro.find(c => c.num === n)
      return {
        tipo: 'ackParametro',
        nodo: busca(1)?.bytes ? texto(busca(1).bytes) : null,
        parametro: busca(2)?.bytes ? texto(busca(2).bytes) : null,
        valor: busca(3)?.f,
      }
    }
    case 100: {
      const busca = n => dentro.find(c => c.num === n)
      return { tipo: 'identificacion', texto: busca(1)?.bytes ? texto(busca(1).bytes) : '' }
    }
    case 103: {
      const busca = n => dentro.find(c => c.num === n)
      return { tipo: 'firmware', texto: busca(1)?.bytes ? texto(busca(1).bytes) : '' }
    }
    case 113: return { tipo: 'sync' }
    default: return { tipo: 'desconocido' }
  }
}
