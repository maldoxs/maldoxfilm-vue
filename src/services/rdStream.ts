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
  isDirectPlayEligible,
  matchInDownloads,
  isJunkMatch,
  audioLangRank,
  isCachedStream,
  hasHardcodedSubs,
  isCinemaLeakSource,
  cutMarker,
  hasEng,
  hasSpa,
  hasLatino,
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

export interface RdStreamResolverOptions {
  rdToken: string;
  tmdbClient: TmdbClient;
  torrentioClient: TorrentioClient;
  rdClient: RealDebridClient;
  /** Resolución server-side para contenido no cacheado (ADR-004). Default: no-op. */
  serverResolve?: ServerResolveFn;
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
      const streamsAll: TorrentioStream[] = await torrentioClient.fetchStreams({
        rdToken,
        imdbId,
        type,
        season,
        episode,
      });
      if (!streamsAll.length) {
        console.warn('[RD] Sin streams en Torrentio'); // línea ~4724
        return emptySelectedStream();
      }

      // ── GATE de idioma original (2026-07-14, caso real "Kraken") ────────────────
      // Ninguna copia cacheada de Kraken (2026) declaraba idioma en el nombre ("⚠️
      // otro") — resultó ser la versión NORUEGA original sin marcar (el idioma
      // original de la película, confirmado en TMDB, es noruego). Cuando el título
      // NO es originalmente inglés ni español, un release SIN etiqueta de idioma es
      // sospechoso de ser esa versión original — a diferencia de Hollywood, donde
      // "sin etiqueta" casi siempre significa inglés por defecto (asunción segura
      // que NO se toca para esos casos). Se exige audio CONFIRMADO (inglés/español/
      // latino) solo cuando el idioma original lo amerita.
      let streams = streamsAll;
      let originalLanguage: string | null = null;
      // foreignAudioLanguage — se informa al usuario (toast), NO bloquea la
      // reproducción. Cambio de diseño (2026-07-14, caso real "Kraken"): antes
      // esto saltaba directo a otro reproductor cuando ningún candidato
      // confirmaba audio ENG/SPA/Latino. Pero ver una película extranjera en su
      // audio ORIGINAL + subtítulo en español (que se busca por IMDB ID, SIN
      // depender del idioma del audio) es una experiencia normal y válida — no
      // un defecto. Ahora se PREFIERE un candidato con audio confirmado si
      // existe (igual que antes); si no existe ninguno, se reproduce la mejor
      // copia igual (ya filtrada de subs quemados/origen de cine por los otros
      // fixes) y se avisa qué idioma trae, en vez de negarse a reproducirla.
      let foreignAudioLanguage: string | null = null;
      try {
        originalLanguage = await tmdbClient.getOriginalLanguage(tmdbId, type);
      } catch {
        originalLanguage = null; // no debe romper la resolución si este dato falla
      }
      if (originalLanguage && originalLanguage !== 'en' && originalLanguage !== 'es') {
        const confirmed = streamsAll.filter((s) => hasEng(s) || hasSpa(s) || hasLatino(s));
        if (confirmed.length) {
          console.warn(
            `[RD] Idioma original "${originalLanguage}" — filtrando a candidatos con audio confirmado:`,
            confirmed.length, 'de', streamsAll.length
          );
          streams = confirmed;
        } else {
          console.warn(
            `[RD] Idioma original "${originalLanguage}" y ningún candidato confirma audio ENG/SPA/Latino — se reproduce igual (audio original) con aviso`
          );
          foreignAudioLanguage = originalLanguage;
        }
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
      let selected = buildSelectedStream({
        best,
        withUrl,
        resolvedUrl,
        streamFilename,
        infoHash,
        imdbId,
        active,
      });

      // ── RE-FETCH del pool si la elegida NO es fluida (2026-07-14, caso real "Ghost Rider") ──
      // Evidencia (log del usuario): Torrentio devolvió un pool de 19 streams SIN ninguna
      // versión Direct Play cacheada → tocó /t/ sobre un archivo que RD generaba a ~0.4x
      // (latidos: contenido total 36.0s → 36.0s → 41.0s en 12s de reproducción) → pausas
      // matemáticamente inevitables. Como el pool de Torrentio VARÍA entre requests (ver
      // nota de "Preferencia latino" más abajo), una SEGUNDA consulta puede traer la versión
      // H264+AAC cacheada que reproduce por Direct Play (HTTP Range, cero transcode, cero
      // pausas). Solo corre en el caso malo (hay rdId pero la versión va a transcodear);
      // la ronda "upgrade a fluido" dentro de resolveActiveStream aplica su guard de idioma
      // (nunca degrada el audio). Si el re-fetch no aporta una fluida con match, el
      // resultado queda IDÉNTICO al de arriba — y si la red falla, también (try/catch).
      // finalPool/finalActive rastrean la selección VIGENTE (el re-fetch de abajo
      // puede reemplazarlos) — los usa el armado de alternativas /t/ más abajo.
      let finalPool = pool;
      let finalActive = active;

      if (selected.rdId && !isDirectPlayEligible(active.activeBest)) {
        try {
          const streams2: TorrentioStream[] = await torrentioClient.fetchStreams({
            rdToken,
            imdbId,
            type,
            season,
            episode,
          });
          const known = new Set(streams.map((s) => s.url).filter(Boolean));
          const nuevos = (streams2 || []).filter((s) => s.url && !known.has(s.url));
          if (nuevos.length) {
            console.warn('[RD] Pool sin versión fluida — re-fetch trajo', nuevos.length, 'streams nuevos');
            const merged = selectBestStream([...streams, ...nuevos], isTv);
            const active2 = resolveActiveStream(
              best,
              resolvedUrl,
              streamFilename,
              merged.pool,
              merged.scored,
              downloads
            );
            // El pool AMPLIADO sirve para las alternativas /t/ aunque no haya
            // aparecido una fluida (más copias cacheadas donde elegir el Plan B).
            finalPool = merged.pool;
            if (active2.rdId && isDirectPlayEligible(active2.activeBest)) {
              console.warn('[RD] Re-fetch encontró versión FLUIDA cacheada:', active2.activeFilename);
              finalActive = active2;
              selected = buildSelectedStream({
                best,
                withUrl: merged.withUrl,
                resolvedUrl,
                streamFilename,
                infoHash,
                imdbId,
                active: active2,
              });
            }
          }
        } catch (e) {
          console.warn('[RD] Re-fetch del pool falló (se mantiene la selección original):', e);
        }
      }

      // ── Alternativas cacheadas para el Plan B de /t/ (2026-07-14, caso "Ghost Rider") ──
      // Si la copia elegida va a /t/ y resulta LENTA en el servidor de RD (cada copia es
      // un archivo distinto — la velocidad de generación varía entre copias), el player
      // necesita a quién cambiarse SIN re-consultar nada. Se listan acá las otras copias
      // que TAMBIÉN tienen rdId propio (cacheadas en la cuenta), en orden de score, con
      // idioma igual o mejor que la elegida (mismo guard que el "upgrade a fluido").
      if (selected.rdId && !isDirectPlayEligible(finalActive.activeBest)) {
        const chosenRank = audioLangRank(finalActive.activeBest);
        // BLINDAJE de corte (2026-07-14, a pedido del usuario: "y si la otra copia no
        // tiene la misma resolución/corte?"): sin esto, el Plan B podía cambiar
        // silenciosamente de "Extended Cut" a la versión de cine — mismo título,
        // escenas DISTINTAS. Se filtra por edición ACÁ (dato ya disponible, gratis,
        // por nombre de archivo); la duración REAL se verifica después en
        // `usePlayer.ts` cuando RD resuelve cada candidato (ese dato recién existe
        // ahí). Dos capas: nombre primero (barato), duración real después (certero).
        const chosenCut = cutMarker(finalActive.activeBest);
        const alts: { rdId?: string; url?: string; filename: string }[] = [];
        for (const cand of finalPool) {
          if (alts.length >= 3) break;
          if (cand.s === finalActive.activeBest) continue;
          if (audioLangRank(cand.s) < chosenRank) continue; // nunca degradar el idioma
          if (cutMarker(cand.s) !== chosenCut) continue; // nunca cambiar de EDICIÓN/corte
          const candFn = extractFilename(cand.s);
          const m = matchInDownloads(cand.s.url || '', cand.s.url || '', candFn, downloads);
          if (m && !isJunkMatch(m) && m.id !== selected.rdId && !alts.some((a) => a.rdId === m.id)) {
            // Ya está en el historial de la cuenta → rdId directo, swap instantáneo.
            alts.push({ rdId: m.id, filename: m.filename || candFn });
          } else if (!m && isCachedStream(cand.s) && cand.s.url) {
            // ── LÍMITE ESTRUCTURAL ELIMINADO (2026-07-14, caso real "Doctor Sleep") ──
            // Antes se EXIGÍA `matchInDownloads` — o sea, que la copia ya estuviera en
            // el historial de descargas de ESTA cuenta. Esa restricción era ARTIFICIAL:
            // una copia `[RD+]` está cacheada en el pool GLOBAL de RD, y resolver su
            // link de Torrentio la agrega a la cuenta en segundos (es el mismo camino
            // por el que la copia PRINCIPAL obtuvo su rdId — `resolveProxyUrl` arriba).
            // Evidencia del bug: Doctor Sleep tenía 11 candidatos `[RD+]` y el Plan B
            // se quedó con CERO alternativas solo porque ninguna se había visto antes.
            // Ahora se guarda la URL y `usePlayer` la resuelve ON DEMAND (solo si el
            // Plan B llega a necesitarla — cero costo si la reproducción va bien).
            alts.push({ url: cand.s.url, filename: candFn });
          }
        }
        if (alts.length) {
          selected.altCachedCandidates = alts;
          console.warn(
            '[RD] Plan B /t/ — alternativas:',
            alts.map((a) => `${a.filename}${a.rdId ? ' (lista)' : ' (a resolver)'}`)
          );
        }

        // ── SIN copia confiable — saltar directo a otro reproductor (2026-07-14, 3ª
        // vuelta caso "La muerte de Robin Hood") ────────────────────────────────────
        // Evidencia: se probaron 3 copias cacheadas DISTINTAS (una HC, otra PLSUBBED,
        // otra sin ninguna etiqueta) y las TRES traían el MISMO subtítulo lituano
        // quemado — todas vienen de la misma filtración de cine. El nombre del archivo
        // dejó de ser una señal confiable para esta película: no hay ninguna copia
        // "limpia" que rescatar, existe o no. Si NINGÚN candidato cacheado [RD+] del
        // pool está libre de sospecha (ni subs declarados NI origen de cine), no tiene
        // sentido seguir adivinando entre copias contaminadas — se avisa y se cambia
        // de reproductor en vez de reproducir con un defecto ya confirmado 3 veces.
        const hayAlgunaConfiable = finalPool.some(
          (p) => isCachedStream(p.s) && !hasHardcodedSubs(p.s) && !isCinemaLeakSource(p.s)
        );
        if (!hayAlgunaConfiable) {
          console.warn('[RD] Ninguna copia cacheada confiable (todas HC/subs regionales/origen cine) — sin rdId');
          selected.noTrustworthyCachedVersion = true;
        }
      }

      // ── Preferencia latino DESHABILITADA (uniformidad + seek fluido) ──────────────
      // Antes: si el match cacheado NO tenía latino pero había un Latino en el pool, se
      // resolvía ese latino SERVER-SIDE (addMagnet/transcode) → seek LENTO. Como el pool de
      // Torrentio VARÍA entre requests, esto se disparaba en una pantalla y en otra no (TV vs
      // desktop), dando reproducciones distintas para el MISMO título: TV terminaba en
      // server-side (lento) y desktop en el match cacheado por `/t/` (fluido). Para que sea
      // IGUAL en todos los dispositivos, se mantiene SIEMPRE el match cacheado (`rdId` → `/t/`,
      // far-seek fluido). Trade-off: si el latino no está cacheado para `/t/`, va en inglés con
      // subtítulos (fluido) en vez de latino server-side (lento). Reactivar solo si se logra
      // servir el latino por `/t/` (rdId cacheado), no por server-side.

      // ── Resolución SERVER-SIDE para contenido NO cacheado (ADR-004) ──
      // Solo si NO hubo match cacheado (`rdId` null): se pasan los infoHashes del
      // pool (ordenados por score) a la Netlify Function `rd-stream`, que hace
      // addMagnet→selectFiles→unrestrict→transcode y devuelve URLs DASH/liveMP4/HLS
      // listas (sin Torrentio, con Range, sin exponer el token). El camino cacheado
      // (`rdId` presente) NO entra aquí → intacto.
      //
      // GATE `unavailableInRd` (2026-07-14, a pedido — caso real "La Odisea 2026"):
      // si `resolveActiveStream` ya determinó que NINGÚN candidato está cacheado
      // ([RD+]) en RD, la Fase 2 (start→polling 90s→legacy 9s) no tiene chance real
      // de éxito (requeriría una descarga desde cero, sin garantía de tiempo). Se
      // saltea la llamada por completo → cae directo al fallback de iframe en
      // usePlayer.ts (ver `selected.unavailableInRd` ahí), evitando minutos de
      // espera sin sentido.
      if (!selected.rdId && !selected.unavailableInRd) {
        // 5 → 12 (2026-07-13, caso El Padrino): las mejores versiones suelen estar
        // bloqueadas por DMCA en RD (addMagnet error 35). Con más candidatos, el
        // server-side puede SALTEAR los bloqueados y hallar uno que RD acepte
        // transcodear a AAC (audio compatible en desktop). Van en orden de score.
        const hashes = Array.from(
          new Set(scored.map((sc) => extractInfoHash(sc.s)).filter((h) => /^[a-f0-9]{40}$/i.test(h)))
        ).slice(0, 12);
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

      if (foreignAudioLanguage) selected.foreignAudioLanguage = foreignAudioLanguage;

      return selected;
    } catch {
      // catch-all — línea ~4918: devuelve la forma completa con valores vacíos
      return emptySelectedStream();
    }
  }

  return { getStream };
}

// Re-exportado por conveniencia — algunos llamadores (p.ej. tests / composables
// que arman nombres de archivo de alternativas fuera de esta capa) lo necesitan.
export { extractFilename };
