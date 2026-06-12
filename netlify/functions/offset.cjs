// Netlify Function: offset
// Crowdsourcing de offsets de subtítulos por infoHash + fileId
// GET  ?infoHash=XXX&fileId=YYY  → devuelve offset guardado
// POST {infoHash, fileId, offset} → guarda offset

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors };

  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore({ name: 'subtitle-offsets', consistency: 'strong' });
    const q = event.queryStringParameters || {};

    // GET — consultar offset guardado
    if (event.httpMethod === 'GET') {
      const { infoHash, fileId } = q;
      if (!infoHash || !fileId) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'infoHash y fileId requeridos' }) };
      }
      const key = `${infoHash}_${fileId}`;
      const val = await store.get(key);
      console.log('[offset] GET', key, '→', val);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ offset: val !== null ? parseInt(val) : null }) };
    }

    // POST — guardar offset
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { infoHash, fileId, offset } = body;
      if (!infoHash || !fileId || offset === undefined) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'infoHash, fileId y offset requeridos' }) };
      }
      const key = `${infoHash}_${fileId}`;
      await store.set(key, String(Math.round(offset)));
      console.log('[offset] POST', key, '=', offset);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch(e) {
    console.error('[offset] error:', e.message);
    // Si Blobs no está disponible, devolver null silenciosamente (no es crítico)
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ offset: null }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
