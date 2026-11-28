import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  PROGRESS_STORAGE_KEY,
  progressKey,
  loadAllProgress,
  persistAllProgress,
  getProgressEntry,
  withSavedProgress,
  withoutProgress,
  playButtonLabel,
  type ProgressEntry,
  type ProgressMap,
} from '../src/services/progress';
import { _resetMemStoreForTests } from '../src/services/safeStorage';

beforeEach(() => {
  localStorage.clear();
  _resetMemStoreForTests();
});

describe('progressKey (preservado de la clave compuesta `${type}:${id}`, líneas ~7464/7469)', () => {
  test('combina tipo e id con dos puntos', () => {
    expect(progressKey(123, 'movie')).toBe('movie:123');
    expect(progressKey('abc', 'tv')).toBe('tv:abc');
  });
});

describe('loadAllProgress / persistAllProgress (preservados de getAllProgress/saveProgress, líneas ~7456-7467)', () => {
  test('devuelve {} si no hay nada guardado', () => {
    expect(loadAllProgress()).toEqual({});
  });

  test('devuelve {} si el JSON guardado está corrupto (no rompe la app)', () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, '{not-json');
    expect(loadAllProgress()).toEqual({});
  });

  test('devuelve {} si el valor guardado no es un objeto plano (datos corruptos)', () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadAllProgress()).toEqual({});
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(42));
    expect(loadAllProgress()).toEqual({});
  });

  test('persistAllProgress + loadAllProgress hacen round-trip', () => {
    const all: ProgressMap = { 'movie:1': { id: '1', type: 'movie', pct: 50, ts: 123 } };
    persistAllProgress(all);
    expect(loadAllProgress()).toEqual(all);
  });
});

describe('getProgressEntry (preservado de getProgress, línea ~7468-7470)', () => {
  test('devuelve la entrada si existe, o null si no', () => {
    const all: ProgressMap = { 'tv:5': { id: 5, type: 'tv', pct: 30, season: 1, episode: 2, ts: 1 } };
    expect(getProgressEntry(all, 5, 'tv')).toEqual(all['tv:5']);
    expect(getProgressEntry(all, 5, 'movie')).toBeNull();
    expect(getProgressEntry(all, 999, 'tv')).toBeNull();
  });
});

describe('withSavedProgress (preservado EXACTO de saveProgress, línea ~7462-7467)', () => {
  test('mergea data + id/type/ts, sin mutar el mapa original (inmutable)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const before: ProgressMap = {};
    const after = withSavedProgress(before, 10, 'movie', { pct: 42, title: 'Alien' });
    expect(before).toEqual({}); // no mutado
    expect(after).toEqual({
      'movie:10': { id: 10, type: 'movie', pct: 42, title: 'Alien', ts: Date.now() },
    });
    vi.useRealTimers();
  });

  test('sobrescribe una entrada existente para la misma clave', () => {
    const before: ProgressMap = { 'tv:1': { id: 1, type: 'tv', pct: 10, season: 1, episode: 1, ts: 1 } };
    const after = withSavedProgress(before, 1, 'tv', { pct: 80, season: 1, episode: 5 });
    expect(after['tv:1'].pct).toBe(80);
    expect(after['tv:1'].episode).toBe(5);
  });
});

describe('withoutProgress (preservado de removeProgress, línea ~7471-7476)', () => {
  test('elimina la entrada de la clave dada, sin mutar el mapa original', () => {
    const before: ProgressMap = {
      'movie:1': { id: 1, type: 'movie', pct: 50, ts: 1 },
      'tv:2': { id: 2, type: 'tv', pct: 20, ts: 2 },
    };
    const after = withoutProgress(before, 1, 'movie');
    expect(after).toEqual({ 'tv:2': before['tv:2'] });
    expect(before['movie:1']).toBeDefined(); // no mutado
  });

  test('devuelve el mismo mapa (referencia) si la clave no existe', () => {
    const before: ProgressMap = { 'tv:2': { id: 2, type: 'tv', pct: 20, ts: 2 } };
    expect(withoutProgress(before, 999, 'movie')).toBe(before);
  });
});

describe('playButtonLabel (preservado EXACTO de `progLabel`+template del botón, líneas ~8917/8930)', () => {
  test('sin progreso: "▶ Reproducir" (un solo ícono — se corrigió el doble ▶ del original)', () => {
    expect(playButtonLabel(null, false)).toBe('▶ Reproducir');
    expect(playButtonLabel(null, true)).toBe('▶ Reproducir');
  });

  test('película con progreso: "▶ Continuar {pct}%"', () => {
    const prog: ProgressEntry = { id: 1, type: 'movie', pct: 43.7, ts: 1 };
    expect(playButtonLabel(prog, false)).toBe('▶ Continuar 44%');
  });

  test('serie con temporada/episodio guardados: "▶ Continuar T{s}·E{e}"', () => {
    const prog: ProgressEntry = { id: 1, type: 'tv', pct: 30, season: 2, episode: 5, ts: 1 };
    expect(playButtonLabel(prog, true)).toBe('▶ Continuar T2·E5');
  });

  test('serie con progreso pero sin season guardada: cae al label de porcentaje', () => {
    const prog: ProgressEntry = { id: 1, type: 'tv', pct: 12, ts: 1 };
    expect(playButtonLabel(prog, true)).toBe('▶ Continuar 12%');
  });
});

// Progreso por capitulo (2026-11-28): barra en la lista de capitulos y retomar cada uno en
// su minuto. Caso real: serie "El Instituto", E1 "El chico" a los 5 min; la lista no
// mostraba nada, y el progreso de la serie se aplicaba a cualquier capitulo que se abriera.
import {
  episodeKey,
  withSavedEpisode,
  withoutSeriesEpisodes,
  episodeBarPct,
  resumeSecForEpisode,
  PCT_CAPITULO_VISTO,
} from '../src/services/progress';

describe('progreso por capitulo', () => {
  const serie = (season: number, episode: number, positionSec: number): ProgressEntry =>
    ({ id: 1, type: 'tv', pct: 8, positionSec, season, episode, ts: 1 }) as ProgressEntry;

  test('la barra se calcula con el minuto y la duracion de TMDB', () => {
    const e = withSavedEpisode({}, 1, 1, 1, { positionSec: 300, pct: 0 })[episodeKey(1, 1, 1)];
    expect(episodeBarPct(e, 59)).toBe(8); // 5 de 59 min
  });

  test('sin duracion de TMDB usa el porcentaje guardado', () => {
    const e = withSavedEpisode({}, 1, 1, 1, { positionSec: 300, pct: 42 })[episodeKey(1, 1, 1)];
    expect(episodeBarPct(e, null)).toBe(42);
  });

  test(`desde el ${PCT_CAPITULO_VISTO}% queda visto y la barra llena`, () => {
    const e = withSavedEpisode({}, 1, 1, 1, { positionSec: 3200, pct: 91 })[episodeKey(1, 1, 1)];
    expect(e.visto).toBe(true);
    expect(episodeBarPct(e, 59)).toBe(100);
  });

  test('volver a abrir un capitulo visto no lo desmarca', () => {
    const visto = withSavedEpisode({}, 1, 1, 1, { positionSec: 3200, pct: 95 });
    const otraVez = withSavedEpisode(visto, 1, 1, 1, { positionSec: 120, pct: 3 });
    expect(otraVez[episodeKey(1, 1, 1)].visto).toBe(true);
  });

  test('cada capitulo retoma en su propio minuto', () => {
    const mapa = withSavedEpisode(withSavedEpisode({}, 1, 1, 1, { positionSec: 300, pct: 8 }), 1, 1, 2, { positionSec: 1200, pct: 35 });
    expect(resumeSecForEpisode(serie(1, 2, 1200), mapa[episodeKey(1, 1, 1)], 1, 1)).toBe(300);
    expect(resumeSecForEpisode(serie(1, 2, 1200), mapa[episodeKey(1, 1, 2)], 1, 2)).toBe(1200);
  });

  test('un capitulo visto empieza desde cero', () => {
    const e = withSavedEpisode({}, 1, 1, 1, { positionSec: 3300, pct: 96 })[episodeKey(1, 1, 1)];
    expect(resumeSecForEpisode(serie(1, 1, 3300), e, 1, 1)).toBeUndefined();
  });

  test('el progreso de la serie ya no se aplica a otro capitulo', () => {
    expect(resumeSecForEpisode(serie(1, 1, 1500), null, 1, 2)).toBeUndefined();
  });

  test('sin registro propio, se usa el de la serie si es ese mismo capitulo', () => {
    expect(resumeSecForEpisode(serie(1, 1, 300), null, 1, 1)).toBe(300);
  });

  test('quitar la serie del historial borra sus capitulos y no los de otra', () => {
    const mapa = withSavedEpisode(withSavedEpisode({}, 1, 1, 1, { positionSec: 300, pct: 8 }), 2, 1, 1, { positionSec: 300, pct: 8 });
    expect(Object.keys(withoutSeriesEpisodes(mapa, 1))).toEqual([episodeKey(2, 1, 1)]);
  });
});
