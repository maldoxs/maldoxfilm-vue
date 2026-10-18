/**
 * moviehash — calcula la huella OSDb del archivo que se está reproduciendo.
 *
 * Para qué: buscar subtítulos POR ARCHIVO en vez de por texto. OpenSubtitles
 * indexa cada subtítulo con la huella del video para el que fue subido, así que
 * un resultado con `moviehash_match` viene sincronizado con ESA copia exacta, no
 * con "una copia parecida". Es el método que usan VLC y Kodi, y es la razón por
 * la que ahí los subtítulos suelen calzar sin tocar nada. Buscando por nombre del
 * release se cae seguido en un .srt de otra edición, con el intro de distinta
 * duración, y entra corrido.
 *
 * La huella es el tamaño del archivo sumado a las palabras de 64 bits de sus
 * primeros y últimos 64 KB, en aritmética sin signo de 64 bits. Es decir: hacen
 * falta 128 KB del archivo, no el archivo entero.
 *
 * Por qué en el servidor y no en el navegador: el enlace de Real-Debrid no manda
 * cabeceras CORS, así que el navegador no puede leerle bytes. Acá no hay esa
 * restricción. De paso, el enlace no vuelve a salir a ningún lado.
 *
 * ESM porque package.json declara "type":"module".
 */

import { hostPermitido, enlaceDirectoDeRd } from '../lib/rd.js';

// Se reexporta para las pruebas, que verifican acá la lista de hosts aceptados.
export { hostPermitido };

const TROZO = 65536; // 64 KB, lo que define el algoritmo OSDb
const MASCARA = (1n << 64n) - 1n;

/** Suma las palabras de 64 bits (little-endian) de un bloque de bytes. */
export function sumarBloque(bytes) {
  let suma = 0n;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 8 <= bytes.byteLength; i += 8) {
    suma = (suma + vista.getBigUint64(i, true)) & MASCARA;
  }
  return suma;
}

/** Huella OSDb en hexadecimal de 16 dígitos. */
export function calcularHuella(tamano, inicio, final) {
  const h = (BigInt(tamano) + sumarBloque(inicio) + sumarBloque(final)) & MASCARA;
  return h.toString(16).padStart(16, '0');
}

async function pedirRango(url, desde, hasta) {
  const r = await fetch(url, { headers: { Range: `bytes=${desde}-${hasta}` }, redirect: 'follow' });
  if (!r.ok && r.status !== 206) throw new Error(`rango ${desde}-${hasta}: ${r.status}`);
  // `Content-Range: bytes 0-65535/1363773830` trae el tamaño total del archivo.
  const rango = r.headers.get('content-range') || '';
  const total = Number(rango.split('/')[1] || 0);
  return { bytes: new Uint8Array(await r.arrayBuffer()), total };
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: '{"error":"method"}' };

  let url = '';
  let rdId = '';
  try {
    const cuerpo = JSON.parse(event.body || '{}');
    url = cuerpo.url || '';
    rdId = typeof cuerpo.rdId === 'string' && /^[A-Z0-9]{1,30}$/i.test(cuerpo.rdId) ? cuerpo.rdId : '';
  } catch {
    return { statusCode: 400, headers: cors, body: '{"error":"body"}' };
  }

  // El enlace que usa el reproductor es el de Torrentio, que redirige al de
  // Real-Debrid. A nuestro servidor, Torrentio le responde 403: bloquea centros
  // de datos y solo atiende navegadores (medido el 18-10-2026; desde una máquina
  // común el mismo enlace responde 302). Así que cuando viene el identificador
  // del archivo en Real-Debrid, se le pide el enlace a Real-Debrid y se saltea
  // el intermediario.
  if (rdId) {
    const directo = await enlaceDirectoDeRd(rdId);
    if (directo) url = directo;
  }
  // El enlace puede llevar credenciales del usuario en la ruta: no se registra
  // nunca, ni siquiera en los mensajes de error.
  if (!hostPermitido(url)) return { statusCode: 400, headers: cors, body: '{"error":"host"}' };

  try {
    // El tamaño sale del PRIMER pedido de rango, no de un HEAD.
    //
    // Por qué: el enlace que manda el reproductor es el de Torrentio, que
    // redirige al de Real-Debrid. A un HEAD sobre ese enlace no vuelve el tamaño
    // del archivo, así que la primera versión se rendía al instante con
    // "motivo: tamaño" (medido en la TV el 18-10-2026). La cabecera
    // `Content-Range` de un pedido parcial sí lo trae, y de paso es un viaje
    // menos.
    const primero = await pedirRango(url, 0, TROZO - 1);
    const tamano = primero.total;
    if (!tamano || tamano < TROZO * 2) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ hash: null, motivo: 'tamaño' }) };
    }

    const ultimo = await pedirRango(url, tamano - TROZO, tamano - 1);
    if (primero.bytes.byteLength < TROZO || ultimo.bytes.byteLength < TROZO) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ hash: null, motivo: 'rango' }) };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ hash: calcularHuella(tamano, primero.bytes, ultimo.bytes), size: tamano }),
    };
  } catch (e) {
    // Que no se pueda calcular la huella no es un error para el reproductor:
    // sigue la búsqueda por texto de siempre. Se devuelve el detalle para poder
    // distinguir un bloqueo del intermediario de un problema nuestro; el mensaje
    // no incluye el enlace, que puede llevar credenciales.
    const detalle = (e?.message || String(e)).slice(0, 120);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ hash: null, motivo: detalle }) };
  }
};
