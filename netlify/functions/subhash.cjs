// Netlify Function: subhash
// Hash OpenSubtitles server-side — sin CORS, URL de RD siempre fresca

const https = require('https');

const OS_KEY = 'BkJDwe4rThVSR3XRJ0F4Lhnn5loX6pYl';
const OS_UA  = 'MaldoxFilm v1.0';

// HTTP/HTTPS request genérico con soporte de redirect
function request(url, opts = {}, body = null, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (!redirects) return reject(new Error('Too many redirects'));
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : require('http');
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    };
    if (body) {
      const b = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(b);
    }
    const req = mod.request(options, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return request(res.headers.location, opts, body, redirects - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Range request para chunk del video
async function fetchRange(url, start, end, rdToken) {
  const headers = {
    'Range': `bytes=${start}-${end}`,
    'User-Agent': OS_UA,
    ...(rdToken ? { 'Authorization': `Bearer ${rdToken}` } : {})
  };
  const res = await request(url, { method: 'GET', headers });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`Range fetch returned ${res.status}`);
  }
  return res.buf;
}

// Algoritmo hash OpenSubtitles (mismo que VLC/Kodi)
function computeOSHash(filesize, firstBuf, lastBuf) {
  let hash = BigInt(filesize);
  const process = (buf) => {
    for (let i = 0; i + 8 <= buf.length; i += 8) {
      const lo = buf.readUInt32LE(i);
      const hi = buf.readUInt32LE(i + 4);
      hash = BigInt.asUintN(64, hash + BigInt(hi) * 0x100000000n + BigInt(lo));
    }
  };
  process(firstBuf);
  process(lastBuf);
  return hash.toString(16).padStart(16, '0');
}

// Llamada a OpenSubtitles API
async function osApi(path, method = 'GET', body = null) {
  const res = await request('https://api.opensubtitles.com/api/v1' + path, {
    method,
    headers: {
      'Api-Key': OS_KEY,
      'User-Agent': OS_UA,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }, body);
  try { return JSON.parse(res.text); }
  catch(e) { throw new Error(`OS API [${res.status}]: ${res.text.substring(0, 200)}`); }
}

// Llamada a Real-Debrid API
async function rdApi(path, rdToken) {
  const res = await request('https://api.real-debrid.com/rest/1.0' + path, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${rdToken}` }
  });
  try { return JSON.parse(res.text); }
  catch(e) { throw new Error(`RD API [${res.status}]: ${res.text.substring(0, 200)}`); }
}

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  const q = event.queryStringParameters || {};
  const { imdb_id, filesize, lang = 'es', file_id, rd_id, rd_token } = q;

  // Modo 1: descarga directa por file_id
  if (file_id) {
    try {
      const dl = await osApi('/download', 'POST', { file_id: parseInt(file_id) });
      if (!dl.link) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Sin link', detail: dl }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ link: dl.link, remaining: dl.remaining, file_name: dl.file_name }) };
    } catch(e) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Modo 2: hash via RD API → URL siempre fresca
  if (rd_id && rd_token && filesize) {
    try {
      console.log('[subhash] Obteniendo URL fresca de RD para rdId:', rd_id);

      // Obtener downloads de RD para encontrar URL fresca
      const downloads = await rdApi('/downloads?limit=500', rd_token);
      const match = Array.isArray(downloads) ? downloads.find(d => d.id === rd_id) : null;

      if (!match || !match.download) {
        throw new Error('No se encontró el download en RD con id: ' + rd_id);
      }

      const freshUrl  = match.download;
      const size      = parseInt(filesize);
      const chunk     = 65536;

      console.log('[subhash] URL fresca obtenida, calculando hash...');
      const [firstBuf, lastBuf] = await Promise.all([
        fetchRange(freshUrl, 0, chunk - 1, rd_token),
        fetchRange(freshUrl, Math.max(0, size - chunk), size - 1, rd_token)
      ]);
      const hash = computeOSHash(size, firstBuf, lastBuf);
      console.log('[subhash] Hash:', hash);

      // Buscar en OpenSubtitles por hash
      let searchUrl = `/subtitles?moviehash=${hash}&languages=${lang}`;
      if (imdb_id) searchUrl += `&imdb_id=${imdb_id.replace(/^tt/i, '')}`;
      const searchRes = await osApi(searchUrl);

      if (searchRes.data?.length) {
        const best   = searchRes.data[0];
        const fileId = best.attributes.files[0]?.file_id;
        const dl     = await osApi('/download', 'POST', { file_id: fileId });
        return { statusCode: 200, headers: cors, body: JSON.stringify({
          source: 'hash', hash,
          release: best.attributes.release,
          link: dl.link, remaining: dl.remaining
        })};
      }

      // Fallback IMDB si hash no encontró nada
      if (imdb_id) {
        const numId = imdb_id.replace(/^tt/i, '');
        const fb = await osApi(`/subtitles?imdb_id=${numId}&languages=${lang}&type=movie`);
        if (fb.data?.length) {
          const best   = fb.data[0];
          const fileId = best.attributes.files[0]?.file_id;
          const dl     = await osApi('/download', 'POST', { file_id: fileId });
          return { statusCode: 200, headers: cors, body: JSON.stringify({
            source: 'imdb_fallback', hash,
            release: best.attributes.release,
            link: dl.link, remaining: dl.remaining
          })};
        }
      }
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Sin resultados', hash }) };

    } catch(e) {
      console.error('[subhash] hash error:', e.message);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Requiere file_id O (rd_id + rd_token + filesize)' }) };
};
