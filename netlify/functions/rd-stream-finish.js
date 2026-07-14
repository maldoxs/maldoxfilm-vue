/**
 * rd-stream-finish — FASE 2 (ADR-009): paso FINAL del flujo por fases. El cliente
 * lo llama cuando `rd-stream-status` reportó `downloaded`. Hace lo caro (una vez):
 *   [selectFiles si aún faltaba] → unrestrict/link → streaming/transcode
 * → devuelve las MISMAS URLs que el `rd-stream.js` monolítico (DASH/liveMP4/HLS +
 * directUrl), con el audio en AAC (por eso suena en desktop, que no decodifica AC3).
 *
 * Entrada:  GET /.netlify/functions/rd-stream-finish?torrentId=<id>[&direct=1]
 * Salida:   { ready:true, directUrl, dash, liveMP4, hls, filename, filesize,
 *             downloadId, torrentId, infoHash }
 *           { ready:false, reason:'not_ready'|'no_video'|'no_links', status, progress }
 *
 * ⚠️ SEGURIDAD: token solo de process.env.RD_TOKEN. ⚠️ ESCRITURA: puede llamar
 * selectFiles (si el start no alcanzó a hacerlo). Limpieza vía rd-cleanup (ADR-006).
 */

const RD = 'https://api.real-debrid.com/rest/1.0';
const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|ts|webm)$/i;

const jsonRes = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const token = process.env.RD_TOKEN || '';
  if (!token) return jsonRes(200, { ready: false, error: 'RD_TOKEN no configurado' });

  const qp = event.queryStringParameters || {};
  const torrentId = (qp.torrentId || '').trim();
  const directOnly = qp.direct === '1';
  if (!/^[A-Z0-9]+$/i.test(torrentId)) return jsonRes(400, { error: 'torrentId inválido' });

  const authH = { Authorization: 'Bearer ' + token };
  const formH = { ...authH, 'Content-Type': 'application/x-www-form-urlencoded' };

  const rd = async (path, opts = {}, retriesLeft = 2) => {
    const res = await fetch(RD + path, opts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* no-JSON */
    }
    if (!res.ok) {
      const code = data && data.error_code;
      if ((res.status === 429 || code === 34 || code === 5) && retriesLeft > 0) {
        await new Promise((r) => setTimeout(r, 1500));
        return rd(path, opts, retriesLeft - 1);
      }
      const err = new Error(`RD ${res.status} code=${code}: ${(data && data.error) || text}`);
      err.code = code;
      throw err;
    }
    return data;
  };

  try {
    let info = await rd('/torrents/info/' + torrentId, { headers: authH });
    const files = Array.isArray(info.files) ? info.files : [];
    const videoFile = files
      .filter((f) => VIDEO_RE.test(f.path || ''))
      .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
    if (!videoFile) return jsonRes(200, { ready: false, reason: 'no_video', status: info.status });

    // Si el start no seleccionó (aparecieron los files después), seleccionar ahora.
    const alreadyOnlyVideo = videoFile.selected && files.every((f) => f.id === videoFile.id || !f.selected);
    if (!alreadyOnlyVideo) {
      await rd('/torrents/selectFiles/' + torrentId, {
        method: 'POST',
        headers: formH,
        body: 'files=' + videoFile.id,
      });
      info = await rd('/torrents/info/' + torrentId, { headers: authH });
    }

    if (info.status !== 'downloaded' || !Array.isArray(info.links) || info.links.length === 0) {
      return jsonRes(200, { ready: false, reason: 'not_ready', status: info.status, progress: info.progress || 0 });
    }

    const un = await rd('/unrestrict/link', {
      method: 'POST',
      headers: formH,
      body: 'link=' + encodeURIComponent(info.links[0]),
    });

    const tc = directOnly ? {} : await rd('/streaming/transcode/' + un.id, { headers: authH });

    return jsonRes(200, {
      ready: true,
      torrentId,
      infoHash: (info.hash || '').toLowerCase() || null,
      downloadId: un.id,
      directUrl: un.download || null,
      dash: (tc.dash && tc.dash.full) || null,
      liveMP4: (tc.liveMP4 && tc.liveMP4.full) || null,
      hls: (tc.apple && tc.apple.full) || (tc.h264 && tc.h264.full) || null,
      filename: videoFile.path || null,
      filesize: videoFile.bytes || 0,
    });
  } catch (e) {
    if (e.code === 35) return jsonRes(200, { ready: false, reason: 'infringing' });
    return jsonRes(200, { ready: false, error: (e && e.message) || 'error' });
  }
};
