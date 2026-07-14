/**
 * playback — la lógica de DECISIÓN (pura, testeable) detrás de la carga del
 * stream RD: detección HEVC nativa, detección de audio incompatible, probing
 * de pista en español (DASH), y los timelines de mensajes de "cargando".
 *
 * Extraído de la sección RD de `loadPlayerSource` (líneas ~7860-8135 de
 * assets/index.html). Esta función es ENORME y mezcla decisión con DOM/red/
 * HLS/Shaka — aquí se separa SOLO la parte que se puede expresar como
 * función pura de sus entradas, para que `composables/usePlayer.ts` (capa de
 * orquestación, no testeable sin un browser real) la consuma sin duplicar
 * regex/umbrales/configuración.
 *
 * NO se "simplifica" nada: cada constante, regex y cascada se preserva con
 * su valor y orden EXACTOS del original, documentando la línea de origen.
 */

// ── Detección de soporte HEVC nativo del navegador (línea ~7864-7868) ────────
export interface MediaSourceLike {
  isTypeSupported(type: string): boolean;
}

const HEVC_MIME_TYPES = [
  'video/mp4; codecs="hev1.1.6.L93.B0"',
  'video/mp4; codecs="hvc1"',
  'video/mp4; codecs="hev1"',
];

/**
 * detectHevcSupport — Chrome 107+ en Mac/Win con GPU moderna puede decodificar
 * h265 nativamente sin pasar por el transcode de RD. Preservado de la
 * condición `typeof MediaSource !== 'undefined' && (... || ... || ...)`.
 * Se recibe `MediaSource` como parámetro (en vez de leer el global) para
 * poder testear ambas ramas (soportado / no soportado / inexistente).
 */
export function detectHevcSupport(mediaSource: MediaSourceLike | undefined | null): boolean {
  if (!mediaSource) return false;
  return HEVC_MIME_TYPES.some((mime) => mediaSource.isTypeSupported(mime));
}

// ── Detección de audio incompatible con reproducción directa (línea ~7873-7877)
// NOTA: esta regex NO es idéntica a `BAD_AUDIO_RE` de streamSelector.ts — el
// original la redefine localmente con dos diferencias deliberadas: agrega
// `\bdd5\.1\b` y `\bmp2\b`. Se preserva la regex EXACTA de esta sección, tal
// como aparece en el código fuente, sin unificarla con la otra (eso sería
// "simplificar lógica" — ambas regex conviven en el original).
// (Agregado deliberado posterior a la migración: `\bsurround\b` — caso "A3 Alien
// 1080p Surround.mp4": MP4 H264 que reproducía VIDEO pero sin audio, porque el
// "Surround" es multicanal NO-AAC (AC3/DTS). Marcarlo manda a transcode → con audio.)
export const DIRECT_PLAY_BAD_AUDIO_RE =
  /\bac3\b|\bac-3\b|\bdts\b|\btruehd\b|\batmos\b|\bdd5\.1\b|\bdd[\d\+]|\bddp\b|\bflac\b|\bpcm\b|\bmp2\b|\bsurround\b/i;

export interface BadAudioCheckResult {
  hasBadAudioExplicit: boolean;
  isMkvNoAac: boolean;
  hasBadAudio: boolean;
}

/**
 * checkBadAudioForDirectPlay — replica la cascada exacta:
 *   _hasBadAudioExplicit = <regex de audio conocido incompatible>
 *   _isMkvNoAac          = es .mkv Y no declara AAC explícito (riesgo)
 *   _hasBadAudio         = explícito || (mkv-sin-aac && hay rdId)
 *                          ("si tenemos rdId, es más seguro usar transcode
 *                          que adivinar" — comentario original línea ~7875)
 */
export function checkBadAudioForDirectPlay(streamFilename: string | null, hasRdId: boolean): BadAudioCheckResult {
  const low = (streamFilename || '').toLowerCase();
  const hasBadAudioExplicit = DIRECT_PLAY_BAD_AUDIO_RE.test(low);
  const isMkvNoAac = low.includes('.mkv') && !/\baac\b/i.test(low);
  return {
    hasBadAudioExplicit,
    isMkvNoAac,
    hasBadAudio: hasBadAudioExplicit || (isMkvNoAac && hasRdId),
  };
}

/**
 * MIN_VALID_DURATION_SEC — duración mínima para aceptar un direct-play HEVC
 * como "reprodujo de verdad" y no un manifest vacío/trailer. Preservado de
 * la línea ~7886: `video.duration > 35`.
 */
export const MIN_VALID_DURATION_SEC = 35;

/**
 * HEVC_DIRECT_PLAY_TIMEOUT_MS — tiempo máximo esperando `loadedmetadata`
 * antes de abortar el intento directo. Preservado de la línea ~7881: 10000.
 */
export const HEVC_DIRECT_PLAY_TIMEOUT_MS = 10000;

/**
 * BLOCKED_MESSAGE_WAIT_MS — espera tras mostrar el mensaje de "bloqueado en
 * RD" antes de cambiar de fuente, para que el usuario pueda leerlo.
 * Preservado de la línea ~7909: 4000.
 */
export const BLOCKED_MESSAGE_WAIT_MS = 4000;

// ── Detección de pista de audio en español (Dual/Latino/...) ────────────────
// Reutiliza exactamente la misma regex que `_initAudioSelector` (línea ~5006)
// y el chequeo `_hasSpaDirect`/`_isDualLat` (líneas ~7900, ~7932) —
// ya extraída como `isDualLatFilename` en realdebrid.ts para no duplicarla.
export { isDualLatFilename } from './realdebrid';

// ── Probing de pista en español dentro del manifest DASH ─────────────────────
/**
 * SPANISH_TRACK_CANDIDATES — orden de prueba de tracks de audio en español.
 * Preservado de la línea ~7940: ['spa1','lat1','spa2','lat2'].
 */
export const SPANISH_TRACK_CANDIDATES = ['spa1', 'lat1', 'spa2', 'lat2'] as const;

const DASH_TRACK_SEGMENT_RE = /\/([^/]+)(\/[^/]+\/[^/]+\/full\.mpd)$/;

/**
 * buildSpanishTrackUrl — sustituye el segmento de "track" en una URL DASH
 * base por el candidato dado. Preservado de la línea ~7942:
 *   _dashUrlBase.replace(/\/([^/]+)(\/[^/]+\/[^/]+\/full\.mpd)$/, '/' + track + '$2')
 *
 * Devuelve `null` si la URL no matchea el patrón esperado o si el resultado
 * es idéntico a la base (preserva el `if(_spaUrl === _dashUrlBase) break;`
 * de la línea ~7943 — el llamador debe cortar el loop ante `null`).
 */
export function buildSpanishTrackUrl(dashUrlBase: string, track: string): string | null {
  if (!DASH_TRACK_SEGMENT_RE.test(dashUrlBase)) return null;
  const result = dashUrlBase.replace(DASH_TRACK_SEGMENT_RE, '/' + track + '$2');
  return result === dashUrlBase ? null : result;
}

/**
 * buildDashBaseUrl — la URL base "https://X.../t/ID/" usada para el panel de
 * ajustes de audio (switching). Preservada de la línea ~7959:
 *   _dashUrlBase.replace(/\/([^/]+)(\/[^/]+\/[^/]+\/full\.mpd)$/, '/')
 */
export function buildDashBaseUrl(dashUrlBase: string): string | null {
  if (!DASH_TRACK_SEGMENT_RE.test(dashUrlBase)) return null;
  return dashUrlBase.replace(DASH_TRACK_SEGMENT_RE, '/');
}

/**
 * Calidad de transcode de RD. `full` = resolución original (más pesada → segmentos
 * grandes → seek lento/se cae). Para FLUIDEZ pedimos 720p: segmentos livianos que RD
 * genera/sirve rápido → el seek deja de pegarse en los casos AC3/MKV/HEVC que van a
 * transcode. Tokens reales del endpoint mediaInfos de RD: full | 720p_4mbps | 720p_2mbps
 * | 480p_2mbps | 480p_1mbps.
 */
export const TRANSCODE_QUALITY = '720p_4mbps';
const DASH_QUALITY_SEGMENT_RE = /\/(full|\d+p_\d+mbps)(\.mpd|\.m3u8)(\?|$)/;

/**
 * applyTranscodeQuality — cambia el segmento de calidad de una URL de transcode RD
 * (DASH `.mpd` o HLS `.m3u8`) por la calidad pedida (default 720p). Si la URL no
 * matchea el patrón (p.ej. server-side rd-stream), la devuelve intacta (no-op seguro).
 */
export function applyTranscodeQuality(url: string, quality: string = TRANSCODE_QUALITY): string {
  if (!url) return url;
  return url.replace(DASH_QUALITY_SEGMENT_RE, '/' + quality + '$2$3');
}

// ── Timeline de mensajes de "cargando" durante transcode (DASH y HLS) ────────
export type LoadingMessageEntry = readonly [delayMs: number, message: string];

/**
 * buildLoadingMessageTimeline — el array `[delay, mensaje]` mostrado mientras
 * se espera que el video arranque de verdad. Preservado EXACTO de las líneas
 * ~7972-7982 (Shaka/DASH) y ~8056-8070 (HLS) — ambas listas son IDÉNTICAS
 * en el original salvo por sus nombres de variable, así que se unifican en
 * una sola función parametrizada por `isBadAudio` (las dos entradas que
 * cambian según ese flag, líneas ~7973/8057-8059 y ~7975/8061-8063).
 */
export function buildLoadingMessageTimeline(isBadAudio: boolean): LoadingMessageEntry[] {
  return [
    [0, isBadAudio ? '🔊 Convirtiendo audio a formato compatible...' : '📡 Conectando con el servidor...'],
    [5000, '⏳ Preparando segmentos de video...'],
    [15000, isBadAudio ? '🎬 Transcodeando audio AC3 → AAC (puede tardar)' : '🎬 El servidor está procesando el video...'],
    [30000, '⚙️ Procesando... (~30s transcurridos)'],
    [60000, '⏱️ 1 minuto — transcode en frío, aguanta un poco...'],
    [90000, '⏱️ 1:30 min — casi listo, el servidor sigue procesando...'],
    [120000, '⏱️ 2 min — RD está transcodeando, es normal para este archivo'],
    [180000, '⏱️ 3 min — tomando más tiempo del habitual...'],
    [210000, '⚠️ Últimos 30 segundos antes de cambiar de reproductor'],
  ];
}

/**
 * messageAtElapsed — dado el tiempo transcurrido (ms), devuelve el mensaje
 * vigente según el timeline (el de mayor `delay` que ya se cumplió). Esto
 * formaliza el comportamiento que producían los `setTimeout` encadenados del
 * original — útil para testear el timeline sin temporizadores reales.
 */
export function messageAtElapsed(timeline: LoadingMessageEntry[], elapsedMs: number): string | null {
  let current: string | null = null;
  for (const [delay, msg] of timeline) {
    if (elapsedMs >= delay) current = msg;
    else break;
  }
  return current;
}

/**
 * PLAYBACK_STARTED_THRESHOLD_SEC — umbral de `currentTime` para considerar
 * que el video "realmente" empezó a reproducir (no solo parseó el manifest).
 * Preservado de las líneas ~7989/8082: `video.currentTime > 0.1`.
 */
export const PLAYBACK_STARTED_THRESHOLD_SEC = 0.1;

/**
 * Watchdogs — tiempos máximos de espera antes de cambiar de fuente.
 * Preservados de las líneas ~8005 (Shaka/DASH) y ~8106 (HLS): 240000 (4min).
 */
export const SHAKA_WATCHDOG_MS = 240000;
export const HLS_WATCHDOG_MS = 240000;

// ── Configuración de HLS.js (líneas ~8030-8046) ──────────────────────────────
// "RD puede tardar 30-90s en transcodar 4K en caliente" (comentario línea ~8025)
export const HLS_CONFIG = {
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 90000,
      maxLoadTimeMs: 300000,
      timeoutRetry: { maxNumRetry: 4, retryDelayMs: 2000, maxRetryDelayMs: 10000 },
      errorRetry: { maxNumRetry: 6, retryDelayMs: 2000, maxRetryDelayMs: 10000 },
    },
  },
  manifestLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 60000,
      maxLoadTimeMs: 60000,
      timeoutRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 5000 },
      errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 5000 },
    },
  },
} as const;

/**
 * isManifestUrl / isDashManifest — distinción entre manifest DASH (.mpd → vía
 * Shaka Player) o HLS (.m3u8 → vía hls.js). Preservada de la condición
 * `hlsUrl.includes('.mpd')` (línea ~7967).
 */
export const isDashManifest = (url: string): boolean => url.includes('.mpd');

// ── ADR-009 fix 4 — probe de audio POST-arranque en Direct Play / link crudo ──
// Para candidatos SIN rdId no existe metadata de pistas (mediaInfos requiere un
// downloadId) → la única verificación posible es DESPUÉS de arrancar: Chrome
// expone `video.webkitAudioDecodedByteCount` (bytes de audio decodificados por
// SOFTWARE). Si el video lleva varios segundos avanzando y ese contador sigue en
// 0, el audio existe pero este dispositivo no lo decodifica (caso real "El
// Padrino": AC3 no declarado en el nombre → Direct Play mudo en desktop Chrome).
//
// ⚠️ El PROBE NO corre en TV (gate en usePlayer): la TV decodifica AC3 por
// HARDWARE y el contador de software podría quedar en 0 con audio audible →
// falso positivo que rompería el caso que hoy SÍ funciona en TV.

/** Segundos de reproducción real requeridos antes de dictaminar "mudo". */
export const AUDIO_PROBE_MIN_PLAYED_SEC = 6;

export type AudioProbeVerdict = 'pending' | 'ok' | 'bad' | 'unsupported';

/**
 * evaluateAudioProbe — decisión PURA del probe (testeable sin DOM):
 *   unsupported → el navegador no expone el contador (Safari/Firefox) → no actuar
 *   ok          → ya se decodificaron bytes de audio → todo bien, probe termina
 *   pending     → aún no pasó el mínimo de reproducción → seguir esperando
 *   bad         → pasó el mínimo avanzando y CERO bytes de audio → mudo confirmado
 */
export function evaluateAudioProbe(params: {
  /** `video.webkitAudioDecodedByteCount` (undefined si el navegador no lo expone). */
  decodedBytes: number | undefined;
  /** Segundos acumulados de reproducción REAL (avanzando, sin pausa) desde el arranque. */
  playedSec: number;
  minPlayedSec?: number;
}): AudioProbeVerdict {
  const { decodedBytes, playedSec, minPlayedSec = AUDIO_PROBE_MIN_PLAYED_SEC } = params;
  if (typeof decodedBytes !== 'number') return 'unsupported';
  if (decodedBytes > 0) return 'ok';
  if (playedSec < minPlayedSec) return 'pending';
  return 'bad';
}
