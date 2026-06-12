import { describe, test, expect, vi } from 'vitest';
import {
  ANIME_API_BASE,
  ANIME_API_KEY,
  anime1Search,
  anime1Info,
  anime1Episode,
  findBestMatch,
  pickEpisodeByNumber,
  buildAnimeServerList,
  hasApiServers,
  type Anime1SearchResult,
  type Anime1Episode as Anime1EpisodeType,
} from '../src/services/anime1';

function fakeFetch(json: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => json })) as unknown as typeof fetch;
}

describe('anime1Search / anime1Info / anime1Episode (preservados EXACTOS de líneas ~4505-4524)', () => {
  test('arman la URL con base+apiKey y devuelven el JSON', async () => {
    const fetchImpl = fakeFetch({ data: { results: [] } });
    const res = await anime1Search('Naruto', fetchImpl);
    expect(res).toEqual({ data: { results: [] } });
    expect(fetchImpl).toHaveBeenCalledWith(`${ANIME_API_BASE}/api/v1/anime/search?q=Naruto&apiKey=${ANIME_API_KEY}`);
  });

  test('anime1Info y anime1Episode codifican la URL del recurso', async () => {
    const fetchImpl = fakeFetch({ data: { episodes: [] } });
    await anime1Info('https://example.com/a b', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ANIME_API_BASE}/api/v1/anime/info?url=${encodeURIComponent('https://example.com/a b')}&apiKey=${ANIME_API_KEY}`
    );
    await anime1Episode('https://example.com/ep1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ANIME_API_BASE}/api/v1/anime/episode?url=${encodeURIComponent('https://example.com/ep1')}&apiKey=${ANIME_API_KEY}`
    );
  });

  test('devuelven null si la red falla (no rompe la app)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await anime1Search('x', fetchImpl)).toBeNull();
    expect(await anime1Info('x', fetchImpl)).toBeNull();
    expect(await anime1Episode('x', fetchImpl)).toBeNull();
  });
});

describe('findBestMatch (preservado EXACTO del algoritmo de 3 pasadas, líneas ~4526-4546)', () => {
  const results: Anime1SearchResult[] = [
    { title: 'Attack on Titan', url: '/aot' },
    { title: 'Attack on Titan: Final Season', url: '/aot-final' },
    { title: 'One Piece', url: '/op' },
  ];

  test('null si no hay resultados', () => {
    expect(findBestMatch('Naruto', null)).toBeNull();
    expect(findBestMatch('Naruto', [])).toBeNull();
  });

  test('coincidencia exacta (normalizada) tiene prioridad', () => {
    expect(findBestMatch('Attack on Titan', results)).toEqual(results[0]);
    expect(findBestMatch('attack-on-titan!!', results)).toEqual(results[0]);
  });

  test('si no hay exacta, cae a "contains" en cualquier dirección', () => {
    expect(findBestMatch('One Piece: East Blue', results)).toEqual(results[2]);
  });

  test('si no hay "contains", usa puntaje por solapamiento de palabras', () => {
    const onlyPartial: Anime1SearchResult[] = [
      { title: 'Demon Slayer Kimetsu no Yaiba', url: '/ds' },
      { title: 'My Hero Academia', url: '/mha' },
    ];
    expect(findBestMatch('Kimetsu no Yaiba: Mugen Train', onlyPartial)).toEqual(onlyPartial[0]);
  });
});

describe('pickEpisodeByNumber (preservado EXACTO de líneas ~4669-4671)', () => {
  const episodes: Anime1EpisodeType[] = [
    { number: '1', url: '/ep1' },
    { number: '2', url: '/ep2' },
    { number: '5', url: '/ep5' },
  ];

  test('busca primero por número absoluto exacto', () => {
    expect(pickEpisodeByNumber(episodes, 5)).toEqual(episodes[2]);
  });

  test('si no hay coincidencia exacta, cae al índice posicional (episode-1)', () => {
    expect(pickEpisodeByNumber(episodes, 3)).toEqual(episodes[2]); // episodes[3-1]
  });

  test('null si no hay episodios o el índice cae fuera de rango', () => {
    expect(pickEpisodeByNumber([], 1)).toBeNull();
    expect(pickEpisodeByNumber(null, 1)).toBeNull();
    expect(pickEpisodeByNumber(episodes, 99)).toBeNull();
  });
});

describe('buildAnimeServerList / hasApiServers (preservados EXACTOS de _renderAnimeSourceSelector, líneas ~4561-4581)', () => {
  test('StreamiX siempre primero, soporta formato `streamLinks`', () => {
    const list = buildAnimeServerList('https://streamix/url', {
      streamLinks: {
        SUB: [{ server: 'ServerA', url: '/sub-a' }],
        DUB: [{ server: 'ServerB', url: '/dub-b' }],
      },
    });
    expect(list).toEqual([
      { label: '🇲🇽 StreamiX', url: 'https://streamix/url', type: 'MX' },
      { label: '🇯🇵 ServerA', url: '/sub-a', type: 'SUB' },
      { label: '🇲🇽 ServerB', url: '/dub-b', type: 'DUB' },
    ]);
    expect(hasApiServers(list)).toBe(true);
  });

  test('cae al formato `servers.{sub,dub}` si `streamLinks` está vacío', () => {
    const list = buildAnimeServerList('https://streamix/url', {
      servers: { sub: [{ server: 'X', url: '/x' }], dub: [] },
    });
    expect(list).toEqual([
      { label: '🇲🇽 StreamiX', url: 'https://streamix/url', type: 'MX' },
      { label: '🇯🇵 X', url: '/x', type: 'SUB' },
    ]);
  });

  test('sin servidores de la API: solo StreamiX, hasApiServers es false', () => {
    const list = buildAnimeServerList('https://streamix/url', null);
    expect(list).toEqual([{ label: '🇲🇽 StreamiX', url: 'https://streamix/url', type: 'MX' }]);
    expect(hasApiServers(list)).toBe(false);
  });
});
