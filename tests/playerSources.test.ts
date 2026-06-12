import { describe, test, expect } from 'vitest';
import {
  SOURCES,
  RD_SRC_IDX,
  buildIframeSourceUrl,
  seasonOptions,
  episodeOptions,
  progressPctFromElapsed,
  shouldPersistProgressOnClose,
  autoNextDelayMs,
  canScheduleAutoNext,
  nextEpisodeTarget,
  prevEpisodeTarget,
  sourceToastLabel,
} from '../src/services/playerSources';

describe('SOURCES / buildIframeSourceUrl (preservados EXACTOS de líneas ~5365-5378 y ~7757-7762)', () => {
  test('UnlimPlay y vidlink arman las URLs de movie/tv exactas', () => {
    expect(SOURCES[0].movie(550)).toBe('https://unlimplay.com/play/embed/movie/550');
    expect(SOURCES[0].tv(1399, 2, 5)).toBe('https://unlimplay.com/play/embed/tv/1399/2/5');
    expect(SOURCES[1].movie(550)).toBe('https://vidlink.pro/movie/550');
    expect(SOURCES[1].tv(1399, 2, 5)).toBe('https://vidlink.pro/tv/1399/2/5');
  });

  test('buildIframeSourceUrl elige movie/tv según el tipo', () => {
    expect(buildIframeSourceUrl(SOURCES, 0, 'movie', 550, 1, 1)).toBe('https://unlimplay.com/play/embed/movie/550');
    expect(buildIframeSourceUrl(SOURCES, 1, 'tv', 1399, 2, 5)).toBe('https://vidlink.pro/tv/1399/2/5');
  });

  test('cae a la fuente 0 si el índice no existe (preserva `SOURCES[idx] || SOURCES[0]`)', () => {
    expect(buildIframeSourceUrl(SOURCES, 99, 'movie', 550, 1, 1)).toBe('https://unlimplay.com/play/embed/movie/550');
  });

  test('RD_SRC_IDX preserva el valor mágico 99', () => {
    expect(RD_SRC_IDX).toBe(99);
  });
});

describe('seasonOptions / episodeOptions (preservados EXACTOS de renderEpisodeControls, líneas ~7629-7633)', () => {
  test('arman las opciones 1..N marcando la activa como `selected`', () => {
    expect(seasonOptions(3, 2)).toEqual([
      { value: 1, label: 'Temporada 1', selected: false },
      { value: 2, label: 'Temporada 2', selected: true },
      { value: 3, label: 'Temporada 3', selected: false },
    ]);
    expect(episodeOptions(2, 1)).toEqual([
      { value: 1, label: 'Episodio 1', selected: true },
      { value: 2, label: 'Episodio 2', selected: false },
    ]);
  });

  test('totalSeasons/episodeCount = 0 produce listas vacías', () => {
    expect(seasonOptions(0, 1)).toEqual([]);
    expect(episodeOptions(0, 1)).toEqual([]);
  });
});

describe('progressPctFromElapsed / shouldPersistProgressOnClose (preservados EXACTOS de líneas ~7702-7704/8740-8743)', () => {
  test('calcula el % sobre runtime, con fallback de 22min y clamp a 95', () => {
    expect(progressPctFromElapsed(11, 22)).toBe(50);
    expect(progressPctFromElapsed(11, 0)).toBe(50); // fallback runtime=22
    expect(progressPctFromElapsed(100, 22)).toBe(95); // clamp
  });

  test('shouldPersistProgressOnClose solo guarda si pct>3', () => {
    expect(shouldPersistProgressOnClose(3)).toBe(false);
    expect(shouldPersistProgressOnClose(3.1)).toBe(true);
    expect(shouldPersistProgressOnClose(50)).toBe(true);
  });
});

describe('autoNextDelayMs (preservado EXACTO de doSchedule, líneas ~8290-8291 — fallback 24min, distinto del de progreso)', () => {
  test('85% del runtime en ms, con piso de 40 segundos', () => {
    expect(autoNextDelayMs(40)).toBe(40 * 60 * 1000 * 0.85);
    expect(autoNextDelayMs(0)).toBe(24 * 60 * 1000 * 0.85); // fallback de 24min — curiosidad preservada
    expect(autoNextDelayMs(0.1)).toBe(40000); // piso de 40s
  });
});

describe('canScheduleAutoNext / nextEpisodeTarget / prevEpisodeTarget (preservados EXACTOS, líneas ~8294-8296/8315-8390/8568-8588)', () => {
  test('canScheduleAutoNext: hay "siguiente" si quedan episodios, temporadas, o no se sabe el total', () => {
    expect(canScheduleAutoNext({ season: 1, episode: 1, totalSeasons: 1, totalEpisodes: 10 })).toBe(true);
    expect(canScheduleAutoNext({ season: 1, episode: 10, totalSeasons: 1, totalEpisodes: 10 })).toBe(false);
    expect(canScheduleAutoNext({ season: 1, episode: 10, totalSeasons: 2, totalEpisodes: 10 })).toBe(true);
    expect(canScheduleAutoNext({ season: 1, episode: 1, totalSeasons: 1, totalEpisodes: 0 })).toBe(true);
  });

  test('nextEpisodeTarget avanza dentro de la temporada, o salta a la siguiente (episodio 1)', () => {
    expect(nextEpisodeTarget({ season: 1, episode: 3, totalSeasons: 2, totalEpisodes: 10 })).toEqual({
      season: 1,
      episode: 4,
      isNewSeason: false,
    });
    expect(nextEpisodeTarget({ season: 1, episode: 10, totalSeasons: 2, totalEpisodes: 10 })).toEqual({
      season: 2,
      episode: 1,
      isNewSeason: true,
    });
    expect(nextEpisodeTarget({ season: 2, episode: 10, totalSeasons: 2, totalEpisodes: 10 })).toBeNull();
  });

  test('prevEpisodeTarget retrocede dentro de la temporada, NUNCA cruza a la anterior (curiosidad preservada)', () => {
    expect(prevEpisodeTarget({ season: 2, episode: 3, totalSeasons: 2, totalEpisodes: 10 })).toEqual({ season: 2, episode: 2 });
    expect(prevEpisodeTarget({ season: 2, episode: 1, totalSeasons: 2, totalEpisodes: 10 })).toBeNull();
  });
});

describe('sourceToastLabel (preservado EXACTO de switchSource, líneas ~8561-8565)', () => {
  test('RD muestra el mensaje de búsqueda; las demás fuentes muestran ícono+nombre', () => {
    expect(sourceToastLabel(SOURCES, RD_SRC_IDX)).toBe('⚡ Real-Debrid — Buscando stream...');
    expect(sourceToastLabel(SOURCES, 0)).toBe('▶ UnlimPlay');
    expect(sourceToastLabel(SOURCES, 1)).toBe('▶ vidlink');
    expect(sourceToastLabel(SOURCES, 5)).toBe('');
  });
});
