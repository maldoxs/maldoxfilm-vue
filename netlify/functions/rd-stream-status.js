/**
 * rd-stream-status — FASE 2 (ADR-009): paso de SONDEO del flujo por fases.
 * El cliente lo llama repetidamente (cada ~2.5s) tras `rd-stream-start` hasta
 * que RD marque el torrent como `downloaded`. Es un GET liviano (un solo
 * `torrents/info`) → NUNCA se acerca al techo de ~10s de Netlify, así que el
 * cliente puede esperar TODO lo que el usuario tolere (con cancelar).
 *
 * Entrada:  GET /.netlify/functions/rd-stream-status?torrentId=<id>
 * Salida:   { status, progress, downloaded:boolean, dead:boolean }
 *
 * ⚠️ SEGURIDAD: token solo de process.env.RD_TOKEN (server-side). Solo LEE.
 */

const RD = 'https://api.real-debrid.com/rest/1.0';
const DEAD_STATUSES = new Set(['magnet_error', 'error', 'dead', 'virus']);

const jsonRes = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const token = process.env.RD_TOKEN || '';
  if (!token) return jsonRes(200, { error: 'RD_TOKEN no configurado' });

  const qp = event.queryStringParameters || {};
  const torrentId = (qp.torrentId || '').trim();
  if (!/^[A-Z0-9]+$/i.test(torrentId)) return jsonRes(400, { error: 'torrentId inválido' });

  try {
    const res = await fetch(RD + '/torrents/info/' + torrentId, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return jsonRes(200, { error: 'RD ' + res.status, status: 'unknown', downloaded: false, dead: false });
    const info = await res.json();
    const status = info.status || 'unknown';
    const downloaded = status === 'downloaded' && Array.isArray(info.links) && info.links.length > 0;
    return jsonRes(200, {
      status,
      progress: info.progress || 0,
      downloaded,
      dead: DEAD_STATUSES.has(status),
    });
  } catch (e) {
    return jsonRes(200, { error: (e && e.message) || 'error', status: 'unknown', downloaded: false, dead: false });
  }
};
