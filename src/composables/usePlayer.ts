/**
 * usePlayer — orquestación de la carga de la fuente Real-Debrid del
 * reproductor: HEVC directo, transcode (DASH/HLS), watchdogs, fallback de
 * fuentes y selector de pista en español.
 *
 * Capa de ORQUESTACIÓN sobre `services/playback.ts` (decisiones puras, ya
 * testeadas) + `services/rdStream.ts` (resolución de stream RD) +
 * `services/realdebrid.ts` (transcode/probing). Reemplaza el bloque
 * `if(_activeSrcIdx === RD_SRC_IDX){ rdGetStream(...).then(...) }` completo
 * de `loadPlayerSource` (líneas ~7824-8186 de assets/index.html) — la rama
 * MÁS COMPLEJA de todo el reproductor (HEVC nativo → transcode DASH/Shaka →
 * transcode HLS/hls.js → fallback x265 → play directo, cada uno con sus
 * watchdogs y timelines de mensajes).
 *
 * ⚠️ Esta capa toca DOM (`<video>`, scripts CDN de hls.js/Shaka),
 * `MediaSource`, red (RD transcode/HEAD probes) y `setTimeout` reales — no es
 * testeable con Vitest puro. TODA decisión ("¿hay audio incompatible?",
 * "¿qué mensaje toca a los X ms?", "¿cuál es la URL de la pista en
 * español?") ya vive en `services/playback.ts` con 18 tests; aquí solo se
 * ENCADENAN esas decisiones sobre el DOM real, preservando el ORDEN EXACTO
 * y los mismos guards de `_playerGen`/`isStale`.
 *
 * GANANCIA REAL vs el original: el árbol de 6 niveles de `if/else` anidados
 * (HEVC → rdId → DASH/HLS → x265 fallback → directo) se vuelve una cascada
 * lineal de funciones `async` con early-returns — cada rama es una función
 * nombrada en vez de un bloque anónimo de 80 líneas.
 */

import { ref, type Ref } from 'vue';
import {
  detectHevcSupport,
  checkBadAudioForDirectPlay,
  isDualLatFilename,
  MIN_VALID_DURATION_SEC,
  HEVC_DIRECT_PLAY_TIMEOUT_MS,
  BLOCKED_MESSAGE_WAIT_MS,
  SPANISH_TRACK_CANDIDATES,
  buildSpanishTrackUrl,
  buildDashBaseUrl,
  buildLoadingMessageTimeline,
  PLAYBACK_STARTED_THRESHOLD_SEC,
  SHAKA_WATCHDOG_MS,
  HLS_WATCHDOG_MS,
  HLS_CONFIG,
  isDashManifest,
  type MediaSourceLike,
} from '../services/playback';
import { pickHlsFallbackFromTranscode, pickDashUrlFromTranscode } from '../services/realdebrid';
import { parseMediaInfos, pickSpanishAudioToken } from '../services/mediaInfos';
import {
  resolveTpipeline,
  pingSeek,
  buildMpdUrl,
  waitForSegmentAt,
  pickBestAudio,
  type TpipelineResolveResult,
} from '../services/rd-t-pipeline';
import type { RealDebridClient } from '../services/realdebrid';
import type { RdStreamResolver } from '../services/rdStream';
import { usePlayerStore } from '../stores/player';
import type { SelectedStream } from '../types';

// Watchdog del cambio de pista de audio del panel ⚙️ — preserva el `90000`
// literal de `spSwitchAudio` (línea ~4378): si el transcode en frío de la
// nueva pista no arranca en 90s, revierte a la anterior.
const AUDIO_SWITCH_WATCHDOG_MS = 90000;

// ── Recuperación de stall a MITAD de reproducción ───────────────────────────
// El watchdog original (`SHAKA_WATCHDOG_MS`) solo vigila el ARRANQUE. Si pausás
// varios minutos, las URLs de streaming de RD caducan y al volver Shaka deja de
// avanzar → la peli "se pega". Esto vigila que `currentTime` avance mientras
// está en play y, si se traba, recarga el DASH actual desde la posición.
const STALL_CHECK_INTERVAL_MS = 2000; // cada cuánto se revisa el avance
const STALL_RECOVER_MS = 8000; // sin avanzar (en play) este tiempo → recuperar
const STALL_RECOVER_SEEK_MS = 4500; // tras un seek (adelantar/retroceder), recuperar más rápido
const SEEK_RECENT_WINDOW_MS = 20000; // ventana en la que un stall cuenta como "post-seek"
// Seek trabado SIN buffer: cuánto esperar antes de volver a posición reproducible.
// CERCA del punto actual → RD puede extender el transcode unos segundos → más paciencia.
// LEJOS (minutos) → RD no tiene ese tramo y no lo va a generar → desistir rápido.
const NEAR_SEEK_SEC = 120; // distancia (s) hasta la que un seek se considera "cercano"
const SEEK_FREEZE_NEAR_MS = 12000; // paciencia para seek cercano (dar tiempo a RD)
const SEEK_FREEZE_FAR_MS = 5000; // seek lejano → volver rápido (no se va a poder)
// (NOTA: ya NO recargamos el manifest en el seek — RD no expone un mecanismo de seek
// replicable desde la API pública; recargar mataba el player. El seek lo maneja Shaka nativo.)
const STALL_BACKOFF_MS = 8000; // por cada recuperación previa, esperar este extra (dar tiempo al transcoder)
const MAX_STALL_RECOVERIES = 4; // recuperaciones sin éxito → cambiar de fuente (con backoff, ~más paciencia)

// ── PRE-CACHEO Direct Play (#5) ──────────────────────────────────────────────
// Mientras reproduce el transcode, sondea a RD si ya cacheó el MP4/H264/AAC; al
// quedar listo, cambia a Direct Play (seek perfecto). Sondeo espaciado para no
// martillar la API de RD (rate limit 250/min) y dar tiempo a la descarga.

// ── Carga dinámica de hls.js / Shaka Player (líneas ~3884-3937) ─────────────
// Se preserva el patrón "singleton + polling" del original: solo un <script>
// se inyecta a la vez, los llamadores concurrentes esperan al mismo callback.
const SCRIPT_LOAD_TIMEOUT_MS = 15000; // si el CDN no responde en 15s, desistir (antes colgaba para siempre)

let _hlsLoading = false;
function loadHlsIfNeeded(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Hls?: unknown };
    if (w.Hls) return resolve();
    if (_hlsLoading) {
      const t = setInterval(() => {
        if (w.Hls) {
          clearInterval(t);
          resolve();
        }
      }, 60);
      return;
    }
    _hlsLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.4.12/hls.min.js';
    // ⚠️ SEGURIDAD — Subresource Integrity: el original cargaba este script de
    // un CDN de terceros SIN verificación de integridad — si cdnjs sufriera un
    // compromiso/MITM, el script ejecutaría con privilegios completos de la
    // página (podría exfiltrar el token RD, leer localStorage, etc. — la
    // superficie de ataque de cadena de suministro más peligrosa de toda la
    // app). Se agrega el hash SRI publicado oficialmente por cdnjs para esta
    // versión exacta (1.4.12) — verificado contra https://api.cdnjs.com — de
    // forma que el navegador rechace cualquier respuesta que no coincida byte
    // a byte. No cambia ningún comportamiento funcional.
    s.integrity = 'sha512-livj3YhgdqpYdRFIbB6vkXJYGrCURfkc19oK1WZWW2RfIaxFYfsWEiu1VysTT4VuodWvYL2Irbb5kv67I1g6Qg==';
    s.crossOrigin = 'anonymous';
    // BUG encontrado (2026-07-05): sin 'onerror' ni timeout, si el CDN no responde (red
    // distinta/más lenta en TV vs desktop) la Promise NUNCA se resolvía ni rechazaba → el
    // reproductor quedaba colgado para siempre "cargando". Ahora rechaza a los 15s o si el
    // <script> falla, y el llamador (con su propio try/catch) cae al respaldo.
    const timeout = setTimeout(() => {
      _hlsLoading = false;
      reject(new Error('HLS.js CDN timeout (15s)'));
    }, SCRIPT_LOAD_TIMEOUT_MS);
    s.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timeout);
      _hlsLoading = false;
      reject(new Error('HLS.js CDN script error'));
    };
    document.head.appendChild(s);
  });
}

let _shakaLoading = false;
function loadShakaIfNeeded(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { shaka?: { polyfill: { installAll(): void } } };
    if (w.shaka) return resolve();
    if (_shakaLoading) {
      const t = setInterval(() => {
        if (w.shaka) {
          clearInterval(t);
          resolve();
        }
      }, 60);
      return;
    }
    _shakaLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.6/shaka-player.compiled.js';
    // ⚠️ SEGURIDAD — mismo razonamiento de Subresource Integrity que en
    // `loadHlsIfNeeded`: hash SRI oficial de cdnjs para shaka-player 4.7.6,
    // verificado contra https://api.cdnjs.com.
    s.integrity = 'sha512-085ivZ5s6z+Qk9InxYMJoXF6JuMRfnTJGpeOph6TKmgsnkqxMhcauQIWINE6FnBt/KJBvcx7JjRAXc+ZvNJuyQ==';
    s.crossOrigin = 'anonymous';
    // Mismo fix que loadHlsIfNeeded (2026-07-05): timeout + onerror para no colgar la
    // Promise para siempre si el CDN no responde (candidato principal de "TV se queda
    // cargando, desktop anda bien" — desktop ya lo tenía cacheado de tanto probar hoy).
    const timeout = setTimeout(() => {
      _shakaLoading = false;
      reject(new Error('Shaka CDN timeout (15s)'));
    }, SCRIPT_LOAD_TIMEOUT_MS);
    s.onload = () => {
      clearTimeout(timeout);
      w.shaka!.polyfill.installAll();
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timeout);
      _shakaLoading = false;
      reject(new Error('Shaka CDN script error'));
    };
    document.head.appendChild(s);
  });
}

// ── Shaka Player — instancia única (líneas ~3901-3937) ──────────────────────
// Variables de módulo (no `ref`): son punteros a instancias de terceros, no
// estado reactivo de UI — exactamente lo que eran en el original (`var _shakaPlayer`).
let _shakaPlayer: ShakaPlayerLike | null = null;
// NOTA — el original también declaraba `_shakaCurrentUrl` ("URL actual (para
// cast)", línea ~3902) pero NUNCA la leía en ningún punto del archivo: era
// vestigial (probablemente para una integración de cast que no llegó a
// implementarse). JS no se queja de variables solo-escritas; TS sí
// (`noUnusedLocals`/TS6133) — se omite aquí por ser muerta en el original
// también, no porque se haya quitado funcionalidad real.

interface ShakaPlayerLike {
  attach(video: HTMLVideoElement): Promise<void>;
  destroy(): Promise<void> | void;
  addEventListener(ev: string, cb: (e: { detail?: { code?: number } }) => void): void;
  configure(cfg: unknown): void;
  load(url: string, startTime?: number | null): Promise<void>;
}

// PERF/MEMORIA — TV y móviles de poca RAM se "pegan" si Shaka acumula un buffer
// grande de un stream de alta tasa. Detección self-contained (no toca el resto):
// `navigator.deviceMemory` ≤ 4 GB, o UA de móvil/TV. Solo se usa para RECORTAR el
// `bufferBehind` (video ya reproducido que Shaka guarda para rebobinar — pura RAM,
// sin riesgo de stutter); en desktop NO se toca nada (defaults de Shaka).
function isLowMemoryDevice(): boolean {
  try {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
    const ua = navigator.userAgent || '';
    return /Mobi|Android|iPhone|iPad|iPod|SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|AFT/i.test(ua);
  } catch {
    return false;
  }
}

async function _shakaLoad(video: HTMLVideoElement, url: string, startTime?: number) {
  if (_shakaPlayer) {
    try {
      await _shakaPlayer.destroy();
    } catch {
      /* silenciar — igual que el original */
    }
    _shakaPlayer = null;
  }
  // ⚠️ El constructor es `shaka.Player`, NO `shaka` (que es el namespace).
  // Preserva índex.html línea 3920: `var p = new shaka.Player();`.
  const w = window as unknown as { shaka: { Player: new () => ShakaPlayerLike } };
  const p = new w.shaka.Player();
  await p.attach(video);
  _shakaPlayer = p;
  p.addEventListener('error', (e) => {
    const code = e.detail ? e.detail.code : null;
    if (code === 1003) return; // LOAD_INTERRUPTED — normal al cambiar audio/fuente
    console.warn('Shaka error:', code ?? e);
  });
  // ── Config PACIENTE para el transcode on-demand de RD ───────────────────────
  // RD genera los segmentos `.m4s` sobre la marcha: al hacer seek lejano, el request
  // del segmento QUEDA COLGADO hasta que RD lo produce (varios segundos). El player
  // oficial de RD simplemente ESPERA → seek fluido. Con la config mínima anterior
  // (3 intentos, timeout corto) Shaka se rendía y caía al iframe. Ahora reintenta
  // con paciencia (timeout largo, más intentos, backoff) → espera al segmento como
  // hace RD. Es el fix real del "se pega/cae al adelantar" en pelis que transcodean.
  const streamingCfg: Record<string, unknown> = {
    retryParameters: {
      maxAttempts: 6,
      baseDelay: 1000,
      backoffFactor: 1.5,
      fuzzFactor: 0.5,
      timeout: 60000, // 60s por segmento: tiempo para que RD lo genere (request colgado)
      connectionTimeout: 0, // sin límite de conexión (RD long-pollea el segmento)
      stallTimeout: 0,
    },
    bufferingGoal: 30, // buffer hacia adelante generoso (menos rebuffer)
    rebufferingGoal: 2,
    bufferBehind: isLowMemoryDevice() ? 10 : 30,
  };
  p.configure({ streaming: streamingCfg });
  await p.load(url, typeof startTime === 'number' && startTime > 0 ? startTime : null);
}

function _shakaDestroy() {
  if (_shakaPlayer) {
    try {
      const r = _shakaPlayer.destroy();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch {
      /* silenciar */
    }
    _shakaPlayer = null;
  }
}

export interface UsePlayerOptions {
  /** Ref al elemento <video> activo. */
  videoRef: Ref<HTMLVideoElement | null | undefined>;
  /** Resuelve el stream RD (IMDB → Torrentio → match en downloads). */
  rdStreamResolver: RdStreamResolver;
  /** Cliente RD — se usa para `fetchTranscode` (probing DASH/HLS). */
  rdClient: RealDebridClient;
  /**
   * ¿Estamos en modo TV? En TV se prefiere H264 1080p (el scoring penaliza HEVC/4K)
   * y se trata HEVC como NO soportado (el navegador de la smart-TV no renderiza el
   * video HEVC por MSE → audio sin imagen). Default false (escritorio/móvil).
   */
  isTv?: () => boolean;
  /** ¿Es anime? Si RD devuelve audio sin ENG/SPA → fallback inmediato a iframe (que trae subs integrados). */
  isAnime?: () => boolean;
  /** Callback: ocultar overlay de carga + arrancar tracking de progreso (equiv. `hideLoadingAndStart`). */
  onStarted: () => void;
  /** Callback: mostrar un toast (equiv. `showToast`). */
  onToast: (msg: string) => void;
  /** Callback: el stream tiene audio nativo en español detectado en DASH (subs OFF por defecto). */
  onNativeSpanishDetected?: () => void;
  /** Callback: stream listo — para inicializar buscador de subtítulos / selector de audio. */
  onStreamReady?: (info: { selected: SelectedStream; hasNativeSpanish: boolean; spanishTrack: string | null }) => void;
  /** Callback: cambiar a la siguiente fuente / reintentar (equiv. `playerState._srcIdx = 0; loadPlayerSource()`). */
  onFallbackToNextSource: () => void;
  /**
   * Callback: arrancó un cambio de pista de audio desde el panel — mostrar el
   * overlay de carga (equiv. a `playerLoading.classList.remove('hidden')`,
   * línea ~4349, dentro de `spSwitchAudio`). `loadingMessage` ya trae el
   * texto correcto ("🇬🇧/🇪🇸 Cargando audio en...").
   */
  onAudioSwitchStart?: () => void;
  /** Callback: terminó (con éxito o no) el cambio de pista — ocultar el overlay (línea ~4370/4382/4420). */
  onAudioSwitchEnd?: () => void;
  /**
   * Callback: la pista de audio cambió con éxito — el llamador decide qué
   * hacer con los subtítulos según el nuevo idioma (preserva el bloque
   * `if(isEng){ if(_subsEnabled...) fetchAndInjectSubtitle(...) } else { box.innerHTML=''; _spUpdateSubRows(false) }`,
   * líneas ~4406-4414): si se pasó a inglés y los subs estaban activos, volver
   * a buscarlos; si se pasó a español (audio nativo), limpiar el overlay.
   */
  onAudioTrackChanged?: (isEng: boolean) => void;
  /** `MediaSource` real (inyectable para tests — por defecto el global). */
  mediaSource?: MediaSourceLike | undefined;
  /**
   * serverCleanup — borra en RD el torrent que `rd-stream` creó para este stream
   * (ADR-004/006), al cerrar el reproductor o cambiar de título. Inyectable y
   * opcional: default no-op para no tocar la red en tests. El llamador real usa
   * `navigator.sendBeacon('/.netlify/functions/rd-cleanup?id=...')`.
   */
  serverCleanup?: (torrentId: string) => void;
}

export interface UsePlayerReturn {
  /** Mensaje vigente del overlay de carga ("📡 Conectando...", "⏱️ 1 minuto...", etc). */
  loadingMessage: Ref<string>;
  /** ¿Hay una carga RD en curso? */
  isLoadingRd: Ref<boolean>;
  /** URL base DASH para el panel de ajustes de audio (o null si no aplica). */
  dashBaseUrl: Ref<string | null>;
  /** Pista de audio activa actualmente (p.ej. 'eng1', 'spa1'). */
  activeTrack: Ref<string>;
  /** Pista en español detectada (o null). */
  spanishTrack: Ref<string | null>;
  /** Carga la fuente RD completa — equivalente al bloque `if(_activeSrcIdx === RD_SRC_IDX)`. */
  loadRdSource(params: { id: string | number; type: 'movie' | 'tv'; season?: number; episode?: number; startPositionSec?: number }): Promise<void>;
  /** Cambia la pista de audio activa en un manifest DASH ya cargado (panel de ajustes). */
  switchAudioTrack(track: string): Promise<void>;
  /** Limpia instancias activas (HLS.js / Shaka) — llamar al cerrar el reproductor. */
  destroy(): void;
  /** ¿Está usando el pipeline /t/? Si true, el seek debe usar tpipelineSeekTo en vez del nativo. */
  isTpipeline: Ref<boolean>;
  /** Duración total (seg) reportada por el pipeline /t/ (para la barra custom). */
  tpipelineDuration: Ref<number>;
  /** Offset del MPD actual (seg) — el tiempo real = offset + video.currentTime. */
  tpipelineOffset: Ref<number>;
  /** ¿Está haciendo seek en el pipeline /t/? Para mostrar freeze-frame + loader. */
  tpipelineSeeking: Ref<boolean>;
  /** Seek del pipeline /t/: recarga el MPD en la posición indicada. */
  tpipelineSeekTo(seconds: number): Promise<void>;
}

export function usePlayer(opts: UsePlayerOptions): UsePlayerReturn {
  const playerStore = usePlayerStore();

  const loadingMessage = ref('');
  const isLoadingRd = ref(false);
  const dashBaseUrl = ref<string | null>(null);
  const activeTrack = ref('eng1');
  const spanishTrack = ref<string | null>(null);

  // ── Pipeline /t/ state ──────────────────────────────────────────────────────
  const isTpipeline = ref(false);
  const tpipelineDuration = ref(0);
  const tpipelineOffset = ref(0);
  const tpipelineSeeking = ref(false);
  let tpipelineState: {
    resolved: TpipelineResolveResult;
    audio: string;
    myGen: number;
  } | null = null;
  let _tSeekTimer: ReturnType<typeof setTimeout> | null = null;
  let _tReloading = false;

  // ── Limpieza del torrent que `rd-stream` creó en RD (ADR-006) ─────────────
  // Se borra al cerrar el reproductor o al cambiar de título, para que no se
  // acumulen torrents (error 21). Solo el camino server-side setea este id.
  let currentServerTorrentId: string | null = null;
  function cleanupServerTorrent() {
    if (currentServerTorrentId) {
      opts.serverCleanup?.(currentServerTorrentId);
      currentServerTorrentId = null;
    }
  }

  let activeMsgTimers: ReturnType<typeof setTimeout>[] = [];
  function clearMsgTimers() {
    activeMsgTimers.forEach(clearTimeout);
    activeMsgTimers = [];
  }

  // ── Programa el timeline de mensajes — reemplaza los `_msgsS.map(setTimeout...)`
  // y `_msgs.map(setTimeout...)` (líneas ~7983-7985 y ~8071-8077), unificados
  // porque ambas listas son IDÉNTICAS salvo por `isBadAudio` (ya unificado en
  // `buildLoadingMessageTimeline`).
  function scheduleLoadingMessages(isBadAudio: boolean, hasStarted: () => boolean) {
    const timeline = buildLoadingMessageTimeline(isBadAudio);
    activeMsgTimers = timeline.map(([delay, msg]) =>
      setTimeout(() => {
        if (!hasStarted()) loadingMessage.value = msg;
      }, delay)
    );
  }

  function getMediaSource(): MediaSourceLike | undefined {
    if (opts.mediaSource !== undefined) return opts.mediaSource;
    return typeof MediaSource !== 'undefined' ? (MediaSource as unknown as MediaSourceLike) : undefined;
  }

  // ── Intento de reproducción directa HEVC (líneas ~7878-7913) ────────────
  // Devuelve `true` si reprodujo de verdad (duration > 35s), `false` si falló
  // o no aplica — el llamador decide si continuar al transcode.
  async function tryHevcDirectPlay(video: HTMLVideoElement, streamUrl: string, startPositionSec?: number): Promise<boolean> {
    let played = false;
    await new Promise<void>((resolve) => {
      const tmo = setTimeout(() => {
        if (!played) {
          video.src = '';
          resolve();
        }
      }, HEVC_DIRECT_PLAY_TIMEOUT_MS);
      video.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(tmo);
          if (video.duration && isFinite(video.duration) && video.duration > MIN_VALID_DURATION_SEC) {
            played = true;
            const resumeAt =
              startPositionSec && startPositionSec > 30 && startPositionSec < video.duration
                ? startPositionSec
                : 0;
            if (resumeAt > 0) {
              // "Continuar viendo": posicionar ANTES de play() y entrar MUTEADO. Aunque
              // seteemos currentTime aquí, el play() de iOS reproduce un instante desde
              // el frame 0 mientras el seek se resuelve async → se oye ~1s del inicio.
              // Mantenemos el audio en silencio hasta que el seek COMPLETE ('seeked'),
              // y recién ahí restauramos volumen. Así nunca se oye la melodía del inicio.
              video.muted = true;
              const restoreAudio = () => {
                video.muted = false;
                video.volume = 1;
              };
              // Si 'seeked' no dispara (edge), un timeout restaura el audio igual.
              const audioFallback = setTimeout(restoreAudio, 1500);
              video.addEventListener(
                'seeked',
                () => {
                  clearTimeout(audioFallback);
                  restoreAudio();
                },
                { once: true }
              );
              try {
                video.currentTime = resumeAt;
              } catch {
                clearTimeout(audioFallback);
                restoreAudio(); // el seek tardío de onRdStarted cubre el reposicionamiento
              }
            } else {
              video.muted = false;
              video.volume = 1;
            }
            video.play().catch(() => {});
            opts.onStarted();
            resolve();
          } else {
            video.src = '';
            resolve();
          }
        },
        { once: true }
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(tmo);
          video.src = '';
          resolve();
        },
        { once: true }
      );
      video.src = streamUrl;
      video.load();
    });
    return played;
  }

  // ── Probing de pista en español dentro del manifest DASH (líneas ~7929-7960) ──
  async function probeSpanishDashTrack(
    dashUrlBase: string,
    fetchImpl: typeof fetch
  ): Promise<{ finalUrl: string; hasNativeSpanish: boolean; track: string | null }> {
    for (const track of SPANISH_TRACK_CANDIDATES) {
      const candidateUrl = buildSpanishTrackUrl(dashUrlBase, track);
      if (!candidateUrl) break; // la URL no matchea el patrón — cortar el loop (línea ~7943)
      try {
        const r = await fetchImpl(candidateUrl, { method: 'HEAD' });
        if (r.ok) return { finalUrl: candidateUrl, hasNativeSpanish: true, track };
      } catch {
        /* silenciar — igual que el catch vacío del original */
      }
    }
    return { finalUrl: dashUrlBase, hasNativeSpanish: false, track: null };
  }

  // ── Monitor de stall a mitad de reproducción (TODOS los caminos: DASH/HLS/directo) ──
  // Antes solo vigilaba DASH/Shaka; ahora es genérico (recibe una función de recuperación
  // específica del camino) y reacciona MÁS RÁPIDO tras un seek (que es justo cuando algunas
  // pelis se "pegaban" al adelantar/retroceder). Aplica igual en escritorio, TV y móvil.
  let stallTimer: ReturnType<typeof setInterval> | null = null;
  let stallLastTime = 0;
  let stallStuckSince = 0;
  let stallRecoveries = 0;
  let stallRecovering = false;
  let currentDashUrl: string | null = null;
  let stallRecoverFn: ((video: HTMLVideoElement) => Promise<void>) | null = null;
  let stallVideo: HTMLVideoElement | null = null;
  let onStallSeeked: (() => void) | null = null;
  let lastSeekAt = 0;
  let lastPlayingPos = 0; // última posición donde el video AVANZABA de verdad (zona reproducible)
  let seekStuckSince = 0; // desde cuándo un seek está trabado SIN buffer (far-seek a tramo no generado)

  // ── Instrumentación (#3) — log compacto de los eventos críticos del <video> con
  // tiempo, buffer por delante, readyState/networkState. Sirve para capturar EXACTO
  // qué pasa en un "se pegó" (seek lejano en transcode vs URL caducada vs decode) en
  // vez de teorizar. Liviano: solo console.warn, sin estado reactivo. ─────────────
  let diagHandlers: Array<[string, EventListener]> | null = null;
  let diagVideo: HTMLVideoElement | null = null;
  function bufferAhead(v: HTMLVideoElement): number {
    try {
      return v.buffered.length ? Math.max(0, v.buffered.end(v.buffered.length - 1) - v.currentTime) : 0;
    } catch {
      return 0;
    }
  }
  function attachDiagnostics(video: HTMLVideoElement) {
    detachDiagnostics();
    diagVideo = video;
    const log = (ev: string) =>
      console.warn(
        `[PLAYER] ${ev} | t=${video.currentTime.toFixed(1)}s | buffer +${bufferAhead(video).toFixed(1)}s | ready=${video.readyState} net=${video.networkState}${video.seeking ? ' | seeking' : ''}`
      );
    const events = ['seeking', 'seeked', 'waiting', 'stalled', 'playing', 'error', 'ended'];
    diagHandlers = events.map((ev) => {
      const h: EventListener = () => log(ev);
      video.addEventListener(ev, h);
      return [ev, h] as [string, EventListener];
    });
  }
  function detachDiagnostics() {
    if (diagHandlers && diagVideo) diagHandlers.forEach(([ev, h]) => diagVideo!.removeEventListener(ev, h));
    diagHandlers = null;
    diagVideo = null;
  }

  function clearStallMonitor() {
    if (stallTimer) {
      clearInterval(stallTimer);
      stallTimer = null;
    }
    if (stallVideo && onStallSeeked) stallVideo.removeEventListener('seeked', onStallSeeked);
    detachDiagnostics();
    onStallSeeked = null;
    stallVideo = null;
    stallStuckSince = 0;
    stallRecoveries = 0;
    stallRecovering = false;
    currentDashUrl = null;
    stallRecoverFn = null;
    lastSeekAt = 0;
    lastPlayingPos = 0;
    seekStuckSince = 0;
  }

  // ── Recuperaciones por camino (recargan el stream desde la posición actual) ──
  /** DASH/Shaka: recarga el MISMO manifest desde la posición → reabre la sesión RD. */
  async function recoverDash(video: HTMLVideoElement) {
    if (!currentDashUrl) throw new Error('sin DASH url');
    // Piso = última posición buena: tras una pausa larga la sesión de transcode puede morir
    // y `video.currentTime` quedar en 0 → recargar ahí REINICIARÍA la peli ("negro a 0").
    // `lastPlayingPos` (última posición donde avanzaba) hace que retome donde ibas, no en 0.
    const pos = Math.max(video.currentTime, lastPlayingPos);
    await _shakaLoad(video, currentDashUrl, pos > 3 ? pos : undefined);
    await video.play().catch(() => {});
  }
  /** hls.js: reanuda la carga desde la posición; si no hay instancia (HLS nativo) recarga el src. */
  function recoverHls(url: string) {
    return async (video: HTMLVideoElement) => {
      const w = window as unknown as {
        hlsInstance?: { startLoad(p?: number): void; stopLoad?(): void } | null;
      };
      const hls = w.hlsInstance;
      const pos = video.currentTime;
      if (hls && typeof hls.startLoad === 'function') {
        try {
          hls.stopLoad?.();
        } catch {
          /* noop */
        }
        hls.startLoad(pos > 3 ? pos : -1);
        try {
          if (pos > 3) video.currentTime = pos;
        } catch {
          /* noop */
        }
        await video.play().catch(() => {});
      } else {
        await recoverReloadSrc(url)(video);
      }
    };
  }
  /** Directo / HLS nativo: re-asigna `src` y restaura la posición (reabre el Range del archivo). */
  function recoverReloadSrc(url: string) {
    return (video: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        // Piso = última posición buena (evita reiniciar a 0 si currentTime se reseteó).
        const pos = Math.max(video.currentTime, lastPlayingPos);
        let done = false;
        const onMeta = () => {
          if (done) return;
          done = true;
          video.removeEventListener('loadedmetadata', onMeta);
          try {
            if (pos > 3) video.currentTime = pos;
          } catch {
            /* noop */
          }
          video.play().catch(() => {});
          resolve();
        };
        video.addEventListener('loadedmetadata', onMeta);
        video.src = url;
        video.load();
        // No colgar la promesa si nunca llega `loadedmetadata`.
        setTimeout(() => {
          if (done) return;
          done = true;
          video.removeEventListener('loadedmetadata', onMeta);
          resolve();
        }, 6000);
      });
  }

  /** Orquestador genérico: cuenta recuperaciones, avisa, y si se agotan cae a otra fuente. */
  async function runStallRecovery(video: HTMLVideoElement, myGen: number) {
    if (stallRecovering || !stallRecoverFn) return;
    if (playerStore.isStale(myGen)) {
      clearStallMonitor();
      return;
    }
    stallRecovering = true;
    stallRecoveries += 1;
    // Demasiadas recuperaciones seguidas sin lograr avanzar → rendirse y cambiar de fuente.
    if (stallRecoveries > MAX_STALL_RECOVERIES) {
      clearStallMonitor();
      opts.onToast('⚠️ La reproducción se interrumpió — cambiando de reproductor');
      opts.onFallbackToNextSource();
      stallRecovering = false;
      return;
    }
    opts.onToast('🔄 Reconectando con el servidor...');
    try {
      await stallRecoverFn(video);
      stallLastTime = video.currentTime;
      stallStuckSince = 0;
    } catch (e) {
      console.warn('[STALL] Falló la recuperación:', e);
      clearStallMonitor();
      if (!playerStore.isStale(myGen)) {
        opts.onToast('⚠️ No se pudo reanudar — cambiando de reproductor');
        opts.onFallbackToNextSource();
      }
    } finally {
      stallRecovering = false;
    }
  }

  /**
   * startStallMonitor — vigila que `currentTime` avance en CUALQUIER camino. Si se traba
   * (en play, sin avanzar) recupera vía `recover` (recarga desde la posición). Tras un seek
   * usa un umbral MÁS CORTO (`STALL_RECOVER_SEEK_MS`): ahí es donde algunas pelis se "pegaban".
   */
  function startStallMonitor(
    video: HTMLVideoElement,
    myGen: number,
    recover: (video: HTMLVideoElement) => Promise<void>
  ) {
    clearStallMonitor();
    stallVideo = video;
    attachDiagnostics(video);
    stallRecoverFn = recover;
    stallLastTime = video.currentTime;
    onStallSeeked = () => {
      lastSeekAt = Date.now();
      // Un seek NUEVO del usuario = intento fresco → resetear el presupuesto de
      // recuperaciones (si no, varios seeks seguidos agotaban los 3 intentos y caía al
      // iframe). Durante una recuperación en curso NO se resetea (evita bucle infinito).
      if (!stallRecovering) {
        stallRecoveries = 0;
        stallStuckSince = 0;
      }
    };
    video.addEventListener('seeked', onStallSeeked);
    stallTimer = setInterval(() => {
      if (playerStore.isStale(myGen)) {
        clearStallMonitor();
        return;
      }
      // SEEK en curso: NO recargar el manifest. Recargar (destruir+recrear Shaka) en un
      // seek de transcode RESETEABA el reproductor ("contador en 00" y muerte) sin lograr
      // el seek — RD no expone un mecanismo de seek replicable desde la API pública (su
      // player usa "Seeking Time" interno). Mejor dejar que Shaka maneje el seek nativo y
      // ESPERE (config paciente): si es seek dentro del buffer/ventana, salta; si es lejano
      // en transcode, bufferea pero el player NO MUERE (el usuario puede volver y seguir).
      if (video.seeking) {
        stallLastTime = video.currentTime;
        stallStuckSince = 0;
        // RED ANTI-CONGELAMIENTO: un far-seek de transcode a un tramo que RD NO generó
        // deja `seeking=true` con buffer 0 PARA SIEMPRE → el player "se muere". Si el seek
        // lleva trabado SIN buffer más de SEEK_FREEZE_MS, volvemos a la última posición
        // reproducible (zona ya transcodeada). No mata el player: seguís viendo. El seek
        // lejano recién funciona cuando el pre-cacheo (#5) cambia a Direct Play.
        if (bufferAhead(video) < 0.1) {
          if (seekStuckSince === 0) {
            seekStuckSince = Date.now();
          } else {
            // Cerca del punto reproducible → RD puede extender el transcode (paciencia).
            // Lejos (minutos) → no lo va a generar → desistir rápido y volver (no morir).
            const dist = Math.abs(video.currentTime - lastPlayingPos);
            const limit = dist <= NEAR_SEEK_SEC ? SEEK_FREEZE_NEAR_MS : SEEK_FREEZE_FAR_MS;
            if (Date.now() - seekStuckSince >= limit) {
              seekStuckSince = 0;
              const safe = Math.max(0, lastPlayingPos);
              const kind = dist > NEAR_SEEK_SEC ? 'lejano' : 'cercano';
              console.warn(`[PLAYER] seek ${kind} trabado (transcode sin segmento) → volviendo a t=${safe.toFixed(1)}s`);
              opts.onToast('⏪ Esa parte aún no está lista — volviendo');
              try {
                video.currentTime = safe;
              } catch {
                /* noop */
              }
            }
          }
        } else {
          seekStuckSince = 0;
        }
        return;
      }
      seekStuckSince = 0;
      // No interferir durante recuperación, cambio de audio, pausa o fin
      // (una pausa normal NO debe disparar recuperación).
      if (stallRecovering || switchingAudio || video.paused || video.ended) {
        stallLastTime = video.currentTime;
        stallStuckSince = 0;
        return;
      }
      const t = video.currentTime;
      if (t > stallLastTime + 0.1) {
        // Avanza con normalidad → resetear contadores.
        stallLastTime = t;
        lastPlayingPos = t; // posición segura para volver si un seek futuro se traba
        stallStuckSince = 0;
        stallRecoveries = 0;
        return;
      }
      // En play pero sin avanzar → cronometrar cuánto lleva trabado.
      if (stallStuckSince === 0) {
        stallStuckSince = Date.now();
        return;
      }
      // Tras un seek reciente, recuperar más rápido (es donde más se notaba el "pegado").
      // Backoff por cada recuperación previa: darle tiempo al transcoder a alcanzar el
      // tramo en vez de recargar (reiniciar) una y otra vez → menos caídas al iframe.
      const recentSeek = lastSeekAt > 0 && Date.now() - lastSeekAt < SEEK_RECENT_WINDOW_MS;
      const base = recentSeek ? STALL_RECOVER_SEEK_MS : STALL_RECOVER_MS;
      const threshold = base + stallRecoveries * STALL_BACKOFF_MS;
      if (Date.now() - stallStuckSince >= threshold) {
        void runStallRecovery(video, myGen);
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  // ── Carga DASH vía Shaka (líneas ~7966-8023) ────────────────────────────
  async function loadDashViaShaka(params: {
    video: HTMLVideoElement;
    url: string;
    isBadAudio: boolean;
    hasNativeSpanish: boolean;
    spanishTrackName: string | null;
    myGen: number;
  }) {
    const { video, url, isBadAudio, hasNativeSpanish, spanishTrackName, myGen } = params;
    let started = false;
    scheduleLoadingMessages(isBadAudio, () => started);

    const onPlaying = () => {
      if (started) return;
      if (video.currentTime > PLAYBACK_STARTED_THRESHOLD_SEC) {
        started = true;
        clearMsgTimers();
        video.removeEventListener('timeupdate', onPlaying);
        opts.onStarted();
      }
    };
    video.addEventListener('timeupdate', onPlaying);

    const watchdog = setTimeout(() => {
      if (!started) {
        clearMsgTimers();
        video.removeEventListener('timeupdate', onPlaying);
        _shakaDestroy();
        if (playerStore.isStale(myGen)) return;
        opts.onToast('⚡ RD DASH tardó demasiado — cambiando de reproductor');
        opts.onFallbackToNextSource();
      }
    }, SHAKA_WATCHDOG_MS);
    const clearWatchdogIfStarted = () => {
      if (started) clearTimeout(watchdog);
    };
    video.addEventListener('timeupdate', clearWatchdogIfStarted);

    try {
      // Movido DENTRO del try (2026-07-05): loadShakaIfNeeded ahora puede rechazar (timeout
      // 15s si el CDN no responde). Antes de este fix, si el script fallaba, la promesa
      // NUNCA se resolvía y el reproductor quedaba colgado para siempre "cargando" (bug real
      // en TV). Ahora el rechazo cae en el catch de abajo, que ya sabe avisar y cambiar de
      // reproductor.
      await loadShakaIfNeeded();
      await _shakaLoad(video, url);
      if (hasNativeSpanish) opts.onNativeSpanishDetected?.();
      spanishTrack.value = spanishTrackName;
      activeTrack.value = spanishTrackName ?? 'eng1';
      video.play().catch(() => {});
      // Vigilar stalls a mitad de reproducción (pausa larga → URL RD caducada, o seek).
      // ⚠️ ORDEN: `startStallMonitor` llama internamente a `clearStallMonitor()`, que pone
      // `currentDashUrl = null`. Por eso `currentDashUrl` se asigna DESPUÉS del start (si se
      // asigna antes, queda en null → `recoverDash` falla con "sin DASH url" → iframe).
      startStallMonitor(video, myGen, recoverDash);
      currentDashUrl = url;
    } catch (e) {
      console.warn('[SHAKA] Error DASH:', e);
      clearMsgTimers();
      clearTimeout(watchdog);
      video.removeEventListener('timeupdate', onPlaying);
      video.removeEventListener('timeupdate', clearWatchdogIfStarted);
      _shakaDestroy();
      if (playerStore.isStale(myGen)) return;
      opts.onToast('⚡ DASH falló — cambiando de reproductor');
      opts.onFallbackToNextSource();
    }
  }

  // ── Carga HLS vía hls.js (líneas ~8024-8134) ────────────────────────────
  async function loadHlsTranscoded(params: {
    video: HTMLVideoElement;
    url: string;
    isBadAudio: boolean;
    streamFilename: string | null;
    myGen: number;
  }) {
    const { video, url, isBadAudio, myGen } = params;
    const w = window as unknown as {
      hlsInstance?: { destroy(): void } | null;
      Hls?: new (cfg: unknown) => HlsInstanceLike;
    };
    interface HlsInstanceLike {
      loadSource(u: string): void;
      attachMedia(v: HTMLVideoElement): void;
      destroy(): void;
      startLoad(startPosition?: number): void;
      stopLoad?(): void;
      on(ev: string, cb: (...args: unknown[]) => void): void;
    }

    if (w.hlsInstance) {
      w.hlsInstance.destroy();
      w.hlsInstance = null;
    }

    try {
      await loadHlsIfNeeded();
    } catch (e) {
      // loadHlsIfNeeded ahora puede rechazar (timeout 15s si el CDN no responde). Manejo
      // LOCAL (esta función no tenía try/catch propio) — mismo patrón que el "no soportado"
      // de abajo: avisar y cambiar de reproductor en vez de dejar la excepción sin capturar.
      console.warn('[RD] HLS.js no cargó:', e);
      if (playerStore.isStale(myGen)) return;
      opts.onToast('⚡ RD: HLS no disponible — cambiando de reproductor');
      opts.onFallbackToNextSource();
      return;
    }
    const HlsCtor = (window as unknown as { Hls?: { new (cfg: unknown): HlsInstanceLike; isSupported(): boolean; Events: Record<string, string>; ErrorTypes: Record<string, string> } }).Hls;

    if (HlsCtor && HlsCtor.isSupported()) {
      const hls = new HlsCtor(HLS_CONFIG);
      w.hlsInstance = hls;
      hls.loadSource(url);
      hls.attachMedia(video);

      let started = false;
      scheduleLoadingMessages(isBadAudio, () => started);

      const onReallyPlaying = () => {
        if (started) return;
        if (video.currentTime > PLAYBACK_STARTED_THRESHOLD_SEC) {
          started = true;
          clearMsgTimers();
          video.removeEventListener('timeupdate', onReallyPlaying);
          opts.onStarted();
        }
      };
      video.addEventListener('timeupdate', onReallyPlaying);

      const watchdog = setTimeout(() => {
        if (!started) {
          clearMsgTimers();
          video.removeEventListener('timeupdate', onReallyPlaying);
          if (w.hlsInstance) {
            w.hlsInstance.destroy();
            w.hlsInstance = null;
          }
          if (playerStore.isStale(myGen)) return;
          opts.onToast('⚡ RD tardó demasiado — cambiando de reproductor');
          opts.onFallbackToNextSource();
        }
      }, HLS_WATCHDOG_MS);
      const clearWatchdogIfStarted = () => {
        if (started) clearTimeout(watchdog);
      };
      video.addEventListener('timeupdate', clearWatchdogIfStarted);

      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(HlsCtor.Events.ERROR, (...args: unknown[]) => {
        const data = args[1] as { fatal?: boolean; type?: string } | undefined;
        if (data?.fatal) {
          if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && !started) {
            console.warn('[RD] HLS network error durante transcode, reintentando...');
            try {
              hls.startLoad();
            } catch {
              /* silenciar */
            }
            return;
          }
          clearMsgTimers();
          clearTimeout(watchdog);
          hls.destroy();
          w.hlsInstance = null;
          if (playerStore.isStale(myGen)) return;
          opts.onToast('⚡ RD: error HLS — cambiando de reproductor');
          opts.onFallbackToNextSource();
        }
      });

      // Recuperación de stall/seek también en HLS (antes solo DASH la tenía).
      startStallMonitor(video, myGen, recoverHls(url));
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.play().catch(() => {});
          opts.onStarted();
          // HLS nativo (Safari/iOS): recuperar recargando el src desde la posición.
          startStallMonitor(video, myGen, recoverReloadSrc(url));
        },
        { once: true }
      );
    } else {
      opts.onToast('⚡ RD: HLS no soportado — cambiando de reproductor');
      opts.onFallbackToNextSource();
    }
  }

  // ── Plan B: x265 sin transcode → alternativa H.264 (líneas ~8135-8156) ──
  function loadX265FallbackDirect(video: HTMLVideoElement, fallbackUrl: string, myGen: number) {
    opts.onToast('🔄 x265 sin transcode — probando alternativa H.264...');
    video.src = fallbackUrl;
    video.load();
    const tmo = setTimeout(() => {
      if (video.readyState < 2) {
        video.src = '';
        opts.onToast('⚡ RD: sin compatible — cambiando de reproductor');
        opts.onFallbackToNextSource();
      }
    }, 12000);
    video.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(tmo);
        if (video.duration && isFinite(video.duration) && video.duration <= MIN_VALID_DURATION_SEC) {
          video.src = '';
          opts.onFallbackToNextSource();
          return;
        }
        video.play().catch(() => {});
        opts.onStarted();
        startStallMonitor(video, myGen, recoverReloadSrc(fallbackUrl));
      },
      { once: true }
    );
    video.addEventListener(
      'error',
      () => {
        clearTimeout(tmo);
        video.src = '';
        opts.onFallbackToNextSource();
      },
      { once: true }
    );
  }

  // ── Sin transcode disponible → play directo (líneas ~8157-8178) ─────────
  function loadDirectPlay(video: HTMLVideoElement, streamUrl: string, myGen: number) {
    video.src = streamUrl;
    video.load();
    const tmo = setTimeout(() => {
      if (video.readyState < 2) {
        video.src = '';
        opts.onToast('⚡ RD: no compatible — cambiando de reproductor');
        opts.onFallbackToNextSource();
      }
    }, 10000);
    video.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(tmo);
        if (video.duration && isFinite(video.duration) && video.duration <= MIN_VALID_DURATION_SEC) {
          video.src = '';
          opts.onFallbackToNextSource();
          return;
        }
        video.play().catch(() => {});
        opts.onStarted();
        startStallMonitor(video, myGen, recoverReloadSrc(streamUrl));
      },
      { once: true }
    );
    video.addEventListener(
      'error',
      () => {
        clearTimeout(tmo);
        video.src = '';
        opts.onFallbackToNextSource();
      },
      { once: true }
    );
  }

  // ── Pipeline /t/ — seek universal vía CDN privada de RD ──────────────────────
  // Recarga el MPD en una posición arbitraria. Freeze-frame + mute + loader para
  // UX fluida (congelar el último cuadro, mostrar spinner, silenciar audio durante
  // la recarga de Shaka). Debounce de 300ms + mutex `_tReloading` para evitar que
  // dos seeks simultáneos colisionen (destruyen/recrean Shaka a la vez → error).

  async function tpipelineReloadMpd(video: HTMLVideoElement, t: number) {
    if (!tpipelineState || _tReloading) return;
    const { resolved, audio, myGen } = tpipelineState;
    if (playerStore.isStale(myGen)) return;

    _tReloading = true;
    tpipelineSeeking.value = true;
    video.pause();
    video.muted = true;
    tpipelineOffset.value = t;

    try {
      await pingSeek(resolved.mediaId, t);
      console.warn(`[/t/] Esperando segmento en t=${t}s...`);
      const ready = await waitForSegmentAt(resolved.cdn, resolved.fullPathId, audio, t);
      console.warn(`[/t/] Segmento ${ready ? 'listo' : 'timeout'} en t=${t}s`);

      // BUG CORREGIDO (2026-07-05): este `return` cortaba ANTES de restaurar el audio
      // (el `video.muted = false` de más abajo nunca corría) → el audio quedaba mudo,
      // y como el <video> es el MISMO elemento reusado entre títulos, ese silencio se
      // arrastraba a la SIGUIENTE película (aunque fuera Direct Play). Ahora se restaura
      // el audio ANTES de salir, sea cual sea el motivo de salida.
      if (playerStore.isStale(myGen)) {
        video.muted = false;
        return;
      }

      const mpdUrl = buildMpdUrl(resolved.fullPathId, resolved.cdn, audio, t);
      await _shakaLoad(video, mpdUrl);
      currentDashUrl = mpdUrl;

      video.muted = false;
      await video.play().catch(() => {});
      console.warn(`[/t/] Shaka listo en offset=${t}s`);
    } catch (e) {
      console.warn('[/t/] reloadMpd falló:', e);
      video.muted = false;
    } finally {
      _tReloading = false;
      tpipelineSeeking.value = false;
    }
  }

  async function tpipelineSeekTo(seconds: number) {
    const video = opts.videoRef.value;
    if (!video || !tpipelineState) return;
    const target = Math.max(0, Math.min(Math.floor(seconds), tpipelineDuration.value || 99999));
    const current = tpipelineOffset.value + (video.currentTime || 0);
    if (Math.abs(target - current) < 3) return;
    if (_tReloading) return;

    if (_tSeekTimer) clearTimeout(_tSeekTimer);
    _tSeekTimer = setTimeout(async () => {
      if (_tReloading || !tpipelineState) return;
      console.warn(`[/t/] Seek → t=${target}s`);
      await tpipelineReloadMpd(video, target);
    }, 300);
  }

  /**
   * tryTpipeline — intenta reproducir via pipeline /t/. Devuelve true si tuvo
   * éxito, false si falló (el llamador cae al transcode legacy).
   */
  async function tryTpipeline(params: {
    video: HTMLVideoElement;
    rdId: string;
    myGen: number;
    selected: SelectedStream;
    streamFn: string | null;
    startPositionSec?: number;
  }): Promise<boolean> {
    const { video, rdId, myGen, selected } = params;
    // Si hay "continuar viendo", arrancamos el MPD directo en esa posición; si no,
    // desde t=1 (inicio). Así evitamos reproducir el minuto 0 y recargar luego.
    const startT =
      params.startPositionSec && params.startPositionSec > 30 ? Math.floor(params.startPositionSec) : 1;

    let resolved: TpipelineResolveResult;
    try {
      loadingMessage.value = '🔍 Preparando streaming avanzado...';
      resolved = await resolveTpipeline(rdId);
    } catch (e) {
      console.warn('[/t/] resolve falló → fallback a transcode legacy:', e);
      return false;
    }

    if (playerStore.isStale(myGen)) return true; // stale = no seguir (handled)

    const audio = pickBestAudio(resolved.audioTracks);
    const isSpanish = /lat|spa|es/i.test(audio);

    tpipelineState = { resolved, audio, myGen };
    isTpipeline.value = true;
    tpipelineDuration.value = resolved.duration;
    tpipelineOffset.value = startT;
    activeTrack.value = audio;
    if (isSpanish) {
      spanishTrack.value = audio;
    }

    try {
      loadingMessage.value = '📡 Conectando con el servidor...';
      await loadShakaIfNeeded();

      const mpdUrl = buildMpdUrl(resolved.fullPathId, resolved.cdn, audio, startT);

      await pingSeek(resolved.mediaId, startT);
      const segReady = await waitForSegmentAt(resolved.cdn, resolved.fullPathId, audio, startT, 8000);
      if (!segReady) console.warn('[/t/] Primer segmento timeout — intentando igual');

      if (playerStore.isStale(myGen)) return true;

      await _shakaLoad(video, mpdUrl);
      currentDashUrl = mpdUrl;

      dashBaseUrl.value = `https://${resolved.cdn}/t/${resolved.fullPathId}/`;

      video.muted = false;
      await video.play().catch(() => {});

      const hasNativeSpanish = isSpanish;
      if (hasNativeSpanish) opts.onNativeSpanishDetected?.();
      opts.onStreamReady?.({ selected, hasNativeSpanish, spanishTrack: isSpanish ? audio : null });
      opts.onStarted();

      startStallMonitor(video, myGen, async (v) => {
        if (!tpipelineState) throw new Error('sin /t/ state');
        const pos = Math.max(v.currentTime, lastPlayingPos);
        const t = tpipelineOffset.value + pos;
        await tpipelineReloadMpd(v, t > 3 ? t : 1);
      });

      console.warn(`[/t/] ✅ Pipeline activo — ${resolved.filename} | audio: ${audio} | CDN: ${resolved.cdn}`);
      const isLat = /lat|spa|es/i.test(audio);
      opts.onToast(isLat ? '✅ Seek fluido · Audio Latino' : '✅ Seek fluido');
      return true;
    } catch (e) {
      console.warn('[/t/] carga falló → fallback a transcode legacy:', e);
      isTpipeline.value = false;
      tpipelineState = null;
      _shakaDestroy();
      return false;
    }
  }

  // ── Punto de entrada — equivalente al bloque RD completo (líneas ~7824-8186) ──

  async function loadRdSource(params: {
    id: string | number;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    /**
     * Posición guardada ("continuar viendo"). En el pipeline /t/ se usa para
     * arrancar el MPD DIRECTAMENTE en esa posición (no desde t=1), evitando que
     * el audio del minuto 0 suene de fondo en mobile cuando, al recargar shaka
     * dentro del fullscreen de iOS, el audio inicial no se silencia limpio.
     */
    startPositionSec?: number;
  }) {
    const video = opts.videoRef.value;
    if (!video) return;

    clearStallMonitor(); // cortar cualquier monitor DASH de una reproducción anterior
    cleanupServerTorrent(); // borrar en RD el torrent del título anterior (ADR-006)
    // Reset del estado /t/ AL INICIO: si la reproducción anterior usó pipeline /t/
    // (isTpipeline=true) y esta entra por Direct Play (que retorna antes del reset
    // de más abajo), el seekOverride seguiría creyendo que está en /t/ → el seek
    // nativo nunca se ejecutaría. Limpiarlo acá garantiza estado fresco por carga.
    isTpipeline.value = false;
    tpipelineState = null;
    tpipelineOffset.value = 0;
    tpipelineSeeking.value = false;
    // PROTECCIÓN (2026-07-05): el <video> es el MISMO elemento DOM reusado entre títulos
    // (nunca se recrea). Si algún camino de seek/carga anterior silenció el audio y no
    // llegó a restaurarlo (bug real encontrado: un `return` temprano en tpipelineReloadMpd
    // salteaba el `muted = false`), ese silencio se arrastraba a la SIGUIENTE película. Se
    // fuerza audio SIN silenciar al empezar cada título nuevo, sin importar el motivo.
    video.muted = false;
    const myGen = playerStore.generation; // capturado ANTES del fetch — equiv. `const myGen = ++_playerGen`
    isLoadingRd.value = true;
    loadingMessage.value = '🔍 Buscando en Real-Debrid...';

    let selected: SelectedStream;
    try {
      // SELECCIÓN IDÉNTICA EN TODAS LAS PANTALLAS: se pasa `false` para que TV elija el MISMO
      // stream que desktop → mismo camino (Direct Play / pipeline /t/) → mismo seek fluido.
      // Junto con el fix de AbortSignal.timeout (compatibilidad webOS), esto hace que el seek
      // funcione en TV. NO volver a pasar isTv acá: rompe el seek en TV (probado).
      selected = await opts.rdStreamResolver.getStream(params.id, params.type, params.season, params.episode, false);
    } catch {
      if (playerStore.isStale(myGen)) return;
      clearMsgTimers();
      opts.onToast('⚡ Error con RD — cambiando de reproductor');
      opts.onFallbackToNextSource();
      return;
    }

    if (playerStore.isStale(myGen)) return; // usuario cambió de fuente — ignorar este resultado (línea ~7827)
    clearMsgTimers();

    const { url: streamUrl, rdId, isX265: streamIsX265, fallbackUrl, streamFilename: streamFn } = selected;

    // ── Anime: SIEMPRE usar Anime1V (selector consistente SUB/DUB/HLS) ──
    // Anime1V está hecho para anime: SUB (japonés + subs español) y DUB (latino
    // 🇲🇽) de forma consistente. RD para anime es errático (mayoría raws japoneses).
    if (opts.isAnime?.()) {
      console.warn('[RD] Anime → Anime1V (selector consistente con HLS por defecto)');
      opts.onFallbackToNextSource();
      isLoadingRd.value = false;
      return;
    }

    // ── Resolución SERVER-SIDE (ADR-004): contenido NO cacheado resuelto por la
    //    Netlify Function `rd-stream` → reproducir su DASH/HLS/liveMP4 directo, sin
    //    pasar por el proxy de Torrentio (Range OK, token fuera del cliente). Solo
    //    aplica cuando `rdId` es null y la function devolvió una URL lista. El camino
    //    cacheado (`rdId` presente) NO entra aquí → intacto.
    const serverUrl =
      selected.serverDashUrl || selected.serverHlsUrl || selected.serverLiveMp4Url || selected.serverDirectUrl;
    if (serverUrl) {
      // Recordar el torrent creado por rd-stream para borrarlo al cerrar/cambiar (ADR-006).
      currentServerTorrentId = selected.serverTorrentId ?? null;
      opts.onToast('🔄 Optimizando video para tu navegador...');
      opts.onStreamReady?.({ selected, hasNativeSpanish: false, spanishTrack: null });
      if (selected.serverDashUrl) {
        // DASH → Shaka (multi-audio + Range). Habilita el panel de cambio de audio.
        dashBaseUrl.value = buildDashBaseUrl(selected.serverDashUrl);
        await loadDashViaShaka({
          video,
          url: selected.serverDashUrl,
          isBadAudio: false,
          hasNativeSpanish: false,
          spanishTrackName: null,
          myGen,
        });
      } else if (selected.serverHlsUrl) {
        await loadHlsTranscoded({ video, url: selected.serverHlsUrl, isBadAudio: false, streamFilename: streamFn, myGen });
      } else {
        loadDirectPlay(video, serverUrl, myGen);
      }
      isLoadingRd.value = false;
      return;
    }

    if (!streamUrl) {
      opts.onToast('⚡ Sin resultados en RD — cambiando de reproductor');
      opts.onFallbackToNextSource();
      return;
    }

    // ── Toast informativo "no cacheado" (líneas ~4899-4900 dentro de `rdGetStream`) ──
    // El original lo dispara DESDE `rdGetStream` mismo, antes de retornar — tras
    // agotar la Ronda 3 sin encontrar alternativa reproducible. Es solo informativo:
    // el playback CONTINÚA con `rdId=null` hacia la cascada HEVC/transcode/"bloqueada"
    // (NO cambia de fuente aquí). `selected.unavailableInRd` propaga esa señal desde
    // `resolveActiveStream` (función pura, sin acceso a `showToast`) hasta acá.
    if (selected.unavailableInRd) {
      opts.onToast('⚠️ No disponible en RD — cambiando de reproductor');
      opts.onFallbackToNextSource();
      isLoadingRd.value = false;
      return;
    }

    // ── Toast x265 (línea ~7860) ──
    if (streamIsX265) opts.onToast('🔄 Optimizando video para tu navegador...');

    // ── Detección HEVC nativa + cascada de audio incompatible (líneas ~7864-7877) ──
    // MISMO comportamiento en todas las pantallas: se decide igual que desktop. Junto con el
    // scoring uniforme y el fix de AbortSignal, esto hace que el seek funcione en TV. NO volver
    // a poner `!isTvNow` acá: desviaba el HEVC al transcode y rompía el seek en TV (probado).
    const hevcOk = detectHevcSupport(getMediaSource());
    const { hasBadAudio } = checkBadAudioForDirectPlay(streamFn, !!rdId);

    // ── PLAY DIRECTO (HTTP Range = seek instantáneo, sin transcode) ──────────────────
    // Se intenta para H264 (cualquier device) o HEVC con soporte real (desktop/iOS, NO TV).
    // ⚠️ NO se restringe a contenedor MP4: las versiones CACHEADAS de RD (incluidas MKV)
    // SÍ se reproducen directo (RD las sirve seekables) — restringir a MP4 rompía títulos
    // que antes andaban (La Momia/Michael: su única versión cacheada es MKV). Si el directo
    // falla (p.ej. MKV no soportado), `tryHevcDirectPlay` devuelve false y cae al transcode.
    // El contenedor MP4 ya se prioriza en el SCORING (no hace falta bloquear acá).
    const canTryDirect = (!streamIsX265 || hevcOk) && !hasBadAudio;
    if (canTryDirect) {
      const played = await tryHevcDirectPlay(video, streamUrl, params.startPositionSec);
      if (played) {
        const hasSpaDirect = isDualLatFilename(streamFn);
        opts.onStreamReady?.({ selected, hasNativeSpanish: hasSpaDirect, spanishTrack: null });
        startStallMonitor(video, myGen, recoverReloadSrc(streamUrl));
        opts.onToast(hasSpaDirect ? '✅ Seek fluido · Audio Latino' : '✅ Seek fluido');
        isLoadingRd.value = false;
        return;
      }
      // Directo falló. Si era HEVC sin rdId → contenido bloqueado/no disponible (líneas ~7905-7911).
      // (Para H264 que falla —p.ej. MKV no reproducible directo— simplemente seguimos al transcode.)
      if (streamIsX265 && !rdId) {
        loadingMessage.value = '🚫 Película no disponible — cambiando de reproductor...';
        await new Promise((r) => setTimeout(r, BLOCKED_MESSAGE_WAIT_MS));
        if (playerStore.isStale(myGen)) return;
      }
      // continúa al transcode
    }

    // ── Pipeline /t/ — upgrade transparente (far-seek + AAC para cualquier archivo) ──
    // Se intenta SIEMPRE que haya rdId. Si falla, cae al transcode legacy sin corte.
    if (rdId) {
      isTpipeline.value = false;
      tpipelineState = null;
      const tpipelineOk = await tryTpipeline({ video, rdId, myGen, selected, streamFn, startPositionSec: params.startPositionSec });
      if (tpipelineOk) {
        isLoadingRd.value = false;
        return;
      }
      if (playerStore.isStale(myGen)) return;
      // /t/ falló → seguir al transcode legacy (transparente)
      console.warn('[/t/] Fallback → transcode DASH legacy');
    }

    // ── Transcode vía RD API + probe de audio español (líneas ~7915-7964) ──
    let hlsUrl: string | null = null;
    let hasNativeSpanish = false;
    let detectedSpanishTrack: string | null = null;
    dashBaseUrl.value = null;
    activeTrack.value = 'eng1';
    spanishTrack.value = null;

    if (rdId) {
      try {
        const tcData = await opts.rdClient.fetchTranscode(rdId);
        const dashUrlBase = pickDashUrlFromTranscode(tcData);
        const hlsFallback = pickHlsFallbackFromTranscode(tcData as Parameters<typeof pickHlsFallbackFromTranscode>[0]);

        let finalDashUrl = dashUrlBase;
        const isDualLat = isDualLatFilename(streamFn);

        if (dashUrlBase) {
          // FASE 3 (GENERAL): pedirle a RD las pistas REALES del archivo (mediaInfos) y
          // usar el TOKEN exacto de audio español (ej. 'lat1') → audio nativo en español
          // sin adivinar. Aplica a CUALQUIER título cuyo archivo tenga pista español, no
          // solo a los "Dual-Lat" por nombre. Si el archivo no tiene español (ej. La Momia
          // Dr4gon = ita/eng), devuelve null → queda en inglés + subtítulo (OpenSubtitles).
          let token: string | null = null;
          try {
            token = pickSpanishAudioToken(parseMediaInfos(await opts.rdClient.fetchMediaInfos(rdId)));
          } catch {
            token = null;
          }
          if (token) {
            const url = buildSpanishTrackUrl(dashUrlBase, token);
            if (url) {
              finalDashUrl = url;
              hasNativeSpanish = true;
              detectedSpanishTrack = token;
            }
          } else if (isDualLat) {
            // Fallback: el nombre sugiere Dual-Lat pero mediaInfos no resolvió → sondeo HEAD.
            const probe = await probeSpanishDashTrack(dashUrlBase, fetch);
            finalDashUrl = probe.finalUrl;
            hasNativeSpanish = probe.hasNativeSpanish;
            detectedSpanishTrack = probe.track;
          }
        }

        if (dashUrlBase) dashBaseUrl.value = buildDashBaseUrl(dashUrlBase);

        hlsUrl = finalDashUrl || hlsFallback;
        // NOTA: el player oficial de RD reproduce estos AC3/MKV fluido con `profile=full`
        // (no 720p). Forzar 720p ROMPÍA la reproducción → se usa la calidad original `full`
        // que devuelve el transcode (la receta que RD mismo usa).
      } catch (e) {
        hlsUrl = null;
        console.log('[RD] Error transcode:', e);
      }
    }

    if (hlsUrl) {
      opts.onStreamReady?.({ selected, hasNativeSpanish, spanishTrack: detectedSpanishTrack });
      if (isDashManifest(hlsUrl)) {
        await loadDashViaShaka({
          video,
          url: hlsUrl,
          isBadAudio: hasBadAudio,
          hasNativeSpanish,
          spanishTrackName: detectedSpanishTrack,
          myGen,
        });
      } else {
        await loadHlsTranscoded({ video, url: hlsUrl, isBadAudio: hasBadAudio, streamFilename: streamFn, myGen });
      }
    } else if (streamIsX265 && fallbackUrl) {
      loadX265FallbackDirect(video, fallbackUrl, myGen);
    } else {
      loadDirectPlay(video, streamUrl, myGen);
    }

    isLoadingRd.value = false;
  }

  // ── Switching de pista de audio en el panel de ajustes ───────────────────
  // Preserva `spSwitchAudio` COMPLETO (líneas ~4324-4426): mutex anti-doble-click,
  // toasts de progreso, overlay de carga con mensajes escalonados, watchdog de
  // 90s que revierte a la pista anterior si el transcode en frío no arranca, y
  // re-enganche de subtítulos según el idioma resultante (delegado al llamador
  // vía `onAudioTrackChanged`, que conoce `subtitles`/`streamImdbId`).
  let switchingAudio = false; // equivalente a `_switchingAudio` (línea ~4324)

  function buildAudioSwitchTimeline(): [number, string][] {
    // Preserva `_msgs` EXACTO (líneas ~4356-4361) — distinto del timeline de
    // `buildLoadingMessageTimeline` (ese es para la carga inicial del stream).
    return [
      [3000, '⏳ El servidor está preparando el audio...'],
      [10000, '🎬 Transcodificando audio (puede tardar)...'],
      [25000, '⚙️ Aún procesando, casi listo...'],
      [50000, '⏱️ Transcode en frío — un poco más...'],
    ];
  }

  async function switchAudioTrack(track: string) {
    const video = opts.videoRef.value;
    if (!video || !dashBaseUrl.value || track === activeTrack.value) return;
    if (switchingAudio) {
      opts.onToast('⏳ Espera, cambiando audio...');
      return;
    }
    switchingAudio = true;

    const candidateUrl = dashBaseUrl.value + track + '/none/aac/full.mpd';
    const startTime = video.currentTime;
    const isEng = track === 'eng1';
    const prevTrack = (isEng ? spanishTrack.value : 'eng1') ?? 'eng1';

    activeTrack.value = track;
    opts.onToast(isEng ? '🇬🇧 Cambiando a inglés...' : '🇪🇸 Cambiando a español...');

    // Overlay de carga — preserva líneas ~4347-4350
    loadingMessage.value = isEng ? '🇬🇧 Cargando audio en inglés...' : '🇪🇸 Cargando audio en español...';
    opts.onAudioSwitchStart?.();

    let started = false;
    const timers = buildAudioSwitchTimeline().map(([delay, msg]) =>
      setTimeout(() => {
        if (!started) loadingMessage.value = msg;
      }, delay)
    );
    const clearAudioTimers = () => timers.forEach(clearTimeout);

    // Detectar reproducción real — preserva `_onAdvance` (líneas ~4366-4374)
    const onAdvance = () => {
      if (video.currentTime > 0.15 && !video.paused) {
        started = true;
        clearAudioTimers();
        opts.onAudioSwitchEnd?.();
        video.removeEventListener('timeupdate', onAdvance);
        clearTimeout(failWatchdog);
      }
    };
    const tryPlay = () => video.play().catch(() => {});

    // Watchdog de fallo: si tras 90s no arrancó → revertir — preserva líneas ~4378-4388
    const failWatchdog = setTimeout(() => {
      if (!started) {
        clearAudioTimers();
        video.removeEventListener('timeupdate', onAdvance);
        opts.onAudioSwitchEnd?.();
        opts.onToast('⚠️ El audio tardó demasiado — volviendo al anterior');
        switchingAudio = false;
        activeTrack.value = prevTrack;
        void switchAudioTrack(track === 'eng1' ? prevTrack : 'eng1'); // revertir
      }
    }, AUDIO_SWITCH_WATCHDOG_MS);

    try {
      // Cargar desde el inicio (RD lo tiene listo); luego saltar a la posición —
      // preserva el comentario y el flujo de líneas ~4391-4404
      await _shakaLoad(video, candidateUrl);
      // Si el monitor de stall está activo, que recargue ESTA pista si hay que recuperar.
      if (stallTimer) currentDashUrl = candidateUrl;
      if (startTime > 3) {
        const seekWhenReady = () => {
          try {
            video.currentTime = startTime;
          } catch {
            /* silenciar — preserva el `catch(e){}` vacío de la línea ~4397 */
          }
          video.removeEventListener('loadeddata', seekWhenReady);
        };
        video.addEventListener('loadeddata', seekWhenReady);
      }
      video.addEventListener('timeupdate', onAdvance);
      video.addEventListener('canplay', tryPlay);
      tryPlay();

      opts.onAudioTrackChanged?.(isEng);
      opts.onToast(isEng ? '🇬🇧 Audio en inglés' : '🇪🇸 Audio en español');
    } catch (e) {
      console.warn('[SHAKA] Error cambiando de pista de audio:', e);
      clearAudioTimers();
      clearTimeout(failWatchdog);
      opts.onAudioSwitchEnd?.();
      opts.onToast('⚠️ Error al cambiar audio — intenta de nuevo');
      activeTrack.value = prevTrack;
    } finally {
      switchingAudio = false;
    }
  }

  function destroy() {
    // CRÍTICO: pausar y vaciar el <video>. Un <video> que quedó reproduciendo sigue
    // sonando (audio) aunque se quite del DOM hasta hacer pause() explícito → era el
    // "se escucha el sonido aunque volví al menú".
    const v = opts.videoRef.value;
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch {
        /* silenciar */
      }
    }
    clearMsgTimers();
    clearStallMonitor();
    cleanupServerTorrent(); // borrar en RD el torrent activo al cerrar (ADR-006)
    isTpipeline.value = false;
    tpipelineSeeking.value = false;
    tpipelineState = null;
    tpipelineOffset.value = 0;
    if (_tSeekTimer) { clearTimeout(_tSeekTimer); _tSeekTimer = null; }
    _tReloading = false;
    _shakaDestroy();
    const w = window as unknown as { hlsInstance?: { destroy(): void } | null };
    if (w.hlsInstance) {
      w.hlsInstance.destroy();
      w.hlsInstance = null;
    }
  }

  return {
    loadingMessage,
    isLoadingRd,
    dashBaseUrl,
    activeTrack,
    spanishTrack,
    loadRdSource,
    switchAudioTrack,
    destroy,
    isTpipeline,
    tpipelineDuration,
    tpipelineOffset,
    tpipelineSeeking,
    tpipelineSeekTo,
  };
}
