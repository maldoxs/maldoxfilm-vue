/**
 * rd-cleanup — Netlify Function (server-side) que BORRA un torrent de la cuenta
 * Real-Debrid (`DELETE /torrents/delete/{id}`). Se invoca al cerrar el reproductor
 * o al cambiar de título, para que los torrents creados por `rd-stream` (ADR-004)
 * NO se acumulen y terminen disparando el error 21 ("too many active downloads").
 * Ver ADR-006.
 *
 * Entrada:  GET/POST /.netlify/functions/rd-cleanup?id=<torrentId>
 *           Pensado para `navigator.sendBeacon(url)` → POST con el id en la query,
 *           de modo que el aviso sobreviva al cierre/descarga de la página.
 * Salida:   { ok:true } | { ok:false, reason }
 *
 * "Best effort": tolera 404 (el torrent ya no existe) y cualquier error; nunca
 * debe bloquear ni romper el cierre del reproductor.
 *
 * ⚠️ SEGURIDAD: el token se lee SOLO de `process.env.RD_TOKEN` (server-side).
 * Nota: ESM (`export const handler`) porque package.json declara "type":"module".
 */

const RD = 'https://api.real-debrid.com/rest/1.0';

const jsonRes = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const token = process.env.RD_TOKEN || '';
  if (!token) return jsonRes(200, { ok: false, reason: 'no_token' });

  const id = ((event.queryStringParameters || {}).id || '').trim();
  if (!/^[a-z0-9]+$/i.test(id)) return jsonRes(200, { ok: false, reason: 'bad_id' });

  try {
    const res = await fetch(`${RD}/torrents/delete/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    // 204 = borrado OK; 404 = ya no existe (también OK para nuestro fin).
    if (res.ok || res.status === 404) return jsonRes(200, { ok: true });
    return jsonRes(200, { ok: false, reason: 'rd_' + res.status });
  } catch (e) {
    return jsonRes(200, { ok: false, reason: (e && e.message) || 'error' });
  }
};
