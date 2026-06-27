import { describe, test, expect, vi } from 'vitest';
import {
  episodeStillUrl,
  normalizeEpisode,
  fetchSeasonEpisodes,
} from '../src/services/episodes';
import { TMDB_IMG_BASE } from '../src/services/catalog';

describe('episodeStillUrl', () => {
  test('arma la URL con tamaño w300 cuando hay still_path', () => {
    expect(episodeStillUrl('/abc.jpg')).toBe(`${TMDB_IMG_BASE}w300/abc.jpg`);
  });

  test('devuelve null si no hay still_path', () => {
    expect(episodeStillUrl(null)).toBeNull();
    expect(episodeStillUrl(undefined)).toBeNull();
    expect(episodeStillUrl('')).toBeNull();
  });
});

describe('normalizeEpisode', () => {
  test('mapea los campos y construye la miniatura', () => {
    const ep = normalizeEpisode(
      { episode_number: 3, name: 'El otro lado', overview: 'Sinopsis.', still_path: '/s.jpg', runtime: 50, air_date: '2024-01-10' },
      2,
    );
    expect(ep).toEqual({
      number: 3,
      name: 'El otro lado',
      overview: 'Sinopsis.',
      stillUrl: `${TMDB_IMG_BASE}w300/s.jpg`,
      runtime: 50,
      airDate: '2024-01-10',
    });
  });

  test('aplica fallbacks: número por índice, título "Episodio N", overview vacío, runtime null', () => {
    const ep = normalizeEpisode({}, 0);
    expect(ep.number).toBe(1);
    expect(ep.name).toBe('Episodio 1');
    expect(ep.overview).toBe('');
    expect(ep.stillUrl).toBeNull();
    expect(ep.runtime).toBeNull();
    expect(ep.airDate).toBeNull();
  });

  test('runtime 0 o negativo se normaliza a null', () => {
    expect(normalizeEpisode({ runtime: 0 }, 0).runtime).toBeNull();
    expect(normalizeEpisode({ runtime: -5 }, 0).runtime).toBeNull();
  });

  test('título solo con espacios cae al fallback', () => {
    expect(normalizeEpisode({ episode_number: 2, name: '   ' }, 1).name).toBe('Episodio 2');
  });
});

describe('fetchSeasonEpisodes', () => {
  test('pide el endpoint correcto y normaliza la lista', async () => {
    const get = vi.fn().mockResolvedValue({
      episodes: [
        { episode_number: 1, name: 'Uno', still_path: '/1.jpg', runtime: 48 },
        { episode_number: 2, name: 'Dos' },
      ],
    });
    const eps = await fetchSeasonEpisodes({ get }, 124364, 1);
    expect(get).toHaveBeenCalledWith('/tv/124364/season/1?language=es-ES');
    expect(eps).toHaveLength(2);
    expect(eps[0].name).toBe('Uno');
    expect(eps[0].stillUrl).toBe(`${TMDB_IMG_BASE}w300/1.jpg`);
    expect(eps[1].stillUrl).toBeNull();
  });

  test('respeta el idioma pasado', async () => {
    const get = vi.fn().mockResolvedValue({ episodes: [] });
    await fetchSeasonEpisodes({ get }, 1, 2, 'en-US');
    expect(get).toHaveBeenCalledWith('/tv/1/season/2?language=en-US');
  });

  test('si TMDB falla devuelve [] (no lanza)', async () => {
    const get = vi.fn().mockRejectedValue(new Error('TMDB 500'));
    await expect(fetchSeasonEpisodes({ get }, 1, 1)).resolves.toEqual([]);
  });

  test('tolera respuesta sin campo episodes', async () => {
    const get = vi.fn().mockResolvedValue({});
    await expect(fetchSeasonEpisodes({ get }, 1, 1)).resolves.toEqual([]);
  });
});
