/**
 * rd-tpipeline — Netlify Function (server-side) que resuelve el pipeline /t/
 * de Real-Debrid: obtiene mediaId scrapeando la streaming page, llama a
 * mediaInfos (CDN, hash, audio tracks), activa el stream, y opcionalmente
 * hace ping de seek. El token RD NUNCA sale al navegador.
 *
 * Endpoints (via query param `action`):
 *   ?action=resolve&rdId=XXX   → mediaId, fullPathId, cdn, audioTracks, duration
 *   ?action=seek&mediaId=XXX&seconds=NNN  → ping para generar segmentos
 *   ?action=mpd&fullPathId=XXX&cdn=XXX&audio=eng1&t=1  → URL del MPD
 *
 * ESM porque package.json declara "type":"module".
 */

const RD_APP_BASE = 'https://app.real-debrid.com/rest/1.0';

async function authFetch(url, token, timeoutMs = 15000) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function handleResolve(rdId, token) {
  // SIN CACHÉ: la sesión de medios de RD (mediaId / CDN / segmentos del pipeline /t/) es
  // EFÍMERA. Cachear el resolve hacía que al RE-ENTRAR a una película se devolvieran datos
  // muertos → /t/ cargaba segmentos expirados → fallaba y caía al transcode (seek roto en la
  // 2da reproducción). Resolver fresco cada vez garantiza una sesión válida (~1-2s, ya cubierto
  // por la pantalla de carga "Buscando..."). NO volver a poner un caché acá sin TTL corto.

  // 1. Fetch streaming page → mediaId
  const streamRes = await fetch(
    `https://real-debrid.com/streaming-${rdId}?auth_token=${token}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const html = await streamRes.text();
  let mediaId = html.match(/setMediaId\("(.+?)"\)/)?.[1];
  if (!mediaId) mediaId = rdId;

  // 2. mediaInfos (private API) → CDN, suffix, audio tracks
  const infoRes = await authFetch(
    `${RD_APP_BASE}/streaming/mediaInfos/${mediaId}`,
    token
  );
  if (!infoRes.ok) throw new Error(`mediaInfos failed: ${infoRes.status}`);
  const info = await infoRes.json();

  const modelUrl = info.modelUrl;
  const pathMatch = modelUrl?.match(/\/t\/([^/]+)\//);
  const fullPathId = pathMatch ? pathMatch[1] : mediaId;

  // Fetch MPD to get real segment CDN (may differ from mediaInfos.host)
  const mpdCdn = info.host;
  let segmentCdn = mpdCdn;
  try {
    const modelUrlResolved = modelUrl
      .replace(/{audio}/, 'eng1')
      .replace(/{subtitles}/, 'none')
      .replace(/{audioCodec}/, 'aac')
      .replace(/{quality}/, 'full')
      .replace(/{format}/, 'mpd');
    const mpdResp = await fetch(modelUrlResolved + '?t=0', {
      signal: AbortSignal.timeout(8000),
    });
    if (mpdResp.ok) {
      const mpdText = await mpdResp.text();
      const segUrlMatch = mpdText.match(
        /media="(https:\/\/[^/]+\/t\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/video-\$Number\$\.m4s)"/
      );
      if (segUrlMatch) {
        segmentCdn = new URL(segUrlMatch[1]).hostname;
      }
    }
  } catch {
    // CDN fallback to mediaInfos.host
  }

  const audioTracks = [];
  if (info.details?.audio) {
    for (const [id, track] of Object.entries(info.details.audio)) {
      audioTracks.push({
        id,
        lang: track.lang,
        iso: track.lang_iso,
        codec: track.codec,
        channels: track.channels,
      });
    }
  }

  // 3. Activate stream
  await authFetch(`${RD_APP_BASE}/streaming/ping/${mediaId}/play`, token);

  const result = {
    mediaId,
    fullPathId,
    cdn: segmentCdn,
    modelUrl,
    duration: info.duration || 0,
    audioTracks,
    filename: info.filename,
  };

  return result;
}

async function handleSeek(mediaId, seconds, token) {
  const res = await authFetch(
    `${RD_APP_BASE}/streaming/ping/${mediaId}/${Math.floor(seconds)}`,
    token
  );
  return { ok: res.ok || res.status === 204 };
}

function handleMpd({ fullPathId, cdn, audio = 'eng1', subs = 'none', codec = 'aac', t = 1 }) {
  const mpdUrl = `https://${cdn}/t/${fullPathId}/${audio}/${subs}/${codec}/full.mpd?t=${t}`;
  return { mpdUrl };
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  const token = process.env.RD_TOKEN || '';
  if (!token) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'RD_TOKEN not configured' }),
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (action === 'resolve') {
      const rdId = params.rdId;
      if (!rdId) throw new Error('Missing rdId');
      const result = await handleResolve(rdId, token);
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    }

    if (action === 'seek') {
      const { mediaId, seconds } = params;
      if (!mediaId || !seconds) throw new Error('Missing mediaId or seconds');
      const result = await handleSeek(mediaId, parseFloat(seconds), token);
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    }

    if (action === 'mpd') {
      const result = handleMpd(params);
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    }

    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: `Unknown action: ${action}` }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
