/**
 * offset — ajuste de sincronía de subtítulos compartido, por archivo.
 *
 * GET  ?infoHash=XXX&fileId=YYY  → devuelve el ajuste guardado, en milisegundos
 * POST {infoHash, fileId, offset} → lo guarda
 *
 * Está en formato moderno (export default) y no en el viejo (exports.handler) por
 * un motivo concreto: en el formato viejo Netlify corre la function en "modo
 * compatibilidad Lambda" y NO le inyecta el acceso al almacenamiento, así que
 * `getStore` fallaba con "The environment has not been configured to use Netlify
 * Blobs". Medido el 18-10-2026: todas las escrituras venían fallando en silencio
 * desde que existe, y por eso ningún ajuste se compartía ni volvía en la
 * reproducción siguiente.
 */

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const json = (datos, status = 200) => new Response(JSON.stringify(datos), { status, headers: cors });

/** Un desfase de más de un minuto no es un ajuste: es un accidente (ver useSubtitles). */
const TOPE_MS = 60000;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });

  try {
    const store = getStore({ name: 'subtitle-offsets', consistency: 'strong' });

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const infoHash = url.searchParams.get('infoHash');
      const fileId = url.searchParams.get('fileId');
      if (!infoHash || !fileId) return json({ error: 'infoHash y fileId requeridos' }, 400);
      const val = await store.get(`${infoHash}_${fileId}`);
      const offset = val !== null && val !== undefined ? parseInt(val, 10) : null;
      return json({ offset: Number.isFinite(offset) ? offset : null });
    }

    if (req.method === 'POST') {
      const { infoHash, fileId, offset } = await req.json();
      if (!infoHash || !fileId || offset === undefined) {
        return json({ error: 'infoHash, fileId y offset requeridos' }, 400);
      }
      const ms = Math.round(Number(offset));
      if (!Number.isFinite(ms) || Math.abs(ms) > TOPE_MS) return json({ error: 'offset fuera de rango' }, 400);
      await store.set(`${infoHash}_${fileId}`, String(ms));
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    // Que falle el almacenamiento no puede romper la reproducción: en la lectura
    // se responde "no hay ajuste" y el subtítulo va como vino.
    if (req.method === 'GET') return json({ offset: null });
    return json({ ok: false, error: (e?.message || String(e)).slice(0, 120) });
  }
};
