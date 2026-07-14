/**
 * rd-stream-start — FASE 2 (ADR-009): primer paso del flujo server-side POR FASES
 * para contenido NO cacheado en la cuenta del usuario. Reemplaza el techo de 9s
 * de `rd-stream.js` (monolítico) por 3 funciones cortas que el cliente encadena
 * con polling:  start → status → finish.
 *
 * `start` hace SOLO lo rápido y con efecto de escritura:
 *   addMagnet(infoHash) → esperar conversión del magnet (que aparezcan files) →
 *   selectFiles(video más grande)  → devolver { torrentId, status, progress }.
 *
 * NO espera a `downloaded`: eso lo consulta el cliente con `rd-stream-status`
 * tantas veces como haga falta (sin el límite de ~10s de Netlify). Así un título
 * que RD tarda 20-60s en preparar YA no se pierde (antes caía al link crudo sin
 * transcode → sin audio AAC en desktop).
 *
 * Acepta VARIOS infoHashes (coma-separados, ordenados por score) e ITERA: salta
 * los bloqueados por DMCA (35) y devuelve el PRIMER candidato viable.
 *
 * Entrada:  GET /.netlify/functions/rd-stream-start?infoHash=<h1>,<h2>,...
 * Salida:   { started:true, torrentId, filename, filesize, status, progress }
 *           { started:false, reason:'all_infringing'|'none_available'|'timeout' }
 *
 * ⚠️ SEGURIDAD: token solo de process.env.RD_TOKEN. ⚠️ ESCRITURA: addMagnet/
 * selectFiles escriben en la cuenta RD (limpieza vía rd-cleanup, ADR-006).
 */

const RD = 'https://api.real-debrid.com/rest/1.0';
const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|ts|webm)$/i;

// 4 → 10 (2026-07-13, caso El Padrino): las mejores versiones a menudo están
// BLOQUEADAS por DMCA (addMagnet error 35, rechazo INSTANTÁNEO). Con solo 4
// candidatos, si esos 4 estaban bloqueados devolvía `all_infringing` y no
// transcodeaba nada. Como el rechazo por DMCA es inmediato, se pueden saltear
// muchos bloqueados y aterrizar en el primero que RD SÍ acepte, dentro del
// presupuesto. Los candidatos vienen en orden de score (cacheados [RD+] primero).
const MAX_TRIES = 10; // tope de candidatos a probar (saltea DMCA hasta hallar uno válido)
const START_BUDGET_MS = 8500; // presupuesto de ESTA función (bajo el techo Netlify ~10s)
const FILES_WAIT_MS = 4500; // espera máx. a que el magnet convierta (un [RD+] cacheado aparece en 1-2s)
const POLL_INTERVAL_MS = 1200;
const DEAD_STATUSES = new Set(['magnet_error', 'error', 'dead', 'virus']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jsonRes = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const token = process.env.RD_TOKEN || '';
  if (!token) return jsonRes(200, { started: false, error: 'RD_TOKEN no configurado' });

  const qp = event.queryStringParameters || {};
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

  const rd = async (path, opts = {}, retriesLeft = 2) => {
    const res = await fetch(RD + path, opts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* respuesta no-JSON */
    }
    if (!res.ok) {
      const code = data && data.error_code;
      if ((res.status === 429 || code === 34 || code === 5) && retriesLeft > 0) {
        await sleep(1500);
        return rd(path, opts, retriesLeft - 1);
      }
      const err = new Error(`RD ${res.status} code=${code}: ${(data && data.error) || text}`);
      err.code = code;
      throw err;
    }
    return data;
  };

  const pollInfo = async (torrentId, predicate, capMs, deadline) => {
    let info = await rd('/torrents/info/' + torrentId, { headers: authH });
    const stopAt = Math.min(Date.now() + capMs, deadline);
    while (!predicate(info) && !DEAD_STATUSES.has(info.status) && Date.now() + POLL_INTERVAL_MS < stopAt) {
      await sleep(POLL_INTERVAL_MS);
      info = await rd('/torrents/info/' + torrentId, { headers: authH });
    }
    return info;
  };

  /** startOne — addMagnet + esperar files + selectFiles para UN infoHash. Nunca lanza. */
  const startOne = async (infoHash, deadline) => {
    try {
      let torrentId;
      try {
        const add = await rd('/torrents/addMagnet', {
          method: 'POST',
          headers: formH,
          body: 'magnet=' + encodeURIComponent(`magnet:?xt=urn:btih:${infoHash}`),
        });
        torrentId = add.id;
      } catch (e) {
        if (e.code === 35) return { state: 'infringing' };
        if (e.code === 33) {
          const list = await rd('/torrents?limit=100', { headers: authH });
          const found = Array.isArray(list) ? list.find((t) => (t.hash || '').toLowerCase() === infoHash) : null;
          torrentId = found && found.id;
        }
        if (!torrentId) throw e;
      }

      // Esperar a que el magnet convierta y aparezcan los archivos.
      let info = await pollInfo(torrentId, (i) => Array.isArray(i.files) && i.files.length > 0, FILES_WAIT_MS, deadline);
      if (DEAD_STATUSES.has(info.status)) return { state: 'error', message: 'status=' + info.status };
      const files = Array.isArray(info.files) ? info.files : [];
      // Sin files todavía: igual devolvemos el torrentId — el cliente sondeará status
      // y el finish hará el selectFiles cuando los files aparezcan.
      if (files.length === 0) {
        return { state: 'started', torrentId, status: info.status, progress: info.progress || 0, filesSelected: false };
      }

      const videoFile = files
        .filter((f) => VIDEO_RE.test(f.path || ''))
        .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
      if (!videoFile) return { state: 'no_video' };

      const alreadyOnlyVideo = videoFile.selected && files.every((f) => f.id === videoFile.id || !f.selected);
      if (!alreadyOnlyVideo) {
        await rd('/torrents/selectFiles/' + torrentId, {
          method: 'POST',
          headers: formH,
          body: 'files=' + videoFile.id,
        });
        info = await rd('/torrents/info/' + torrentId, { headers: authH });
      }

      return {
        state: 'started',
        torrentId,
        status: info.status,
        progress: info.progress || 0,
        filename: videoFile.path || null,
        filesize: videoFile.bytes || 0,
        filesSelected: true,
      };
    } catch (e) {
      if (e.code === 35) return { state: 'infringing' };
      return { state: 'error', message: (e && e.message) || 'error' };
    }
  };

  const deadline = Date.now() + START_BUDGET_MS;
  let infringing = 0;
  let ranOutOfTime = false;
  for (const h of hashes) {
    if (Date.now() >= deadline) {
      ranOutOfTime = true;
      break;
    }
    const r = await startOne(h, deadline);
    if (r.state === 'started') {
      return jsonRes(200, {
        started: true,
        torrentId: r.torrentId,
        filename: r.filename ?? null,
        filesize: r.filesize ?? 0,
        status: r.status,
        progress: r.progress,
        filesSelected: r.filesSelected,
      });
    }
    if (r.state === 'infringing') infringing++;
  }

  if (ranOutOfTime) return jsonRes(200, { started: false, reason: 'timeout', tried: hashes.length });
  return jsonRes(200, {
    started: false,
    reason: infringing === hashes.length ? 'all_infringing' : 'none_available',
    tried: hashes.length,
  });
};
