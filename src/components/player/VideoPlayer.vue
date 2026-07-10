<script setup lang="ts">
/**
 * VideoPlayer — el `<video>` + barra de controles custom estilo Netflix +
 * overlay de carga + overlay de subtítulos, todo orquestado.
 *
 * Reemplaza el núcleo del reproductor (líneas ~3732-3826 de assets/index.html):
 * `#playerFrame`/`#playerVideo`/`#playerLoading`/`#nfControls` + sus paneles.
 * Combina los composables ya escritos:
 *   - `usePlayer`      → carga RD (HEVC/transcode/HLS/Shaka/watchdogs)
 *   - `useSubtitles`   → búsqueda/parseo/overlay de subtítulos
 *   - `useFullscreen`  → fullscreen custom
 *   - `useNetflixControls` → barra de controles (`#nfControls`)
 *
 * GANANCIA REAL vs el original: el árbol de `getElementById`/`innerHTML`/
 * `classList` disperso entre 8 funciones (`_nfSetupControls`, `_injectSubtitle`,
 * `loadPlayerSource`, `enterPlayerFullscreen`, ...) se vuelve un único
 * componente con `<template>` declarativo — el estado vive en los composables,
 * el DOM lo gestiona Vue.
 *
 * Esta vista NO reimplementa la carga de fuentes-iframe (UnlimPlay/vidlink) —
 * eso vive en `PlayerView.vue` (Fase 5), que es quien conoce `playerState`/
 * `SOURCES` y decide cuál `<VideoPlayer>` o `<iframe>` mostrar.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import SubtitleOverlay from './SubtitleOverlay.vue';
import PlayerSettingsPanel from './PlayerSettingsPanel.vue';
import { usePlayer, type UsePlayerReturn } from '../../composables/usePlayer';
import { useSubtitles } from '../../composables/useSubtitles';
import { useFullscreen } from '../../composables/useFullscreen';
import { FULLSCREEN_PATH_D } from '../../services/fullscreen';
import { useNetflixControls, formatNfTime } from '../../composables/useNetflixControls';
import { useToast } from '../../composables/useToast';
import { usePlayerStore } from '../../stores/player';
import { useDeviceStore } from '../../stores/device';
import type { RdStreamResolver } from '../../services/rdStream';
import type { RealDebridClient } from '../../services/realdebrid';

const props = defineProps<{
  rdStreamResolver: RdStreamResolver;
  rdClient: RealDebridClient;
  title: string;
  /** Duración de la peli (seg, de TMDB) — fallback cuando `video.duration` es Infinity (transcode RD). */
  runtimeSec?: number;
  /**
   * Estado del fullscreen DE PÁGINA (el de `PlayerView`, que cubre la flecha "Volver"
   * + topbar). El botón ⛶ de la barra de controles NO usa el fullscreen local de este
   * componente (acotado a su wrapper → escondía la flecha); delega en el de página vía
   * `toggle-fullscreen`. Esta prop solo alimenta el ícono para mantenerlo en sync.
   */
  pageFullscreen?: boolean;
}>();

const emit = defineEmits<{
  (e: 'fallback-to-next-source'): void;
  /** El usuario tocó el ⛶ de la barra → que `PlayerView` togglee su fullscreen de página. */
  (e: 'toggle-fullscreen'): void;
  /**
   * started — el video RD arrancó de verdad (equiv. `hideLoadingAndStart`,
   * línea ~7808). `PlayerView` lo escucha para arrancar `startProgressTracking`/
   * `scheduleAutoNext` — esa orquestación NO vive aquí (ver nota de cabecera:
   * "Esta vista NO reimplementa la carga de fuentes-iframe... eso vive en
   * PlayerView.vue"); este componente solo avisa CUÁNDO arrancó.
   */
  (e: 'started'): void;
  /**
   * native-fullscreen-exit — en mobile el usuario salió del fullscreen nativo
   * de iOS (la ✕ del reproductor a pantalla completa). `PlayerView` lo escucha
   * para CERRAR el reproductor y volver directo al detalle, sin dejarlo en la
   * pantalla negra intermedia.
   */
  (e: 'native-fullscreen-exit'): void;
}>();

const playerStore = usePlayerStore();
const deviceStore = useDeviceStore();
const { show: showToast } = useToast();

const videoRef = ref<HTMLVideoElement | null>(null);
const playerPageRef = ref<HTMLElement | null>(null);
const seekBarRef = ref<HTMLElement | null>(null);
const fullscreenIconRef = ref<HTMLElement | null>(null);
const freezeCanvasRef = ref<HTMLCanvasElement | null>(null);

// ── Subtítulos ──────────────────────────────────────────────────────────────
let _playerRef: UsePlayerReturn | null = null;
const subtitles = useSubtitles({
  videoRef,
  timeOverride: () => {
    if (!_playerRef?.isTpipeline.value) return null;
    const v = videoRef.value;
    return _playerRef.tpipelineOffset.value + (v?.currentTime || 0);
  },
});

// ── Fullscreen custom ────────────────────────────────────────────────────────
const fullscreen = useFullscreen({
  playerPageRef,
  iconRef: fullscreenIconRef,
  isTvMode: () => deviceStore.isTV,
});

// ── Panel de Audio/Subtítulos/Velocidad — estado para `_spInit` (líneas ~4213-4277) ──
// `hasNativeSpanish`/`lastSelectedStream` se capturan en `onStreamReady` (no son
// reactivos en `usePlayer` — solo viajan una vez por stream vía callback, igual
// que `_hasNativeSpanish`/`_hasSpaDirect` globales del original).
const hasNativeSpanish = ref(false);
const lastSelectedStream = ref<{ imdbId: string | null; streamFilename: string | null; infoHash: string | null } | null>(null);
// `_spShowForRD(true)` — los botones CC/Velocidad solo aparecen una vez el
// stream está listo (igual que el original, que los muestra dentro de `_spInit`,
// llamado tras resolver el stream — líneas ~7901/8012/4270).
const audioPanelReady = ref(false);

// ── Carga de stream RD ───────────────────────────────────────────────────────
const player: UsePlayerReturn = usePlayer({
  videoRef,
  rdStreamResolver: props.rdStreamResolver,
  rdClient: props.rdClient,
  // En TV: preferir H264 1080p y tratar HEVC como no soportado (el navegador de la
  // smart-TV no renderiza HEVC por MSE → audio sin imagen, caso Deadpool 4K x265).
  isTv: () => deviceStore.isTV,
  isAnime: () => playerStore.current.isAnime ?? false,
  // ADR-006 — borrar en RD el torrent creado por rd-stream al cerrar/cambiar.
  // sendBeacon sobrevive al cierre/descarga de la página (mejor que fetch aquí).
  serverCleanup: (torrentId: string) => {
    try {
      navigator.sendBeacon(`/.netlify/functions/rd-cleanup?id=${encodeURIComponent(torrentId)}`);
    } catch {
      /* best effort — nunca debe romper el cierre */
    }
  },
  onStarted: () => {
    isLoading.value = false;
    nfControls.attach();
    // Arma el auto-hide de `.nf-controls` (barra de reproducción) apenas arranca el
    // video. Sin esto, `resetControlsAutoHide()` solo se disparaba con un mousemove/
    // interacción posterior — en TV, si el usuario no mueve el control remoto justo
    // después de entrar, la barra quedaba visible para siempre ("se pega").
    resetControlsAutoHide();
    emit('started');
  },
  onToast: (msg) => showToast(msg),
  onNativeSpanishDetected: () => {
    subtitles.enabled.value = false;
    subtitles.status.value = '🔊 Audio en Español';
  },
  onStreamReady: ({ selected, hasNativeSpanish: nativeEs, spanishTrack: detectedTrack }) => {
    hasNativeSpanish.value = nativeEs;
    lastSelectedStream.value = { imdbId: selected.imdbId, streamFilename: selected.streamFilename, infoHash: selected.infoHash ?? null };
    audioPanelReady.value = true;
    // `_subsEnabled = !hasSpanish` — preserva el estado inicial de `_spInit` (línea ~4265):
    // arranca ON salvo que el audio nativo ya sea español.
    subtitles.enabled.value = !nativeEs;
    if (nativeEs) return; // _onVideoStarted no busca subs si el audio nativo ya es ES (línea ~7841-7846)
    if (selected.imdbId) {
      subtitles.fetchAndInject({
        imdbId: selected.imdbId,
        type: playerStore.current.type,
        season: playerStore.current.season,
        episode: playerStore.current.episode,
        streamFilename: selected.streamFilename,
        infoHash: selected.infoHash ?? null,
      });
    }
    void detectedTrack; // las filas de audio leen `player.spanishTrack` directamente (reactivo)
  },
  onFallbackToNextSource: () => emit('fallback-to-next-source'),
  // ── Cambio de pista de audio desde el panel ⚙️ — preserva `spSwitchAudio` (líneas ~4406-4414) ──
  onAudioSwitchStart: () => {
    isLoading.value = true;
  },
  onAudioSwitchEnd: () => {
    isLoading.value = false;
  },
  onAudioTrackChanged: (isEng) => {
    if (isEng) {
      // Volvió a inglés: re-enganchar subs si estaban activos y aún no hay .srt cargado
      if (subtitles.enabled.value && !subtitles.hasSubtitleData.value && lastSelectedStream.value?.imdbId) {
        const s = lastSelectedStream.value;
        subtitles.fetchAndInject({
          imdbId: s.imdbId,
          type: playerStore.current.type,
          season: playerStore.current.season,
          episode: playerStore.current.episode,
          streamFilename: s.streamFilename,
          infoHash: s.infoHash,
        });
      }
    } else {
      // Volvió a español (audio nativo): solo ocultar overlay — preserva
      // `box.innerHTML=''; _spUpdateSubRows(false)` (líneas ~4412-4413). NO se
      // usa `subtitles.clear()`: ese borraría `srtRaw`/`offsetMs` (el original
      // conserva el .srt y el offset cacheados — si el usuario vuelve a inglés,
      // el guard `!_subSrtRaw` evita re-buscar y el offset persiste). Apagar
      // `enabled` ya hace que `renderAtCurrentTime` vacíe `activeCueText` (oculta
      // el overlay) sin tocar `cues`/`srtRaw`/`offsetMs`.
      subtitles.enabled.value = false;
    }
  },
});
_playerRef = player;

// Intención real de mute del usuario, capturada antes de silenciar por seek
// nativo (evita que el audio del nuevo punto suene antes de que cargue la imagen).
let seekMuteRestore: boolean | null = null;
let seekUnmuteTimer: ReturnType<typeof setTimeout> | null = null;

// ── Barra de controles custom (#nfControls) ─────────────────────────────────
const nfControls = useNetflixControls({
  videoRef,
  seekBarRef,
  onInteraction: () => resetControlsAutoHide(),
  durationFallback: () => props.runtimeSec || 0,
  timeOverride: () => {
    if (!player.isTpipeline.value) return null;
    const v = videoRef.value;
    return player.tpipelineOffset.value + (v?.currentTime || 0);
  },
  durationOverride: () => {
    if (!player.isTpipeline.value) return null;
    // BUG encontrado (2026-07-06): si RD no reporta duración para este archivo puntual
    // (mediaInfos.duration=0 — dato faltante de RD, no de nuestro código), esto caía a
    // `video.duration` NATIVO — pero en /t/ el manifest se genera dinámicamente en el
    // offset pedido (`?t=X`) y su duración declarada puede reflejar solo lo que queda
    // desde ahí, NO el total del episodio → la barra salía rota (cerca del 100% al
    // reanudar lejos del inicio). Preferir el runtime de TMDB (confiable) antes que
    // caer al nativo, que no es de fiar en este camino.
    return player.tpipelineDuration.value || props.runtimeSec || null;
  },
  seekOverride: (seconds: number) => {
    if (player.isTpipeline.value) {
      void player.tpipelineSeekTo(seconds);
    } else {
      // Direct Play / transcode legacy: seek nativo (HTTP Range). Silenciar hasta
      // que la imagen esté lista en la nueva posición (`seeked`) para que el audio
      // no suene antes de que cargue el cuadro.
      const v = videoRef.value;
      if (!v) return;
      if (seekMuteRestore === null) seekMuteRestore = v.muted; // intención real, una sola vez
      v.muted = true;
      const restore = () => {
        v.removeEventListener('seeked', restore);
        if (seekUnmuteTimer) { clearTimeout(seekUnmuteTimer); seekUnmuteTimer = null; }
        if (seekMuteRestore !== null) { v.muted = seekMuteRestore; seekMuteRestore = null; }
      };
      v.addEventListener('seeked', restore);
      // Salvavidas: si `seeked` no dispara, restaurar el audio igual.
      if (seekUnmuteTimer) clearTimeout(seekUnmuteTimer);
      seekUnmuteTimer = setTimeout(restore, 8000);
      v.currentTime = seconds;
    }
  },
});

const isLoading = ref(true);

// ── Auto-hide de controles (preserva `controls-hidden` del original) ────────
const controlsHidden = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;
function resetControlsAutoHide() {
  controlsHidden.value = false;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (nfControls.isPlaying.value) {
      controlsHidden.value = true;
      settingsPanelOpen.value = false;
    }
  }, 3500);
}

// ── Panel ⚙️ Audio/Subtítulos/Velocidad — preserva `nfShowPanel`/`nfHidePanelDelayed`/
// `nfCancelHide`/`nfOpenPanel`/`_nfWireHover` (líneas ~3955-4021): hover-intent
// con cierre demorado 350ms (cancelable al entrar al panel) + click para abrir/
// alternar. En Vue el anclaje dinámico al botón (`getBoundingClientRect`/
// `requestAnimationFrame`) se reemplaza por el posicionamiento estático
// `bottom:64px;right:12px` que YA trae `#playerSettingsPanel` como base CSS
// (línea ~1213-1220) — mismo resultado visual, sin recalcular en cada apertura. ──
type SettingsPanelMode = 'audiosubs' | 'speed';
const settingsPanelOpen = ref(false);
const settingsPanelMode = ref<SettingsPanelMode>('audiosubs');
let panelHideTimer: ReturnType<typeof setTimeout> | null = null;

function showSettingsPanel(mode: SettingsPanelMode) {
  if (panelHideTimer) {
    clearTimeout(panelHideTimer);
    panelHideTimer = null;
  }
  settingsPanelMode.value = mode;
  settingsPanelOpen.value = true;
  resetControlsAutoHide(); // preserva `playerPage.classList.remove('controls-hidden')` (línea ~3965)
}
function hideSettingsPanelDelayed() {
  if (panelHideTimer) clearTimeout(panelHideTimer);
  panelHideTimer = setTimeout(() => {
    settingsPanelOpen.value = false;
  }, 350); // preserva el delay EXACTO de `nfHidePanelDelayed` (línea ~3983)
}
function cancelHideSettingsPanel() {
  if (panelHideTimer) {
    clearTimeout(panelHideTimer);
    panelHideTimer = null;
  }
}
/** nfOpenPanel — preserva "click también abre/cierra" (líneas ~3989-3998): si ya está abierto en el mismo modo, lo cierra. */
function toggleSettingsPanel(mode: SettingsPanelMode) {
  if (settingsPanelOpen.value && settingsPanelMode.value === mode) {
    settingsPanelOpen.value = false;
    return;
  }
  showSettingsPanel(mode);
}

const canSwitchAudio = computed(() => player.dashBaseUrl.value !== null);

/** spSwitchAudio — delega en `usePlayer.switchAudioTrack` (que preserva mutex/toasts/watchdog/loading). */
function onSwitchAudio(track: string) {
  void player.switchAudioTrack(track);
}

/**
 * spSetSubs — preserva el toggle de doble-etiqueta (ver nota de cabecera de
 * `PlayerSettingsPanel`) + el guard `!_subSrtRaw && _streamImdbId` que evita
 * re-buscar si ya hay un .srt cargado (líneas ~4444-4459).
 */
function onToggleSubs() {
  const turningOn = !subtitles.enabled.value;
  subtitles.enabled.value = turningOn;
  if (turningOn) {
    if (!subtitles.hasSubtitleData.value && lastSelectedStream.value?.imdbId) {
      const s = lastSelectedStream.value;
      subtitles.fetchAndInject({
        imdbId: s.imdbId,
        type: playerStore.current.type,
        season: playerStore.current.season,
        episode: playerStore.current.episode,
        streamFilename: s.streamFilename,
        infoHash: s.infoHash,
      });
    }
  }
  showToast(turningOn ? '💬 Subtítulos activados' : '💬 Subtítulos desactivados');
}

/** spSetSpeed — delega en `nfControls.setSpeed` (mismo patrón que `SubtitleControls`: el toast vive en la UI). */
function onSetSpeed(value: number) {
  nfControls.setSpeed(value);
}

const remainingDisplay = computed(() => {
  if (player.isTpipeline.value) {
    const dur = player.tpipelineDuration.value || props.runtimeSec || 0;
    const cur = player.tpipelineOffset.value + (videoRef.value?.currentTime || 0);
    return '-' + formatNfTime(dur - cur);
  }
  const d = videoRef.value?.duration;
  const eff = d && isFinite(d) && d > 0 ? d : props.runtimeSec || 0;
  return '-' + formatNfTime(eff - (videoRef.value?.currentTime || 0));
});

/**
 * onVideoClick — preserva `_nfVideoClick` (índex.html líneas 4076-4081): un
 * click sobre el video CIERRA el panel ⚙️ si está abierto; si no, alterna
 * play/pausa. Así el usuario puede pausar/reanudar clicando la pantalla, no
 * solo el botón de la barra.
 */
function onVideoClick() {
  if (settingsPanelOpen.value) {
    settingsPanelOpen.value = false;
    return;
  }
  nfControls.togglePlay();
}

/**
 * loadRdSourceWrapped — al empezar a cargar un título nuevo: (1) resetea la barra de
 * progreso a 0 (el <video> se reusa entre títulos → sin esto muestra el % viejo de la peli
 * anterior, ~100% si estaba cerca del final, hasta que la nueva carga), y (2) muestra el
 * overlay de carga (spinner) — antes quedaba pantalla negra sin aviso al cambiar de título.
 * `onStarted` (ya existente) apaga isLoading cuando el nuevo stream arranca de verdad.
 */
function loadRdSourceWrapped(params: Parameters<typeof player.loadRdSource>[0]) {
  nfControls.resetProgress();
  isLoading.value = true;
  return player.loadRdSource(params);
}

defineExpose({
  loadRdSource: loadRdSourceWrapped,
  switchAudioTrack: player.switchAudioTrack,
  videoRef,
  fullscreen,
  isTpipeline: player.isTpipeline,
  tpipelineOffset: player.tpipelineOffset,
  tpipelineSeekTo: player.tpipelineSeekTo,
  /**
   * isLoading (expuesto) — permite mostrar el spinner puntualmente desde PlayerView
   * durante el seek nativo de "continuar viendo" en Direct Play (ver PlayerView.vue,
   * bloque de resume): ese seek ocurre DESPUÉS de que onStarted ya apagó el loader,
   * así que sin esto la pantalla queda negra sin aviso mientras busca el byte range.
   */
  isLoading,
});

// ── Overlay UNIFICADO anti-pantalla-negra (2026-07-06, a pedido del usuario) ─────────────
// Antes había huecos: el freeze-frame solo cubría el seek de /t/ (tpipelineSeeking), pero
// los cortes A MITAD de reproducción (RD generando lento, recuperación de stall) dejaban
// pasar cuadros negros crudos sin ningún aviso. La clave del fix: CAPTURAR EL CUADRO DE
// FORMA CONTINUA mientras reproduce bien (no en el momento del corte — para entonces ya es
// tarde, el intento anterior de esta sesión falló por eso) para que SIEMPRE haya un cuadro
// reciente listo para mostrar apenas se traba, sea cual sea la causa (seek, stall-recovery,
// buffering). `bufferingOverlay` se activa con el evento NATIVO 'waiting' del <video> (que
// dispara sin importar el motivo del corte) y se apaga con 'playing'.
const bufferingOverlay = ref(false);
let lastCaptureAt = 0;

function captureFreezeFrame() {
  const video = videoRef.value;
  const canvas = freezeCanvasRef.value;
  if (!video || !canvas || video.readyState < 2) return;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function onVideoTimeUpdateCapture() {
  const video = videoRef.value;
  if (!video || video.paused || video.seeking || video.readyState < 2) return;
  const now = Date.now();
  if (now - lastCaptureAt < 300) return; // throttle — no hace falta capturar cada frame
  lastCaptureAt = now;
  captureFreezeFrame();
}

// Respaldo por intervalo fijo (2026-07-06, a pedido): en un corte LARGO (RD degradándose
// unos segundos ANTES de trabarse del todo) 'timeupdate' puede volverse irregular o dejar
// de disparar justo cuando más se necesita el último cuadro fresco. Este intervalo corre
// SIEMPRE, independiente de 'timeupdate', así el canvas nunca queda con un cuadro viejo.
let freezeInterval: ReturnType<typeof setInterval> | null = null;
function startFreezeIntervalCapture() {
  stopFreezeIntervalCapture();
  freezeInterval = setInterval(() => {
    const video = videoRef.value;
    if (!video || video.paused || video.seeking || video.readyState < 2) return;
    captureFreezeFrame();
  }, 400);
}
function stopFreezeIntervalCapture() {
  if (freezeInterval) {
    clearInterval(freezeInterval);
    freezeInterval = null;
  }
}

let waitingDebounce: ReturnType<typeof setTimeout> | null = null;

function onVideoWaiting() {
  // NOTA: ya NO se retorna temprano si tpipelineSeeking está activo. Antes ese guard
  // impedía que bufferingOverlay se activara durante el seek → apenas terminaba el seek
  // (tpipelineSeeking=false) con el video AÚN buffereando, el overlay desaparecía y quedaba
  // un HUECO NEGRO sin indicación hasta que arrancaba. Como tpipelineSeeking y
  // bufferingOverlay muestran el MISMO overlay (canvas + loader, ver v-if del template),
  // dejarlos convivir NO duplica nada: solo hace que el overlay se mantenga CONTINUO desde
  // el seek hasta que 'playing' confirma que la peli arrancó de verdad.
  // BUG encontrado (2026-07-06, a pedido): durante la carga INICIAL (isLoading=true, el
  // spinner grande de .player-loading ya cubre la pantalla), el <video> también dispara
  // 'waiting' (sin datos aún) → se veían DOS loaders superpuestos (el grande + este chico).
  // Mientras isLoading esté activo, .player-loading ya comunica "cargando" — no duplicar.
  if (isLoading.value) return;
  // NO capturar acá: en el 'waiting' el <video> YA está en stall → readyState cae y
  // captureFreezeFrame() dibuja NEGRO, sobrescribiendo el último cuadro BUENO de la captura
  // continua (timeupdate/intervalo). Confiamos solo en la captura continua.
  // Umbral de 1s: los cortes MUY cortos (<1s) el <video> los absorbe solo; más largos
  // muestran el freeze-frame + loader (antes 2s dejaba ver negro más tiempo en TV).
  if (waitingDebounce) clearTimeout(waitingDebounce);
  waitingDebounce = setTimeout(() => {
    bufferingOverlay.value = true;
  }, 1000);
}

function onVideoPlayingResumed() {
  if (waitingDebounce) {
    clearTimeout(waitingDebounce);
    waitingDebounce = null;
  }
  bufferingOverlay.value = false;
}

watch(videoRef, (video, prev) => {
  if (prev) {
    prev.removeEventListener('timeupdate', onVideoTimeUpdateCapture);
    prev.removeEventListener('waiting', onVideoWaiting);
    prev.removeEventListener('playing', onVideoPlayingResumed);
  }
  if (video) {
    video.addEventListener('timeupdate', onVideoTimeUpdateCapture);
    video.addEventListener('waiting', onVideoWaiting);
    video.addEventListener('playing', onVideoPlayingResumed);
    startFreezeIntervalCapture();
  } else {
    stopFreezeIntervalCapture();
  }
});

// Freeze-frame en el seek /t/: NO se captura acá. `tpipelineReloadMpd` hace `video.pause()`
// de forma síncrona apenas pone tpipelineSeeking=true; este watch correría DESPUÉS del pause
// → en la TV el decoder ya soltó el cuadro y captureFreezeFrame() dibujaría NEGRO,
// sobrescribiendo el último cuadro BUENO de la captura continua. ESE era el bug de "al
// retroceder se pone negra en vez de congelada". El canvas ya se MUESTRA con tpipelineSeeking
// vía v-show; ahora conserva el cuadro bueno en vez de pisarlo con negro.

// ── Subtítulos en fullscreen nativo (SOLO móvil) ─────────────────────────────
// El fullscreen nativo de iOS (`webkitEnterFullscreen`) muestra únicamente el
// <video> y sus TextTracks NATIVOS — el overlay DOM <SubtitleOverlay> NO es
// visible ahí. Para que los subtítulos aparezcan en fullscreen, espejamos los
// cues parseados en un TextTrack nativo y lo activamos solo MIENTRAS dura el
// fullscreen nativo. Inline (no-fullscreen) el track queda 'hidden' para no
// duplicar con el overlay DOM. Gateado a `isMobile` → desktop/TV intactos.
let nativeTrack: TextTrack | null = null;
let inNativeFullscreen = false;

function applyNativeTrackMode() {
  if (!nativeTrack) return;
  nativeTrack.mode = inNativeFullscreen && subtitles.enabled.value ? 'showing' : 'hidden';
}

function syncNativeTrack() {
  if (!deviceStore.isMobile) return;
  const video = videoRef.value;
  if (!video) return;
  if (!nativeTrack) {
    nativeTrack = video.addTextTrack('subtitles', 'Español', 'es');
    nativeTrack.mode = 'hidden';
  }
  // Limpiar cues previos (peli/offset anterior) y volcar los actuales (ms → seg).
  const existing = nativeTrack.cues ? Array.from(nativeTrack.cues) : [];
  for (const c of existing) nativeTrack.removeCue(c);
  for (const cue of subtitles.cues.value) {
    try {
      nativeTrack.addCue(new VTTCue(cue.s / 1000, cue.e / 1000, cue.text));
    } catch {
      /* ignorar cue malformado */
    }
  }
  applyNativeTrackMode();
}

function onBeginNativeFs() {
  inNativeFullscreen = true;
  syncNativeTrack();
}
function onEndNativeFs() {
  inNativeFullscreen = false;
  applyNativeTrackMode();
  // En mobile, salir del fullscreen nativo = terminar de ver → cerrar el player
  // y volver al detalle directamente (PlayerView lo maneja).
  emit('native-fullscreen-exit');
}

// Reataches al cambiar de instancia de <video> (nueva fuente) y re-espejado al
// cambiar cues (peli nueva u offset ajustado) o el toggle de subtítulos.
watch(videoRef, (video, prev) => {
  if (!deviceStore.isMobile) return;
  if (prev) {
    prev.removeEventListener('webkitbeginfullscreen', onBeginNativeFs);
    prev.removeEventListener('webkitendfullscreen', onEndNativeFs);
  }
  nativeTrack = null;
  if (video) {
    video.addEventListener('webkitbeginfullscreen', onBeginNativeFs);
    video.addEventListener('webkitendfullscreen', onEndNativeFs);
  }
});
watch(() => subtitles.cues.value, () => syncNativeTrack());
watch(() => subtitles.enabled.value, () => applyNativeTrackMode());

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer);
  if (waitingDebounce) clearTimeout(waitingDebounce);
  stopFreezeIntervalCapture();
  const video = videoRef.value;
  if (video) {
    video.removeEventListener('webkitbeginfullscreen', onBeginNativeFs);
    video.removeEventListener('webkitendfullscreen', onEndNativeFs);
    video.removeEventListener('timeupdate', onVideoTimeUpdateCapture);
    video.removeEventListener('waiting', onVideoWaiting);
    video.removeEventListener('playing', onVideoPlayingResumed);
  }
  player.destroy();
  nfControls.detach();
  subtitles.clear();
});
</script>

<template>
  <div ref="playerPageRef" class="video-player" :class="{ 'controls-hidden': controlsHidden }">
    <!-- Overlay de carga — reemplaza #playerLoading (línea ~3740-3746) -->
    <div v-if="isLoading" class="player-loading">
      <div class="spinner"></div>
      <p class="player-loading-text">{{ player.loadingMessage.value || 'Conectando señal...' }}</p>
      <p class="player-loading-hint">El servidor obtiene el contenido en tiempo real.<br />Puede tardar hasta 15 segundos.</p>
    </div>

    <div class="player-frame-wrap" @mousemove="resetControlsAutoHide">
      <!-- Freeze-frame + loader: seek del pipeline /t/ (tpipelineSeeking) O cualquier corte
           a mitad de reproducción (bufferingOverlay, disparado por el 'waiting' nativo del
           <video> — cubre stall-recovery, buffering, cualquier motivo, no solo el seek). -->
      <canvas v-show="player.tpipelineSeeking.value || bufferingOverlay" ref="freezeCanvasRef" class="tpipeline-freeze"></canvas>
      <div v-if="player.tpipelineSeeking.value || bufferingOverlay" class="tpipeline-loader">
        <div class="tpipeline-spinner"></div>
        <span class="tpipeline-loader-text">Cargando…</span>
      </div>

      <video ref="videoRef" class="video-el" playsinline @click="onVideoClick"></video>

      <SubtitleOverlay :text="subtitles.activeCueText.value" :enabled="subtitles.enabled.value" />

      <!-- Barra de controles custom — reemplaza #nfControls (líneas ~3751-3824) -->
      <div class="nf-controls" :class="{ hidden: controlsHidden }">
        <div class="nf-seek-wrap">
          <span class="nf-time-elapsed">{{ nfControls.elapsedLabel.value }}</span>
          <div
            ref="seekBarRef"
            class="nf-seek-bar"
            @click="nfControls.onSeekBarClick"
            @mousedown="nfControls.onSeekBarMouseDown"
            @mousemove="nfControls.onSeekBarMouseMove"
          >
            <div class="nf-seek-fill" :style="{ width: nfControls.progressPct.value + '%' }"></div>
            <div class="nf-seek-dot" :style="{ left: nfControls.progressPct.value + '%' }"></div>
            <div class="nf-seek-tooltip" :style="{ left: nfControls.tooltipPct.value + '%' }">{{ nfControls.tooltipLabel.value }}</div>
          </div>
          <span class="nf-time">{{ remainingDisplay }}</span>
        </div>

        <div class="nf-row">
          <div class="nf-left">
            <button class="nf-btn" @click="nfControls.togglePlay">
              <svg v-if="nfControls.isPlaying.value" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </button>
            <button class="nf-btn nf-btn-sm" @click="nfControls.skip(-10)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 5V2L8 6l4 4V7a7 7 0 1 1-6.93 8H3.05A9 9 0 1 0 12 5z" />
                <text x="7.5" y="15.5" font-size="5.5" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">10</text>
              </svg>
            </button>
            <button class="nf-btn nf-btn-sm" @click="nfControls.skip(10)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 5V2l4 4-4 4V7a7 7 0 1 0 6.93 8H20.95A9 9 0 1 1 12 5z" />
                <text x="7.5" y="15.5" font-size="5.5" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="bold">10</text>
              </svg>
            </button>
            <div class="nf-vol-group">
              <button class="nf-btn" @click="nfControls.toggleMute">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path v-if="!nfControls.isMuted.value" d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <template v-else>
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </template>
                </svg>
              </button>
              <input
                class="nf-vol-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="nfControls.volume.value"
                @input="nfControls.setVolume(parseFloat(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>
          <div class="nf-center">
            <span class="nf-title-bar">{{ title }}</span>
          </div>
          <div class="nf-right">
            <!-- Disparadores de episodios (⏭ / ⧉) — los inyecta PlayerView vía slot SOLO en
                 series/anime. Van al mismo nivel que CC/velocidad/fullscreen (camino RD). -->
            <slot name="episode-triggers"></slot>
            <!-- #nfCCBtn — preserva línea ~3803-3808 (oculto hasta que `_spInit` llama `_spShowForRD(true)`) -->
            <button
              v-if="audioPanelReady"
              id="nfCCBtn"
              class="nf-btn nf-btn-sm" 
              @click="toggleSettingsPanel('audiosubs')"
              @mouseenter="showSettingsPanel('audiosubs')"
              @mouseleave="hideSettingsPanelDelayed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="6" y1="10" x2="14" y2="10" />
                <line x1="6" y1="14" x2="11" y2="14" />
              </svg>
            </button>
            <!-- #nfSpeedBtn — preserva línea ~3810-3815 -->
            <button
              v-if="audioPanelReady"
              id="nfSpeedBtn"
              class="nf-btn nf-btn-sm" 
              @click="toggleSettingsPanel('speed')"
              @mouseenter="showSettingsPanel('speed')"
              @mouseleave="hideSettingsPanelDelayed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button ref="fullscreenIconRef" class="nf-btn" @click="emit('toggle-fullscreen')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path :d="props.pageFullscreen ? FULLSCREEN_PATH_D.enter : FULLSCREEN_PATH_D.exit" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Panel ⚙️ Audio+Subtítulos / Velocidad — reemplaza #playerSettingsPanel (líneas ~3613-3673) -->
      <PlayerSettingsPanel
        v-if="audioPanelReady"
        :open="settingsPanelOpen"
        :mode="settingsPanelMode"
        :has-native-spanish="hasNativeSpanish"
        :spanish-track="player.spanishTrack.value"
        :active-track="player.activeTrack.value"
        :can-switch-audio="canSwitchAudio"
        :subs-enabled="subtitles.enabled.value"
        :offset-ms="subtitles.offsetMs.value"
        :speed="nfControls.speed.value"
        @switch-audio="onSwitchAudio"
        @toggle-subs="onToggleSubs"
        @adjust-offset="subtitles.adjustOffset"
        @reset-offset="subtitles.adjustOffset(-subtitles.offsetMs.value)"
        @set-speed="onSetSpeed"
        @mouseenter="cancelHideSettingsPanel"
        @mouseleave="hideSettingsPanelDelayed"
      />
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.player-page`/`.player-loading`/`#nfControls`/`.nf-*` (líneas ~907-1120, ~1305-1313) */
.video-player {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.player-frame-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.video-el {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.player-loading {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.75);
  transition: opacity var(--trans, 0.25s ease);
}
.player-loading-text {
  color: var(--text-muted, #9a9a9a);
  font-size: 0.83rem;
  font-weight: 500;
  text-align: center;
}
.player-loading-hint {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.35);
  text-align: center;
  max-width: 260px;
  line-height: 1.4;
}

/* Pipeline /t/ — freeze-frame + loader durante seek/corte. z-index 55/56: BUG encontrado
   (2026-07-06) — estaba en 5/6, por DEBAJO del overlay de subtítulos (z-index 50), así que
   los subtítulos se veían "atravesando" la pantalla de carga (aparecían antes que el video
   real). Ahora queda por encima, cubriendo TODO — video negro Y subtítulos — mientras dure
   el corte. Sigue por debajo de .player-loading (60), que es el overlay de carga inicial. */
.tpipeline-freeze {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 55;
  background: #000;
  pointer-events: none;
}
/* Loader del seek/corte /t/. SIN fondo oscuro: el frozen-frame (canvas, z-index 55) DEBE
   verse — se comprobó que en la TV el canvas SÍ muestra la imagen congelada. Solo se
   superpone el spinner + "Cargando…" (con sombra fuerte para leerse sobre cualquier
   cuadro). Un fondo oscuro acá tapaba la imagen y la hacía ver negra (regresión 41dae4b). */
.tpipeline-loader {
  position: absolute;
  inset: 0;
  z-index: 56;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  pointer-events: none;
}
.tpipeline-spinner {
  width: 46px;
  height: 46px;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top: 3px solid #3d5afe;
  border-radius: 50%;
  animation: tpipeline-spin 0.8s linear infinite;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.tpipeline-loader-text {
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}
@keyframes tpipeline-spin {
  to { transform: rotate(360deg); }
}

.nf-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: 6px 16px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85), transparent);
  transition: opacity var(--trans, 0.25s ease);
}
.nf-controls.hidden {
  opacity: 0;
  pointer-events: none;
}
.nf-seek-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0 4px;
}
.nf-time,
.nf-time-elapsed {
  font-size: 0.72rem;
  color: var(--text, #f0f0f0);
  min-width: 38px;
  text-align: center;
}
.nf-seek-bar {
  position: relative;
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
  cursor: pointer;
  transition: height 0.15s ease;
}
.nf-seek-bar:hover {
  height: 5px;
}
.nf-seek-fill {
  height: 100%;
  background: var(--accent, #3d5afe);
  border-radius: 2px;
  pointer-events: none;
}
.nf-seek-dot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: var(--accent, #3d5afe);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  display: none;
}
.nf-seek-bar:hover .nf-seek-dot {
  display: block;
}
.nf-seek-tooltip {
  position: absolute;
  bottom: 14px;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.nf-seek-bar:hover .nf-seek-tooltip {
  opacity: 1;
}
.nf-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nf-left,
.nf-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nf-center {
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nf-title-bar {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.7);
}
.nf-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  color: #fff;
  opacity: 0.85;
  display: flex;
  align-items: center;
  transition: opacity var(--trans, 0.25s ease);
}
.nf-btn:hover {
  opacity: 1;
}
.nf-btn svg {
  width: 22px;
  height: 22px;
}
.nf-btn-sm {
  font-size: 0.7rem;
  font-weight: 600;
}
.nf-vol-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* Preserva `.nf-vol-slider` (líneas ~1137-1142): COLAPSADO por defecto, se
   expande solo al hover/focus del grupo de volumen — no siempre visible. */
.nf-vol-slider {
  width: 0;
  overflow: hidden;
  transition: width 0.2s ease;
  accent-color: var(--accent, #3d5afe);
}
.nf-vol-group:hover .nf-vol-slider,
.nf-vol-group:focus-within .nf-vol-slider {
  width: 76px;
}

@media (max-width: 640px) {
  .nf-vol-group {
    display: none; /* el original también simplifica controles en mobile */
  }
}
</style>
