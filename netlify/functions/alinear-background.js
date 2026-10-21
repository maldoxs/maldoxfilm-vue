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

/** El doble de tramos para el segundo intento (ver la nota más abajo). */
const TRAMOS_SEGUNDA_PASADA = 16;

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

    let r = await medirDesfase({ ffmpeg, url, cues, duracionSeg: Number(duracionSeg) || 0 });

    // Segunda pasada cuando la primera queda al borde. Medido con *Hope*
    // (coreana, 20-10-2026): con ocho tramos dio -16,8 s y margen 1,245, cinco
    // milésimas por debajo del corte, así que no aplicó nada y el usuario tuvo
    // que ajustarla a mano. Con dieciséis tramos la misma película da -15,3 s y
    // margen 1,30: la respuesta estaba, faltaba escuchar más. Solo se paga ese
    // tiempo extra cuando hace falta; si la primera pasada es clara, no corre.
    if (!r.error && !r.confiable && r.ventaja >= 1.1) {
      await anotar({ estado: 'midiendo', pasada: 2, ventajaPrimera: Number(r.ventaja.toFixed(3)) });
      const r2 = await medirDesfase({
        ffmpeg,
        url,
        cues,
        duracionSeg: Number(duracionSeg) || 0,
        tramos: TRAMOS_SEGUNDA_PASADA,
      });
      if (!r2.error) r = r2;
    }

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
      });
      return new Response('', { status: 202, headers: cors });
    }

    // Se guarda donde ya lo busca el reproductor al empezar cada película.
    const offsets = getStore({ name: 'subtitle-offsets', consistency: 'strong' });
    await offsets.set(clave, String(r.offsetMs));
    await anotar({ estado: 'listo', offsetMs: r.offsetMs, ventaja: Number(r.ventaja.toFixed(3)) });
  } catch (e) {
    await anotar({ estado: 'error', motivo: (e?.message || String(e)).slice(0, 120) });
  }

  return new Response('', { status: 202, headers: cors });
};
