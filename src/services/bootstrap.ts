/**
 * bootstrap — fábrica única de los clientes de red (TMDB/Torrentio/RD) y del
 * `RdStreamResolver`, compartidos por toda la app vía `provide`/`inject`.
 *
 * Reemplaza las variables globales `TMDB_KEY`/instancias sueltas creadas
 * inline en `rdGetStream`/`tmdb()` (líneas ~4481, ~8826-8840). En el original
 * cada función recreaba sus propios fetchers; aquí se arma UNA vez al
 * arrancar la app (`main.ts`) y se inyecta donde se necesite — mismo patrón
 * que `useToast` (singleton), pero para clientes de red en vez de estado UI.
 *
 * ⚠️ SEGURIDAD — RD_TOKEN (ver también `services/realdebrid.ts`/`rdStream.ts`):
 * el token `Z5EQ6B2BAS6ZKOYCD6EWAQENYST6B6TUQKQOWAVYJ26RBVYI7HQA` que vivía
 * hardcodeado en el original (línea ~4708 aprox.) está COMPROMETIDO/EXPUESTO
 * PÚBLICAMENTE. NO se reincorpora aquí bajo ninguna forma (ni `.env`, ni
 * `VITE_*`, ni hardcode). En su lugar, `fetchRdToken()` pide el token a una
 * Netlify Function (`/.netlify/functions/rd-token`, A IMPLEMENTAR
 * server-side, fuera de este alcance) que debe:
 *   1) regenerar/usar un token nuevo guardado como variable de entorno del lado
 *      del servidor (nunca commiteado), y
 *   2) idealmente, no devolver el token en absoluto — sino actuar como proxy
 *      completo de las llamadas a `api.real-debrid.com`/Torrentio, de forma
 *      que el navegador JAMÁS lo reciba (la "Fase 2 de seguridad" mencionada
 *      en `realdebrid.ts`).
 * Mientras esa function no exista, `fetchRdToken()` devuelve `''` de forma
 * segura — `RdStreamResolver`/`usePlayer` ya manejan ese caso con
 * `emptySelectedStream()` (ver `rdStream.ts`), así que la app no se rompe,
 * solo la fuente RD queda inactiva hasta que el backend esté listo.
 */

import { createTmdbClient, type TmdbClient } from './tmdb';
import { createTorrentioClient, type TorrentioClient } from './torrentio';
import { createRealDebridClient, type RealDebridClient } from './realdebrid';
import { createRdStreamResolver, type RdStreamResolver } from './rdStream';

/** TMDB_API_KEY — preservada EXACTA de la línea ~4481. Las API keys de TMDB son públicas por diseño (rate-limit por key, no secretas) — a diferencia del RD_TOKEN, no representan un riesgo de seguridad si viajan al cliente. */
export const TMDB_API_KEY = 'd95e6a7e2ead40e949fcdb81f1f26f0b';

/** Endpoint placeholder — debe implementarse como Netlify Function server-side (ver advertencia arriba). */
const RD_TOKEN_ENDPOINT = '/.netlify/functions/rd-token';

export interface AppServices {
  tmdbClient: TmdbClient;
  torrentioClient: TorrentioClient;
  rdClient: RealDebridClient;
  rdStreamResolver: RdStreamResolver;
  /** El token resuelto en runtime — '' si la function de backend aún no existe/falla. */
  rdToken: string;
}

/**
 * fetchRdToken — pide el token al backend. Falla de forma silenciosa y
 * segura (devuelve `''`) si la function no existe todavía — exactamente el
 * mismo "modo degradado" que tenía el original cuando RD no estaba configurado.
 */
async function fetchRdToken(fetchImpl: typeof fetch): Promise<string> {
  try {
    const res = await fetchImpl(RD_TOKEN_ENDPOINT);
    if (!res.ok) return '';
    const data = (await res.json()) as { token?: string };
    return data.token ?? '';
  } catch {
    return '';
  }
}

export interface CreateAppServicesOptions {
  isTvMode: boolean;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
}

/**
 * createAppServices — arma el grafo de dependencias completo una sola vez.
 * Se llama desde `main.ts` antes de montar la app y se provee vía
 * `app.provide(APP_SERVICES_KEY, services)`.
 */
export async function createAppServices(opts: CreateAppServicesOptions): Promise<AppServices> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const tmdbClient = createTmdbClient({ apiKey: TMDB_API_KEY, isTvMode: opts.isTvMode, fetchImpl });
  const rdToken = await fetchRdToken(fetchImpl);
  const torrentioClient = createTorrentioClient({ fetchImpl });
  const rdClient = createRealDebridClient({ rdToken, fetchImpl });

  /**
   * serverResolve — llama a la Netlify Function `rd-stream` (server-side, ADR-004)
   * para resolver contenido NO cacheado sin exponer el token ni pasar por Torrentio.
   * Falla de forma segura (devuelve null) si la function no existe o no hay versión
   * disponible — el reproductor entonces cae al respaldo iframe, como hoy.
   */
  const serverResolve = async (infoHashes: string[]) => {
    if (!infoHashes.length) return null;
    try {
      const res = await fetchImpl(`/.netlify/functions/rd-stream?infoHash=${infoHashes.join(',')}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        ready?: boolean;
        dash?: string | null;
        liveMP4?: string | null;
        hls?: string | null;
        directUrl?: string | null;
        filename?: string | null;
        torrentId?: string | null;
      };
      if (!data || !data.ready) return null;
      return {
        dash: data.dash ?? null,
        liveMP4: data.liveMP4 ?? null,
        hls: data.hls ?? null,
        directUrl: data.directUrl ?? null,
        filename: data.filename ?? null,
        torrentId: data.torrentId ?? null,
      };
    } catch {
      return null;
    }
  };

  const rdStreamResolver = createRdStreamResolver({ rdToken, tmdbClient, torrentioClient, rdClient, serverResolve });

  return { tmdbClient, torrentioClient, rdClient, rdStreamResolver, rdToken };
}

/** Clave de inyección — preserva el patrón `provide`/`inject` tipado de Vue 3. */
export const APP_SERVICES_KEY = Symbol('app-services');
