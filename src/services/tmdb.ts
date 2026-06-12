/**
 * tmdb — cliente de The Movie Database (catálogo, detalle, IMDB external_ids).
 *
 * Extraído de `tmdb()` (líneas ~8826-8840 de assets/index.html) y del fetch de
 * `external_ids` dentro de `rdGetStream` (línea ~4713-4715).
 *
 * La función de red es deliberadamente delgada — toda la lógica memoizable
 * vive en `lruCache.ts` (ya testeado por separado). Aquí solo se arma la URL
 * y se orquesta el fetch + caché, preservando el comportamiento exacto:
 * agregar `api_key` con el separador correcto (`?` o `&`), lanzar en HTTP
 * no-OK, y memoizar por endpoint completo.
 */

import { createLruCache, tmdbCacheMaxSize, type LruCache } from './lruCache';

export const TMDB_BASE = 'https://api.themoviedb.org/3';

export interface TmdbClientOptions {
  apiKey: string;
  isTvMode?: boolean;
  /** Inyectable para tests — por defecto usa `fetch` global. */
  fetchImpl?: typeof fetch;
}

/**
 * buildTmdbUrl — arma la URL final agregando `api_key` con el separador
 * correcto según si el endpoint ya trae query string. Preservado de la
 * línea ~8828: `const sep = endpoint.includes('?') ? '&' : '?'`.
 */
export function buildTmdbUrl(base: string, endpoint: string, apiKey: string): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${base}${endpoint}${sep}api_key=${apiKey}`;
}

export interface TmdbClient {
  /** Caché expuesto para inspección/tests — mismas garantías que `_tmdbCache`. */
  cache: LruCache<unknown>;
  /** Equivalente a `tmdb(endpoint)`: GET memoizado, lanza si la respuesta no es OK. */
  get<T = unknown>(endpoint: string): Promise<T>;
  /** Equivalente al paso 1 de `rdGetStream`: obtiene el IMDB ID desde TMDB. */
  getImdbId(tmdbId: string | number, type: 'movie' | 'tv'): Promise<string | null>;
}

/**
 * createTmdbClient — fábrica del cliente. Recibe la API key y el modo TV
 * por fuera (en vez de leer `document.documentElement` o una constante
 * global) para que sea testeable e inyectable desde Pinia/composables.
 */
export function createTmdbClient(opts: TmdbClientOptions): TmdbClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cache = createLruCache<unknown>(tmdbCacheMaxSize(!!opts.isTvMode));

  async function get<T = unknown>(endpoint: string): Promise<T> {
    const cached = cache.get(endpoint);
    if (cached !== undefined) return cached as T;

    const url = buildTmdbUrl(TMDB_BASE, endpoint, opts.apiKey);
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const data = (await res.json()) as T;

    cache.set(endpoint, data);
    return data;
  }

  async function getImdbId(tmdbId: string | number, type: 'movie' | 'tv'): Promise<string | null> {
    const tmdbType = type === 'tv' ? 'tv' : 'movie';
    const data = await get<{ imdb_id?: string | null }>(`/${tmdbType}/${tmdbId}/external_ids`);
    return data.imdb_id ?? null;
  }

  return { cache, get, getImdbId };
}
