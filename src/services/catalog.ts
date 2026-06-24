/**
 * catalog — funciones puras para renderizar tarjetas/carruseles de catálogo
 * (TMDB: películas/series/anime/búsqueda).
 *
 * Extraído de `createCard`/`createScoreCircle`/`scoreColor`/`escapeHtml`
 * (líneas ~6943-6963, ~7049-7063, ~8842 de assets/index.html). Se separa
 * deliberadamente "qué mostrar" (puro, testeable aquí) de "cómo pintarlo"
 * (orquestación DOM → ahora `<MovieCard>`/`<Carousel>` declarativos).
 */

import type { MediaItem } from '../types';

/** Base de imágenes TMDB — preservada de la línea ~4484. */
export const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/';

/**
 * posterSize — el tamaño de poster según el modo. Preservado de la línea
 * ~4486: `w185` en TV (pantallas grandes mirando de lejos = menos detalle
 * necesario / menos datos), `w342` en desktop/mobile.
 */
export function posterSize(isTvMode: boolean): 'w185' | 'w342' {
  return isTvMode ? 'w185' : 'w342';
}

/**
 * buildPosterUrl — arma la URL completa del poster, o `''` si no hay
 * `poster_path` (el original cae a un div con texto de fallback). Preservado
 * de la construcción inline en `createCard` (línea ~7052).
 */
export function buildPosterUrl(posterPath: string | null | undefined, isTvMode: boolean): string {
  if (!posterPath) return '';
  return `${TMDB_IMG_BASE}${posterSize(isTvMode)}${posterPath}`;
}

/**
 * escapeHtml — saneo XSS-safe de títulos antes de inyectarlos en `innerHTML`.
 * Preservado EXACTO de la línea ~8842 (mismo orden de reemplazos: & antes que
 * < > " ' para no doble-escapar entidades).
 */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * mediaTitle — título normalizado: TMDB usa `title` para películas y `name`
 * para series/personas. Preservado de `item.title || item.name || ''`.
 */
export function mediaTitle(item: MediaItem): string {
  return item.title || item.name || '';
}

/**
 * mediaYear — año de 4 dígitos extraído de `release_date`/`first_air_date`,
 * o `''` si no hay fecha. Preservado de `(date||'').slice(0,4)`.
 */
export function mediaYear(item: MediaItem): string {
  const date = item.release_date || item.first_air_date || '';
  return date.slice(0, 4);
}

/**
 * mediaRating — rating con un decimal, o `'?'` si no hay `vote_average`
 * (o es 0 — TMDB usa 0 para "sin votos"). Preservado de
 * `vote_average ? vote_average.toFixed(1) : '?'`.
 */
export function mediaRating(item: MediaItem): string {
  return item.vote_average ? item.vote_average.toFixed(1) : '?';
}

/**
 * scoreColor — color del círculo de puntaje según el rating (0-10).
 * Preservado EXACTO de `scoreColor` (línea ~6943-6948): umbrales en
 * 8/7/6, colores `#4caf7d`/`#26c9a0`/`#3d5afe`/`#e05c3a`.
 */
export function scoreColor(rating: number): string {
  if (rating >= 8) return '#4caf7d';
  if (rating >= 7) return '#26c9a0';
  if (rating >= 6) return '#3d5afe';
  return '#e05c3a';
}

/**
 * scoreCirclePct — el porcentaje (0-100) que llena el anillo del círculo de
 * puntaje. TMDB da `vote_average` en escala 0-10; el círculo se llena en
 * proporción directa (`rating * 10`). Preservado de la línea ~6951.
 */
export function scoreCirclePct(rating: number): number {
  return Math.max(0, Math.min(100, rating * 10));
}

/**
 * resolveMediaType — determina el `media_type` efectivo de un ítem: usa el
 * que viene de TMDB (`/search/multi` lo incluye), o cae al `fallback` que
 * pasa la sección que está renderizando (p.ej. 'movie' en `/discover/movie`).
 * Preservado de `item.media_type || fallbackType` (línea ~7350-7361).
 */
export function resolveMediaType(item: MediaItem, fallback: 'movie' | 'tv'): 'movie' | 'tv' {
  return item.media_type === 'tv' || item.media_type === 'movie' ? item.media_type : fallback;
}

/**
 * isSearchableMedia — filtro usado por `doSearchUnified` (línea ~7361):
 * descarta resultados de tipo "person" y los que no traen poster ni título —
 * exactamente igual que el original, para no mostrar tarjetas vacías/rotas.
 */
export function isSearchableMedia(item: MediaItem): boolean {
  if (item.media_type === 'person') return false;
  const hasTitle = !!(item.title || item.name);
  const hasPoster = !!item.poster_path;
  return hasTitle && hasPoster;
}

/**
 * SEARCH_DEBOUNCE_MS — el debounce de 400ms de `handleSearch` (línea ~7350:
 * `setTimeout(()=>doSearchUnified(val.trim()), 400)`).
 */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * CAROUSEL_SCROLL_PX — el desplazamiento por click de flecha del carrusel.
 * Preservado de `scrollCarousel` (línea ~7064: `scrollBy({left: dir*640, ...})`).
 */
export const CAROUSEL_SCROLL_PX = 640;

export interface GenreOption {
  id: number;
  label: string;
}

/**
 * GENRE_NAMES_MAP — id de género TMDB → nombre en español, usado para
 * reescribir títulos de sección al filtrar (`filterMoviesGenre`, línea
 * ~6649). Subconjunto de los géneros de películas/series más comunes,
 * preservado 1:1 de los valores usados en el original.
 */
export const GENRE_NAMES_MAP: Record<number, string> = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familiar',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia ficción',
  10770: 'TV Movie',
  53: 'Suspenso',
  10752: 'Bélica',
  37: 'Western',
};

/** TODOS_GENRE_ID — el id especial "Todos" que restaura las secciones originales (línea ~6851: `gid===0`). */
export const TODOS_GENRE_ID = 0;

/**
 * buildGenreOptions — arma la lista de pills "Todos" + géneros conocidos,
 * en el orden que aparecen en `GENRE_NAMES_MAP`. Preservado del armado
 * estático de `#moviesGenreBar`/`#seriesGenreBar` (líneas ~3054-3060).
 */
export function buildGenreOptions(): GenreOption[] {
  return [
    { id: TODOS_GENRE_ID, label: 'Todos' },
    ...Object.entries(GENRE_NAMES_MAP).map(([id, label]) => ({ id: Number(id), label })),
  ];
}

/**
 * buildHomeGenreOptions — la lista REDUCIDA de géneros para la barra del Inicio
 * (13 opciones), en el orden y con las etiquetas que usa producción
 * (878 se muestra como "Sci-Fi", no "Ciencia ficción"). El catálogo completo
 * (`buildGenreOptions`) se sigue usando en Películas/Series.
 */
export function buildHomeGenreOptions(): GenreOption[] {
  return [
    { id: TODOS_GENRE_ID, label: 'Todos' },
    { id: 28, label: 'Acción' },
    { id: 35, label: 'Comedia' },
    { id: 18, label: 'Drama' },
    { id: 27, label: 'Terror' },
    { id: 878, label: 'Sci-Fi' },
    { id: 10749, label: 'Romance' },
    { id: 53, label: 'Suspenso' },
    { id: 16, label: 'Animación' },
    { id: 80, label: 'Crimen' },
    { id: 12, label: 'Aventura' },
    { id: 14, label: 'Fantasía' },
    { id: 99, label: 'Documental' },
  ];
}

/**
 * sectionTitleForGenre — el título de sección reescrito al filtrar por
 * género (p.ej. "Acción · Películas"), o el título original si `genreId`
 * es `TODOS_GENRE_ID`. Preservado de la lógica de `filterMoviesGenre`
 * (línea ~6851-6870: reemplaza el título por `${genreName} · ${kind}`).
 */
export function sectionTitleForGenre(genreId: number, kind: string, originalTitle: string): string {
  if (genreId === TODOS_GENRE_ID) return originalTitle;
  const name = GENRE_NAMES_MAP[genreId];
  if (!name) return originalTitle;
  return `${name} · ${kind}`;
}

// ── Anime — 100% TMDB vía genre+keyword (líneas ~7096-7141) ─────────────────

/**
 * ANIME_KEYWORD_FILTER — preservado EXACTO de la línea ~7102:
 * `with_genres=16&with_keywords=210024`. El keyword 210024 = "anime"
 * garantiza solo animación japonesa, excluyendo Pixar/Disney/animación
 * occidental (que también cae bajo el género 16 "Animación").
 */
export const ANIME_KEYWORD_FILTER = 'with_genres=16&with_keywords=210024';

/**
 * ANIME_GENRE_NAMES_MAP — subconjunto de géneros aplicable a anime,
 * preservado EXACTO del comentario de `filterAnimeGenre` (línea ~7135):
 * "0=Todos, 10759=Acción/Aventura, 35=Comedia, 18=Drama,
 * 10765=Sci-Fi/Fantasía, 9648=Misterio, 10762=Kids".
 */
export const ANIME_GENRE_NAMES_MAP: Record<number, string> = {
  10759: 'Acción/Aventura',
  35: 'Comedia',
  18: 'Drama',
  10765: 'Sci-Fi/Fantasía',
  9648: 'Misterio',
  10762: 'Kids',
};

/** buildAnimeGenreOptions — "Todos" + el subconjunto de géneros de anime (preservado del armado de `#animeFilterBar`, línea ~2985-2995). */
export function buildAnimeGenreOptions(): GenreOption[] {
  return [
    { id: TODOS_GENRE_ID, label: 'Todos' },
    ...Object.entries(ANIME_GENRE_NAMES_MAP).map(([id, label]) => ({ id: Number(id), label })),
  ];
}

/**
 * buildAnimeGenreFilter — el fragmento `with_genres=...` para anime,
 * preservado EXACTO de la línea ~7138-7139:
 *   genreId===0 → `with_genres=16&with_keywords=210024`
 *   genreId!==0 → `with_genres=16,${genreId}&with_keywords=210024`
 * (TMDB interpreta la coma como OR — "animación Y (cualquiera de estos géneros)").
 */
export function buildAnimeGenreFilter(genreId: number): string {
  if (genreId === TODOS_GENRE_ID) return ANIME_KEYWORD_FILTER;
  return `with_genres=16,${genreId}&with_keywords=210024`;
}

/** Identifica cada uno de los 5 carruseles de `AnimeView` (orden EXACTO del original, líneas ~7104-7109/~7156-7160). */
export type AnimeCarouselKey = 'airing' | 'latestEps' | 'topAll' | 'season' | 'upcoming';

export interface CarouselHeading {
  title: string;
  subtitle: string;
}

/**
 * animeCarouselHeading — título + subtítulo de cada carrusel de anime, antes
 * y después de filtrar por género. Preservado 1:1 de `_setAnimeTitle` dentro
 * de `filterAnimeGenre` (líneas ~7141-7155) y de los headers estáticos del
 * HTML (líneas ~3000-3033).
 *
 * IMPORTANTE — esto NO sigue un patrón uniforme tipo "{género} · Anime"
 * (sería "simplificar"): cada carrusel tiene su propio emoji/título/subtítulo,
 * y varios cambian el subtítulo entre el estado "Todos" y el filtrado
 * (p.ej. `topAll` pasa de "de todos los tiempos" a "más populares"; `airing`
 * incluso agrega un emoji 📡 que no existe en su estado "Todos"). Se preserva
 * cada combinación EXACTA tal como las escribía `_setAnimeTitle`.
 */
export function animeCarouselHeading(key: AnimeCarouselKey, genreId: number): CarouselHeading {
  if (genreId === TODOS_GENRE_ID) {
    switch (key) {
      case 'airing':
        return { title: 'En Emisión', subtitle: 'ahora mismo' };
      case 'latestEps':
        return { title: '🆕 Últimos Capítulos', subtitle: 'más recientes' };
      case 'topAll':
        return { title: '⭐ Más Populares', subtitle: 'de todos los tiempos' };
      case 'season':
        return { title: '🏆 Mejor Valorados', subtitle: 'de la historia' };
      case 'upcoming':
        return { title: '🔢 Más Vistos', subtitle: 'en general' };
    }
  }
  const name = ANIME_GENRE_NAMES_MAP[genreId] || 'Anime';
  switch (key) {
    case 'airing':
      return { title: `📡 ${name}`, subtitle: 'en emisión' };
    case 'latestEps':
      return { title: `🆕 ${name}`, subtitle: 'más recientes' };
    case 'topAll':
      return { title: `⭐ ${name}`, subtitle: 'más populares' };
    case 'season':
      return { title: `🏆 ${name}`, subtitle: 'mejor valorados' };
    case 'upcoming':
      return { title: `🔢 ${name}`, subtitle: 'más vistos' };
  }
}

// ── DetailView — funciones puras para `dpRenderPage`/`dpLoadSeason` (líneas ~8901-9034) ──

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  profile_path?: string | null;
}

export interface VideoResult {
  key: string;
  name: string;
  site: string;
  type: string;
}

export interface DetailStat {
  l: string;
  v: string | number;
  g?: boolean;
}

/**
 * dedupeRecommendations — combina `recommendations`+`similar`, descarta
 * duplicados por id (se queda con la primera aparición) y limita a 20.
 * Preservado EXACTO de la línea ~8994:
 *   [...(d.recommendations?.results||[]),...(d.similar?.results||[])]
 *     .filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i).slice(0,20)
 */
export function dedupeRecommendations(recommendations: MediaItem[], similar: MediaItem[]): MediaItem[] {
  const combined = [...recommendations, ...similar];
  return combined.filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).slice(0, 20);
}

/**
 * filterYoutubeTrailers — videos de YouTube tipo Trailer/Teaser, máx. 8.
 * Preservado EXACTO de la línea ~8961.
 */
export function filterYoutubeTrailers(videos: VideoResult[]): VideoResult[] {
  return videos.filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')).slice(0, 8);
}

/**
 * isJapaneseAnimeDetail — detecta si el detalle corresponde a un anime
 * japonés (género "Animación" + país de origen "JP"). Preservado EXACTO
 * de la línea ~8972 — el original usa este flag para precargar
 * `_dpIsAnime`/`_dpAnimeTitle`/`_dpAnimeTmdbId` antes de abrir el
 * reproductor (resolución de fuente especial para anime, p.ej. Anime1V).
 */
export function isJapaneseAnimeDetail(genreNames: string[], originCountry: string[]): boolean {
  return genreNames.includes('Animación') && originCountry.includes('JP');
}

/**
 * detailRuntimeLabel — preserva `d.runtime?\`${d.runtime} min\`:(d.number_of_seasons?\`${...} temp.\`:'')` (línea ~8907).
 */
export function detailRuntimeLabel(runtime?: number | null, numberOfSeasons?: number | null): string {
  if (runtime) {
    const h = Math.floor(runtime / 60);
    const m = runtime % 60;
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    return `${m}min`;
  }
  if (numberOfSeasons) return `${numberOfSeasons} temp.`;
  return '';
}

/** detailTypeBadge — preserva el badge `★ Serie`/`★ Película` del hero (línea ~8919). */
export function detailTypeBadge(isTV: boolean): string {
  return isTV ? '★ Serie' : '★ Película';
}

/**
 * buildDetailStats — arma el grid de estadísticas del detalle. Preservado
 * EXACTO de la línea ~8938-8944: orden fijo de Puntuación/Año/Tipo/Duración,
 * seguido de los campos condicionales (Votos/Temporadas/Episodios/Estado)
 * que solo aparecen cuando el dato existe.
 */
export function buildDetailStats(opts: {
  rating: string;
  year: string;
  isTV: boolean;
  runtime: string;
  voteCount?: number | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  status?: string | null;
}): DetailStat[] {
  const { rating, year, isTV, runtime, voteCount, numberOfSeasons, numberOfEpisodes, status } = opts;
  const stats: DetailStat[] = [
    { l: 'Puntuación', v: rating, g: true },
    { l: 'Año', v: year || '—' },
    { l: 'Tipo', v: isTV ? 'Serie' : 'Película' },
    { l: 'Duración', v: runtime || '—' },
  ];
  if (voteCount) stats.push({ l: 'Votos', v: voteCount.toLocaleString('es') });
  if (isTV && numberOfSeasons) stats.push({ l: 'Temporadas', v: numberOfSeasons });
  if (isTV && numberOfEpisodes) stats.push({ l: 'Episodios', v: numberOfEpisodes });
  if (status) stats.push({ l: 'Estado', v: status });
  return stats;
}

/** episodeDisplayName — preserva `ep.name||\`Episodio ${ep.episode_number}\`` (línea ~9020). */
export function episodeDisplayName(name: string | undefined | null, episodeNumber: number): string {
  return name || `Episodio ${episodeNumber}`;
}

/** seasonTabLabel — preserva `seasons===1?'Episodios':\`Temp. ${s}\`` (línea ~8985: una sola temporada se llama "Episodios", no "Temp. 1"). */
export function seasonTabLabel(seasonNumber: number, totalSeasons: number): string {
  return totalSeasons === 1 ? 'Episodios' : `Temp. ${seasonNumber}`;
}
