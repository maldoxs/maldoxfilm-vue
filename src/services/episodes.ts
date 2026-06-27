/**
 * episodes — datos de episodios de una temporada (TMDB) para el panel estilo
 * Netflix del reproductor (lista con miniatura + sinopsis + duración) y la card
 * "Siguiente episodio".
 *
 * No agrega caché propia: `tmdbClient.get()` ya memoiza por endpoint (LRU), así
 * que pedir la misma temporada dos veces no golpea la red. Las funciones de
 * normalización son PURAS (testeables sin red); `fetchSeasonEpisodes` recibe el
 * cliente por parámetro (inyectable en tests).
 */

import type { TmdbClient } from './tmdb';
import { TMDB_IMG_BASE } from './catalog';

export interface EpisodeMeta {
  /** Número de episodio (1-based). */
  number: number;
  /** Título del episodio (fallback "Episodio N" si TMDB no lo trae). */
  name: string;
  /** Sinopsis (vacío si TMDB no la tiene en el idioma pedido). */
  overview: string;
  /** URL de la miniatura (still) lista para usar, o null si no hay. */
  stillUrl: string | null;
  /** Duración en minutos, o null. */
  runtime: number | null;
  /** Fecha de emisión ISO (YYYY-MM-DD), o null. */
  airDate: string | null;
}

/** Forma cruda del episodio en la respuesta de TMDB (campos que usamos). */
interface TmdbEpisode {
  episode_number?: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  runtime?: number | null;
  air_date?: string | null;
}

/** Tamaño de still de TMDB — w300 es nítido para una miniatura ~104px sin pesar de más. */
const STILL_SIZE = 'w300';

/** Construye la URL de la miniatura, o null si TMDB no tiene still para el episodio. */
export function episodeStillUrl(stillPath: string | null | undefined): string | null {
  return stillPath ? `${TMDB_IMG_BASE}${STILL_SIZE}${stillPath}` : null;
}

/** Normaliza un episodio crudo de TMDB a `EpisodeMeta` (con fallbacks seguros). */
export function normalizeEpisode(ep: TmdbEpisode, idx: number): EpisodeMeta {
  const number = ep.episode_number ?? idx + 1;
  return {
    number,
    name: ep.name?.trim() || `Episodio ${number}`,
    overview: ep.overview?.trim() || '',
    stillUrl: episodeStillUrl(ep.still_path),
    runtime: ep.runtime && ep.runtime > 0 ? ep.runtime : null,
    airDate: ep.air_date || null,
  };
}

/**
 * fetchSeasonEpisodes — trae y normaliza los episodios de una temporada.
 * Nunca lanza: si TMDB falla devuelve `[]` (el panel muestra el estado vacío).
 */
export async function fetchSeasonEpisodes(
  tmdbClient: Pick<TmdbClient, 'get'>,
  tvId: string | number,
  season: number,
  lang = 'es-ES',
): Promise<EpisodeMeta[]> {
  const data = await tmdbClient
    .get<{ episodes?: TmdbEpisode[] }>(`/tv/${tvId}/season/${season}?language=${lang}`)
    .catch(() => ({ episodes: [] as TmdbEpisode[] }));
  return (data.episodes ?? []).map(normalizeEpisode);
}
