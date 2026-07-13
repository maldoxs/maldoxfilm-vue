/**
 * useNetflixControls — la barra de controles custom estilo Netflix
 * (`#nfControls`) usada SOLO para la fuente Real-Debrid (el `<video>` nativo;
 * los iframes usan sus propios controles).
 *
 * Reemplaza `_nfSetupControls`/`_nfTick`/`_nfFmt`/`nfTogglePlay`/`nfSkip`/
 * `nfSetVolume`/`nfToggleMute`/`_nfUpdateVolIcon`/`_nfSeekClick`/`_nfSeekStart`
 * (líneas ~4039-4210 de assets/index.html).
 *
 * GANANCIA REAL vs el original: en vez de 6 funciones que hacen
 * `getElementById` + mutación manual de `innerHTML`/`style.width`/`textContent`
 * (`_nfOnPlay`/`_nfOnPause`/`_nfTick`/`_nfUpdateVolIcon`), este composable
 * expone estado reactivo puro (`isPlaying`, `progressPct`, `elapsedLabel`,
 * `remainingLabel`, `isMuted`, `volume`) — el componente `<VideoPlayer>`
 * solo necesita interpolarlos en el template; Vue se encarga del DOM.
 *
 * Se preserva el truco de `_nfSeeking` (líneas ~4171/4177): mientras se
 * arrastra/clickea la barra de seek, se "congela" `progressPct` en el valor
 * destino para que `timeupdate` no la haga "parpadear" durante el buffering.
 */

import { ref, onBeforeUnmount, type Ref } from 'vue';

export interface UseNetflixControlsOptions {
  videoRef: Ref<HTMLVideoElement | null | undefined>;
  seekBarRef: Ref<HTMLElement | null | undefined>;
  /** Llamado en cada interacción que debe "resetear" el auto-hide de controles (equiv. `window._nfShowControls`). */
  onInteraction?: () => void;
  /**
   * Duración (seg) de respaldo cuando `video.duration` no es finita (streams transcodeados
   * de RD reportan `Infinity` → la barra/tiempo marcaban 0). Se usa el runtime de TMDB.
   */
  durationFallback?: () => number;
  /**
   * Override de tiempo actual (seg). Cuando está activo, se usa en vez de
   * `video.currentTime` para la barra y los labels. Pipeline /t/: offset + currentTime.
   */
  timeOverride?: () => number | null;
  /**
   * Override de duración total (seg). Pipeline /t/: duración del resolve.
   */
  durationOverride?: () => number | null;
  /**
   * Override de seek. Cuando está activo, se llama en vez de `video.currentTime = target`.
   * Pipeline /t/: recarga el MPD en la posición.
   */
  seekOverride?: (seconds: number) => void;
  /**
   * Override del "final" del buffer (seg, posición ABSOLUTA en la peli). En Direct Play,
   * `video.buffered` ya está en la línea de tiempo real → no hace falta. En /t/, cada
   * recarga del MPD reinicia su propia línea de tiempo en 0 → hay que sumarle el offset
   * (igual que `timeOverride`) para saber hasta dónde real está descargado.
   */
  bufferedEndOverride?: () => number | null;
}

/**
 * SPEEDS — los 5 valores EXACTOS del selector de velocidad Netflix
 * (`.nf-speed-dot`/`.nf-speed-lbl` + `spSetSpeed`, líneas ~3658-3670/4429-4441).
 * El índice dentro de este array determina qué "dot"/label se marca `.active`
 * y el `%` de relleno de `.nf-speed-fill` (`idx / (SPEEDS.length-1) * 100`).
 */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export interface UseNetflixControlsReturn {
  isPlaying: Ref<boolean>;
  isMuted: Ref<boolean>;
  volume: Ref<number>;
  /** Velocidad de reproducción activa — uno de {@link SPEEDS} (preserva `_playerSpeed`, línea ~5000). */
  speed: Ref<number>;
  /** Porcentaje (0-100) de progreso — congelado durante seek manual. */
  progressPct: Ref<number>;
  /** Porcentaje (0-100) de cuánto está descargado/bufferizado por delante — indicador visual
   *  (barra gris) de hasta dónde se puede adelantar sin esperar carga. */
  bufferedPct: Ref<number>;
  /** "0:00" / "1:23:45" — tiempo transcurrido. */
  elapsedLabel: Ref<string>;
  /** "-12:34" estilo Netflix — tiempo restante (formateado, sin signo: el original tampoco lo agrega). */
  remainingLabel: Ref<string>;
  /** Texto del tooltip al hacer hover sobre la barra de seek. */
  tooltipLabel: Ref<string>;
  /** Posición (%) del tooltip sobre la barra. */
  tooltipPct: Ref<number>;
  /**
   * setSpeed — aplica `video.playbackRate` y actualiza `speed` (preserva
   * `spSetSpeed`, línea ~4429-4441 — SIN el toast/clases DOM, que aquí
   * delega el componente de UI, igual que `SubtitleControls.adjust/reset`).
   */
  setSpeed(value: number): void;
  togglePlay(): void;
  skip(seconds: number): void;
  setVolume(val: number): void;
  toggleMute(): void;
  onSeekBarClick(e: MouseEvent): void;
  onSeekBarMouseDown(e: MouseEvent): void;
  onSeekBarMouseMove(e: MouseEvent): void;
  /** Wire/unwire de los listeners del <video> — llamar cuando la fuente cambia (equiv. `_nfSetupControls`/`_nfClearProgress`). */
  attach(): void;
  detach(): void;
  /**
   * resetProgress — pone la barra/labels en 0. Se llama al EMPEZAR a cargar un título nuevo:
   * como el <video> se reusa entre títulos, sin esto la barra mostraría el % viejo (la peli
   * anterior cerca del final = ~100%) hasta que la nueva cargue.
   */
  resetProgress(): void;
}

/** _nfFmt — formato "m:ss" / "h:mm:ss". Preservado EXACTO de la línea ~4119-4124. */
export function formatNfTime(s: number): string {
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  return m + ':' + String(ss).padStart(2, '0');
}

export function useNetflixControls(opts: UseNetflixControlsOptions): UseNetflixControlsReturn {
  const isPlaying = ref(false);
  const isMuted = ref(false);
  const volume = ref(1);
  const speed = ref(1);
  const progressPct = ref(0);
  const bufferedPct = ref(0);
  const elapsedLabel = ref('0:00');
  const remainingLabel = ref('0:00');
  const tooltipLabel = ref('');
  const tooltipPct = ref(0);

  let seeking = false; // equivalente a `_nfSeeking`

  function video(): HTMLVideoElement | null {
    return opts.videoRef.value ?? null;
  }

  /** Duración efectiva: override > real > TMDB fallback. */
  function effDur(vv: HTMLVideoElement): number {
    const ov = opts.durationOverride?.();
    if (ov != null && ov > 0) return ov;
    const d = vv.duration;
    return d && isFinite(d) && d > 0 ? d : opts.durationFallback?.() || 0;
  }

  /** Tiempo actual efectivo: override > video.currentTime. */
  function effTime(vv: HTMLVideoElement): number {
    const ov = opts.timeOverride?.();
    return ov != null ? ov : vv.currentTime;
  }

  /** Posición ABSOLUTA (seg) hasta donde está bufferizado: override (/t/, con offset) >
   *  `video.buffered` nativo (Direct Play, ya en la línea de tiempo real). */
  function effBufferedEnd(vv: HTMLVideoElement): number {
    const ov = opts.bufferedEndOverride?.();
    if (ov != null) return ov;
    try {
      return vv.buffered.length ? vv.buffered.end(vv.buffered.length - 1) : 0;
    } catch {
      return 0;
    }
  }

  // ── Tick — reemplaza `_nfTick` (línea ~4103-4117) ────────────────────────
  function tick() {
    const v = video();
    if (!v) return;
    const t = effTime(v);
    const dur = effDur(v);
    const pct = dur ? (t / dur) * 100 : 0;
    if (!seeking) progressPct.value = pct;
    elapsedLabel.value = formatNfTime(t);
    remainingLabel.value = formatNfTime((dur || 0) - t);
    bufferedPct.value = dur ? Math.min(100, (effBufferedEnd(v) / dur) * 100) : 0;
  }

  const onPlay = () => {
    isPlaying.value = true;
  };
  const onPause = () => {
    isPlaying.value = false;
  };
  const onTick = () => tick();
  // El pipeline /t/ silencia/restaura `video.muted` internamente (durante seek/carga) sin
  // pasar por toggleMute/setVolume → el ícono de volumen quedaba mostrando "mute" aunque el
  // audio sonara. Escuchar 'volumechange' del <video> mantiene el ícono sincronizado con el
  // estado REAL del audio, venga el cambio de donde venga.
  const onVolumeChange = () => syncVolumeState();

  // ── setSpeed — preserva `spSetSpeed` (línea ~4429-4441): aplica
  // `video.playbackRate = speed` y guarda `_playerSpeed`. El toast "⏩ Nx"
  // y el resaltado de dots/labels (`.active`)/relleno de la barra se
  // resuelven en la UI vía `speed`/`SPEEDS` reactivos — no hay `silent` aquí
  // porque el toast vive en el componente (mismo patrón que `SubtitleControls`). ──
  function setSpeed(value: number) {
    const v = video();
    if (v) v.playbackRate = value;
    speed.value = value;
    opts.onInteraction?.();
  }

  // ── togglePlay — línea ~4155-4159 ────────────────────────────────────────
  function togglePlay() {
    const v = video();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  // ── skip — línea ~4160-4187 (preserva el "congelado" de la barra durante el seek) ──
  function skip(seconds: number) {
    const v = video();
    if (!v) return;
    const dur = effDur(v);
    const curTime = effTime(v);
    if (dur) {
      const target = Math.max(0, Math.min(dur, curTime + seconds));
      seeking = true;
      progressPct.value = (target / dur) * 100;
      elapsedLabel.value = formatNfTime(target);
      remainingLabel.value = formatNfTime(dur - target);
      if (opts.seekOverride) {
        opts.seekOverride(target);
        seeking = false;
        tick();
      } else {
        v.currentTime = target;
        const onSeeked = () => {
          seeking = false;
          v.removeEventListener('seeked', onSeeked);
          tick();
        };
        v.addEventListener('seeked', onSeeked);
      }
    } else {
      if (opts.seekOverride) {
        opts.seekOverride(Math.max(0, curTime + seconds));
      } else {
        v.currentTime = Math.max(0, v.currentTime + seconds);
      }
    }
    opts.onInteraction?.();
  }

  // ── volumen — líneas ~4188-4210 ──────────────────────────────────────────
  function syncVolumeState() {
    const v = video();
    if (!v) return;
    isMuted.value = v.muted || v.volume === 0;
    volume.value = v.volume;
  }

  function setVolume(val: number) {
    const v = video();
    if (v) {
      v.volume = val;
      v.muted = val === 0;
    }
    syncVolumeState();
  }

  function toggleMute() {
    const v = video();
    if (!v) return;
    v.muted = !v.muted;
    syncVolumeState();
  }

  // ── seek bar — líneas ~4126-4153 ─────────────────────────────────────────
  function pctFromEvent(e: MouseEvent): number | null {
    const bar = opts.seekBarRef.value;
    const v = video();
    if (!bar || !v || !effDur(v)) return null;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function onSeekBarClick(e: MouseEvent) {
    const v = video();
    const pct = pctFromEvent(e);
    if (v && pct !== null) {
      const target = pct * effDur(v);
      if (opts.seekOverride) {
        opts.seekOverride(target);
      } else {
        v.currentTime = target;
      }
    }
    opts.onInteraction?.();
  }

  let dragMoveHandler: ((ev: MouseEvent) => void) | null = null;
  let dragUpHandler: ((ev: MouseEvent) => void) | null = null;

  function onSeekBarMouseDown(_e: MouseEvent) {
    seeking = true;
    dragMoveHandler = (ev: MouseEvent) => {
      const pct = pctFromEvent(ev);
      if (pct !== null) progressPct.value = pct * 100;
    };
    dragUpHandler = (ev: MouseEvent) => {
      seeking = false;
      onSeekBarClick(ev);
      if (dragMoveHandler) document.removeEventListener('mousemove', dragMoveHandler);
      if (dragUpHandler) document.removeEventListener('mouseup', dragUpHandler);
      dragMoveHandler = dragUpHandler = null;
    };
    document.addEventListener('mousemove', dragMoveHandler);
    document.addEventListener('mouseup', dragUpHandler);
  }

  function onSeekBarMouseMove(e: MouseEvent) {
    const bar = opts.seekBarRef.value;
    const v = video();
    if (!bar || !v || !effDur(v)) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    tooltipLabel.value = formatNfTime(pct * effDur(v));
    tooltipPct.value = pct * 100;
  }

  // ── attach/detach — reemplaza `_nfSetupControls`/`_nfClearProgress` (líneas ~4039-4092) ──
  function attach() {
    const v = video();
    if (!v) return;
    detach();
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTick);
    v.addEventListener('volumechange', onVolumeChange);
    volume.value = v.volume || 1;
    isPlaying.value = !v.paused;
    syncVolumeState();
    // — Velocidad — resetear a 1x al (re)conectar una fuente nueva, en
    // silencio (preserva `spSetSpeed(1, true)` justo antes de `_spShowForRD(true)`,
    // línea ~4269: cada nuevo stream RD arranca en velocidad normal sin toast).
    speed.value = 1;
    v.playbackRate = 1;
    tick();
  }

  function detach() {
    const v = video();
    if (!v) return;
    v.removeEventListener('play', onPlay);
    v.removeEventListener('pause', onPause);
    v.removeEventListener('timeupdate', onTick);
    v.removeEventListener('volumechange', onVolumeChange);
  }

  function resetProgress() {
    seeking = false;
    progressPct.value = 0;
    bufferedPct.value = 0;
    elapsedLabel.value = '0:00';
    remainingLabel.value = '0:00';
  }

  onBeforeUnmount(() => {
    detach();
    if (dragMoveHandler) document.removeEventListener('mousemove', dragMoveHandler);
    if (dragUpHandler) document.removeEventListener('mouseup', dragUpHandler);
  });

  return {
    isPlaying,
    isMuted,
    volume,
    speed,
    progressPct,
    bufferedPct,
    elapsedLabel,
    remainingLabel,
    tooltipLabel,
    tooltipPct,
    setSpeed,
    togglePlay,
    skip,
    setVolume,
    toggleMute,
    onSeekBarClick,
    onSeekBarMouseDown,
    onSeekBarMouseMove,
    resetProgress,
    attach,
    detach,
  };
}
