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
