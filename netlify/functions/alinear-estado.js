/**
 * alinear-estado — en qué anda la medición que disparó `alinear-background`.
 *
 * El reproductor pregunta cada pocos segundos mientras muestra "midiendo...".
 * Estados: midiendo · listo (con `offsetMs`) · sin_senal · error.
 */

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  try {
    const url = new URL(req.url);
    const infoHash = url.searchParams.get('infoHash');
    const fileId = url.searchParams.get('fileId');
    if (!infoHash || !fileId) {
      return new Response('{"error":"infoHash y fileId requeridos"}', { status: 400, headers: cors });
    }
    const estados = getStore({ name: 'alineaciones', consistency: 'strong' });
    const dato = await estados.get(`${infoHash}_${fileId}`, { type: 'json' });
    return new Response(JSON.stringify(dato || { estado: 'nada' }), { headers: cors });
  } catch {
    return new Response('{"estado":"nada"}', { headers: cors });
  }
};
