/**
 * alinear-background — mide el desfase del subtítulo contra el audio y lo guarda.
 *
 * La dispara el botón "ajustar al audio" del panel de sincronía. Tarda alrededor
 * de minuto y medio (hay que bajar y escuchar ocho tramos de la película), muy por
 * encima de lo que Netlify permite en una llamada normal, así que es una function
 * de FONDO: responde enseguida con 202 y va dejando el estado en el almacenamiento.
 * El reproductor pregunta por ese estado hasta que termina (`alinear-estado`).
 *
 * El resultado se guarda en el mismo lugar que los ajustes manuales, así que la
 * próxima reproducción de esa copia arranca sincronizada sin apretar nada.
 */

import { getStore } from '@netlify/blobs';
import ffmpeg from 'ffmpeg-static';
import { enlaceDirectoDeRd } from '../lib/rd.js';
import { medirDesfase } from '../lib/alinear.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (req.method !== 'POST') return new Response('{"error":"method"}', { status: 405, headers: cors });

  let datos;
  try {
    datos = await req.json();
  } catch {
    return new Response('{"error":"body"}', { status: 400, headers: cors });
  }
  const { rdId, infoHash, fileId, cues, duracionSeg } = datos || {};
  if (!rdId || !infoHash || !fileId || !Array.isArray(cues) || cues.length < 20) {
    return new Response('{"error":"faltan datos"}', { status: 400, headers: cors });
  }

  const estados = getStore({ name: 'alineaciones', consistency: 'strong' });
  const clave = `${infoHash}_${fileId}`;
  const anotar = (x) => estados.setJSON(clave, { ...x, ts: Date.now() }).catch(() => {});

  await anotar({ estado: 'midiendo' });

  try {
    const url = await enlaceDirectoDeRd(rdId);
    if (!url) {
      await anotar({ estado: 'error', motivo: 'no se pudo resolver el archivo' });
      return new Response('', { status: 202, headers: cors });
    }

    const r = await medirDesfase({ ffmpeg, url, cues, duracionSeg: Number(duracionSeg) || 0 });

    if (r.error) {
      await anotar({ estado: 'error', motivo: r.error });
      return new Response('', { status: 202, headers: cors });
    }
    if (!r.confiable) {
      // Una película muy ruidosa puede no dar un ganador claro. Antes que
      // aplicar un número inventado, se dice que no se pudo.
      await anotar({
        estado: 'sin_senal',
        ventaja: Number(r.ventaja.toFixed(3)),
        // Queda anotado el número que SÍ se midió aunque no se aplique: sin esto,
        // cuando una medición falla no hay forma de saber si estuvo cerca.
        offsetMedido: r.offsetMs,
        difMitadesSeg: r.difMitadesSeg,
      });
      return new Response('', { status: 202, headers: cors });
    }

    // Se guarda donde ya lo busca el reproductor al empezar cada película.
    const offsets = getStore({ name: 'subtitle-offsets', consistency: 'strong' });
    await offsets.set(clave, String(r.offsetMs));
    await anotar({
      estado: 'listo',
      offsetMs: r.offsetMs,
      ventaja: Number(r.ventaja.toFixed(3)),
      difMitadesSeg: r.difMitadesSeg,
    });
  } catch (e) {
    await anotar({ estado: 'error', motivo: (e?.message || String(e)).slice(0, 120) });
  }

  return new Response('', { status: 202, headers: cors });
};
