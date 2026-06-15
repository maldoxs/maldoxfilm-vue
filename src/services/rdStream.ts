/**
 * rdStream — orquestación completa de `rdGetStream` (líneas ~4707-4919 de
 * assets/index.html): el flujo de 5 pasos que va desde "tengo un tmdbId" a
 * "tengo una URL reproducible + rdId + metadata del stream elegido".
 *
 * Esta es la "capa rd.service.ts" mencionada en `streamSelector.ts`
 * (`selectBestStream` — "SIN tocar red, eso lo hace rd.service.ts en una capa
 * superior"): combina los clientes ya extraídos (`tmdb`, `torrentio`,
 * `realdebrid`) con las funciones puras de selección (`selectBestStream`,
 * `resolveActiveStream`, `buildSelectedStream`) preservando el orden EXACTO
 * de los 5 pasos:
 *
 *   1. IMDB ID desde TMDB           (líneas ~4711-4716)
 *   2. Streams desde Torrentio + scoring/ranking → `best`  (líneas ~4718-4809)
 *   3. Filename + infoHash del `best`             (líneas ~4811-4818)
 *   4. Resolver proxy Torrentio → URL CDN real    (líneas ~4820-4828)
 *   5. Buscar match en downloads de RD (+ 2 rondas de fallback) → ensamblar
 *      {@link SelectedStream}                      (líneas ~4830-4918)
 *
 * Los pasos 2 (scoring) y 5 (matching/fallback) son funciones puras ya
 * testeadas (`rankStreams`/`selectBestStream`/`resolveActiveStream` en
 * `streamSelector.test.ts`); aquí solo se "pega" todo con red.
 *
 * ⚠️ SEGURIDAD — RD_TOKEN: igual que `realdebrid.ts`/`torrentio.ts`, este
 * resolver acepta `rdToken` inyectado. El llamador (composable/store) es
 * responsable de obtenerlo de una fuente segura — NUNCA hardcodeado client-side.
 */

import type { SelectedStream, TorrentioStream } from '../types';
import type { TmdbClient } from './tmdb';
import type { TorrentioClient } from './torrentio';
import type { RealDebridClient } from './realdebrid';
import {
  selectBestStream,
  resolveActiveStream,
  buildSelectedStream,
  extractFilename,
  extractInfoHash,
  pickDirectPlayUpgrade,
  isDirectPlayStream,
} from './streamSelector';

/**
 * ServerResolveResult — lo que devuelve la Netlify Function `rd-stream` cuando
 * resuelve un torrent NO cacheado (ADR-004). Todas las URLs pueden venir null.
 */
export interface ServerResolveResult {
  dash?: string | null;
  liveMP4?: string | null;
  hls?: string | null;
  directUrl?: string | null;
  filename?: string | null;
  /** Id del torrent creado en RD — para borrarlo luego (ADR-006). */
  torrentId?: string | null;
}

/**
 * ServerResolveFn — función inyectada que llama a `rd-stream` con los infoHashes
 * candidatos (ordenados por score) y devuelve la primera versión cacheable, o
 * `null` si ninguna está disponible. Se inyecta para poder testear sin red: por
 * defecto es no-op, así los tests existentes no se ven afectados.
 */
export type ServerResolveFn = (infoHashes: string[]) => Promise<ServerResolveResult | null>;

/**
 * PrecacheDirectFn — PRE-CACHEO Direct Play (#5). Cachea en RD un MP4/H264/AAC
 * concreto (por infoHash) y devuelve su URL CDN directa (Range = seek nativo), o
 * null mientras RD aún descarga / si falla. El llamador reintenta hasta que esté.
 */
export type PrecacheDirectFn = (
  infoHash: string
) => Promise<{ directUrl: string; torrentId: string | null } | null>;

export interface RdStreamResolverOptions {
  rdToken: string;
  tmdbClient: TmdbClient;
  torrentioClient: TorrentioClient;
  rdClient: RealDebridClient;
  /** Resolución server-side para contenido no cacheado (ADR-004). Default: no-op. */
  serverResolve?: ServerResolveFn;
  /** Pre-cacheo Direct Play (#5). Default: no-op (devuelve null). */
  precacheDirect?: PrecacheDirectFn;
}

export interface RdStreamResolver {
  /**
   * getStream — equivalente a `rdGetStream(tmdbId, type, season, episode)`.
   * Devuelve `{url:null, rdId:null, ...}` (forma "vacía" de {@link SelectedStream})
   * si no hay token, no hay IMDB ID, no hay streams, o ningún stream tiene URL —
   * preservando los `return {url:null, rdId:null}` tempranos del original
   * (líneas ~4709, ~4716, ~4724, ~4790) y el catch-all final (línea ~4918).
   */
  getStream(
    tmdbId: string | number,
    type: 'movie' | 'tv',
    season?: number,
    episode?: number,
    isTv?: boolean
  ): Promise<SelectedStream>;
  /** Pre-cacheo Direct Play (#5): cachea un MP4 por infoHash y da su URL directa. */
  precacheDirect?: PrecacheDirectFn;
}

/**
 * emptySelectedStream — la forma "sin resultado" que devuelve `rdGetStream`
 * en sus distintos early-returns. El original es inconsistente entre el
 * `{url:null, rdId:null}` minimalista de los returns tempranos (líneas
 * ~4709/4716/4724/4790) y el objeto completo del catch final (línea ~4918)
 * — aquí se devuelve siempre la forma COMPLETA para que el llamador (TS)
 * tenga un único shape que consumir, sin perder ningún campo informativo.
 */
function emptySelectedStream(): SelectedStream {
  return {
    url: null,
    rdId: null,
    isX265: false,
    fallbackUrl: null,
    imdbId: null,
    streamFilename: null,
    hasAAC: false,
    rdDownloadUrl: null,
    rdFilesize: 0,
    infoHash: '',
    unavailableInRd: false,
  };
}

export function createRdStreamResolver(opts: RdStreamResolverOptions): RdStreamResolver {
  const { rdToken, tmdbClient, torrentioClient, rdClient } = opts;
  // Default no-op: sin función inyectada, el camino server-side queda inactivo
  // (los tests existentes no la pasan → comportamiento idéntico al actual).
  const serverResolve: ServerResolveFn = opts.serverResolve ?? (async () => null);
  const precacheDirect: PrecacheDirectFn = opts.precacheDirect ?? (async () => null);

  async function getStream(
    tmdbId: string | number,
    type: 'movie' | 'tv',
    season?: number,
    episode?: number,
    isTv = false
  ): Promise<SelectedStream> {
    // Guard inicial — línea ~4709: `if(!RD_TOKEN) return {url:null, rdId:null};`
    if (!rdToken) return emptySelectedStream();

    try {
      // ── 1. IMDB ID desde TMDB (líneas ~4711-4716) ──
      const imdbId = await tmdbClient.getImdbId(tmdbId, type);
      if (!imdbId) return emptySelectedStream();

      // ── 2. Streams desde Torrentio (líneas ~4718-4724) ──
      const streams: TorrentioStream[] = await torrentioClient.fetchStreams({
        rdToken,
        imdbId,
        type,
        season,
        episode,
      });
      if (!streams.length) {
        console.warn('[RD] Sin streams en Torrentio'); // línea ~4724
        return emptySelectedStream();
      }
      // Línea ~4725 — log de diagnóstico (preservado 1:1)
      console.warn(
        '[RD] Streams encontrados:',
        streams.length,
        streams.map((s, i) => ({
          i,
          name: s.name,
          title: s.title,
          filename: s.behaviorHints?.filename || null,
          url: s.url ? '✅' : '❌',
        }))
      );

      // ── Selección + scoring (líneas ~4731-4809) — función pura ya testeada ──
      // `isTv` ajusta el scoring para preferir H264 1080p en TV (evita HEVC/4K que
      // el navegador de la smart-TV no renderiza → audio sin imagen).
      const selection = selectBestStream(streams, isTv);
      if (!selection.best || !selection.best.url) return emptySelectedStream();

      const { best, withUrl, scored, pool, streamFilename, infoHash } = selection;
      // Guard redundante con la línea 110 (`!selection.best.url`) — TS no
      // propaga esa narrowing a `best.url` tras la desestructuración; angosta
      // `string | undefined` → `string` para `resolveProxyUrl` sin cambiar el flujo.
      if (!best.url) return emptySelectedStream();

      // ── 4. Resolver proxy Torrentio → URL CDN real (líneas ~4820-4828) ──
      const resolvedUrl = await rdClient.resolveProxyUrl(best.url);

      // ── 5. Buscar match en downloads + 2 rondas de fallback (líneas ~4830-4905) ──
      let downloads: Awaited<ReturnType<typeof rdClient.fetchDownloads>> = [];
      try {
        downloads = await rdClient.fetchDownloads();
      } catch (e) {
        // línea ~4905: `catch(e){ rdId = null; console.warn('[RD] Error buscando en downloads:', e); }`
        // — el original SÍ loguea el error (no es un catch totalmente silencioso,
        // solo no relanza ni rompe el flujo); preservado 1:1 para diagnóstico.
        downloads = [];
        console.warn('[RD] Error buscando en downloads:', e);
      }

      const active = resolveActiveStream(best, resolvedUrl, streamFilename, pool, scored, downloads);

      // ── Ensamblado final (líneas ~4907-4917) — función pura ya testeada ──
      const selected = buildSelectedStream({
        best,
        withUrl,
        resolvedUrl,
        streamFilename,
        infoHash,
        imdbId,
        active,
      });

      // ── Resolución SERVER-SIDE para contenido NO cacheado (ADR-004) ──
      // Solo si NO hubo match cacheado (`rdId` null): se pasan los infoHashes del
      // pool (ordenados por score) a la Netlify Function `rd-stream`, que hace
      // addMagnet→selectFiles→unrestrict→transcode y devuelve URLs DASH/liveMP4/HLS
      // listas (sin Torrentio, con Range, sin exponer el token). El camino cacheado
      // (`rdId` presente) NO entra aquí → intacto.
      if (!selected.rdId) {
        const hashes = Array.from(
          new Set(scored.map((sc) => extractInfoHash(sc.s)).filter((h) => /^[a-f0-9]{40}$/i.test(h)))
        ).slice(0, 5);
        if (hashes.length) {
          const sr = await serverResolve(hashes);
          if (sr && (sr.dash || sr.liveMP4 || sr.hls || sr.directUrl)) {
            selected.serverDashUrl = sr.dash ?? null;
            selected.serverLiveMp4Url = sr.liveMP4 ?? null;
            selected.serverHlsUrl = sr.hls ?? null;
            selected.serverDirectUrl = sr.directUrl ?? null;
            selected.serverTorrentId = sr.torrentId ?? null;
            console.warn(
              '[RD] Resuelto server-side (rd-stream) →',
              sr.dash ? 'DASH' : sr.liveMP4 ? 'liveMP4' : sr.hls ? 'HLS' : 'directo',
              '| filename:',
              sr.filename
            );
          }
        }
      }

      // ── PRE-CACHEO Direct Play (#5) ──────────────────────────────────────
      // Si lo que se va a reproducir NO es Direct Play (transcode: MKV/AC3 → seek
      // lejano roto) y NO tenemos ya una URL directa server-side, buscar la mejor
      // versión MP4/H264/AAC NO cacheada del pool. `usePlayer` la cachea en RD en
      // segundo plano y, al quedar lista, cambia a esa fuente (seek perfecto).
      const alreadyDirect = isDirectPlayStream(best) || !!selected.serverDirectUrl;
      if (alreadyDirect) {
        console.warn('[RD] Pre-cacheo (#5): no hace falta — ya es Direct Play');
      } else {
        const up = pickDirectPlayUpgrade(streams);
        if (up) {
          const h = extractInfoHash(up);
          if (/^[a-f0-9]{40}$/i.test(h)) {
            selected.upgradeInfoHash = h;
            selected.upgradeFilename = up.behaviorHints?.filename ?? null;
            console.warn('[RD] Pre-cacheo (#5): candidato Direct Play →', selected.upgradeFilename, '| hash:', h);
          } else {
            console.warn('[RD] Pre-cacheo (#5): candidato sin infoHash válido →', up.behaviorHints?.filename);
          }
        } else {
          console.warn('[RD] Pre-cacheo (#5): SIN candidato MP4/H264/AAC en este pool → no se puede mejorar el seek');
        }
      }

      return selected;
    } catch {
      // catch-all — línea ~4918: devuelve la forma completa con valores vacíos
      return emptySelectedStream();
    }
  }

  return { getStream, precacheDirect };
}

// Re-exportado por conveniencia — algunos llamadores (p.ej. tests / composables
// que arman nombres de archivo de alternativas fuera de esta capa) lo necesitan.
export { extractFilename };
