<script setup lang="ts">
/**
 * PlayerView — la página del reproductor: orquesta el origen activo (Real-Debrid
 * vía `<VideoPlayer>` o iframes UnlimPlay/vidlink/Anime1V), el selector de
 * fuentes, la navegación de episodios, el banner de auto-siguiente, el
 * tracking de progreso y el fullscreen de la página completa.
 *
 * Reemplaza `openPlayer`/`loadPlayerSource`/`renderEpisodeControls`/
 * `changeSeason`/`changeEpisode`/`switchSource`/`nextEpisode`/`prevEpisode`/
 * `goToNextEpisode`/`scheduleAutoNext`/`preloadNextEpData`/
 * `startAutoNextCountdown`/`cancelAutoNext`/`startProgressTracking`/
 * `closePlayer`/`enterPlayerFullscreen`/`exitPlayerFullscreen`/
 * `togglePlayerFullscreen`/`_flashControlsOnEpChange`/`_renderAnimeSourceSelector`/
 * `_fetchAnimeServersForEpisode`/`_loadUrlInPlayer`/`selectAnimeServer`/
 * `switchAnime1Lang` (líneas ~6071-6083, ~7535-8810 de assets/index.html).
 *
 * División de responsabilidades (decidida durante la investigación de esta
 * vista — ver cabecera de `VideoPlayer.vue`):
 *   - `<VideoPlayer>` (Fase 5 previa) posee TODO el camino Real-Debrid:
 *     `<video>`, barra de controles Netflix, overlay de carga, subtítulos,
 *     Y SU PROPIO fullscreen acotado a su wrapper `.video-player`.
 *   - `PlayerView` posee: el camino iframe (UnlimPlay/vidlink/Anime1V), el
 *     selector de fuentes del topbar, la navegación de episodios, el banner
 *     de auto-siguiente, el tracking de progreso (arranca cuando cualquiera
 *     de las dos fuentes "empieza"), Y SU PROPIO fullscreen acotado a la
 *     página completa `.player-page` (con `frameRef` apuntando al iframe) —
 *     preserva el `togglePlayerFullscreen` del topbar (`#btnFullscreen`,
 *     línea ~3604) que en el original cubría AMBOS caminos por igual.
 *
 * `<VideoPlayer>` y `<iframe>` se mantienen SIEMPRE montados con `v-show`
 * (nunca `v-if`) — preserva el hecho de que `#playerVideo`/`#playerFrame`
 * coexistían siempre en el DOM original con `display:none/block` alternado;
 * evita el costo de remount/lifecycle al cambiar de fuente a mitad de sesión.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import VideoPlayer from '../components/player/VideoPlayer.vue';
import EpisodePanel from '../components/player/EpisodePanel.vue';
import EpisodeTriggers from '../components/player/EpisodeTriggers.vue';
import NextEpisodeCard from '../components/player/NextEpisodeCard.vue';
import { fetchSeasonEpisodes, type EpisodeMeta } from '../services/episodes';
import { useAppServices } from '../composables/useAppServices';
import { usePlayerStore } from '../stores/player';
import { useProgressStore } from '../stores/progress';
import { useDeviceStore } from '../stores/device';
import { useToast } from '../composables/useToast';
import { useFullscreen } from '../composables/useFullscreen';
import { FULLSCREEN_PATH_D } from '../services/fullscreen';
import { TMDB_IMG_BASE } from '../services/catalog';
import {
  SOURCES,
  RD_SRC_IDX,
  buildIframeSourceUrl,
  seasonOptions,
  shouldPersistProgressOnClose,
  autoNextDelayMs,
  canScheduleAutoNext,
  nextEpisodeTarget,
  sourceToastLabel,
} from '../services/playerSources';
import {
  anime1Search,
  anime1Info,
  anime1Episode,
  findBestMatch,
  pickEpisodeByNumber,
  buildAnimeServerList,
  type Anime1Episode,
  type AnimeServerEntry,
} from '../services/anime1';

const props = defineProps<{
  type: 'movie' | 'tv';
  id: string | number;
  season?: number;
  episode?: number;
}>();

const router = useRouter();
const { tmdbClient, rdStreamResolver, rdClient } = useAppServices();
const playerStore = usePlayerStore();
const progressStore = useProgressStore();
const deviceStore = useDeviceStore();
const { show: showToast } = useToast();

const LANG = 'es-ES';
const IMG = TMDB_IMG_BASE;

// ── Refs de DOM/componentes ──────────────────────────────────────────────────
const playerPageRef = ref<HTMLElement | null>(null);
const frameRef = ref<HTMLIFrameElement | null>(null);
const fullscreenIconRef = ref<HTMLElement | null>(null);
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);

// ── Fullscreen propio de la página — cubre AMBOS caminos (preserva
// `togglePlayerFullscreen`/`#btnFullscreen` del topbar, línea ~3604: un
// único fullscreen "de página completa" disponible siempre, sea cual sea
// la fuente activa). El de `<VideoPlayer>` es interno/acotado a su wrapper. ──
const fullscreen = useFullscreen({
  playerPageRef,
  iconRef: fullscreenIconRef,
  frameRef,
  isTvMode: () => deviceStore.isTV,
});

// ── "Enviar a TV" / Cast — NO se porta ────────────────────────────────────────
// El original tiene el HTML/JS de `#btnCast`/`#castModal`/`openCastModal` aún
// presentes (líneas ~3590-3601, ~9197-9316), pero están deshabilitados a
// propósito vía la regla CSS global `#btnCast { display: none !important; }
// /* Enviar a TV eliminado */` (línea 2282) — código muerto, igual que
// "Canales TV" (que el usuario confirmó eliminar). El usuario confirmó NO
// portar esta función ("Quitarlo (Recomendado)"), siguiendo el mismo criterio.

// ── Derivados de `playerStore.current` ───────────────────────────────────────
const title = computed(() => playerStore.current.title || 'Cargando...');
/** epInfo — preserva `updateEpInfo` (línea ~7623-7626). */
const epInfo = computed(() =>
  playerStore.current.type === 'tv' ? `T${playerStore.current.season} · E${playerStore.current.episode}` : ''
);
const isAnime = computed(() => playerStore.current.isAnime && playerStore.current.type === 'tv');
const isRdSource = computed(() => playerStore.sourceIndex === RD_SRC_IDX);

// ── Overlay de carga del camino iframe (#playerLoading/#playerLoadingText) ──
const iframeLoading = ref(true);
const iframeLoadingText = ref('🔌 Conectando con el servidor...');

// ── Selector de fuentes (#sourceSelector) ────────────────────────────────────
interface SourceButton {
  idx: number;
  label: string;
  icon: string;
  active: boolean;
  isRd: boolean;
}
/**
 * sourceButtons — preserva el `innerHTML` armado en `loadPlayerSource`
 * (líneas ~7798-7813): botón "⚡ RD" + uno por cada `SOURCES[i]`. Solo se
 * muestra para contenido NO-anime (`!_dpIsAnime || type !== 'tv'`).
 */
const sourceButtons = computed<SourceButton[]>(() => {
  const active = playerStore.sourceIndex;
  const rd: SourceButton = { idx: RD_SRC_IDX, label: 'RD', icon: '⚡', active: active === RD_SRC_IDX, isRd: true };
  const rest = SOURCES.map((s, i) => ({ idx: i, label: s.name, icon: s.icon, active: i === active, isRd: false }));
  return [rd, ...rest];
});
// Anime → siempre selector Anime1V (SUB/DUB/HLS). No-anime → RD/UnlimPlay/vidlink.
const showSourceSelector = computed(() => !isAnime.value);

// ── Selector de servidores Anime1V ────────────────────────────────────────────
const selectedAnime1Lang = ref<'SUB' | 'DUB'>('SUB');
const animeServersCache = ref<AnimeServerEntry[] | null>(null);
const activeAnimeServerIdx = ref(0);
/** Caché de info del anime — preserva `_animeInfoCache` (se reutiliza entre episodios del mismo anime). */
let animeInfoCache: { episodes?: Anime1Episode[] } | null = null;
/**
 * animeServerButtons — preserva `_renderAnimeSourceSelector` (líneas
 * ~4561-4598): toggle SUB/DUB (solo si la API trajo servidores) + lista de
 * servidores con StreamiX siempre primero.
 */
const animeServerButtons = computed(() => {
  const all = animeServersCache.value ?? [];
  const subServers = all.filter((s) => s.type === 'SUB');
  const dubServers = all.filter((s) => s.type === 'DUB');
  const mx = all.filter((s) => s.type === 'MX');
  const lang = selectedAnime1Lang.value;
  const filtered = [...mx, ...(lang === 'SUB' ? subServers : dubServers)];
  return {
    showLangToggle: subServers.length > 0 && dubServers.length > 0,
    subActive: lang === 'SUB',
    servers: filtered,
  };
});

// ── Episodios (#playerBottom / .ep-controls-row) ─────────────────────────────
const seasonOpts = computed(() => seasonOptions(playerStore.current.totalSeasons, playerStore.current.season));
const showEpisodeControls = computed(() => playerStore.current.type === 'tv' && playerStore.current.totalSeasons > 0);

// ── Panel de episodios estilo Netflix (EpisodePanel) ─────────────────────────
const episodePanelOpen = ref(false);
const episodePanelLoading = ref(false);
/** Temporada que se está VIENDO en el panel (puede diferir de la que se reproduce — el usuario navega). */
const viewedSeason = ref(1);
const viewedEpisodes = ref<EpisodeMeta[]>([]);

async function loadViewedEpisodes(season: number) {
  const id = playerStore.current.id;
  if (id == null) return;
  episodePanelLoading.value = true;
  viewedSeason.value = season;
  try {
    viewedEpisodes.value = await fetchSeasonEpisodes(tmdbClient, id, season, LANG);
  } finally {
    episodePanelLoading.value = false;
  }
}

function openEpisodePanel() {
  episodePanelOpen.value = true;
  void loadViewedEpisodes(playerStore.current.season);
}

function onPanelSelectSeason(season: number) {
  void loadViewedEpisodes(season);
}

function onPanelPlay({ season, episode }: { season: number; episode: number }) {
  episodePanelOpen.value = false;
  cancelAutoNext();
  // Si cambia de temporada, actualizar el conteo de episodios desde lo que ya cargó el panel.
  if (season !== playerStore.current.season && viewedEpisodes.value.length) {
    playerStore.setTotals(playerStore.current.totalSeasons, viewedEpisodes.value.length);
  }
  playerStore.setEpisode(season, episode);
  fetchEpisodeRuntime(season, episode);
  loadActiveSource();
  flashControlsOnEpChange();
}

// ── Hover (estilo audio/subtítulos/velocidad): mouseenter abre, leave cierra con
//    delay; el "puente" evita que se cierre al pasar el mouse del ícono a la card/panel.
const HOVER_CLOSE_MS = 220;
let nextCloseTimer: ReturnType<typeof setTimeout> | null = null;
let listCloseTimer: ReturnType<typeof setTimeout> | null = null;

// Card "Siguiente episodio" ----------------------------------------------------
const nextCardOpen = ref(false);
const nextCardLoading = ref(false);
const nextEpisodeMeta = ref<EpisodeMeta | null>(null);

async function loadNextEpisodeMeta() {
  const cur = playerStore.current;
  const target = nextEpisodeTarget({ season: cur.season, episode: cur.episode, totalSeasons: cur.totalSeasons, totalEpisodes: cur.totalEpisodes });
  if (!target || cur.id == null) {
    nextEpisodeMeta.value = null;
    return;
  }
  nextCardLoading.value = true;
  try {
    const eps = await fetchSeasonEpisodes(tmdbClient, cur.id, target.season, LANG);
    nextEpisodeMeta.value = eps.find((e) => e.number === target.episode) ?? null;
  } finally {
    nextCardLoading.value = false;
  }
}

function onNextEnter() {
  if (nextCloseTimer) { clearTimeout(nextCloseTimer); nextCloseTimer = null; }
  if (!nextCardOpen.value) void loadNextEpisodeMeta();
  nextCardOpen.value = true;
}
function onNextLeave() {
  nextCloseTimer = setTimeout(() => { nextCardOpen.value = false; }, HOVER_CLOSE_MS);
}
function onNextTap() {
  if (nextCardOpen.value) { nextCardOpen.value = false; return; }
  void loadNextEpisodeMeta();
  nextCardOpen.value = true;
}
function onNextCardKeep() {
  if (nextCloseTimer) { clearTimeout(nextCloseTimer); nextCloseTimer = null; }
}
function onNextCardEnd() {
  nextCloseTimer = setTimeout(() => { nextCardOpen.value = false; }, HOVER_CLOSE_MS);
}
function playNextFromCard() {
  nextCardOpen.value = false;
  triggerNextEpisode();
}

// Panel "Lista de episodios" ---------------------------------------------------
function onListEnter() {
  if (listCloseTimer) { clearTimeout(listCloseTimer); listCloseTimer = null; }
  if (!episodePanelOpen.value) openEpisodePanel();
}
function onListLeave() {
  listCloseTimer = setTimeout(() => { episodePanelOpen.value = false; }, HOVER_CLOSE_MS);
}
function onListTap() {
  if (episodePanelOpen.value) { episodePanelOpen.value = false; return; }
  openEpisodePanel();
}
function onPanelHoverKeep() {
  if (listCloseTimer) { clearTimeout(listCloseTimer); listCloseTimer = null; }
}
function onPanelHoverEnd() {
  listCloseTimer = setTimeout(() => { episodePanelOpen.value = false; }, HOVER_CLOSE_MS);
}

// ── Banner auto-next (#autonextBanner) ───────────────────────────────────────
const autoNextVisible = ref(false);
const autoNextEpNum = ref('1');
const autoNextEpTitle = ref('Cargando...');
const autoNextEpDesc = ref('');
const autoNextThumb = ref('');
const autoNextCountdownPct = ref(0);
const autoNextCountdownTransition = ref('none');
let autoNextTimer: ReturnType<typeof setTimeout> | null = null;
let autoNextInterval: ReturnType<typeof setInterval> | null = null;
let autoNextTriggered = false;
let autoNextEpisodeData: { season: number; episode: number; title: string; desc: string; thumb: string } | null = null;
let runtimeFetchPromise: Promise<number> | null = null;

// ── Tracking de progreso (#progressInterval) ──────────────
let progressInterval: ReturnType<typeof setInterval> | null = null;

// ── Auto-hide de controles en táctiles — preserva `_flashControlsOnEpChange`/
// `controlsHideTimeout` (líneas ~6071-6083 + apertura en `openPlayer`) ──────
const controlsHidden = ref(false);
let controlsHideTimeout: ReturnType<typeof setTimeout> | null = null;
/**
 * armControlsHide — oculta el topbar/controles tras 3.5s de inactividad. Lógica
 * UNIFORME para películas, series y anime: mover el puntero → muestra; 3.5s quieto
 * → oculta. Sobre el `<video>` nativo (RD) el `mousemove` burbujea al `.player-page`;
 * sobre el iframe (anime) lo captura un overlay transparente (`.iframe-activity-catcher`)
 * que lo revela; en fullscreen lo capta el listener de `document` (ver onMounted).
 */
function armControlsHide() {
  if (controlsHideTimeout) clearTimeout(controlsHideTimeout);
  controlsHideTimeout = setTimeout(() => {
    controlsHidden.value = true;
  }, 3500);
}
/** onPlayerActivity — actividad del mouse/touch: muestra controles y re-arma el ocultado. */
function onPlayerActivity() {
  controlsHidden.value = false;
  armControlsHide();
}
function flashControlsOnEpChange() {
  controlsHidden.value = false;
  armControlsHide();
}

// ── Mensajes progresivos del overlay de carga (camino iframe) — preserva
// `_loadMsgs`/`_msgTimers` (líneas ~7790-7796) ───────────────────────────────
let iframeMsgTimers: ReturnType<typeof setTimeout>[] = [];
function clearIframeMsgTimers() {
  iframeMsgTimers.forEach(clearTimeout);
  iframeMsgTimers = [];
}
function scheduleIframeLoadingMessages() {
  clearIframeMsgTimers();
  const msgs: [number, string][] = [
    [0, '🔌 Conectando con el servidor...'],
    [3500, '📡 Obteniendo el contenido...'],
    [7000, '🎬 Preparando el reproductor...'],
    [11000, '⏳ Casi listo, un momento...'],
    [16000, '🌐 Verificando la señal...'],
    [22000, '⚠️ Tardando más de lo normal...'],
  ];
  msgs.forEach(([delay, msg]) => {
    iframeMsgTimers.push(
      setTimeout(() => {
        if (iframeLoading.value) iframeLoadingText.value = msg;
      }, delay)
    );
  });
}

let iframeAutoFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let iframeOnloadFired = false;

// ════════════════════════════════════════════════════════════════════════════
// PROGRESO — preserva `startProgressTracking` (líneas ~7702-7719)
// ════════════════════════════════════════════════════════════════════════════
function stopProgressTracking() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}
function getRealPositionSec(): number {
  const vp = videoPlayerRef.value;
  if (!vp) return 0;
  const v = vp.videoRef;
  if (!v) return 0;
  const ct = v.currentTime || 0;
  if (vp.isTpipeline) return (vp.tpipelineOffset || 0) + ct;
  return ct;
}

function startProgressTracking() {
  stopProgressTracking();

  progressInterval = setInterval(() => {
    if (!playerStore.current.id) return;
    const positionSec = getRealPositionSec();
    // NO sobrescribir el avance guardado en estados TRANSITORIOS:
    // • video en PAUSA → durante una reanudación colgada (el /t/ pausa esperando el segmento,
    //   p.ej. Cadena Perpetua en TV) guardar acá regresaba/borraba el minuto real.
    // • posición < 30s → nunca es un "continuar viendo" útil (onRdStarted solo retoma si >30) y
    //   evita pisar un avance bueno con la posición del arranque desde el principio.
    // Seguro para todos los dispositivos: la reproducción normal (no pausada, posición real) guarda igual.
    const vEl = videoPlayerRef.value?.videoRef;
    if ((vEl && vEl.paused) || positionSec < 30) return;
    const runtimeSec = (playerStore.current.runtimeMin || 22) * 60;
    const pct = runtimeSec > 0 ? Math.min((positionSec / runtimeSec) * 100, 95) : 0;
    const rtMin = playerStore.current.runtimeMin || undefined;
    if (playerStore.current.type === 'tv') {
      progressStore.save(playerStore.current.id, 'tv', {
        pct,
        positionSec: Math.floor(positionSec),
        runtimeMin: rtMin,
        season: playerStore.current.season,
        episode: playerStore.current.episode,
        title: playerStore.current.title,
      });
    } else {
      progressStore.save(playerStore.current.id, 'movie', { pct, positionSec: Math.floor(positionSec), runtimeMin: rtMin, title: playerStore.current.title });
    }
  }, 15000);
}

/** hideLoadingAndStart — preserva el callback compartido por todos los caminos (líneas ~7775-7786). */
function hideLoadingAndStart() {
  clearIframeMsgTimers();
  iframeLoading.value = false;

  startProgressTracking();
  if (playerStore.current.type === 'tv') {
    setTimeout(() => scheduleAutoNext(), 2000);
  }
  if (!isRdSource.value) {
    controlsHidden.value = false;
  }
}

/** onRdStarted — escucha `<VideoPlayer>` @started (equiv. a la rama RD de `hideLoadingAndStart`, líneas ~7853-7862). */
function onRdStarted() {
  iframeLoading.value = false;

  // En mobile iOS el <video playsinline> no entra en fullscreen automáticamente.
  // webkitEnterFullscreen() funciona desde el evento @started (contexto de gesto del usuario).
  if (deviceStore.isMobile) {
    const v = videoPlayerRef.value?.videoRef;
    if (v) {
      const vAny = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      vAny.webkitEnterFullscreen?.();
    }
  }

  startProgressTracking();
  if (playerStore.current.type === 'tv') {
    setTimeout(() => scheduleAutoNext(), 2000);
  }
  // Restaurar posición guardada ("Continuar viendo")
  if (playerStore.current.id) {
    const prog = progressStore.get(playerStore.current.id, playerStore.current.type);
    if (prog?.positionSec && prog.positionSec > 30) {
      setTimeout(() => {
        const vp = videoPlayerRef.value;
        if (!vp) return;
        if (vp.isTpipeline) {
          void vp.tpipelineSeekTo(prog.positionSec!);
          console.warn(`[PLAYER] Retomando en /t/ → ${Math.floor(prog.positionSec! / 60)}:${String(Math.floor(prog.positionSec! % 60)).padStart(2, '0')}`);
        } else {
          const v = vp.videoRef;
          if (v && prog.positionSec) {
            v.currentTime = prog.positionSec;
            console.warn(`[PLAYER] Retomando en ${Math.floor(prog.positionSec / 60)}:${String(Math.floor(prog.positionSec % 60)).padStart(2, '0')}`);
          }
        }
      }, 500);
    }
  }
}

/**
 * onNativeFullscreenExit — en mobile, al salir del fullscreen nativo de iOS
 * (✕ del reproductor a pantalla completa) cerramos el player y volvemos directo
 * al detalle, sin dejar al usuario en la pantalla negra intermedia que obligaba
 * a tocar la X varias veces.
 */
function onNativeFullscreenExit() {
  if (!deviceStore.isMobile) return;
  // CLAVE: NO navegar dentro del propio evento `webkitendfullscreen`. iOS todavía
  // está procesando la transición de SALIDA del fullscreen; si desmontamos el
  // <video> ahí, iOS queda en un estado sucio y el PRÓXIMO webkitEnterFullscreen
  // se IGNORA (la siguiente reproducción sale inline/negra) → bug "alternado".
  // Diferimos el cierre a un macrotask posterior, ya con la transición resuelta.
  setTimeout(() => closePlayer(true), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// AUTO-NEXT — preserva `scheduleAutoNext`/`preloadNextEpData`/
// `startAutoNextCountdown`/`cancelAutoNext`/`goToNextEpisode` (líneas ~8279-8402)
// ════════════════════════════════════════════════════════════════════════════
function cancelAutoNext() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  if (autoNextInterval) {
    clearInterval(autoNextInterval);
    autoNextInterval = null;
  }
  autoNextTriggered = false;
  autoNextEpisodeData = null;
  autoNextVisible.value = false;
  autoNextCountdownTransition.value = 'none';
  autoNextCountdownPct.value = 0;
}

async function preloadNextEpData() {
  try {
    const cur = playerStore.current;
    const nextEp = cur.episode < cur.totalEpisodes ? cur.episode + 1 : 1;
    const nextS = cur.episode < cur.totalEpisodes ? cur.season : cur.season + 1;
    const d = await tmdbClient
      .get<{ name?: string; overview?: string; still_path?: string | null }>(
        `/tv/${cur.id}/season/${nextS}/episode/${nextEp}?language=${LANG}`
      )
      .catch(() => null);
    autoNextEpisodeData = {
      season: nextS,
      episode: nextEp,
      title: d ? d.name || `Episodio ${nextEp}` : `Episodio ${nextEp}`,
      desc: d ? d.overview || '' : '',
      thumb: d && d.still_path ? `${IMG}w300${d.still_path}` : '',
    };
  } catch {
    autoNextEpisodeData = null;
  }
}

function startAutoNextCountdown() {
  if (autoNextTriggered) return;
  autoNextTriggered = true;

  const cur = playerStore.current;
  const nextEp = cur.episode < cur.totalEpisodes ? cur.episode + 1 : 1;
  const nextS = cur.episode < cur.totalEpisodes ? cur.season : cur.season + 1;
  const info = autoNextEpisodeData;

  autoNextEpNum.value = `E${nextEp}`;
  autoNextEpTitle.value = info ? info.title : `T${nextS} · Ep ${nextEp}`;
  autoNextEpDesc.value = info ? info.desc : '';
  autoNextThumb.value = info?.thumb || '';
  autoNextVisible.value = true;

  // Barra countdown 15s — transición CSS, igual que el original (líneas ~8351-8355)
  const SECS = 15;
  autoNextCountdownTransition.value = 'none';
  autoNextCountdownPct.value = 0;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      autoNextCountdownTransition.value = `width ${SECS}s linear`;
      autoNextCountdownPct.value = 100;
    })
  );

  let elapsed = 0;
  autoNextInterval = setInterval(() => {
    elapsed++;
    if (elapsed >= SECS) {
      if (autoNextInterval) clearInterval(autoNextInterval);
      autoNextInterval = null;
      cancelAutoNext();
      goToNextEpisode();
    }
  }, 1000);
}

function scheduleAutoNext() {
  cancelAutoNext();
  if (playerStore.current.type !== 'tv') return;

  preloadNextEpData();

  function doSchedule() {
    const runtime = playerStore.current.runtimeMin;
    const delay = autoNextDelayMs(runtime);
    if (autoNextTimer) clearTimeout(autoNextTimer);
    autoNextTimer = setTimeout(() => {
      const cur = playerStore.current;
      const canNext = canScheduleAutoNext({
        season: cur.season,
        episode: cur.episode,
        totalSeasons: cur.totalSeasons,
        totalEpisodes: cur.totalEpisodes,
      });
      if (canNext && !autoNextTriggered) startAutoNextCountdown();
    }, delay);
  }

  if (playerStore.current.runtimeMin > 0) {
    doSchedule();
  } else {
    const wait = runtimeFetchPromise
      ? runtimeFetchPromise.then(() => doSchedule()).catch(() => doSchedule())
      : new Promise((r) => setTimeout(r, 2000)).then(() => doSchedule());
    void wait;
  }
}

/** goToNextEpisode — preserva líneas ~8378-8402 (avanza episodio, o salta de temporada y refresca el conteo). */
async function goToNextEpisode() {
  cancelAutoNext();
  const cur = playerStore.current;
  if (cur.episode < cur.totalEpisodes) {
    playerStore.setEpisode(cur.season, cur.episode + 1);
    fetchEpisodeRuntime(cur.season, cur.episode + 1);
    loadActiveSource();
  } else if (cur.season < cur.totalSeasons) {
    const newSeason = cur.season + 1;
    playerStore.setEpisode(newSeason, 1);
    try {
      const sd = await tmdbClient
        .get<{ episodes?: unknown[] }>(`/tv/${cur.id}/season/${newSeason}?language=${LANG}`)
        .catch(() => ({ episodes: [] }));
      const epCount = sd.episodes?.length || 20;
      playerStore.setTotals(playerStore.current.totalSeasons, epCount);
    } catch {
      playerStore.setTotals(playerStore.current.totalSeasons, 20);
    }
    fetchEpisodeRuntime(newSeason, 1);
    loadActiveSource();
    showToast(`▶ Temporada ${newSeason}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RUNTIME — preserva `fetchEpisodeRuntime` (líneas ~7613-7617)
// ════════════════════════════════════════════════════════════════════════════
function fetchEpisodeRuntime(season: number, episode: number) {
  const id = playerStore.current.id;
  runtimeFetchPromise = tmdbClient
    .get<{ runtime?: number | null }>(`/tv/${id}/season/${season}/episode/${episode}?language=${LANG}`)
    .then((ep) => {
      const min = ep.runtime || 0;
      playerStore.setRuntime(min);
      return min;
    })
    .catch(() => {
      playerStore.setRuntime(0);
      return 0;
    });
}

// ════════════════════════════════════════════════════════════════════════════
// ANIME1V — preserva `_fetchAnimeServersForEpisode`/`_renderAnimeSourceSelector`/
// `selectAnimeServer`/`switchAnime1Lang`/`_loadUrlInPlayer` (líneas ~4549-4660)
// ════════════════════════════════════════════════════════════════════════════
function resetAnimeSelector() {
  animeServersCache.value = null;
  activeAnimeServerIdx.value = 0;
  selectedAnime1Lang.value = 'SUB';
}

async function fetchAnimeServersForEpisode(season: number, episode: number) {
  const myGen = playerStore.generation;
  const currentId = playerStore.current.id;
  if (currentId == null) return;
  resetAnimeSelector();
  const streamixUrl = buildIframeSourceUrl(SOURCES, 0, 'tv', currentId, season, episode);

  // Fallback baseline: si Anime1V no tiene el episodio, cargar StreamiX (UNA carga).
  const loadStreamixOnly = () => {
    if (playerStore.isStale(myGen)) return;
    animeServersCache.value = [{ label: '🇲🇽 StreamiX', url: streamixUrl, type: 'MX' as const }];
    activeAnimeServerIdx.value = 0;
    loadUrlInPlayer(streamixUrl);
  };

  try {
    if (!animeInfoCache) {
      const searchRes = await anime1Search(playerStore.current.animeTitle);
      const best = findBestMatch(playerStore.current.animeTitle, searchRes?.data?.results ?? null);
      if (!best) return loadStreamixOnly();
      const infoRes = await anime1Info(best.url);
      if (!infoRes?.data?.episodes?.length) return loadStreamixOnly();
      animeInfoCache = infoRes.data;
    }
    if (playerStore.isStale(myGen)) return;

    const targetEp = pickEpisodeByNumber(animeInfoCache.episodes ?? null, episode);
    if (!targetEp) return loadStreamixOnly();

    const epRes = await anime1Episode(targetEp.url);
    if (playerStore.isStale(myGen)) return;
    if (!epRes?.success) return loadStreamixOnly();

    const serverList = buildAnimeServerList(streamixUrl, epRes.data);
    animeServersCache.value = serverList;
    // UNA sola carga: HLS si existe, si no el primer servidor disponible.
    setTimeout(() => {
      if (playerStore.isStale(myGen)) return;
      const filtered = animeServerButtons.value.servers;
      const hlsIdx = filtered.findIndex((s) => /hls/i.test(s.label));
      if (hlsIdx >= 0) selectAnimeServer(hlsIdx);
      else selectAnimeServer(filtered.length > 1 ? 1 : 0);
    }, 0);
  } catch {
    loadStreamixOnly();
  }
}

function selectAnimeServer(idx: number) {
  const filtered = animeServerButtons.value.servers;
  if (!filtered[idx]) return;
  activeAnimeServerIdx.value = idx;
  loadUrlInPlayer(filtered[idx].url);
}

function switchAnime1Lang(lang: 'SUB' | 'DUB') {
  selectedAnime1Lang.value = lang;
  // Auto-seleccionar HLS del nuevo grupo
  setTimeout(() => {
    const filtered = animeServerButtons.value.servers;
    const hlsIdx = filtered.findIndex((s) => /hls/i.test(s.label));
    if (hlsIdx >= 0) selectAnimeServer(hlsIdx);
    else if (filtered.length > 0) selectAnimeServer(0);
  }, 0);
}

/** loadUrlInPlayer — preserva `_loadUrlInPlayer` (líneas ~4636-4659): carga una URL en el iframe sin reiniciar todo el reproductor. */
function loadUrlInPlayer(url: string) {
  if (!url) return;
  stopRdPlayback();
  iframeOnloadFired = false;
  iframeLoading.value = true;
  iframeLoadingText.value = `🔄 Cargando servidor...`;
  if (frameRef.value) {
    frameRef.value.onload = () => {
      iframeLoading.value = false;
    };
    frameRef.value.src = url;
  }
  setTimeout(() => {
    iframeLoading.value = false;
  }, 16000);
}

// ════════════════════════════════════════════════════════════════════════════
// CARGA DE FUENTES — preserva `loadPlayerSource` (líneas ~7717-8265)
// ════════════════════════════════════════════════════════════════════════════

/** stopRdPlayback — preserva `video.pause(); video.src=''` al inicio de cada `loadPlayerSource` (línea ~7748). */
function stopRdPlayback() {
  const v = videoPlayerRef.value?.videoRef;
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
  }
}

/**
 * @param blankIframe Si true (default), navega el iframe a `about:blank` para cortar su
 *   audio. ⚠️ Eso AGREGA una entrada al historial del navegador. En `closePlayer` se llama
 *   con `false`: blanquear ahí, ANTES de navegar, dejaba una entrada basura + pantalla
 *   blanca → "Volver" pedía dos clicks. Al cerrar, el audio se corta igual en
 *   `onBeforeUnmount` (que blanquea DESPUÉS de navegar) y al desmontarse el iframe.
 */
function stopIframePlayback(blankIframe = true) {
  if (iframeAutoFallbackTimer) {
    clearTimeout(iframeAutoFallbackTimer);
    iframeAutoFallbackTimer = null;
  }
  if (frameRef.value) {
    frameRef.value.onload = null;
    frameRef.value.onerror = null;
    if (blankIframe) frameRef.value.src = 'about:blank';
  }
}

/**
 * loadIframeSource — preserva la rama "no-RD" de `loadPlayerSource`
 * (líneas ~8189-8262): carga progresiva con auto-fallback a la siguiente
 * fuente si el `onload` del iframe no llega dentro del timeout.
 */
function loadIframeSource(srcIdx: number, myGen: number) {
  if (playerStore.isStale(myGen)) return;
  // `current.id` solo es `null` antes de `playerStore.load()` — `init()` siempre
  // llama `load()` antes de poder llegar aquí, pero TS no puede inferirlo a través
  // del store; guard explícito para angostar `string | number | null` → `string | number`.
  if (playerStore.current.id == null) return;
  iframeOnloadFired = false;
  if (iframeAutoFallbackTimer) {
    clearTimeout(iframeAutoFallbackTimer);
    iframeAutoFallbackTimer = null;
  }

  const isTV = deviceStore.isTV;
  const srcUrl = buildIframeSourceUrl(
    SOURCES,
    srcIdx,
    playerStore.current.type,
    playerStore.current.id,
    playerStore.current.season,
    playerStore.current.episode
  );

  playerStore.setSourceIndex(srcIdx);

  iframeLoadingText.value =
    srcIdx === 0 ? '🔌 Conectando con el servidor...' : `🔄 Probando ${SOURCES[srcIdx]?.name ?? 'siguiente fuente'}...`;

  const frame = frameRef.value;
  if (!frame) return;

  frame.onload = () => {
    if (iframeOnloadFired) return;
    iframeOnloadFired = true;
    if (iframeAutoFallbackTimer) {
      clearTimeout(iframeAutoFallbackTimer);
      iframeAutoFallbackTimer = null;
    }
    setTimeout(hideLoadingAndStart, isTV ? 600 : 0);
  };

  frame.src = 'about:blank';
  setTimeout(() => {
    if (playerStore.isStale(myGen)) return;
    if (frameRef.value) frameRef.value.src = srcUrl;
  }, 50);

  // Fuente 0 (UnlimPlay) tarda ~15s en scraping; las demás son más rápidas (línea ~8243-8245)
  const timeoutMs = srcIdx === 0 ? (isTV ? 22000 : 16000) : isTV ? 14000 : 10000;

  iframeAutoFallbackTimer = setTimeout(() => {
    if (playerStore.isStale(myGen)) return;
    clearIframeMsgTimers();
    if (!iframeOnloadFired) {
      const nextIdx = srcIdx + 1;
      if (nextIdx < SOURCES.length) {
        loadIframeSource(nextIdx, myGen);
        return;
      }
      iframeOnloadFired = true;
    
      startProgressTracking();
      if (playerStore.current.type === 'tv') scheduleAutoNext();
    }
    iframeLoading.value = false;
  }, timeoutMs);
}

/**
 * loadActiveSource — el orquestador maestro, preserva el cuerpo de
 * `loadPlayerSource` (líneas ~7717-8265): cancela todo lo pendiente,
 * resetea ambos reproductores, decide RD vs iframe según
 * `playerStore.sourceIndex`, y dispara el camino correspondiente.
 */
function loadActiveSource() {
  const myGen = playerStore.bumpGeneration();
  cancelAutoNext();
  stopProgressTracking();
  stopRdPlayback();
  stopIframePlayback();

  iframeLoading.value = true;
  iframeLoadingText.value = '🔌 Conectando con el servidor...';
  scheduleIframeLoadingMessages();

  // ── Anime: NUNCA pasa por RD, y carga UNA sola vez ──
  // RD para anime es errático (raws japoneses). Además, cargar StreamiX y después
  // pisarlo con HLS generaba DOS cargas (flash "otro reproductor" + doble back).
  // `fetchAnimeServersForEpisode` hace UNA sola carga (HLS si existe, si no StreamiX).
  if (isAnime.value) {
    if (isRdSource.value) playerStore.setSourceIndex(0);
    animeServersCache.value = null;
    fetchAnimeServersForEpisode(playerStore.current.season, playerStore.current.episode);
    return; // NO caer a loadIframeSource → evita la doble carga
  }

  if (isRdSource.value) {
    // ── REAL-DEBRID — delega en <VideoPlayer>/usePlayer.loadRdSource ──
    // `currentId` angosta `string | number | null` → `string | number` (ver nota
    // en `loadIframeSource`); `current.id` ya está garantizado no-nulo aquí porque
    // `init()` siempre corre `playerStore.load()` antes de `loadActiveSource()`.
    const currentId = playerStore.current.id;
    if (currentId != null) {
      void videoPlayerRef.value?.loadRdSource({
        id: currentId,
        type: playerStore.current.type,
        season: playerStore.current.season,
        episode: playerStore.current.episode,
      });
    }
  } else {
    // ── IFRAME (UnlimPlay/vidlink) — carga progresiva con auto-fallback ──
    loadIframeSource(playerStore.sourceIndex === RD_SRC_IDX ? 0 : playerStore.sourceIndex, myGen);
  }
}

/** switchSource — preserva líneas ~8557-8565 (clic MANUAL del usuario en un botón de fuente). */
function switchSource(idx: number) {
  if (!playerStore.current.id) return;
  playerStore.setSourceIndex(idx);
  loadActiveSource();
  showToast(sourceToastLabel(SOURCES, idx));
}

/**
 * fallbackToFirstSource — preserva el camino INTERNO de auto-fallback de RD
 * (`playerState._srcIdx = 0; loadPlayerSource();`, líneas ~7831/8003/8021/8104/
 * 8121/8131/8143/8149/8155/8164/8170/8176/8184): el original NUNCA pasa por
 * `switchSource` en estos casos, así que NO emite el toast adicional
 * `${SOURCES[0].icon} ${SOURCES[0].name}` — solo el toast específico del
 * motivo de la falla (p.ej. "⚡ RD: no compatible — cambiando de reproductor"),
 * que ya disparó `usePlayer`/`loadRdSource` antes de emitir `fallback-to-next-source`.
 *
 * ⚠️ Usar `switchSource(0)` aquí (como antes) duplicaba el toast — el usuario
 * veía "⚡ RD: ... cambiando de reproductor" SEGUIDO de "▶ UnlimPlay" apilados,
 * dando la sensación de "salta de un reproductor a otro" sin que eso ocurriera
 * realmente en el original.
 */
function fallbackToFirstSource() {
  if (!playerStore.current.id) return;
  playerStore.setSourceIndex(0);
  loadActiveSource();
}

// ════════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN DE EPISODIOS — la selección de temporada/episodio vive ahora en el
// panel estilo Netflix (`EpisodePanel` → `onPanelPlay`/`onPanelSelectSeason`) y la
// card "Siguiente" (`triggerNextEpisode`). Los antiguos dropdowns + botones
// Anterior/Siguiente se removieron junto con `changeSeason`/`changeEpisode`/
// `nextEpisode`/`prevEpisode`.
// ════════════════════════════════════════════════════════════════════════════
function triggerNextEpisode() {
  cancelAutoNext();
  void goToNextEpisode();
}

// ════════════════════════════════════════════════════════════════════════════
// CIERRE — preserva `closePlayer` (líneas ~8735-8810)
// ════════════════════════════════════════════════════════════════════════════
function persistProgressOnClose() {
  if (!playerStore.current.id) return;
  const positionSec = getRealPositionSec();
  const runtimeSec = (playerStore.current.runtimeMin || 22) * 60;
  const pct = runtimeSec > 0 ? Math.min((positionSec / runtimeSec) * 100, 95) : 0;
  if (!shouldPersistProgressOnClose(pct)) return;
  if (playerStore.current.type === 'tv') {
    progressStore.save(playerStore.current.id, 'tv', { pct, positionSec: Math.floor(positionSec), season: playerStore.current.season, episode: playerStore.current.episode, title: playerStore.current.title });
  } else {
    progressStore.save(playerStore.current.id, 'movie', { pct, positionSec: Math.floor(positionSec), title: playerStore.current.title });
  }
}

function closePlayer(forceDetail = false) {
  fullscreen.exit();
  persistProgressOnClose();
  stopProgressTracking();
  cancelAutoNext();
  stopRdPlayback();
  stopIframePlayback(false); // NO blanquear acá: agregaría entrada al historial → doble-back. Lo hace onBeforeUnmount tras navegar.
  clearIframeMsgTimers();
  if (controlsHideTimeout) {
    clearTimeout(controlsHideTimeout);
    controlsHideTimeout = null;
  }
  runtimeFetchPromise = null;
  const cur = playerStore.current;
  const detailRoute =
    cur.type === 'movie' ? `/pelicula/${cur.id}` : `/serie/${cur.id}/${cur.season}/${cur.episode}`;
  // Solo invalidar async pendiente (bumpGeneration) SIN resetear sourceIndex:
  // resetearlo a RD_SRC_IDX acá hace que el reproductor RD parpadee al volver.
  // El reset completo (`close()`) lo hace `onBeforeUnmount` al desmontar.
  playerStore.bumpGeneration();
  document.body.style.overflow = '';
  // CÓMO VOLVER — depende de si el historial quedó limpio o contaminado:
  // • Camino RD/video (sin iframe): el stack es [catálogo → detalle → player] LIMPIO, así
  //   que `router.back()` cae en el detalle, que conserva su propio `back` hacia el
  //   catálogo/filtro (p.ej. /peliculas?genero=27) → "Volver" del detalle respeta el filtro.
  // • Camino iframe (anime/UnlimPlay): al cargar, `iframe.src` crea una entrada DUPLICADA
  //   de la ruta del player (misma `/ver/tv/...`) que ADEMÁS hereda `history.state.back`
  //   apuntando al detalle. Por eso NO sirve mirar `state.back` (parece el detalle pero hay
  //   una entrada del player en el medio): `router.back()` caía en esa entrada duplicada y
  //   "Volver" pedía dos clicks. Solución: en iframe vamos DIRECTO al detalle con `push`.
  // forceDetail (mobile, salida del fullscreen nativo): navegación DETERMINISTA al
  // detalle con replace — NO depende del historial (que en mobile puede tener una
  // entrada intermedia y obligar a tocar la X dos veces). replace deja el stack en
  // [catálogo → detalle], así que el "Volver" del detalle sigue funcionando.
  if (forceDetail && cur.id != null) {
    router.replace(detailRoute);
    return;
  }
  const prevEntry =
    typeof window !== 'undefined' && window.history.state ? window.history.state.back : null;
  const cameFromDetail =
    typeof prevEntry === 'string' && (prevEntry.startsWith('/pelicula/') || prevEntry.startsWith('/serie/'));
  if (isRdSource.value && cameFromDetail) router.back();
  else if (cur.id != null) router.push(detailRoute);
  else router.back();
  // ── TV: ocultar la BARRA DEL NAVEGADOR (webOS) al volver ─────────────────────
  // Tras el ciclo de reproducción, webOS re-muestra su barra (URL/controles) y tapa
  // el nav. El ÚNICO modo fiable de ocultarla es el Fullscreen API; el clic en
  // "Volver" es un GESTO del usuario, así que está permitido pedirlo. El nav usa
  // `position: sticky` (NO `fixed`) justamente para que SOBREVIVA al fullscreen de
  // webkit (donde `fixed` deja de pegarse al scrollear). No hacemos `exitFullscreen`
  // en TV (ver useFullscreen), así que queda oculta de forma estable.
  if (deviceStore.isTV) {
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      /* silenciar */
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN — preserva `openPlayer` (líneas ~7535-7613)
// ════════════════════════════════════════════════════════════════════════════
interface DetailPayload {
  title?: string;
  name?: string;
  number_of_seasons?: number | null;
  runtime?: number | null;
}

async function init() {
  const id = props.id;
  const type = props.type;

  document.body.style.overflow = 'hidden';
  controlsHidden.value = false;
  armControlsHide(); // auto-oculta el topbar tras 3.5s (desktop y táctil)

  // Resolver temporada/episodio inicial — preserva `getProgress`+overrides de la URL (línea ~7548-7549)
  const saved = progressStore.get(id, type);
  const startSeason = props.season || (type === 'tv' && saved?.season) || 1;
  const startEpisode = props.episode || (type === 'tv' && saved?.episode) || 1;

  let detailTitle = '';
  let totalSeasons = 1;
  let movieRuntime = 0;
  try {
    const endpoint = type === 'tv' ? `/tv/${id}?language=${LANG}` : `/movie/${id}?language=${LANG}`;
    const data = await tmdbClient.get<DetailPayload>(endpoint);
    detailTitle = data.title || data.name || '';
    totalSeasons = data.number_of_seasons || 1;
    movieRuntime = data.runtime || 0; // duración de la peli (min) → fallback de duración del player
  } catch {
    /* silenciar — preserva el modo degradado del original (título queda vacío, totalSeasons=1) */
  }

  playerStore.load({
    id,
    type,
    season: startSeason,
    episode: startEpisode,
    totalSeasons,
    totalEpisodes: 0,
    title: detailTitle,
    runtimeMin: type === 'movie' ? movieRuntime : 0,
  });

  if (type === 'tv') {
    try {
      const sd = await tmdbClient.get<{ episodes?: unknown[] }>(`/tv/${id}/season/${startSeason}?language=${LANG}`).catch(() => ({ episodes: [] }));
      const epCount = sd.episodes?.length && sd.episodes.length > 0 ? sd.episodes.length : 20;
      playerStore.setTotals(totalSeasons, epCount);
      fetchEpisodeRuntime(startSeason, startEpisode);
    } catch {
      playerStore.setTotals(totalSeasons, 20);
    }
  }

  // Anime: precargar selector mostrando StreamiX inmediatamente (preserva línea ~7589-7593)
  if (isAnime.value) {
    animeInfoCache = null; // anime nuevo → no reutilizar caché de otro título
    resetAnimeSelector();
  }

  loadActiveSource();
}

// Listener de actividad a nivel `document`: en fullscreen nativo (sobre todo del
// `<video>` de RD) el `mousemove` no siempre burbujea al `.player-page`, pero sí
// llega al documento. Así "mover el puntero → mostrar controles" funciona también
// en pantalla completa. Sobre el iframe cross-origin no dispara (lo cubre el overlay).
const onDocActivity = () => onPlayerActivity();
onMounted(() => {
  void init();
  document.addEventListener('mousemove', onDocActivity);
});

onBeforeUnmount(() => {
  fullscreen.exit();
  stopProgressTracking();
  cancelAutoNext();
  clearIframeMsgTimers();
  document.removeEventListener('mousemove', onDocActivity);
  if (iframeAutoFallbackTimer) clearTimeout(iframeAutoFallbackTimer);
  if (controlsHideTimeout) clearTimeout(controlsHideTimeout);
  if (nextCloseTimer) clearTimeout(nextCloseTimer);
  if (listCloseTimer) clearTimeout(listCloseTimer);
  // Vaciar el iframe (UnlimPlay/vidlink) → corta su audio al volver (igual que el
  // <video> de RD, que se pausa en usePlayer.destroy()).
  if (frameRef.value) {
    try {
      frameRef.value.src = 'about:blank';
    } catch {
      /* silenciar */
    }
  }
  document.body.style.overflow = '';
  playerStore.close();
});
</script>

<template>
  <div
    ref="playerPageRef"
    class="player-page"
    :class="{ 'controls-hidden': controlsHidden }"
    @mousemove="onPlayerActivity"
  >
    <button class="player-back" :class="{ 'icon-close-mode': deviceStore.isMobile }" title="Volver" @click="closePlayer()">
      <svg v-if="!deviceStore.isMobile" class="icon-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <svg v-else class="icon-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <div class="player-topbar">
      <div class="player-title">{{ title }}</div>
      <div class="player-ep-info">{{ epInfo }}</div>

      <!-- Selector de fuentes — preserva líneas ~7798-7813 -->
      <div v-if="showSourceSelector" class="source-selector">
        <button
          v-for="btn in sourceButtons"
          :key="btn.idx"
          class="source-btn"
          :class="{ active: btn.active }"
          :title="btn.isRd ? 'Real-Debrid — streams HD, sin anuncios' : btn.label"
          @click="switchSource(btn.idx)"
        >
          {{ btn.icon }} {{ btn.label }}
        </button>
      </div>

      <!-- Selector de servidores Anime1V — preserva `_renderAnimeSourceSelector` -->
      <div v-else class="source-selector">
        <template v-if="animeServerButtons.showLangToggle">
          <button class="source-btn" :class="{ active: animeServerButtons.subActive }" @click="switchAnime1Lang('SUB')">🇯🇵 SUB</button>
          <button class="source-btn" :class="{ active: !animeServerButtons.subActive }" @click="switchAnime1Lang('DUB')">🇲🇽 DUB</button>
          <div class="source-sep"></div>
        </template>
        <button
          v-for="(srv, i) in animeServerButtons.servers"
          :key="i"
          class="source-btn"
          :class="{ active: i === activeAnimeServerIdx }"
          :title="srv.label"
          @click="selectAnimeServer(i)"
        >
          {{ srv.label }}
        </button>
      </div>

      <!-- #btnCast — NO portado: deshabilitado en el original (`display:none !important` / "Enviar a TV eliminado", línea 2282). Ver nota en <script>. -->
      <!-- ⛶ del topbar: en móvil/tablet/desktop SOLO se muestra para fuentes iframe (que NO
           tienen la barra de controles propia con su ⛶). En el camino RD se oculta para dejar
           un único botón de fullscreen abajo (patrón estándar). En TV siempre visible (se navega
           con control remoto y la barra inferior se auto-oculta). -->
      <button v-if="deviceStore.isTV || !isRdSource" ref="fullscreenIconRef" class="player-fullscreen-btn" title="Pantalla completa" @click="fullscreen.toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path :d="fullscreen.isFullscreen.value ? FULLSCREEN_PATH_D.enter : FULLSCREEN_PATH_D.exit" />
        </svg>
      </button>
    </div>

    <div class="player-frame-wrap">
      <!-- Overlay de carga del camino iframe — preserva #playerLoading (línea ~3740) -->
      <div v-show="iframeLoading && !isRdSource" class="player-loading">
        <div class="spinner"></div>
        <p class="player-loading-text">{{ iframeLoadingText }}</p>
        <p class="player-loading-hint">El servidor obtiene el contenido en tiempo real.<br />Puede tardar hasta 15 segundos.</p>
      </div>

      <!-- Real-Debrid — siempre montado, mostrado vía v-show -->
      <div v-show="isRdSource" class="rd-wrap">
        <VideoPlayer ref="videoPlayerRef" :rd-stream-resolver="rdStreamResolver" :rd-client="rdClient" :title="title" :runtime-sec="(playerStore.current.runtimeMin || 0) * 60" :page-fullscreen="fullscreen.isFullscreen.value" @started="onRdStarted" @fallback-to-next-source="fallbackToFirstSource" @toggle-fullscreen="fullscreen.toggle" @native-fullscreen-exit="onNativeFullscreenExit">
          <template v-if="showEpisodeControls" #episode-triggers>
            <EpisodeTriggers
              @next-enter="onNextEnter" @next-leave="onNextLeave" @next-tap="onNextTap"
              @list-enter="onListEnter" @list-leave="onListLeave" @list-tap="onListTap"
            />
          </template>
        </VideoPlayer>
      </div>

      <!-- Iframe (UnlimPlay/vidlink/Anime1V) — siempre montado, mostrado vía v-show -->
      <iframe
        v-show="!isRdSource"
        ref="frameRef"
        class="player-frame"
        tabindex="0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        referrerpolicy="no-referrer"
      ></iframe>

      <!-- Captador de actividad sobre el iframe (cross-origin no manda mousemove al padre).
           Solo activo cuando los controles están OCULTOS: captura el 1er movimiento para
           revelarlos y luego se desactiva (pointer-events:none) para no bloquear el iframe. -->
      <div
        v-show="!isRdSource && controlsHidden"
        class="iframe-activity-catcher"
        @mousemove="onPlayerActivity"
        @click="onPlayerActivity"
      ></div>
    </div>

    <!-- Banner auto-next — preserva #autonextBanner (líneas ~3855-3873) -->
    <div class="autonext-banner" :class="{ show: autoNextVisible }">
      <div class="autonext-thumb">
        <img v-if="autoNextThumb" :src="autoNextThumb" alt="" />
        <div class="autonext-thumb-overlay">
          <span style="font-size: 0.72rem; color: rgba(255, 255, 255, 0.7)">A continuación</span>
        </div>
        <div class="autonext-countdown-bar">
          <div class="autonext-countdown-fill" :style="{ width: autoNextCountdownPct + '%', transition: autoNextCountdownTransition }"></div>
        </div>
      </div>
      <div class="autonext-body">
        <div class="autonext-label">
          <div class="autonext-label-num">{{ autoNextEpNum }}</div>
          Siguiente episodio
        </div>
        <div class="autonext-ep-title">{{ autoNextEpTitle }}</div>
        <div class="autonext-ep-desc">{{ autoNextEpDesc }}</div>
        <div class="autonext-actions">
          <button class="autonext-play" @click="triggerNextEpisode">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Ver ahora
          </button>
          <button class="autonext-cancel" @click="cancelAutoNext">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Mini-barra de episodios para IFRAME/anime (el camino RD los pone en su propia
         barra de controles vía slot). Solo series/anime, y se oculta con los controles. -->
    <div v-if="showEpisodeControls && !isRdSource" class="ep-iframe-bar" :class="{ hidden: controlsHidden }">
      <EpisodeTriggers
        @next-enter="onNextEnter" @next-leave="onNextLeave" @next-tap="onNextTap"
        @list-enter="onListEnter" @list-leave="onListLeave" @list-tap="onListTap"
      />
      <!-- ⛶ del player (CLICK, no hover): fullscreen NUESTRO (de página), que conserva los
           controles de episodios — a diferencia del ⛶ interno del iframe (fullscreen nativo). -->
      <button class="ep-fs-btn" title="Pantalla completa" aria-label="Pantalla completa" @click="fullscreen.toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path :d="fullscreen.isFullscreen.value ? FULLSCREEN_PATH_D.enter : FULLSCREEN_PATH_D.exit" />
        </svg>
      </button>
    </div>

    <!-- Card "Siguiente episodio" (hover sobre ⏭). En iframe/anime va centrada sobre el
         botón (que está al medio); en RD va a la esquina (el ⏭ está en la barra). -->
    <NextEpisodeCard
      :open="nextCardOpen"
      :loading="nextCardLoading"
      :episode="nextEpisodeMeta"
      :centered="!isRdSource"
      @play="playNextFromCard"
      @hover-keep="onNextCardKeep"
      @hover-end="onNextCardEnd"
    />

    <!-- Panel de episodios estilo Netflix (hover sobre ⧉, entra desde la derecha) -->
    <EpisodePanel
      :open="episodePanelOpen"
      :loading="episodePanelLoading"
      :episodes="viewedEpisodes"
      :viewed-season="viewedSeason"
      :seasons="seasonOpts"
      :playing-season="playerStore.current.season"
      :playing-episode="playerStore.current.episode"
      @close="episodePanelOpen = false"
      @select-season="onPanelSelectSeason"
      @play="onPanelPlay"
      @hover-keep="onPanelHoverKeep"
      @hover-end="onPanelHoverEnd"
    />
  </div>
</template>

<style scoped>
/* ── Página completa — preserva `.player-page`/`.controls-hidden` (líneas ~907-911, ~1010-1024) ── */
.player-page {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 400;
  display: flex;
  flex-direction: column;
  contain: layout style;
  isolation: isolate;
}

/* ── Botón volver — preserva `.player-back` (líneas ~952-984) ── */
.player-back {
  background: rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.9;
  transition: opacity 0.2s, transform 0.2s, background 0.2s;
  position: absolute;
  top: 60px;
  left: 16px;
  z-index: 20;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.player-back svg {
  width: 28px;
  height: 28px;
}
.player-back:hover,
.player-back:focus {
  opacity: 1;
  transform: scale(1.08);
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.5);
  outline: none;
}
/* La flecha Volver se oculta junto con el resto al inactivarse (en RD e iframe).
   ⚠️ Nota: sobre un iframe (UnlimPlay/vidlink) el `mousemove` no burbujea al
   padre, así que para reaparecer los controles hay que mover el mouse hacia la
   franja superior/inferior (zonas de la propia página, no del iframe) o pulsar
   Escape para salir. */
.player-page.controls-hidden .player-back {
  opacity: 0;
  pointer-events: none;
}
/* Flecha en desktop/TV, ✕ en mobile — preserva `.icon-arrow`/`.icon-close` (líneas ~1083-1088) */
.icon-close-mode .icon-arrow {
  display: none;
}
.icon-close-mode .icon-close {
  display: flex;
}

/* ── Topbar — preserva `.player-topbar`/`.player-title`/`.player-ep-info`/`.source-selector` (líneas ~1029-1048, ~1089-1090) ── */
.player-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 22px 40px 88px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.96) 0%, rgba(0, 0, 0, 0.65) 55%, transparent 100%);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  opacity: 1;
  transition: opacity 0.4s ease;
  pointer-events: none;
}
.player-topbar > * {
  pointer-events: auto;
}
.player-page.controls-hidden .player-topbar {
  opacity: 0;
  pointer-events: none;
}
.player-title {
  font-family: 'Oswald', sans-serif;
  font-weight: 600;
  font-size: 1.1rem;
  letter-spacing: 0.5px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
}
.player-ep-info {
  font-size: 0.76rem;
  color: var(--text-muted, #9a9a9a);
  white-space: nowrap;
}
.source-selector {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  align-items: center;
}
.source-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
  flex-shrink: 0;
}
.source-btn {
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Roboto', sans-serif;
  white-space: nowrap;
}
.source-btn:hover,
.source-btn.active {
  background: var(--accent, #3d5afe);
  color: #000;
  border-color: var(--accent, #3d5afe);
}
.source-btn:focus,
.player-back:focus,
.player-fullscreen-btn:focus {
  outline: none;
}
html.tv-mode .source-btn:focus {
  box-shadow: 0 0 0 2px rgba(61, 90, 254, 0.7);
}
.player-fullscreen-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  color: #fff;
  opacity: 0.85;
  display: flex;
  align-items: center;
  transition: opacity 0.25s ease;
}
.player-fullscreen-btn:hover {
  opacity: 1;
}
.player-fullscreen-btn svg {
  width: 20px;
  height: 20px;
}

/* ── Área del video/iframe — preserva `.player-frame-wrap`/`#playerFrame`/`.player-loading` (líneas ~1262-1278) ── */
.player-frame-wrap {
  flex: 1;
  position: relative;
  isolation: isolate;
  will-change: transform;
}
.rd-wrap,
.player-frame {
  width: 100%;
  height: 100%;
  border: none;
  position: absolute;
  inset: 0;
}
/* Captador de actividad sobre el iframe — transparente, solo visible (v-show) cuando
   los controles están ocultos. Al moverse el mouse revela los controles y desaparece,
   dejando el iframe interactivo. */
.iframe-activity-catcher {
  position: absolute;
  inset: 0;
  z-index: 9;
  background: transparent;
  cursor: default;
}
/* Mini-barra de episodios para iframe/anime (RD usa su propia barra de controles).
   Centrada-abajo (no en la esquina) para no chocar con los controles propios del
   iframe (captura/PiP); se oculta junto con el resto de los controles. */
.ep-iframe-bar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: var(--radius-lg, 8px);
  backdrop-filter: blur(4px);
  transition: opacity var(--trans, 0.25s ease), transform var(--trans, 0.25s ease);
}
.ep-iframe-bar.hidden {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
  pointer-events: none;
}
.ep-fs-btn {
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
.ep-fs-btn:hover,
.ep-fs-btn:focus-visible {
  opacity: 1;
}
.ep-fs-btn svg {
  width: 22px;
  height: 22px;
}
.player-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.92);
  z-index: 5;
  transition: opacity 0.25s ease;
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
.spinner {
  width: 38px;
  height: 38px;
  border: 3px solid rgba(255, 255, 255, 0.18);
  border-top-color: var(--accent, #3d5afe);
  border-radius: 50%;
  animation: player-spin 0.9s linear infinite;
}
@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Botón "Sig. Ep ›" flotante — preserva `.player-next-ep-btn` (líneas ~700-712) ── */
.player-next-ep-btn {
  position: absolute;
  bottom: 20px;
  right: 16px;
  z-index: 11;
  background: rgba(14, 14, 14, 0.82);
  border: 1px solid rgba(61, 90, 254, 0.35);
  color: var(--accent, #3d5afe);
  padding: 7px 14px;
  border-radius: var(--radius, 8px);
  font-family: 'Roboto', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  display: none;
  align-items: center;
  gap: 5px;
  transition: opacity 0.3s ease;
  white-space: nowrap;
  opacity: 0;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.player-next-ep-btn.visible-btn {
  display: flex;
}
.player-page.controls-hidden .player-next-ep-btn.visible-btn {
  opacity: 1;
}
.player-page:not(.controls-hidden) .player-next-ep-btn {
  opacity: 0 !important;
  pointer-events: none !important;
}

/* ── Banner auto-next — preserva `.autonext-banner`/`.autonext-*` (líneas ~620-693) ── */
.autonext-banner {
  position: absolute;
  bottom: 90px;
  right: 24px;
  z-index: 25;
  background: rgba(14, 14, 14, 0.98);
  border: 1px solid rgba(61, 90, 254, 0.25);
  border-radius: var(--radius-lg, 12px);
  padding: 0;
  width: 320px;
  display: none;
  flex-direction: column;
  animation: slideInRight 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.autonext-banner.show {
  display: flex;
  pointer-events: all;
  opacity: 1;
}
@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(32px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
.autonext-thumb {
  position: relative;
  width: 100%;
  height: 135px;
  background: var(--surface2, #1c1c1c);
  overflow: hidden;
}
.autonext-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.autonext-thumb-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(14, 14, 14, 0.9) 0%, rgba(14, 14, 14, 0.2) 60%);
  display: flex;
  align-items: flex-end;
  padding: 10px;
}
.autonext-countdown-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
}
.autonext-countdown-fill {
  height: 100%;
  background: var(--accent, #3d5afe);
  width: 0%;
}
.autonext-body {
  padding: 12px 14px 14px;
}
.autonext-label {
  font-size: 0.62rem;
  color: var(--accent, #3d5afe);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 700;
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.autonext-label-num {
  background: var(--accent, #3d5afe);
  color: #000;
  font-size: 0.6rem;
  font-weight: 900;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.autonext-ep-title {
  font-size: 0.84rem;
  font-weight: 700;
  margin-bottom: 4px;
  line-height: 1.3;
}
.autonext-ep-desc {
  font-size: 0.68rem;
  color: var(--text-muted, #9a9a9a);
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.autonext-actions {
  display: flex;
  gap: 8px;
}
.autonext-play {
  flex: 1;
  padding: 8px 14px;
  border-radius: var(--radius, 8px);
  background: var(--accent, #3d5afe);
  color: #000;
  border: none;
  font-family: 'Roboto', sans-serif;
  font-weight: 700;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.25s;
}
.autonext-play:hover {
  background: var(--accent2, #5c7cfa);
}
.autonext-cancel {
  padding: 8px 12px;
  border-radius: var(--radius, 8px);
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-muted, #9a9a9a);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-family: 'Roboto', sans-serif;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.25s;
}
.autonext-cancel:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

/* ── Controles de episodio — preserva `.player-bottom`/`.ep-*` (líneas ~1339-1399) ── */
.player-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.94) 0%, rgba(0, 0, 0, 0.78) 45%, rgba(0, 0, 0, 0.3) 75%, transparent 100%);
  padding: 64px 0 max(20px, env(safe-area-inset-bottom, 20px));
  display: flex;
  align-items: flex-end;
  justify-content: center;
  opacity: 1;
  transition: opacity 0.4s ease;
  pointer-events: none;
}
.player-page.controls-hidden .player-bottom {
  opacity: 0;
  pointer-events: none;
}
.player-bottom > * {
  pointer-events: auto;
}
.ep-controls-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}
.ep-label {
  font-size: 0.62rem;
  color: rgba(255, 255, 255, 0.42);
  letter-spacing: 1px;
  text-transform: uppercase;
  font-weight: 700;
  white-space: nowrap;
  margin-right: 2px;
}
.ep-select {
  background: rgba(28, 28, 28, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  padding: 6px 26px 6px 12px;
  border-radius: 6px;
  font-family: 'Roboto', sans-serif;
  font-size: 0.76rem;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,255,255,0.45)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  min-width: 118px;
}
.ep-select:hover,
.ep-select:focus {
  border-color: rgba(255, 255, 255, 0.5);
  background-color: rgba(50, 50, 50, 0.92);
}
.ep-select option {
  background: #1a1a1a;
}
.ep-sep {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 4px;
  flex-shrink: 0;
}
.ep-nav-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(28, 28, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.88);
  padding: 6px 15px;
  border-radius: 6px;
  font-family: 'Roboto', sans-serif;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}
.ep-nav-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.85;
}
.ep-nav-btn:hover {
  background: rgba(60, 60, 60, 0.92);
  border-color: rgba(255, 255, 255, 0.38);
  color: #fff;
}
.ep-nav-btn.next-btn {
  background: rgba(61, 90, 254, 0.12);
  border-color: rgba(61, 90, 254, 0.3);
  color: var(--accent, #3d5afe);
}
.ep-nav-btn.next-btn:hover {
  background: rgba(61, 90, 254, 0.22);
  border-color: var(--accent, #3d5afe);
}

/* ── Mobile — preserva overrides de `@media(max-width:768px)` (líneas ~1740-1800) ── */
@media (max-width: 768px) {
  .player-topbar {
    padding: 10px 14px 30px 78px;
    gap: 8px;
  }
  .player-title {
    font-size: 0.92rem;
  }
  .ep-controls-row {
    gap: 4px;
  }
  .ep-select {
    min-width: 92px;
    font-size: 0.7rem;
    padding: 5px 22px 5px 10px;
  }
  .ep-nav-btn {
    padding: 5px 10px;
    font-size: 0.7rem;
  }
  .ep-label {
    display: none;
  }
  .autonext-banner {
    width: 260px;
    right: 12px;
    bottom: 76px;
  }
  .source-selector {
    display: none !important;
  }
  /* La X de cerrar SIEMPRE clickeable en mobile — sin esto el primer toque solo
     reaparece los controles y hace falta un segundo toque para cerrar. */
  .player-page.controls-hidden .player-back {
    opacity: 1;
    pointer-events: auto;
  }
}

/* ── TV mode — preserva overrides de líneas ~2270-2400 ── */
/* En el original el player se abría con `.player-page.active`; en la migración
   `.player-page` es la vista de ruta (siempre "activa") y NUNCA recibe `.active`,
   por lo que esa regla quedaba muerta y se perdía la promoción de capa GPU de la
   página → en TV el video caía a un overlay de hardware ("pantalla azul"). Se
   aplica directo a `.player-page` para restaurar el comportamiento del original. */
:global(html.tv-mode) .player-page {
  /* Forzar el player a pantalla completa en TV — PRESERVADO del original
     (index.html ~2099): la migración había perdido este `width/height: 100v*`,
     por eso en TV el player quedaba achicado en una franja y el resto azul. */
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  bottom: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  padding: 0 !important;
  margin: 0 !important;
  will-change: transform;
  transform: translateZ(0);
}
:global(html.tv-mode) .player-back {
  width: 60px;
  height: 60px;
  top: 64px;
  left: 20px;
}
:global(html.tv-mode) .player-back svg {
  width: 32px;
  height: 32px;
  stroke-width: 2.2;
}
/* El hover/foco del botón Volver en TV se define en `style.css` (global): aquí en
   scoped, `:global(html.tv-mode) .x:focus` rompía el compilador y aplicaba los
   estilos a `<html>` entero (fondo azul tras ver una película). */
</style>
