import { describe, test, expect, vi } from 'vitest';
import { createRdStreamResolver } from '../src/services/rdStream';
import { createTmdbClient } from '../src/services/tmdb';
import { createTorrentioClient } from '../src/services/torrentio';
import { createRealDebridClient } from '../src/services/realdebrid';

/**
 * Router de fetch — despacha respuestas JSON/redirect según el patrón de la
 * URL solicitada, simulando los 4 servicios remotos que `rdGetStream`
 * encadena: TMDB external_ids → Torrentio streams → resolución de proxy →
 * RD downloads. Permite testear el flujo COMPLETO de orquestación de
 * `rdStream.ts` sin un browser real, igual que se hizo con los clientes
 * individuales en `apiClients.test.ts`.
 */
function makeRouter(routes: { match: RegExp; json?: unknown; url?: string }[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const r of routes) {
      if (r.match.test(url)) {
        return {
          ok: true,
          status: 200,
          url: r.url ?? url,
          json: async () => r.json,
          text: async () => JSON.stringify(r.json),
        } as unknown as Response;
      }
    }
    throw new Error('Sin ruta mockeada para: ' + url);
  });
}

function buildResolver(fetchImpl: typeof fetch, rdToken = 'TEST_TOKEN') {
  const tmdbClient = createTmdbClient({ apiKey: 'TMDB_KEY', fetchImpl });
  const torrentioClient = createTorrentioClient({ fetchImpl });
  const rdClient = createRealDebridClient({ rdToken, fetchImpl });
  return createRdStreamResolver({ rdToken, tmdbClient, torrentioClient, rdClient });
}

const SPA_STREAM = {
  name: 'RD ✅',
  title: '🇪🇸 Spanish.Movie.2020.1080p.x264.AAC 💾 4.2 GB',
  url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/null/0/Spanish.Movie.2020.1080p.x264.AAC.mkv',
  infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  behaviorHints: { filename: 'Spanish.Movie.2020.1080p.x264.AAC.mkv' },
};

describe('rdStream — orquestación completa de rdGetStream', () => {
  test('flujo feliz: IMDB → Torrentio → resolve proxy → match en downloads → SelectedStream completo', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt1234567' } },
      { match: /torrentio\.strem\.fun\/realdebrid=/, json: { streams: [SPA_STREAM] } },
      {
        match: /resolve\/realdebrid\/TEST_TOKEN\/aaaa/,
        json: {},
        url: 'https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv',
      },
      {
        match: /\/downloads\?limit=500/,
        json: [
          {
            id: 'RD_ID_1',
            download: 'https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv',
            filename: 'Spanish.Movie.2020.1080p.x264.AAC.mkv',
            filesize: 4200000000,
          },
        ],
      },
    ]);

    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(603, 'movie');

    expect(result.url).toBe('https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv');
    expect(result.rdId).toBe('RD_ID_1');
    expect(result.rdDownloadUrl).toBe('https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv');
    expect(result.rdFilesize).toBe(4200000000);
    expect(result.imdbId).toBe('tt1234567');
    expect(result.hasAAC).toBe(true);
    expect(result.isX265).toBe(false);
    expect(result.infoHash).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.streamFilename).toBe('Spanish.Movie.2020.1080p.x264.AAC.mkv');
  });

  test('sin token → forma vacía sin tocar la red', async () => {
    const fetchImpl = vi.fn();
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch, '');
    const result = await resolver.getStream(603, 'movie');
    expect(result).toEqual({
      url: null,
      rdId: null,
      isX265: false,
      fallbackUrl: null,
      imdbId: null,
      streamFilename: null,
      hasAAC: false,
      rdDownloadUrl: null,
      rdFilesize: 0,
      infoHash: '',
      unavailableInRd: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sin imdb_id → forma vacía (early return línea ~4716)', async () => {
    const fetchImpl = makeRouter([{ match: /external_ids/, json: { imdb_id: null } }]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(603, 'movie');
    expect(result.url).toBeNull();
    expect(result.rdId).toBeNull();
  });

  test('sin streams en Torrentio → forma vacía (early return línea ~4724)', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt1234567' } },
      { match: /torrentio\.strem\.fun\/realdebrid=/, json: { streams: [] } },
    ]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(603, 'movie');
    expect(result.url).toBeNull();
  });

  test('sin match en downloads → rdId null pero url presente (puede intentar HEVC directo)', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt1234567' } },
      { match: /torrentio\.strem\.fun\/realdebrid=/, json: { streams: [SPA_STREAM] } },
      {
        match: /resolve\/realdebrid\/TEST_TOKEN\/aaaa/,
        json: {},
        url: 'https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv',
      },
      { match: /\/downloads\?limit=500/, json: [] },
    ]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(603, 'movie');
    expect(result.rdId).toBeNull();
    expect(result.url).toBe('https://abc123.stream.real-debrid.com/d/XYZ/Spanish.Movie.2020.1080p.x264.AAC.mkv');
  });

  test('error de red en cualquier paso → forma vacía completa (catch-all línea ~4918)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(603, 'movie');
    expect(result).toEqual({
      url: null,
      rdId: null,
      isX265: false,
      fallbackUrl: null,
      imdbId: null,
      streamFilename: null,
      hasAAC: false,
      rdDownloadUrl: null,
      rdFilesize: 0,
      infoHash: '',
      unavailableInRd: false,
    });
  });

  test('Torrentio query incluye imdbId/season/episode para series — preserva el path de rdGetStream', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt7654321' } },
      {
        match: /torrentio\.strem\.fun\/realdebrid=/,
        json: { streams: [{ ...SPA_STREAM, url: SPA_STREAM.url.replace('aaaa', 'bbbb') }] },
      },
      { match: /resolve\/realdebrid/, json: {}, url: SPA_STREAM.url.replace('aaaa', 'bbbb') },
      { match: /\/downloads\?limit=500/, json: [] },
    ]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    await resolver.getStream(1399, 'tv', 2, 5);

    const torrentioCall = (fetchImpl.mock.calls as unknown as [string][]).find(([u]) =>
      u.includes('torrentio.strem.fun/realdebrid=')
    );
    expect(torrentioCall?.[0]).toContain('/stream/series/tt7654321:2:5.json');
  });
});

// ── RE-FETCH del pool si la elegida NO es fluida (caso real "Ghost Rider", 2026-07-14) ──
// Evidencia del bug: Torrentio entregó un pool pobre (19 streams) sin ninguna versión
// Direct Play cacheada → el player cayó a /t/ sobre un archivo que RD generaba a ~0.4x
// → pausas inevitables. El fix: segunda consulta a Torrentio (el pool VARÍA entre
// requests) y re-selección — si aparece una H264+AAC cacheada, esa reproduce fluida.
describe('rdStream — re-fetch del pool cuando la versión elegida va a transcodear', () => {
  // Stream tipo Ghost Rider: cacheado y con match, pero AC3+MKV → NO es Direct Play.
  const AC3_STREAM = {
    name: '[RD+] Torrentio 720p',
    title: 'Ghost.Movie.2007.720p.AC3.5.1.x264 💾 4.4 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/cccccccccccccccccccccccccccccccccccccccc/null/0/Ghost.Movie.2007.720p.AC3.5.1.x264.mkv',
    infoHash: 'cccccccccccccccccccccccccccccccccccccccc',
    behaviorHints: { filename: 'Ghost.Movie.2007.720p.AC3.5.1.x264.mkv' },
  };
  // La versión FLUIDA (H264+AAC+MP4) que solo aparece en el SEGUNDO fetch.
  const FLUID_STREAM = {
    name: '[RD+] Torrentio 1080p',
    title: 'Ghost.Movie.2007.1080p.x264.AAC 💾 2.1 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/dddddddddddddddddddddddddddddddddddddddd/null/0/Ghost.Movie.2007.1080p.x264.AAC.mp4',
    infoHash: 'dddddddddddddddddddddddddddddddddddddddd',
    behaviorHints: { filename: 'Ghost.Movie.2007.1080p.x264.AAC.mp4' },
  };
  const DOWNLOADS = [
    {
      id: 'RD_AC3',
      download: 'https://x1.stream.real-debrid.com/d/AC3/Ghost.Movie.2007.720p.AC3.5.1.x264.mkv',
      filename: 'Ghost.Movie.2007.720p.AC3.5.1.x264.mkv',
      filesize: 4400000000,
    },
    {
      id: 'RD_FLUID',
      download: 'https://x2.stream.real-debrid.com/d/FLUID/Ghost.Movie.2007.1080p.x264.AAC.mp4',
      filename: 'Ghost.Movie.2007.1080p.x264.AAC.mp4',
      filesize: 2100000000,
    },
  ];

  /** Router con Torrentio STATEFUL: 1er fetch → pool pobre; 2do fetch → pool con la fluida. */
  function makeRefetchRouter(secondPool: unknown[]) {
    let torrentioCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({
          ok: true,
          status: 200,
          url: finalUrl ?? url,
          json: async () => json,
          text: async () => JSON.stringify(json),
        }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt0259324' });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) {
        torrentioCalls += 1;
        return respond({ streams: torrentioCalls === 1 ? [AC3_STREAM] : secondPool });
      }
      if (/resolve\/realdebrid\/TEST_TOKEN\/cccc/.test(url))
        return respond({}, DOWNLOADS[0].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
    return { fetchImpl, torrentioCallCount: () => torrentioCalls };
  }

  test('la 2da consulta trae una H264+AAC cacheada → el resolver la elige (adiós /t/ lento)', async () => {
    const { fetchImpl, torrentioCallCount } = makeRefetchRouter([AC3_STREAM, FLUID_STREAM]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(1071, 'movie');

    expect(torrentioCallCount()).toBe(2); // el gate disparó el re-fetch
    expect(result.rdId).toBe('RD_FLUID'); // upgrade a la versión fluida cacheada
    expect(result.streamFilename).toBe('Ghost.Movie.2007.1080p.x264.AAC.mp4');
    expect(result.hasAAC).toBe(true);
    expect(result.isX265).toBe(false);
  });

  test('la 2da consulta no trae nada nuevo → la selección original queda IDÉNTICA', async () => {
    const { fetchImpl, torrentioCallCount } = makeRefetchRouter([AC3_STREAM]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(1071, 'movie');

    expect(torrentioCallCount()).toBe(2);
    expect(result.rdId).toBe('RD_AC3'); // sin candidatos nuevos → sin cambios
    expect(result.streamFilename).toBe('Ghost.Movie.2007.720p.AC3.5.1.x264.mkv');
  });

  test('si el re-fetch FALLA (red), la selección original sobrevive intacta', async () => {
    let torrentioCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({ ok: true, status: 200, url: finalUrl ?? url, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt0259324' });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) {
        torrentioCalls += 1;
        if (torrentioCalls > 1) throw new Error('Torrentio caído');
        return respond({ streams: [AC3_STREAM] });
      }
      if (/resolve\/realdebrid\/TEST_TOKEN\/cccc/.test(url)) return respond({}, DOWNLOADS[0].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(1071, 'movie');

    expect(result.rdId).toBe('RD_AC3'); // el fallo del re-fetch nunca rompe lo ya resuelto
  });

  test('si la elegida YA es fluida (Direct Play), NO se dispara segunda consulta', async () => {
    const { fetchImpl, torrentioCallCount } = makeRefetchRouter([]);
    // Reusar el router pero con un primer pool cuyo top ya es H264+AAC+MP4 con match:
    const fluidFirst = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({ ok: true, status: 200, url: finalUrl ?? url, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt0259324' });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) return respond({ streams: [FLUID_STREAM] });
      if (/resolve\/realdebrid\/TEST_TOKEN\/dddd/.test(url)) return respond({}, DOWNLOADS[1].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
    const resolver = buildResolver(fluidFirst as unknown as typeof fetch);
    const result = await resolver.getStream(1071, 'movie');

    expect(result.rdId).toBe('RD_FLUID');
    const torrentioHits = (fluidFirst.mock.calls as unknown as [string][]).filter(([u]) =>
      u.includes('torrentio.strem.fun/realdebrid=')
    ).length;
    expect(torrentioHits).toBe(1); // fluida de entrada → cero requests extra
    expect(torrentioCallCount()).toBe(0); // (el otro router quedó sin usar)
  });
});

// ── Plan B /t/: alternativas cacheadas para cambiar de copia si la elegida es lenta ──
describe('rdStream — altCachedCandidates (Plan B del pipeline /t/)', () => {
  const AC3_A = {
    name: '[RD+] Torrentio 720p',
    title: 'Slow.Movie.2007.720p.AC3.x264 💾 4.4 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/null/0/Slow.Movie.2007.720p.AC3.x264.mkv',
    infoHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    behaviorHints: { filename: 'Slow.Movie.2007.720p.AC3.x264.mkv' },
  };
  const AC3_B = {
    name: '[RD+] Torrentio 1080p',
    title: 'Slow.Movie.2007.1080p.DTS.x264 💾 8.0 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/ffffffffffffffffffffffffffffffffffffffff/null/0/Slow.Movie.2007.1080p.DTS.x264.mkv',
    infoHash: 'ffffffffffffffffffffffffffffffffffffffff',
    behaviorHints: { filename: 'Slow.Movie.2007.1080p.DTS.x264.mkv' },
  };
  const DL = [
    {
      id: 'RD_A',
      download: 'https://y1.stream.real-debrid.com/d/A/Slow.Movie.2007.720p.AC3.x264.mkv',
      filename: 'Slow.Movie.2007.720p.AC3.x264.mkv',
      filesize: 4400000000,
    },
    {
      id: 'RD_B',
      download: 'https://y2.stream.real-debrid.com/d/B/Slow.Movie.2007.1080p.DTS.x264.mkv',
      filename: 'Slow.Movie.2007.1080p.DTS.x264.mkv',
      filesize: 8000000000,
    },
  ];

  test('cuando la elegida va a /t/, las OTRAS copias cacheadas quedan listadas como Plan B', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt0000001' } },
      { match: /torrentio\.strem\.fun\/realdebrid=/, json: { streams: [AC3_A, AC3_B] } },
      { match: /resolve\/realdebrid\/TEST_TOKEN\/eeee/, json: {}, url: DL[0].download },
      { match: /\/downloads\?limit=500/, json: DL },
    ]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(42, 'movie');

    expect(result.rdId).toBe('RD_A'); // la elegida (score más alto: 720p AC3 vs DTS penalizado)
    expect(result.altCachedCandidates).toEqual([
      { rdId: 'RD_B', filename: 'Slow.Movie.2007.1080p.DTS.x264.mkv' },
    ]); // la otra copia cacheada, sin duplicar la elegida
  });

  test('sin otras copias cacheadas → sin lista (el Plan B simplemente no aplica)', async () => {
    const fetchImpl = makeRouter([
      { match: /external_ids/, json: { imdb_id: 'tt0000001' } },
      { match: /torrentio\.strem\.fun\/realdebrid=/, json: { streams: [AC3_A, AC3_B] } },
      { match: /resolve\/realdebrid\/TEST_TOKEN\/eeee/, json: {}, url: DL[0].download },
      { match: /\/downloads\?limit=500/, json: [DL[0]] }, // solo la elegida está cacheada
    ]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(42, 'movie');

    expect(result.rdId).toBe('RD_A');
    expect(result.altCachedCandidates).toBeUndefined();
  });
});

// ── noTrustworthyCachedVersion: TODAS las copias cacheadas son de origen cine/con subs ──
// Caso real "La muerte de Robin Hood" (2026-07-14, 3ª vuelta): 3 copias DISTINTAS
// probadas en producción (HC, PLSUBBED, sin etiqueta) — las 3 traían el MISMO
// subtítulo lituano quemado. Ninguna era realmente confiable.
describe('rdStream — noTrustworthyCachedVersion (todas las copias cacheadas son sospechosas)', () => {
  const HC_A = {
    name: '[RD+] Torrentio\n1080p',
    title: 'The.Death.Of.Robin.hood.2026.1080p.HC.DCPRip.AAC5.1-NeoNoir\n💾 1.78 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/1111111111111111111111111111111111111a/null/0/hc.mkv',
    infoHash: '1111111111111111111111111111111111111a',
    behaviorHints: { filename: 'The.Death.Of.Robin.hood.2026.1080p.HC.DCPRip.AAC5.1-NeoNoir.mkv' },
  };
  const PLSUBBED_B = {
    name: '[RD+] Torrentio\n1080p',
    title: 'The.Death.of.Robin.Hood.2026.PLSUBBED.AI.1080p.DCRip.XviD.AC3-MAXX\n💾 3.53 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/2222222222222222222222222222222222222b/null/0/pl.avi',
    infoHash: '2222222222222222222222222222222222222b',
    behaviorHints: { filename: 'The.Death.of.Robin.Hood.2026.PLSUBBED.AI.1080p.DCRip.XviD.AC3-MAXX.avi' },
  };
  // NOTA IMPORTANTE (honestidad sobre el alcance real de este fix): en producción
  // hubo una TERCERA copia sin ninguna etiqueta sospechosa en el nombre que TAMBIÉN
  // traía el subtítulo quemado — esa NO puede detectarse por texto (no hay ninguna
  // palabra que la delate) y por eso NO se modela aquí como "detectable". Este test
  // cubre lo que el fix SÍ puede garantizar: cuando TODOS los candidatos cacheados
  // declaran su riesgo (HC/PLSUBBED/origen cine), se activa la bandera. El caso
  // "ninguna etiqueta pero igual quemado" queda documentado como límite conocido en
  // sessions/2026-07-14.md — requeriría inspección real del video (OCR), no texto.
  const THEATER_C = {
    name: '[RD+] Torrentio',
    title: 'The.Death.Of.Robin.hood.V2.2026.2K.Theater.Rip.Lite.FLAC.5.1-BOOB\n💾 12.91 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/3333333333333333333333333333333333333c/null/0/theater.mkv',
    infoHash: '3333333333333333333333333333333333333c',
    behaviorHints: { filename: 'The.Death.Of.Robin.hood.V2.2026.2K.Theater.Rip.Lite.FLAC.5.1-BOOB.mkv' },
  };
  const DOWNLOADS = [
    { id: 'RD_HC', download: 'https://x1.stream.real-debrid.com/d/HC/hc.mkv', filename: 'The.Death.Of.Robin.hood.2026.1080p.HC.DCPRip.AAC5.1-NeoNoir.mkv', filesize: 1_780_000_000 },
    // THEATER_C ya estaba en el historial de descargas de la cuenta — gana Ronda 1
    // directo, sin pasar por el rescate.
    {
      id: 'RD_THEATER',
      download: 'https://x3.stream.real-debrid.com/d/THEATER/theater.mkv',
      filename: 'The.Death.Of.Robin.hood.V2.2026.2K.Theater.Rip.Lite.FLAC.5.1-BOOB.mkv',
      filesize: 12_910_000_000,
    },
  ];

  function makeRouter3(streams: unknown[]) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({ ok: true, status: 200, url: finalUrl ?? url, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt0000002' });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) return respond({ streams });
      if (/resolve\/realdebrid\/TEST_TOKEN\/1111/.test(url)) return respond({}, DOWNLOADS[0].download);
      if (/resolve\/realdebrid\/TEST_TOKEN\/3333/.test(url)) return respond({}, DOWNLOADS[1].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
  }

  test('las 3 copias cacheadas contaminadas → noTrustworthyCachedVersion true', async () => {
    const fetchImpl = makeRouter3([HC_A, PLSUBBED_B, THEATER_C]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(999, 'movie');

    expect(result.noTrustworthyCachedVersion).toBe(true);
  });

  test('si aparece UNA copia cacheada limpia (WEB-DL sin HC/región), no se activa la bandera', async () => {
    const CLEAN_D = {
      name: '[RD+] Torrentio\n1080p',
      title: 'The Death Of Robin Hood 2026 1080p WEB-DL H264 DDP5.1\n💾 5 GB',
      url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/4444444444444444444444444444444444444d/null/0/clean.mkv',
      infoHash: '4444444444444444444444444444444444444d',
      behaviorHints: { filename: 'The.Death.Of.Robin.Hood.2026.1080p.WEB-DL.H264.DDP5.1.mkv' },
    };
    const fetchImpl = makeRouter3([HC_A, PLSUBBED_B, THEATER_C, CLEAN_D]);
    const resolver = buildResolver(fetchImpl as unknown as typeof fetch);
    const result = await resolver.getStream(999, 'movie');

    expect(result.noTrustworthyCachedVersion).toBeUndefined();
  });
});

// ── Gate de idioma original vía TMDB (caso real "Kraken", 2026-07-14) ──
// Kraken (2026) es una película NORUEGA (confirmado en TMDB/Wikipedia). Ninguna
// copia cacheada declaraba idioma ("⚠️ otro") — la elegida era el noruego sin
// marcar. El gate exige audio confirmado (ENG/SPA/Latino) cuando el idioma
// original no es inglés ni español.
describe('rdStream — gate de idioma original (caso real "Kraken", noruega)', () => {
  const NORWEGIAN_UNTAGGED = {
    name: '[RD+] Torrentio\n720p',
    title: 'Kraken 2026 720p BluRay x264-GeneMige 💾 3.56 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/7777777777777777777777777777777777777a/null/0/kraken-no.mkv',
    infoHash: '7777777777777777777777777777777777777a',
    behaviorHints: { filename: 'Kraken 2026 720p BluRay x264-GeneMige.mkv' },
  };
  const ENGLISH_CONFIRMED = {
    name: '[RD+] Torrentio\n1080p',
    title: 'Kraken 2026 1080p BluRay ENG AAC 💾 4 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/8888888888888888888888888888888888888b/null/0/kraken-en.mkv',
    infoHash: '8888888888888888888888888888888888888b',
    behaviorHints: { filename: 'Kraken.2026.1080p.BluRay.ENG.AAC.mkv' },
  };
  const DOWNLOADS = [
    { id: 'RD_NO', download: 'https://k1.stream.real-debrid.com/d/NO/kraken-no.mkv', filename: 'Kraken 2026 720p BluRay x264-GeneMige.mkv', filesize: 3_560_000_000 },
    { id: 'RD_EN', download: 'https://k2.stream.real-debrid.com/d/EN/kraken-en.mkv', filename: 'Kraken.2026.1080p.BluRay.ENG.AAC.mkv', filesize: 4_000_000_000 },
  ];

  function buildResolverWithLang(streams: unknown[], originalLanguage: string | null) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({ ok: true, status: 200, url: finalUrl ?? url, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt9999999' });
      // Endpoint de detalle (para original_language) — NO matchea /external_ids.
      if (/\/movie\/\d+\?/.test(url)) return respond({ original_language: originalLanguage });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) return respond({ streams });
      if (/resolve\/realdebrid\/TEST_TOKEN\/7777/.test(url)) return respond({}, DOWNLOADS[0].download);
      if (/resolve\/realdebrid\/TEST_TOKEN\/8888/.test(url)) return respond({}, DOWNLOADS[1].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
    const tmdbClient = createTmdbClient({ apiKey: 'TMDB_KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    const torrentioClient = createTorrentioClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const rdClient = createRealDebridClient({ rdToken: 'TEST_TOKEN', fetchImpl: fetchImpl as unknown as typeof fetch });
    return createRdStreamResolver({ rdToken: 'TEST_TOKEN', tmdbClient, torrentioClient, rdClient });
  }

  test('idioma original noruego + NINGÚN candidato confirma ENG/SPA/Latino → reproduce igual + foreignAudioLanguage', async () => {
    // Cambio de diseño (2026-07-14): ya NO bloquea — se reproduce el audio
    // original y se marca el idioma para que usePlayer muestre el toast.
    const resolver = buildResolverWithLang([NORWEGIAN_UNTAGGED], 'no');
    const result = await resolver.getStream(1110034, 'movie');
    expect(result.foreignAudioLanguage).toBe('no');
    expect(result.rdId).toBe('RD_NO');
  });

  test('idioma original noruego + SÍ hay un candidato con ENG confirmado → lo elige, sin aviso', async () => {
    const resolver = buildResolverWithLang([NORWEGIAN_UNTAGGED, ENGLISH_CONFIRMED], 'no');
    const result = await resolver.getStream(1110034, 'movie');
    expect(result.foreignAudioLanguage).toBeUndefined();
    expect(result.rdId).toBe('RD_EN');
  });

  test('idioma original inglés ("en") → nunca activa el aviso aunque nadie declare idioma (Hollywood normal)', async () => {
    const resolver = buildResolverWithLang([NORWEGIAN_UNTAGGED], 'en');
    const result = await resolver.getStream(1110034, 'movie');
    expect(result.foreignAudioLanguage).toBeUndefined();
    expect(result.rdId).toBe('RD_NO'); // se elige igual, comportamiento normal sin aviso
  });

  test('idioma original español ("es") tampoco activa el aviso', async () => {
    const resolver = buildResolverWithLang([NORWEGIAN_UNTAGGED], 'es');
    const result = await resolver.getStream(1110034, 'movie');
    expect(result.foreignAudioLanguage).toBeUndefined();
  });

  test('si TMDB no devuelve idioma original (null/error), no rompe nada', async () => {
    const resolver = buildResolverWithLang([NORWEGIAN_UNTAGGED], null);
    const result = await resolver.getStream(1110034, 'movie');
    expect(result.foreignAudioLanguage).toBeUndefined();
    expect(result.rdId).toBe('RD_NO');
  });
});

// ── Plan B: el filtro de altCachedCandidates respeta el CORTE/edición (caso real "Ghost Rider") ──
describe('rdStream — Plan B respeta cutMarker (no ofrece Extended↔Theatrical como alternativa)', () => {
  const EXTENDED_A = {
    name: '[RD+] Torrentio\n720p',
    title: 'Ghost Rider 2007 Extended Cut BluRay 720p AC3 5.1 - Waldek 💾 4.4 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/9999999999999999999999999999999999999a/null/0/ext.mkv',
    infoHash: '9999999999999999999999999999999999999a',
    behaviorHints: { filename: 'Ghost Rider 2007 Extended Cut BluRay 720p AC3 5.1 - Waldek.mkv' },
  };
  const THEATRICAL_B = {
    name: '[RD+] Torrentio\n1080p',
    title: 'Ghost Rider 2007 1080p BluRay x264 DTS 💾 8 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/8888888888888888888888888888888888888b/null/0/theat.mkv',
    infoHash: '8888888888888888888888888888888888888b',
    behaviorHints: { filename: 'Ghost.Rider.2007.1080p.BluRay.x264.DTS.mkv' },
  };
  const EXTENDED_C = {
    name: '[RD+] Torrentio\n720p',
    title: 'Ghost Rider 2007 Extended Cut WEBRip 720p AAC 💾 2.1 GB',
    url: 'https://torrentio.strem.fun/resolve/realdebrid/TEST_TOKEN/7777777777777777777777777777777777777c/null/0/ext2.mkv',
    infoHash: '7777777777777777777777777777777777777c',
    behaviorHints: { filename: 'Ghost.Rider.2007.Extended.Cut.WEBRip.720p.AAC.mkv' },
  };
  const DOWNLOADS = [
    { id: 'RD_EXT_A', download: 'https://x1.stream.real-debrid.com/d/A/ext.mkv', filename: 'Ghost Rider 2007 Extended Cut BluRay 720p AC3 5.1 - Waldek.mkv', filesize: 4_400_000_000 },
    { id: 'RD_THEAT_B', download: 'https://x2.stream.real-debrid.com/d/B/theat.mkv', filename: 'Ghost.Rider.2007.1080p.BluRay.x264.DTS.mkv', filesize: 8_000_000_000 },
    { id: 'RD_EXT_C', download: 'https://x3.stream.real-debrid.com/d/C/ext2.mkv', filename: 'Ghost.Rider.2007.Extended.Cut.WEBRip.720p.AAC.mkv', filesize: 2_100_000_000 },
  ];

  test('la Theatrical (sin marcador Extended) NUNCA aparece como alternativa de una Extended Cut', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (json: unknown, finalUrl?: string) =>
        ({ ok: true, status: 200, url: finalUrl ?? url, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (/external_ids/.test(url)) return respond({ imdb_id: 'tt0259324' });
      if (/torrentio\.strem\.fun\/realdebrid=/.test(url)) return respond({ streams: [EXTENDED_A, THEATRICAL_B, EXTENDED_C] });
      if (/resolve\/realdebrid\/TEST_TOKEN\/9999/.test(url)) return respond({}, DOWNLOADS[0].download);
      if (/\/downloads\?limit=500/.test(url)) return respond(DOWNLOADS);
      throw new Error('Sin ruta mockeada para: ' + url);
    });
    const tmdbClient = createTmdbClient({ apiKey: 'TMDB_KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    const torrentioClient = createTorrentioClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const rdClient = createRealDebridClient({ rdToken: 'TEST_TOKEN', fetchImpl: fetchImpl as unknown as typeof fetch });
    const resolver = createRdStreamResolver({ rdToken: 'TEST_TOKEN', tmdbClient, torrentioClient, rdClient });
    const result = await resolver.getStream(1481, 'movie');

    // Cualquiera de las dos Extended puede ganar el scoring (no es lo que se prueba
    // acá) — lo que importa es que la ALTERNATIVA sea la OTRA Extended, nunca la
    // Theatrical, sin importar cuál haya ganado.
    expect(['RD_EXT_A', 'RD_EXT_C']).toContain(result.rdId);
    const altIds = (result.altCachedCandidates ?? []).map((a) => a.rdId);
    expect(altIds).not.toContain('RD_THEAT_B'); // la Theatrical NUNCA es alternativa
    expect(altIds).toEqual(result.rdId === 'RD_EXT_A' ? ['RD_EXT_C'] : ['RD_EXT_A']);
  });
});
