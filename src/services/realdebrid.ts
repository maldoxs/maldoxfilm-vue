/**
 * realdebrid — cliente de la API de Real-Debrid (downloads, resolución de
 * proxy de Torrentio, transcode HLS/DASH).
 *
 * Extraído de `rdGetStream` (líneas ~4821-4838) y del flujo de transcode en
 * el reproductor (líneas ~7915-7927) de assets/index.html.
 *
 * ⚠️ SEGURIDAD — RD_TOKEN: el token NUNCA debe vivir en este cliente como
 * constante ni en `.env` (Vite inlinea `VITE_*` en el bundle = mismo problema
 * que el hardcode actual). Debe inyectarse en runtime desde una respuesta de
 * Netlify Function que lo resuelva server-side, o — mejor aún — las llamadas
 * a `api.real-debrid.com` deberían proxyarse íntegramente por una function
 * para que el token NUNCA llegue al navegador. Este cliente acepta el token
 * como parámetro únicamente para no bloquear la migración de la lógica; la
 * decisión arquitectónica de dónde vive el token es del Fase-2 de seguridad.
 */

import type { RDDownload, RDTranscodeResponse } from '../types';
import { matchInDownloads } from './streamSelector';

export const RD_API_BASE = 'https://api.real-debrid.com/rest/1.0';

export interface RealDebridClientOptions {
  rdToken: string;
  fetchImpl?: typeof fetch;
  base?: string;
}

export interface RealDebridClient {
  /**
   * fetchDownloads — lista de descargas activas en la cuenta RD (usada para
   * encontrar el `rdId`/`download`/`filesize` del stream elegido).
   * Preservado de las líneas ~4835-4838: `GET /downloads?limit=500`.
   * Devuelve `[]` si la respuesta no es un array (mismo guard que el original).
   */
  fetchDownloads(): Promise<RDDownload[]>;

  /**
   * fetchTranscode — pide los manifiestos de transcodificación (DASH/HLS)
   * para un `rdId` ya cacheado. Preservado de las líneas ~7919-7922:
   * `GET /streaming/transcode/{rdId}`.
   */
  fetchTranscode(rdId: string): Promise<RDTranscodeResponse>;

  /**
   * fetchMediaInfos — FASE 3: pistas REALES del archivo (audio/subs/códec/duración)
   * desde `GET /streaming/mediaInfos/{rdId}`. Fuente de verdad para elegir el track
   * de audio español del transcode y subtítulos embebidos. Devuelve el JSON crudo;
   * `parseMediaInfos` (mediaInfos.ts) lo normaliza.
   */
  fetchMediaInfos(rdId: string): Promise<unknown>;

  /**
   * resolveProxyUrl — sigue el redirect de una URL proxy de Torrentio para
   * obtener la URL CDN real de Real-Debrid. Preservado de las líneas
   * ~4821-4828: solo reemplaza si la URL final cambió Y contiene
   * "real-debrid" (evita quedarse con una redirección a error/login).
   * Cualquier excepción se silencia y se devuelve la URL original — igual
   * que el `try{}catch(e){}` vacío del original.
   */
  resolveProxyUrl(originalUrl: string): Promise<string>;

  /**
   * findDownloadMatch — wrapper sobre `matchInDownloads` (ya extraído en
   * streamSelector.ts) que primero obtiene la lista de downloads. Atajo
   * de conveniencia para no duplicar la llamada a fetchDownloads en cada
   * lugar que necesite matchear.
   */
  findDownloadMatch(resolvedUrl: string, originalUrl: string, filename: string | null): Promise<RDDownload | undefined>;
}

const authHeaders = (token: string) => ({ Authorization: 'Bearer ' + token });

/**
 * isTorrentioProxyUrl — preservado de la condición de la línea ~4822:
 * `best.url.includes('torrentio.strem.fun')`.
 */
export const isTorrentioProxyUrl = (url: string): boolean => url.includes('torrentio.strem.fun');

/**
 * shouldAdoptResolvedUrl — la condición exacta para aceptar la URL resuelta
 * en lugar de la original (línea ~4825):
 *   resolveRes.url && resolveRes.url !== best.url && resolveRes.url.includes('real-debrid')
 */
export function shouldAdoptResolvedUrl(resolvedUrl: string | undefined | null, originalUrl: string): boolean {
  return !!resolvedUrl && resolvedUrl !== originalUrl && resolvedUrl.includes('real-debrid');
}

/**
 * pickHlsFallbackFromTranscode — extrae la URL HLS de respaldo del
 * manifiesto de transcode, en cascada `apple → h264`. Preservado de la
 * línea ~7925-7927:
 *   (tcData.apple?.full) || (tcData.h264?.full) || null
 *
 * Nota: el tipo `RDTranscodeResponse` documentado en el plan no incluía
 * `h264`, pero el código original SÍ lo consulta como segundo fallback —
 * se preserva esa rama exactamente (campo opcional adicional).
 */
export function pickHlsFallbackFromTranscode(tcData: RDTranscodeResponse & { h264?: { full: string } }): string | null {
  return tcData.apple?.full || tcData.h264?.full || null;
}

/**
 * pickDashUrlFromTranscode — la URL base DASH del manifiesto de transcode.
 * Preservada de la línea ~7924: `tcData.dash && tcData.dash.full`.
 */
export function pickDashUrlFromTranscode(tcData: RDTranscodeResponse): string | null {
  return tcData.dash?.full || null;
}

/**
 * isDualLatFilename — detecta si el archivo probablemente trae pista de
 * audio en español (Dual/Multi/Lat/Spa/...). Preservado de la línea ~7932,
 * la MISMA regex usada en `_initAudioSelector` (línea ~5006) — se reutiliza
 * aquí para no duplicarla ni "simplificarla".
 */
export const isDualLatFilename = (streamFilename: string | null): boolean =>
  /\bdual\b|\bmulti\b|\blat\b|\bspa\b|\bespañol\b|\bcastellano\b|\blatino\b/i.test((streamFilename || '').toLowerCase());

export function createRealDebridClient(opts: RealDebridClientOptions): RealDebridClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.base ?? RD_API_BASE;
  const headers = authHeaders(opts.rdToken);

  async function fetchDownloads(): Promise<RDDownload[]> {
    const downloads = await fetchImpl(`${base}/downloads?limit=500`, { headers }).then((r) => r.json());
    return Array.isArray(downloads) ? (downloads as RDDownload[]) : [];
  }

  async function fetchTranscode(rdId: string): Promise<RDTranscodeResponse> {
    return fetchImpl(`${base}/streaming/transcode/${rdId}`, { headers }).then((r) => r.json());
  }

  async function fetchMediaInfos(rdId: string): Promise<unknown> {
    return fetchImpl(`${base}/streaming/mediaInfos/${rdId}`, { headers }).then((r) => r.json());
  }

  async function resolveProxyUrl(originalUrl: string): Promise<string> {
    if (!isTorrentioProxyUrl(originalUrl)) return originalUrl;
    try {
      const res = await fetchImpl(originalUrl, { redirect: 'follow' });
      if (shouldAdoptResolvedUrl(res.url, originalUrl)) return res.url;
    } catch {
      /* silenciar — igual que el try/catch vacío del original */
    }
    return originalUrl;
  }

  async function findDownloadMatch(resolvedUrl: string, originalUrl: string, filename: string | null) {
    const downloads = await fetchDownloads();
    return matchInDownloads(resolvedUrl, originalUrl, filename, downloads);
  }

  return { fetchDownloads, fetchTranscode, fetchMediaInfos, resolveProxyUrl, findDownloadMatch };
}
