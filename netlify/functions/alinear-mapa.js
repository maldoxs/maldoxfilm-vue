/**
 * alinear-mapa — DIAGNÓSTICO. Devuelve el mapa de voz de la película, crudo.
 *
 * No decide nada ni guarda nada: escucha los tramos y entrega, por cada uno,
 * desde qué milisegundo arranca y qué cuadros de 100 ms tienen voz. Con eso se
 * puede probar cómo se comporta el cálculo del corrimiento sin volver a bajar
 * audio ni tocar lo que está en producción.
 *
 * Existe porque el método falló en un caso real ("Cat's Eye", 1985: midió +45 s
 * donde la respuesta era +10) y sin el dato de entrada no hay forma de probar
 * una corrección: cada intento costaba un despliegue y dos minutos de espera.
 */

import ffmpeg from 'ffmpeg-static';
import { enlaceDirectoDeRd } from '../lib/rd.js';
import { energias, marcarVoz, SEG_POR_TRAMO } from '../lib/alinear.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method !== 'POST') return new Response('{"error":"method"}', { status: 405, headers: cors });

  let datos;
  try {
    datos = await req.json();
  } catch {
    return new Response('{"error":"body"}', { status: 400, headers: cors });
  }
  const { rdId, duracionSeg, tramos = 16 } = datos || {};
  if (!rdId) return new Response('{"error":"falta rdId"}', { status: 400, headers: cors });

  const url = await enlaceDirectoDeRd(rdId);
  if (!url) return new Response('{"error":"no se pudo resolver"}', { status: 404, headers: cors });

  const largo = duracionSeg && duracionSeg > 600 ? duracionSeg : 5400;
  const ventanas = [];
  for (let i = 1; i <= tramos; i++) {
    const desde = Math.round((largo * i) / (tramos + 1));
    const voz = marcarVoz(await energias(ffmpeg, url, desde, SEG_POR_TRAMO));
    if (voz.length) {
      ventanas.push({ desdeMs: desde * 1000, voz: Buffer.from(voz).toString('base64') });
    }
  }
  return new Response(JSON.stringify({ tramos: ventanas.length, ventanas }), { status: 200, headers: cors });
};
