/**
 * rd-stream — Netlify Function (server-side) que resuelve un torrent NO cacheado
 * usando la API oficial de Real-Debrid v1.0, SIN pasar por el proxy de Torrentio
 * y SIN exponer el RD_TOKEN al navegador. Ver ADR-004.
 *
 * Flujo por cada candidato (solo cuando la app NO encontró match cacheado):
 *   addMagnet(infoHash) → [esperar conversión del magnet: que aparezcan files] →
 *   selectFiles (dispara cache) → [esperar a status=downloaded: instant-cache] →
 *   unrestrict/link → streaming/transcode
 *
 * ⚠️ RD es ASÍNCRONO: tras addMagnet el torrent pasa por `magnet_conversion`
 * (sin `files`), y aunque esté instant-cacheado tarda 1-2s en marcar
 * `downloaded`. Por eso se SONDEA con un presupuesto de tiempo (no un chequeo
 * único). Si en el presupuesto no quedó `downloaded`, es que RD tendría que
 * descargarlo de verdad (minutos) → se devuelve `not_cached` y el cliente cae a
 * iframe (pero el torrent queda descargando → la próxima vez estará cacheado).
 *
 * Acepta VARIOS infoHashes (coma-separados, ordenados por score) e ITERA:
 * salta los bloqueados por DMCA (error 35) y devuelve el primero LISTO.
 *
 * Entrada:  GET /.netlify/functions/rd-stream?infoHash=<hash1>,<hash2>,...
 * Salida:   { ready:true, directUrl, dash, liveMP4, hls, filename, downloadId, infoHash }
 *           { ready:false, reason:'not_cached'|'all_infringing'|'none_available'|'timeout' }
 *           { error: '...' }
 *
 * ⚠️ SEGURIDAD: el token se lee SOLO de `process.env.RD_TOKEN` (server-side).
 * ⚠️ ESCRITURA: addMagnet/selectFiles ESCRIBEN en la cuenta RD (ver ADR-006:
 *    limpieza de torrents pendiente).
 *
 * Nota: ESM (`export const handler`) porque package.json declara "type":"module".
 */

const RD = 'https://api.real-debrid.com/rest/1.0';
const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|ts|webm)$/i;

const MAX_TRIES = 4; // tope de candidatos a probar (limita escrituras / rate-limit)
const TOTAL_BUDGET_MS = 9000; // presupuesto GLOBAL (Netlify corta funciones sync a ~10s)
const FILES_WAIT_MS = 3500; // espera máx. a que el magnet convierta (aparezcan files)
const CACHE_WAIT_MS = 4000; // espera máx. a que RD marque 'downloaded' (instant-cache)
const POLL_INTERVAL_MS = 1200; // cadencia de sondeo de torrents/info
const DEAD_STATUSES = new Set(['magnet_error', 'error', 'dead', 'virus']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jsonRes = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const token = process.env.RD_TOKEN || '';
  if (!token) return jsonRes(200, { ready: false, error: 'RD_TOKEN no configurado' });

  const qp = event.queryStringParameters || {};
  // direct=1 → PRE-CACHEO Direct Play (#5): solo queremos la URL CDN directa del MP4
  // (Range OK = seek nativo). Saltamos el paso de transcode (innecesario y un request
  // de más a RD), ya que el cliente reproducirá el MP4 nativo, no DASH.
  const directOnly = qp.direct === '1';
  const raw = qp.infoHash || '';
  const hashes = raw
    .toLowerCase()
    .split(',')
    .map((h) => h.trim())
    .filter((h) => /^[a-f0-9]{40}$/.test(h))
    .slice(0, MAX_TRIES);
  if (hashes.length === 0) return jsonRes(400, { error: 'infoHash inválido (40 hex, coma-separado)' });

  const authH = { Authorization: 'Bearer ' + token };
  const formH = { ...authH, 'Content-Type': 'application/x-www-form-urlencoded' };

  /** rd — llamada con reintento ante 429/34 (too many requests) y 5 (slow down). */
  const rd = async (path, opts = {}, retriesLeft = 2) => {
    const res = await fetch(RD + path, opts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* respuesta no-JSON (p.ej. 204) */
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

  /**
   * pollInfo — sondea torrents/info hasta que `predicate(info)` sea true, o hasta
   * agotar `capMs` o el `deadline` global (lo que llegue antes). Devuelve la
   * última `info` obtenida.
   */
  const pollInfo = async (torrentId, predicate, capMs, deadline) => {
    let info = await rd('/torrents/info/' + torrentId, { headers: authH });
    const stopAt = Math.min(Date.now() + capMs, deadline);
    while (!predicate(info) && !DEAD_STATUSES.has(info.status) && Date.now() + POLL_INTERVAL_MS < stopAt) {
      await sleep(POLL_INTERVAL_MS);
      info = await rd('/torrents/info/' + torrentId, { headers: authH });
    }
    return info;
  };

  /**
   * resolveOne — intenta resolver UN infoHash. Nunca lanza: devuelve un objeto
   * de resultado para que el bucle continúe con el siguiente candidato.
   */
  const resolveOne = async (infoHash, deadline) => {
    try {
      // 1. addMagnet (maneja error 33 "ya activo" reusando el torrent)
      let torrentId;
      try {
        const add = await rd('/torrents/addMagnet', {
          method: 'POST',
          headers: formH,
          body: 'magnet=' + encodeURIComponent(`magnet:?xt=urn:btih:${infoHash}`),
        });
        torrentId = add.id;
      } catch (e) {
        if (e.code === 35) return { state: 'infringing' }; // bloqueado por DMCA → siguiente
        if (e.code === 33) {
          const list = await rd('/torrents?limit=100', { headers: authH });
          const found = Array.isArray(list) ? list.find((t) => (t.hash || '').toLowerCase() === infoHash) : null;
          torrentId = found && found.id;
        }
        if (!torrentId) throw e;
      }

      // 2. Esperar a que el magnet convierta y aparezcan los archivos.
      let info = await pollInfo(torrentId, (i) => Array.isArray(i.files) && i.files.length > 0, FILES_WAIT_MS, deadline);
      if (DEAD_STATUSES.has(info.status)) return { state: 'error', message: 'status=' + info.status };
      const files = Array.isArray(info.files) ? info.files : [];
      if (files.length === 0) return { state: 'not_cached', status: info.status, progress: info.progress || 0 };

      const videoFile = files.filter((f) => VIDEO_RE.test(f.path || '')).sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
      if (!videoFile) return { state: 'no_video' };

      // 3. selectFiles SOLO el video → garantiza que info.links[0] sea ese archivo.
      const alreadyOnlyVideo = videoFile.selected && files.every((f) => f.id === videoFile.id || !f.selected);
      if (!alreadyOnlyVideo) {
        await rd('/torrents/selectFiles/' + torrentId, {
          method: 'POST',
          headers: formH,
          body: 'files=' + videoFile.id,
        });
      }

      // 4. Esperar a que RD lo marque 'downloaded' (instant-cache) con links listos.
      info = await pollInfo(
        torrentId,
        (i) => i.status === 'downloaded' && Array.isArray(i.links) && i.links.length > 0,
        CACHE_WAIT_MS,
        deadline
      );
      if (DEAD_STATUSES.has(info.status)) return { state: 'error', message: 'status=' + info.status };
      if (info.status !== 'downloaded' || !Array.isArray(info.links) || info.links.length === 0) {
        return { state: 'not_cached', status: info.status, progress: info.progress || 0 };
      }

      // 5. unrestrict → URL CDN directa (Range OK) + download_id
      const un = await rd('/unrestrict/link', {
        method: 'POST',
        headers: formH,
        body: 'link=' + encodeURIComponent(info.links[0]),
      });

      // 6. transcode → DASH principal (multi-audio + Range), liveMP4/HLS fallback.
      //    Extracción idéntica al camino cacheado (realdebrid.ts pickers).
      //    PRE-CACHEO (direct=1): se omite — solo interesa `directUrl` (MP4 nativo).
      const tc = directOnly ? {} : await rd('/streaming/transcode/' + un.id, { headers: authH });

      return {
        state: 'ready',
        result: {
          ready: true,
          infoHash,
          torrentId, // para ADR-006 (limpieza al cerrar)
          downloadId: un.id,
          directUrl: un.download || null,
          dash: (tc.dash && tc.dash.full) || null,
          liveMP4: (tc.liveMP4 && tc.liveMP4.full) || null,
          hls: (tc.apple && tc.apple.full) || (tc.h264 && tc.h264.full) || null,
          filename: videoFile.path || null,
          filesize: videoFile.bytes || 0,
        },
      };
    } catch (e) {
      if (e.code === 35) return { state: 'infringing' };
      return { state: 'error', message: (e && e.message) || 'error' };
    }
  };

  // ── Iterar candidatos: devolver el primero LISTO; saltar bloqueados/errores ──
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let infringing = 0;
  let lastNotCached = null;
  let ranOutOfTime = false;
  for (const h of hashes) {
    if (Date.now() >= deadline) {
      ranOutOfTime = true;
      break;
    }
    const r = await resolveOne(h, deadline);
    if (r.state === 'ready') return jsonRes(200, r.result);
    if (r.state === 'infringing') infringing++;
    if (r.state === 'not_cached') lastNotCached = r;
  }

  if (lastNotCached) {
    // Ninguno cacheado al instante, pero al menos uno es válido (RD descargando).
    return jsonRes(200, {
      ready: false,
      reason: 'not_cached',
      status: lastNotCached.status,
      progress: lastNotCached.progress,
      tried: hashes.length,
    });
  }
  if (ranOutOfTime) {
    return jsonRes(200, { ready: false, reason: 'timeout', tried: hashes.length });
  }
  return jsonRes(200, {
    ready: false,
    reason: infringing === hashes.length ? 'all_infringing' : 'none_available',
    tried: hashes.length,
  });
};
