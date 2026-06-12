import { describe, test, expect, vi } from 'vitest';
import { buildTmdbUrl, createTmdbClient, TMDB_BASE } from '../src/services/tmdb';
import { buildStreamPath, buildTorrentioUrl, createTorrentioClient, TORRENTIO_BASE } from '../src/services/torrentio';
import {
  isTorrentioProxyUrl,
  shouldAdoptResolvedUrl,
  pickHlsFallbackFromTranscode,
  pickDashUrlFromTranscode,
  isDualLatFilename,
  createRealDebridClient,
} from '../src/services/realdebrid';

// ── Helper para mockear `fetch` con una respuesta JSON ───────────────────────
function mockFetchJson(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    url: '',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

describe('tmdb — construcción de URL y cliente memoizado', () => {
  test('buildTmdbUrl agrega api_key con "?" si el endpoint no trae query', () => {
    expect(buildTmdbUrl(TMDB_BASE, '/movie/123', 'KEY')).toBe(`${TMDB_BASE}/movie/123?api_key=KEY`);
  });

  test('buildTmdbUrl agrega api_key con "&" si el endpoint ya trae query', () => {
    expect(buildTmdbUrl(TMDB_BASE, '/search/movie?query=alien', 'KEY')).toBe(
      `${TMDB_BASE}/search/movie?query=alien&api_key=KEY`
    );
  });

  test('get() memoiza por endpoint — solo llama a fetch una vez para el mismo endpoint', async () => {
    const fetchImpl = mockFetchJson({ id: 1, name: 'Alien' });
    const client = createTmdbClient({ apiKey: 'KEY', fetchImpl: fetchImpl as unknown as typeof fetch });

    const a = await client.get('/movie/123');
    const b = await client.get('/movie/123');
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('get() lanza un Error con el status si la respuesta no es OK', async () => {
    const fetchImpl = mockFetchJson({}, false, 404);
    const client = createTmdbClient({ apiKey: 'KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.get('/movie/999')).rejects.toThrow('TMDB 404');
  });

  test('getImdbId pide /movie|tv/{id}/external_ids y devuelve imdb_id (o null)', async () => {
    const fetchImpl = mockFetchJson({ imdb_id: 'tt0111161' });
    const client = createTmdbClient({ apiKey: 'KEY', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.getImdbId(278, 'movie')).toBe('tt0111161');
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/movie/278/external_ids'));

    const fetchImplNull = mockFetchJson({ imdb_id: null });
    const client2 = createTmdbClient({ apiKey: 'KEY', fetchImpl: fetchImplNull as unknown as typeof fetch });
    expect(await client2.getImdbId('1399', 'tv')).toBeNull();
  });

  test('el tamaño del caché depende del modo TV (40) vs resto (120)', async () => {
    const fetchImpl = mockFetchJson({ ok: true });
    const tv = createTmdbClient({ apiKey: 'K', isTvMode: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    const desktop = createTmdbClient({ apiKey: 'K', isTvMode: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    // Llenar más allá de 40 en "tv" y verificar que nunca exceda ese tope
    for (let i = 0; i < 45; i++) await tv.get(`/movie/${i}`);
    expect(tv.cache.size()).toBeLessThanOrEqual(40);

    for (let i = 0; i < 5; i++) await desktop.get(`/movie/${i}`);
    expect(desktop.cache.size()).toBe(5);
  });
});

describe('torrentio — construcción de URL y cliente de streams', () => {
  test('buildStreamPath: película vs serie', () => {
    expect(buildStreamPath({ imdbId: 'tt0068646', type: 'movie' })).toBe('/stream/movie/tt0068646.json');
    expect(buildStreamPath({ imdbId: 'tt0903747', type: 'tv', season: 1, episode: 5 })).toBe(
      '/stream/series/tt0903747:1:5.json'
    );
  });

  test('buildTorrentioUrl arma realdebrid={token}|qualityfilter=...{path}', () => {
    const url = buildTorrentioUrl({ rdToken: 'TOK', imdbId: 'tt0068646', type: 'movie' });
    expect(url).toBe(`${TORRENTIO_BASE}/realdebrid=TOK|qualityfilter=other,scr,cam/stream/movie/tt0068646.json`);
  });

  test('buildTorrentioUrl respeta un qualityFilter custom', () => {
    const url = buildTorrentioUrl({ rdToken: 'TOK', imdbId: 'tt1', type: 'movie', qualityFilter: 'cam' });
    expect(url).toContain('qualityfilter=cam');
  });

  test('fetchStreams devuelve [] si la respuesta no trae streams (preserva guard original)', async () => {
    const fetchImpl = mockFetchJson({});
    const client = createTorrentioClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.fetchStreams({ rdToken: 'T', imdbId: 'tt1', type: 'movie' })).toEqual([]);
  });

  test('fetchStreams devuelve el array de streams cuando existen', async () => {
    const streams = [{ name: 'RD', url: 'https://x' }];
    const fetchImpl = mockFetchJson({ streams });
    const client = createTorrentioClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.fetchStreams({ rdToken: 'T', imdbId: 'tt1', type: 'movie' })).toEqual(streams);
  });
});

describe('realdebrid — helpers puros (proxy, transcode, audio dual)', () => {
  test('isTorrentioProxyUrl detecta URLs de torrentio.strem.fun', () => {
    expect(isTorrentioProxyUrl('https://torrentio.strem.fun/resolve/x')).toBe(true);
    expect(isTorrentioProxyUrl('https://x.real-debrid.com/d/abc')).toBe(false);
  });

  test('shouldAdoptResolvedUrl exige que cambie Y contenga "real-debrid"', () => {
    expect(shouldAdoptResolvedUrl('https://x.real-debrid.com/d/abc', 'https://torrentio.strem.fun/x')).toBe(true);
    expect(shouldAdoptResolvedUrl('https://torrentio.strem.fun/x', 'https://torrentio.strem.fun/x')).toBe(false); // no cambió
    expect(shouldAdoptResolvedUrl('https://login.example.com/error', 'https://torrentio.strem.fun/x')).toBe(false); // no es RD
    expect(shouldAdoptResolvedUrl(null, 'https://torrentio.strem.fun/x')).toBe(false);
  });

  test('pickHlsFallbackFromTranscode: cascada apple → h264 → null', () => {
    expect(pickHlsFallbackFromTranscode({ apple: { full: 'A' } })).toBe('A');
    expect(pickHlsFallbackFromTranscode({ h264: { full: 'H' } } as never)).toBe('H');
    expect(pickHlsFallbackFromTranscode({ apple: { full: 'A' }, h264: { full: 'H' } } as never)).toBe('A');
    expect(pickHlsFallbackFromTranscode({})).toBeNull();
  });

  test('pickDashUrlFromTranscode devuelve dash.full o null', () => {
    expect(pickDashUrlFromTranscode({ dash: { full: 'D' } })).toBe('D');
    expect(pickDashUrlFromTranscode({})).toBeNull();
  });

  test('isDualLatFilename detecta pistas de audio en español por nombre de archivo', () => {
    expect(isDualLatFilename('Movie.2020.Dual.Latino.mkv')).toBe(true);
    expect(isDualLatFilename('Movie.2020.SPA.mkv')).toBe(true);
    expect(isDualLatFilename('Movie.2020.ENG.mkv')).toBe(false);
    expect(isDualLatFilename(null)).toBe(false);
  });

  test('resolveProxyUrl: sigue el redirect y adopta la URL si es de real-debrid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ url: 'https://abc.real-debrid.com/d/final' } as Response);
    const client = createRealDebridClient({ rdToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const resolved = await client.resolveProxyUrl('https://torrentio.strem.fun/resolve/x');
    expect(resolved).toBe('https://abc.real-debrid.com/d/final');
  });

  test('resolveProxyUrl: si no es URL de torrentio, la devuelve sin tocar (no hace fetch)', async () => {
    const fetchImpl = vi.fn();
    const client = createRealDebridClient({ rdToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const resolved = await client.resolveProxyUrl('https://x.real-debrid.com/d/already');
    expect(resolved).toBe('https://x.real-debrid.com/d/already');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('resolveProxyUrl: silencia errores de red y devuelve la URL original', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const client = createRealDebridClient({ rdToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const resolved = await client.resolveProxyUrl('https://torrentio.strem.fun/resolve/x');
    expect(resolved).toBe('https://torrentio.strem.fun/resolve/x');
  });

  test('fetchDownloads devuelve [] si la respuesta no es un array', async () => {
    const fetchImpl = mockFetchJson({ error: 'unauthorized' });
    const client = createRealDebridClient({ rdToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.fetchDownloads()).toEqual([]);
  });

  test('fetchDownloads envía el header Authorization Bearer con el token', async () => {
    const fetchImpl = mockFetchJson([{ id: '1', filename: 'a.mkv' }]);
    const client = createRealDebridClient({ rdToken: 'SECRET', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.fetchDownloads();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/downloads?limit=500'),
      expect.objectContaining({ headers: { Authorization: 'Bearer SECRET' } })
    );
  });

  test('findDownloadMatch obtiene downloads y delega en matchInDownloads', async () => {
    const fetchImpl = mockFetchJson([
      { id: 'rd1', download: 'https://real-debrid.com/d/x', filename: 'Movie.mkv', filesize: 123 },
    ]);
    const client = createRealDebridClient({ rdToken: 'TOK', fetchImpl: fetchImpl as unknown as typeof fetch });
    const match = await client.findDownloadMatch('https://real-debrid.com/d/x', 'orig', 'Movie.mkv');
    expect(match?.id).toBe('rd1');
  });
});
