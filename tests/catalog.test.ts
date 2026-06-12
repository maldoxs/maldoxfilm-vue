import { describe, test, expect } from 'vitest';
import {
  posterSize,
  buildPosterUrl,
  escapeHtml,
  mediaTitle,
  mediaYear,
  mediaRating,
  scoreColor,
  scoreCirclePct,
  resolveMediaType,
  isSearchableMedia,
  buildGenreOptions,
  sectionTitleForGenre,
  TODOS_GENRE_ID,
  TMDB_IMG_BASE,
  buildAnimeGenreOptions,
  buildAnimeGenreFilter,
  animeCarouselHeading,
  ANIME_KEYWORD_FILTER,
  dedupeRecommendations,
  filterYoutubeTrailers,
  isJapaneseAnimeDetail,
  detailRuntimeLabel,
  detailTypeBadge,
  buildDetailStats,
  episodeDisplayName,
  seasonTabLabel,
} from '../src/services/catalog';

describe('posterSize / buildPosterUrl (preservado de línea ~4484-4486 y ~7052)', () => {
  test('w185 en TV, w342 en desktop/mobile', () => {
    expect(posterSize(true)).toBe('w185');
    expect(posterSize(false)).toBe('w342');
  });

  test('arma la URL completa cuando hay poster_path', () => {
    expect(buildPosterUrl('/abc.jpg', false)).toBe(`${TMDB_IMG_BASE}w342/abc.jpg`);
    expect(buildPosterUrl('/abc.jpg', true)).toBe(`${TMDB_IMG_BASE}w185/abc.jpg`);
  });

  test('devuelve "" cuando no hay poster_path', () => {
    expect(buildPosterUrl(null, false)).toBe('');
    expect(buildPosterUrl(undefined, false)).toBe('');
    expect(buildPosterUrl('', false)).toBe('');
  });
});

describe('escapeHtml (preservado EXACTO de línea ~8842)', () => {
  test('escapa & < > " \' en el orden correcto (sin doble-escape)', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml(`O'Brien`)).toBe('O&#39;Brien');
    expect(escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });
});

describe('mediaTitle / mediaYear / mediaRating (preservados de createCard línea ~7049-7063)', () => {
  test('mediaTitle prefiere title sobre name, cae a "" si no hay ninguno', () => {
    expect(mediaTitle({ id: 1, title: 'Movie', name: 'Show' })).toBe('Movie');
    expect(mediaTitle({ id: 1, name: 'Show' })).toBe('Show');
    expect(mediaTitle({ id: 1 })).toBe('');
  });

  test('mediaYear extrae los primeros 4 caracteres de la fecha disponible', () => {
    expect(mediaYear({ id: 1, release_date: '2024-05-01' })).toBe('2024');
    expect(mediaYear({ id: 1, first_air_date: '2019-01-01' })).toBe('2019');
    expect(mediaYear({ id: 1 })).toBe('');
  });

  test('mediaRating formatea con un decimal o "?" si no hay votos', () => {
    expect(mediaRating({ id: 1, vote_average: 8.456 })).toBe('8.5');
    expect(mediaRating({ id: 1, vote_average: 0 })).toBe('?');
    expect(mediaRating({ id: 1 })).toBe('?');
  });
});

describe('scoreColor / scoreCirclePct (preservado EXACTO de línea ~6943-6951)', () => {
  test('umbrales de color: 8/7/6 → verde/turquesa/azul, resto rojo', () => {
    expect(scoreColor(9)).toBe('#4caf7d');
    expect(scoreColor(8)).toBe('#4caf7d');
    expect(scoreColor(7.5)).toBe('#26c9a0');
    expect(scoreColor(7)).toBe('#26c9a0');
    expect(scoreColor(6.2)).toBe('#3d5afe');
    expect(scoreColor(6)).toBe('#3d5afe');
    expect(scoreColor(5.9)).toBe('#e05c3a');
    expect(scoreColor(0)).toBe('#e05c3a');
  });

  test('scoreCirclePct escala 0-10 a 0-100 y clampa', () => {
    expect(scoreCirclePct(8.5)).toBe(85);
    expect(scoreCirclePct(0)).toBe(0);
    expect(scoreCirclePct(15)).toBe(100);
    expect(scoreCirclePct(-3)).toBe(0);
  });
});

describe('resolveMediaType / isSearchableMedia (preservados de doSearchUnified línea ~7350-7361)', () => {
  test('resolveMediaType usa media_type si es válido, si no cae al fallback', () => {
    expect(resolveMediaType({ id: 1, media_type: 'tv' }, 'movie')).toBe('tv');
    expect(resolveMediaType({ id: 1, media_type: 'movie' }, 'tv')).toBe('movie');
    expect(resolveMediaType({ id: 1 }, 'tv')).toBe('tv');
    expect(resolveMediaType({ id: 1, media_type: 'person' }, 'movie')).toBe('movie');
  });

  test('isSearchableMedia descarta personas y resultados sin título o sin poster', () => {
    expect(isSearchableMedia({ id: 1, title: 'X', poster_path: '/a.jpg', media_type: 'movie' })).toBe(true);
    expect(isSearchableMedia({ id: 1, name: 'X', poster_path: '/a.jpg', media_type: 'tv' })).toBe(true);
    expect(isSearchableMedia({ id: 1, title: 'X', poster_path: '/a.jpg', media_type: 'person' })).toBe(false);
    expect(isSearchableMedia({ id: 1, poster_path: '/a.jpg' })).toBe(false);
    expect(isSearchableMedia({ id: 1, title: 'X' })).toBe(false);
  });
});

describe('buildGenreOptions / sectionTitleForGenre (preservados de filterMoviesGenre línea ~6851-6870)', () => {
  test('buildGenreOptions antepone "Todos" (id=0)', () => {
    const opts = buildGenreOptions();
    expect(opts[0]).toEqual({ id: TODOS_GENRE_ID, label: 'Todos' });
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.find((o) => o.id === 28)?.label).toBe('Acción');
  });

  test('sectionTitleForGenre reescribe el título con el nombre del género', () => {
    expect(sectionTitleForGenre(28, 'Películas', 'Tendencias')).toBe('Acción · Películas');
    expect(sectionTitleForGenre(TODOS_GENRE_ID, 'Películas', 'Tendencias')).toBe('Tendencias');
    expect(sectionTitleForGenre(999999, 'Películas', 'Tendencias')).toBe('Tendencias');
  });
});

describe('buildAnimeGenreOptions / buildAnimeGenreFilter / animeCarouselHeading (preservados de filterAnimeGenre línea ~7134-7160)', () => {
  test('buildAnimeGenreOptions antepone "Todos" y usa el subconjunto de géneros de anime', () => {
    const opts = buildAnimeGenreOptions();
    expect(opts[0]).toEqual({ id: TODOS_GENRE_ID, label: 'Todos' });
    expect(opts.find((o) => o.id === 10759)?.label).toBe('Acción/Aventura');
    expect(opts.find((o) => o.id === 28)).toBeUndefined(); // no es un género de anime
  });

  test('buildAnimeGenreFilter: "Todos" devuelve el filtro base, otros agregan el id con coma (OR)', () => {
    expect(buildAnimeGenreFilter(TODOS_GENRE_ID)).toBe(ANIME_KEYWORD_FILTER);
    expect(buildAnimeGenreFilter(35)).toBe('with_genres=16,35&with_keywords=210024');
  });

  test('animeCarouselHeading — estado "Todos": preserva título/subtítulo EXACTOS de cada carrusel', () => {
    expect(animeCarouselHeading('airing', TODOS_GENRE_ID)).toEqual({ title: 'En Emisión', subtitle: 'ahora mismo' });
    expect(animeCarouselHeading('latestEps', TODOS_GENRE_ID)).toEqual({
      title: '🆕 Últimos Capítulos',
      subtitle: 'más recientes',
    });
    expect(animeCarouselHeading('topAll', TODOS_GENRE_ID)).toEqual({
      title: '⭐ Más Populares',
      subtitle: 'de todos los tiempos',
    });
    expect(animeCarouselHeading('season', TODOS_GENRE_ID)).toEqual({
      title: '🏆 Mejor Valorados',
      subtitle: 'de la historia',
    });
    expect(animeCarouselHeading('upcoming', TODOS_GENRE_ID)).toEqual({ title: '🔢 Más Vistos', subtitle: 'en general' });
  });

  test('animeCarouselHeading — filtrado por género: el subtítulo cambia (no es un patrón uniforme)', () => {
    expect(animeCarouselHeading('airing', 10759)).toEqual({ title: '📡 Acción/Aventura', subtitle: 'en emisión' });
    expect(animeCarouselHeading('latestEps', 10759)).toEqual({ title: '🆕 Acción/Aventura', subtitle: 'más recientes' });
    expect(animeCarouselHeading('topAll', 10759)).toEqual({ title: '⭐ Acción/Aventura', subtitle: 'más populares' });
    expect(animeCarouselHeading('season', 10759)).toEqual({ title: '🏆 Acción/Aventura', subtitle: 'mejor valorados' });
    expect(animeCarouselHeading('upcoming', 10759)).toEqual({ title: '🔢 Acción/Aventura', subtitle: 'más vistos' });
  });

  test('animeCarouselHeading — id de género desconocido cae a "Anime" como nombre', () => {
    expect(animeCarouselHeading('airing', 999999)).toEqual({ title: '📡 Anime', subtitle: 'en emisión' });
  });
});

describe('dedupeRecommendations (preservado EXACTO de dpRenderPage línea ~8994)', () => {
  test('combina recommendations+similar, descarta duplicados por id (primera aparición) y limita a 20', () => {
    const recs = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
    const similar = [{ id: 2, title: 'B-dup' }, { id: 3, title: 'C' }];
    expect(dedupeRecommendations(recs, similar)).toEqual([
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
      { id: 3, title: 'C' },
    ]);
  });

  test('limita a 20 resultados', () => {
    const recs = Array.from({ length: 15 }, (_, i) => ({ id: i, title: `R${i}` }));
    const similar = Array.from({ length: 15 }, (_, i) => ({ id: i + 100, title: `S${i}` }));
    expect(dedupeRecommendations(recs, similar)).toHaveLength(20);
  });
});

describe('filterYoutubeTrailers (preservado EXACTO de línea ~8961)', () => {
  test('filtra solo YouTube + Trailer/Teaser, máx 8', () => {
    const videos = [
      { key: '1', name: 'T1', site: 'YouTube', type: 'Trailer' },
      { key: '2', name: 'T2', site: 'YouTube', type: 'Teaser' },
      { key: '3', name: 'T3', site: 'YouTube', type: 'Featurette' },
      { key: '4', name: 'T4', site: 'Vimeo', type: 'Trailer' },
    ];
    expect(filterYoutubeTrailers(videos)).toEqual([
      { key: '1', name: 'T1', site: 'YouTube', type: 'Trailer' },
      { key: '2', name: 'T2', site: 'YouTube', type: 'Teaser' },
    ]);
  });

  test('limita a 8', () => {
    const videos = Array.from({ length: 12 }, (_, i) => ({ key: String(i), name: `T${i}`, site: 'YouTube', type: 'Trailer' }));
    expect(filterYoutubeTrailers(videos)).toHaveLength(8);
  });
});

describe('isJapaneseAnimeDetail (preservado EXACTO de línea ~8972)', () => {
  test('true solo si incluye género "Animación" Y país "JP"', () => {
    expect(isJapaneseAnimeDetail(['Animación', 'Acción'], ['JP'])).toBe(true);
    expect(isJapaneseAnimeDetail(['Animación'], ['US'])).toBe(false);
    expect(isJapaneseAnimeDetail(['Drama'], ['JP'])).toBe(false);
    expect(isJapaneseAnimeDetail([], [])).toBe(false);
  });
});

describe('detailRuntimeLabel / detailTypeBadge (preservados de líneas ~8907/8919)', () => {
  test('runtime en minutos si existe, si no temporadas, si no ""', () => {
    expect(detailRuntimeLabel(120, null)).toBe('120 min');
    expect(detailRuntimeLabel(null, 3)).toBe('3 temp.');
    expect(detailRuntimeLabel(null, null)).toBe('');
    expect(detailRuntimeLabel(0, 3)).toBe('3 temp.');
  });

  test('badge ★ Serie / ★ Película', () => {
    expect(detailTypeBadge(true)).toBe('★ Serie');
    expect(detailTypeBadge(false)).toBe('★ Película');
  });
});

describe('buildDetailStats (preservado EXACTO de línea ~8938-8944)', () => {
  test('siempre incluye Puntuación/Año/Tipo/Duración en orden, con "—" de fallback', () => {
    const stats = buildDetailStats({ rating: '7.5', year: '', isTV: false, runtime: '' });
    expect(stats).toEqual([
      { l: 'Puntuación', v: '7.5', g: true },
      { l: 'Año', v: '—' },
      { l: 'Tipo', v: 'Película' },
      { l: 'Duración', v: '—' },
    ]);
  });

  test('agrega campos condicionales solo si el dato existe (Votos/Temporadas/Episodios/Estado)', () => {
    const stats = buildDetailStats({
      rating: '8.1',
      year: '2024',
      isTV: true,
      runtime: '3 temp.',
      voteCount: 12345,
      numberOfSeasons: 3,
      numberOfEpisodes: 24,
      status: 'Returning Series',
    });
    expect(stats).toEqual([
      { l: 'Puntuación', v: '8.1', g: true },
      { l: 'Año', v: '2024' },
      { l: 'Tipo', v: 'Serie' },
      { l: 'Duración', v: '3 temp.' },
      { l: 'Votos', v: (12345).toLocaleString('es') },
      { l: 'Temporadas', v: 3 },
      { l: 'Episodios', v: 24 },
      { l: 'Estado', v: 'Returning Series' },
    ]);
  });

  test('Temporadas/Episodios solo aparecen si isTV es true (preserva `isTV&&d.number_of_seasons`)', () => {
    const stats = buildDetailStats({
      rating: '7.0',
      year: '2020',
      isTV: false,
      runtime: '120 min',
      numberOfSeasons: 3,
      numberOfEpisodes: 24,
    });
    expect(stats.find((s) => s.l === 'Temporadas')).toBeUndefined();
    expect(stats.find((s) => s.l === 'Episodios')).toBeUndefined();
  });
});

describe('episodeDisplayName / seasonTabLabel (preservados de líneas ~9020/8985)', () => {
  test('episodeDisplayName usa el nombre o "Episodio N" de fallback', () => {
    expect(episodeDisplayName('Piloto', 1)).toBe('Piloto');
    expect(episodeDisplayName('', 5)).toBe('Episodio 5');
    expect(episodeDisplayName(undefined, 5)).toBe('Episodio 5');
  });

  test('seasonTabLabel: "Episodios" si solo hay una temporada, "Temp. N" si hay varias', () => {
    expect(seasonTabLabel(1, 1)).toBe('Episodios');
    expect(seasonTabLabel(1, 3)).toBe('Temp. 1');
    expect(seasonTabLabel(2, 3)).toBe('Temp. 2');
  });
});
