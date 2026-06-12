/**
 * torrentio — cliente del addon Torrentio (catálogo de streams para un
 * IMDB ID, ya resueltos contra Real-Debrid del lado del addon).
 *
 * Extraído de las líneas ~4719-4724 de `rdGetStream` en assets/index.html.
 *
 * IMPORTANTE (seguridad — ver nota en buildTorrentioUrl): la URL de
 * Torrentio incluye el RD_TOKEN en texto plano. En el código actual ese
 * token está hardcodeado en el bundle cliente (expuesto). En la migración
 * este cliente NO debe recibir un token hardcodeado: debe recibirlo desde
 * una capa server-side (Netlify Function) que lo inyecte — exactamente la
 * recomendación de seguridad ya acordada para RD_TOKEN.
 */

import type { TorrentioResponse, TorrentioStream } from '../types';

export const TORRENTIO_BASE = 'https://torrentio.strem.fun';

export interface TorrentioQueryParams {
  rdToken: string;
  imdbId: string;
  type: 'movie' | 'tv';
  season?: number | string;
  episode?: number | string;
  /** Filtro de calidad — preservado del original: `qualityfilter=other,scr,cam`. */
  qualityFilter?: string;
}

/**
 * buildStreamPath — la ruta `/stream/...json` según tipo de contenido.
 * Preservada de las líneas ~4719-4721:
 *   película → /stream/movie/{imdbId}.json
 *   serie    → /stream/series/{imdbId}:{season}:{episode}.json
 */
export function buildStreamPath(params: Pick<TorrentioQueryParams, 'imdbId' | 'type' | 'season' | 'episode'>): string {
  const { imdbId, type, season, episode } = params;
  return type === 'tv'
    ? `/stream/series/${imdbId}:${season}:${episode}.json`
    : `/stream/movie/${imdbId}.json`;
}

/**
 * buildTorrentioUrl — arma la URL completa de consulta a Torrentio.
 * Preservada de la línea ~4722:
 *   {base}/realdebrid={TOKEN}|qualityfilter=other,scr,cam{path}
 */
export function buildTorrentioUrl(params: TorrentioQueryParams, base = TORRENTIO_BASE): string {
  const qf = params.qualityFilter ?? 'other,scr,cam';
  const path = buildStreamPath(params);
  return `${base}/realdebrid=${params.rdToken}|qualityfilter=${qf}${path}`;
}

export interface TorrentioClientOptions {
  /** Inyectable para tests — por defecto usa `fetch` global. */
  fetchImpl?: typeof fetch;
  base?: string;
}

export interface TorrentioClient {
  /**
   * fetchStreams — consulta Torrentio y devuelve el array de streams (o []
   * si la respuesta no trae `streams`). Preservado del chequeo de la línea
   * ~4724: `if(!tData.streams || !tData.streams.length)`.
   */
  fetchStreams(params: TorrentioQueryParams): Promise<TorrentioStream[]>;
}

export function createTorrentioClient(opts: TorrentioClientOptions = {}): TorrentioClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.base ?? TORRENTIO_BASE;

  async function fetchStreams(params: TorrentioQueryParams): Promise<TorrentioStream[]> {
    const url = buildTorrentioUrl(params, base);
    const data = (await fetchImpl(url).then((r) => r.json())) as TorrentioResponse;
    return data?.streams?.length ? data.streams : [];
  }

  return { fetchStreams };
}
