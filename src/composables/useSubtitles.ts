/**
 * useSubtitles — orquestación del overlay de subtítulos + búsqueda en
 * OpenSubtitles + crowdsourcing de offset.
 *
 * Capa de ORQUESTACIÓN sobre `services/subtitles.ts` (parseo/scoring/keys,
 * ya puro y testeado). Reemplaza el bloque OPENSUBTITLES completo de
 * assets/index.html (líneas ~4922-5359): `_injectSubtitle`,
 * `fetchAndInjectSubtitle`, `_adjustSubOffset`, `_clearSubOverlay`,
 * `_renderSubStatus`.
 *
 * ⚠️ Esta capa toca DOM (overlay que se mueve con fullscreen, eventos
 * `timeupdate`/`seeking`/`seeked`/`fullscreenchange`) y red (OpenSubtitles +
 * Netlify Functions `subhash`/`offset`) — no es testeable con Vitest puro.
 * El "cómo elegir el subtítulo" y "cómo parsear/convertir" SÍ lo es y ya
 * tiene 26 tests en `subtitles.test.ts`; aquí solo se orquesta.
 *
 * GANANCIA REAL vs el original: en Vue, el overlay deja de ser
 * `getElementById('subOverlay')` + `innerHTML` manual — pasa a ser un
 * `<SubtitleOverlay>` reactivo que recibe `activeCue` como prop. Este
 * composable expone exactamente ese dato (`activeCueText`) en vez de pintar
 * HTML — la Fase 4 (componentes UI) solo necesita renderizarlo.
 */

import { ref, shallowRef, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import {
  parseSrt,
  findActiveCue,
  buildOffsetStorageKey,
  buildSubImdbId,
  deriveVideoHints,
  pickBestSubtitle,
  rankSubtitles,
  scoreSubtitle,
  buildReleaseName,
  numericImdbId,
  isSubtitleValid,
  MAX_DOWNLOAD_ATTEMPTS,
  type SubtitleCue,
} from '../services/subtitles';
import { safeStorage } from '../services/safeStorage';
import type { OpenSubtitle } from '../types';

const OS_KEY = 'BkJDwe4rThVSR3XRJ0F4Lhnn5loX6pYl';
const OS_UA = 'MaldoxFilm v1.0';
const OS_BASE = 'https://api.opensubtitles.com/api/v1/subtitles';

export interface UseSubtitlesOptions {
  /** Ref al elemento <video> activo. */
  videoRef: Ref<HTMLVideoElement | null | undefined>;
  /** Inyectable para tests — por defecto `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Override de tiempo (seg). Pipeline /t/: offset + currentTime. */
  timeOverride?: () => number | null;
}

export interface UseSubtitlesReturn {
  /** Texto del cue activo en el `currentTime` actual (o '' si no hay). Reactivo — listo para `<SubtitleOverlay :text="activeCueText" />`. */
  activeCueText: Ref<string>;
  /** Estado para el indicador "🔍 Buscando..." / "✅ ES | offset: Xs" / "❌ Sin subtítulos". */
  status: Ref<string>;
  /** ¿Subtítulos activados? (toggle del usuario). */
  enabled: Ref<boolean>;
  /** Offset actual en ms (positivo = adelantar). */
  offsetMs: Ref<number>;
  /**
   * ¿Ya se cargó un .srt para el stream activo? Preserva el guard `!_subSrtRaw`
   * que usa `spSetSubs`/`spSwitchAudio` (líneas ~4451/~4408) para decidir si
   * vale la pena re-disparar `fetchAndInject` al reactivar subtítulos o cambiar
   * de pista de audio (evita búsquedas duplicadas cuando ya hay un .srt listo).
   */
  hasSubtitleData: Ref<boolean>;
  /** Busca, puntúa, descarga e inyecta el mejor subtítulo ES disponible. */
  fetchAndInject(params: {
    imdbId: string | null;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    streamFilename: string | null;
    infoHash: string | null;
  }): Promise<void>;
  /** Ajusta el offset +/- delta ms, re-renderiza y persiste (local + crowdsourcing). */
  adjustOffset(deltaMs: number): void;
  /** Limpia cues/listeners — llamar al cerrar el reproductor. */
  clear(): void;
  /**
   * Cues parseados (con offset aplicado). Reactivo. Lo consume `VideoPlayer`
   * SOLO en móvil para construir un TextTrack nativo que iOS muestra en el
   * fullscreen nativo del <video> (el overlay DOM no es visible ahí).
   */
  cues: Ref<SubtitleCue[]>;
}

export function useSubtitles(opts: UseSubtitlesOptions): UseSubtitlesReturn {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const activeCueText = ref('');
  const status = ref('');
  const enabled = ref(true);
  const offsetMs = ref(0);

  const cues = shallowRef<SubtitleCue[]>([]);
  const srtRaw = ref<string | null>(null);
  let subImdbId: string | null = null;
  let subFileId: number | null = null;
  let subInfoHash: string | null = null;
  // Cancela los fetch de subtítulo en vuelo (OpenSubtitles/subhash/offset/descarga)
  // si se cierra el player o se cambia de película antes de que terminen.
  let activeAbort: AbortController | null = null;

  // ── Render reactivo del cue activo (reemplaza `_subTimeUpdate` + innerHTML manual) ──
  function renderAtCurrentTime() {
    const video = opts.videoRef.value;
    if (!video || !enabled.value) {
      activeCueText.value = '';
      return;
    }
    const ov = opts.timeOverride?.();
    const tMs = (ov != null ? ov : video.currentTime) * 1000;
    const cue = findActiveCue(cues.value, tMs);
    // ⚠️ SEGURIDAD: el original convertía '\n' → '<br>' y volcaba el resultado
    // con `innerHTML` (luego replicado aquí como `v-html`). El texto del cue
    // viene de archivos .srt DESCARGADOS DE OPENSUBTITLES — contenido de red
    // no confiable. `parseSrt` ya limpia tags con una regex (`<[^>]+>`), pero
    // el sanitizado de HTML por regex es un anti-patrón conocido (bypasses de
    // "mutation XSS"/parsers diferenciales — ver OWASP). Para eliminar esa
    // superficie por completo, NO se inyecta HTML: se deja el '\n' tal cual y
    // <SubtitleOverlay> lo renderiza con interpolación de texto plano +
    // `white-space: pre-line` (CSS puro, sin parseo de markup).
    activeCueText.value = cue ? cue.text : '';
  }

  let timeUpdateHandler: (() => void) | null = null;
  let seekingHandler: (() => void) | null = null;

  function attachVideoListeners() {
    const video = opts.videoRef.value;
    if (!video) return;
    detachVideoListeners();
    timeUpdateHandler = renderAtCurrentTime;
    seekingHandler = () => {
      activeCueText.value = '';
    };
    video.addEventListener('timeupdate', timeUpdateHandler);
    video.addEventListener('seeked', timeUpdateHandler);
    video.addEventListener('seeking', seekingHandler);
  }

  function detachVideoListeners() {
    const video = opts.videoRef.value;
    if (!video) return;
    if (timeUpdateHandler) {
      video.removeEventListener('timeupdate', timeUpdateHandler);
      video.removeEventListener('seeked', timeUpdateHandler);
    }
    if (seekingHandler) video.removeEventListener('seeking', seekingHandler);
    timeUpdateHandler = null;
    seekingHandler = null;
  }

  // ── Inyección — reemplaza `_injectSubtitle` (líneas ~5117-5190) ──────────
  // En el original esto creaba/movía un <div id="subOverlay"> según
  // fullscreen. En Vue, ese trabajo lo hace `<SubtitleOverlay>` reactivamente
  // (Fase 4) — aquí solo parseamos y dejamos los cues listos.
  function inject(srt: string, offset: number) {
    srtRaw.value = srt;
    offsetMs.value = offset;
    cues.value = parseSrt(srt, offset);
    // Log de diagnóstico — preserva índex.html línea 5123 (1:1).
    console.warn(
      '[SUB] Cues parseados:',
      cues.value.length,
      '| primer cue en:',
      (cues.value[0]?.s != null ? cues.value[0].s / 1000 : NaN).toFixed(1),
      's'
    );
    attachVideoListeners();
    renderAtCurrentTime();
    // ⚠️ PRESERVAR 1:1 — el original SIEMPRE termina `_injectSubtitle` con el
    // literal `_renderSubStatus('✅ ES | offset: 0s')` (índex.html línea 5189),
    // SIN usar el parámetro `offsetMs` recibido — incluso cuando se inyecta con
    // un offset guardado no-cero (p.ej. `fetchAndInjectSubtitle` → línea 5354
    // pasa `_subOffsetMs`). Es un punto ciego cosmético del original (siempre
    // muestra "0s" justo tras inyectar) que NO se debe "arreglar" aquí — solo
    // `_adjustSubOffset` (→ `adjustOffset` abajo) calcula y muestra el label real.
    status.value = '✅ ES | offset: 0s';
  }

  // ── Ajuste de offset — reemplaza `_adjustSubOffset` (líneas ~5192-5212) ──
  function adjustOffset(deltaMs: number) {
    if (!srtRaw.value) {
      status.value = 'Sin subtítulos cargados';
      return;
    }
    const next = offsetMs.value + deltaMs;
    inject(srtRaw.value, next);
    const sign = next >= 0 ? '+' : '';
    const label = sign + (next / 1000).toFixed(1) + 's';
    status.value = `✅ ES | offset: ${label}`;

    if (subImdbId) {
      const key = 'sub_off_' + (subImdbId.includes('.') ? subImdbId.replace(/\.[^.]+$/, '') : subImdbId);
      safeStorage.setItem(key, String(next));
    }
    if (subInfoHash && subFileId) {
      fetchImpl('/.netlify/functions/offset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoHash: subInfoHash, fileId: subFileId, offset: next }),
      }).catch(() => {});
    }
  }

  // ── Búsqueda + scoring + descarga — reemplaza `fetchAndInjectSubtitle`
  // (líneas ~5226-5359). Cascada EXACTA preservada: query por release →
  // fallback por IMDB ID → scoring → crowdsourcing offset → descarga con
  // hasta MAX_DOWNLOAD_ATTEMPTS reintentos validando cues >= MIN_VALID_CUES.
  async function fetchAndInject(params: {
    imdbId: string | null;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    streamFilename: string | null;
    infoHash: string | null;
  }) {
    status.value = '🔍 Buscando subtítulos ES...';
    const { imdbId, type, season, episode, streamFilename, infoHash } = params;

    activeAbort?.abort(); // cancelar una búsqueda anterior en vuelo (cambio de peli)
    const ac = new AbortController();
    activeAbort = ac;
    const signal = ac.signal;

    subImdbId = buildSubImdbId(infoHash, streamFilename, imdbId);
    const offKey = buildOffsetStorageKey(infoHash, streamFilename, imdbId);
    const savedOff = safeStorage.getItem(offKey);
    if (savedOff !== null) offsetMs.value = parseInt(savedOff, 10) || 0;
    // Log de diagnóstico — preserva índex.html línea 5234 (1:1).
    if (infoHash) console.warn('[SUB] infoHash:', infoHash, '| offset guardado:', offsetMs.value + 'ms');

    try {
      const numId = numericImdbId(imdbId);
      const headers = { 'Api-Key': OS_KEY, 'User-Agent': OS_UA };
      const releaseName = buildReleaseName(streamFilename);
      let data: { data: OpenSubtitle[] } = { data: [] };

      if (releaseName) {
        try {
          const q1 = `${OS_BASE}?languages=es&query=${encodeURIComponent(releaseName)}&imdb_id=${numId}`;
          const r1 = await fetchImpl(q1, { headers, signal }).then((r) => r.json());
          // Log de diagnóstico — preserva índex.html línea 5247 (1:1).
          console.warn('[SUB] Búsqueda por release:', r1.total_count, 'resultados');
          if (r1.data?.length) data = r1;
        } catch (e) {
          // Log de diagnóstico — preserva índex.html línea 5249 (1:1).
          console.warn('[SUB] Búsqueda por release falló:', (e as Error)?.message, '— usando IMDB fallback');
        }
      }
      if (!data.data?.length) {
        try {
          const typeQs =
            type === 'tv' ? `&type=episode&season_number=${season}&episode_number=${episode}` : '&type=movie';
          const q2 = `${OS_BASE}?languages=es&imdb_id=${numId}${typeQs}`;
          const r2 = await fetchImpl(q2, { headers, signal }).then((r) => r.json());
          // Log de diagnóstico — preserva índex.html línea 5258 (1:1).
          console.warn('[SUB] Búsqueda por IMDB ID:', r2.total_count, 'resultados');
          data = r2;
        } catch (e) {
          // Log de diagnóstico — preserva índex.html línea 5260 (1:1).
          console.warn('[SUB] Búsqueda por IMDB ID falló:', (e as Error)?.message);
        }
      }
      if (!data.data?.length) {
        status.value = '❌ Sin subtítulos ES';
        return;
      }

      const hints = deriveVideoHints(streamFilename);
      const vidDuration = opts.videoRef.value?.duration || 0;
      const { best, fileId } = pickBestSubtitle(data.data, hints, vidDuration);
      if (!best || !fileId) {
        status.value = '❌ Sin file_id';
        return;
      }
      // Log de diagnóstico — preserva índex.html línea 5312 (1:1).
      console.warn(
        '[SUB] Elegido:',
        best.attributes.release,
        '| score:',
        scoreSubtitle(best, hints, vidDuration),
        '| AI:',
        best.attributes.ai_translated
      );
      subFileId = fileId;
      subInfoHash = infoHash;

      // ⚠️ SEGURIDAD: `infoHash`/`fileId`/`candidateId` van interpolados en
      // querystrings hacia las Netlify Functions `offset`/`subhash`. En la
      // práctica son de bajo riesgo (`infoHash` ya viene validado por
      // `INFOHASH_RE = /[a-f0-9]{40}/i` en streamSelector.ts; los `file_id`
      // de OpenSubtitles son numéricos), pero se aplica `encodeURIComponent`
      // de forma uniforme — igual que ya hacía `releaseName` en la línea de
      // arriba — para no depender de supuestos sobre el formato upstream y
      // evitar inyección de parámetros (`&otherParam=...`) si esos formatos
      // cambiaran alguna vez.
      if (infoHash && fileId) {
        try {
          const shared = await fetchImpl(
            `/.netlify/functions/offset?infoHash=${encodeURIComponent(infoHash)}&fileId=${encodeURIComponent(fileId)}`,
            { signal }
          ).then((r) => r.json());
          if (shared.offset !== null && shared.offset !== undefined) {
            offsetMs.value = shared.offset;
            // Log de diagnóstico — preserva índex.html línea 5322 (1:1).
            console.warn('[SUB] Offset compartido encontrado:', offsetMs.value + 'ms');
          }
        } catch {
          /* no crítico */
        }
      }

      const dlData = await fetchImpl(`/.netlify/functions/subhash?file_id=${encodeURIComponent(fileId)}`, {
        signal,
      }).then((r) => r.json());
      // Log de diagnóstico — preserva índex.html línea 5329 (1:1).
      console.warn('[SUB] Restantes hoy:', dlData.remaining, '| archivo:', dlData.file_name);
      if (!dlData.link) {
        status.value = '❌ Sin link';
        return;
      }

      const ranked = rankSubtitles(data.data, hints, vidDuration);
      let srt: string | null = null;
      for (let attempt = 0; attempt < Math.min(ranked.length, MAX_DOWNLOAD_ATTEMPTS); attempt++) {
        const candidate = ranked[attempt];
        const candidateId = candidate.attributes.files[0]?.file_id;
        if (!candidateId) continue;
        const dl = await fetchImpl(`/.netlify/functions/subhash?file_id=${encodeURIComponent(candidateId)}`, {
          signal,
        }).then((r) => r.json());
        if (!dl.link) continue;
        const raw = await fetchImpl(dl.link, { signal }).then((r) => r.text());
        const parsedCues = parseSrt(raw, 0);
        if (isSubtitleValid(parsedCues)) {
          srt = raw;
          // Log de diagnóstico — preserva índex.html línea 5345 (1:1).
          if (attempt > 0)
            console.warn('[SUB] Reintento', attempt, '→', candidate.attributes.release, '| cues:', parsedCues.length);
          subFileId = candidateId;
          break;
        }
        // Log de diagnóstico — preserva índex.html línea 5349 (1:1).
        console.warn('[SUB] Descartado (solo', parsedCues.length, 'cues):', candidate.attributes.release);
      }
      if (!srt) {
        status.value = '❌ Sin subtítulo válido';
        return;
      }

      inject(srt, offsetMs.value);
    } catch (e) {
      // Cancelado al cerrar/cambiar de peli → no es un error real (no loguear ni
      // pisar el status, que ya pertenece a la búsqueda nueva).
      if (signal.aborted || (e as Error)?.name === 'AbortError') return;
      // Log de diagnóstico — preserva índex.html línea 5356 (1:1).
      console.warn('[SUB] Error:', e);
      status.value = '❌ Error cargando subtítulos';
    }
  }

  function clear() {
    activeAbort?.abort(); // cancelar fetches de subtítulo en vuelo
    activeAbort = null;
    detachVideoListeners();
    cues.value = [];
    activeCueText.value = '';
    srtRaw.value = null;
    subImdbId = subFileId = subInfoHash = null;
    offsetMs.value = 0;
  }

  // Re-engancha listeners si el <video> cambia de instancia (nueva fuente).
  watch(opts.videoRef, () => {
    if (cues.value.length) attachVideoListeners();
  });

  onBeforeUnmount(clear);

  const hasSubtitleData = computed(() => srtRaw.value !== null);

  return { activeCueText, status, enabled, offsetMs, hasSubtitleData, fetchAndInject, adjustOffset, clear, cues };
}
