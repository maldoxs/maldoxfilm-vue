<script setup lang="ts">
/**
 * DetailView — página de detalle de película/serie: hero con backdrop,
 * título/meta/sinopsis, acciones (Reproducir/Mi Lista/Volver), grid de
 * estadísticas, reparto, tráilers (modal de YouTube), tabs de
 * temporada+grid de episodios (series) y recomendaciones.
 *
 * Reemplaza `showDetailPage`/`dpHideDetail`/`dpLoadDetail`/`dpRenderPage`/
 * `dpLoadSeason`/`dpToggleList`/`dpOpenTM`/`dpCloseTM`/`_mlInList`
 * (líneas ~8849-9057 de assets/index.html).
 *
 * Props — vienen del router (`/pelicula/:id` y `/serie/:id/:s/:e`, ver
 * `router/index.ts`): `season`/`episode` solo existen para series y se usan
 * como temporada/episodio iniciales (deep-link directo a una temporada
 * concreta — útil para "Continuar viendo"/recomendaciones, algo que el
 * original no podía hacer porque `showDetailPage(id,type)` no llevaba esa
 * información en la URL. GANANCIA REAL: compartir/recargar el link conserva
 * la temporada activa).
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAppServices } from '../composables/useAppServices';
import { useMyListStore } from '../stores/myList';
import { useProgressStore } from '../stores/progress';
import { usePlayerStore } from '../stores/player';
import { useDeviceStore } from '../stores/device';
import { useToast } from '../composables/useToast';
import {
  TMDB_IMG_BASE,
  posterSize,
  resolveMediaType,
  dedupeRecommendations,
  filterYoutubeTrailers,
  isJapaneseAnimeDetail,
  detailRuntimeLabel,
  detailTypeBadge,
  buildDetailStats,
  episodeDisplayName,
  seasonTabLabel,
  type CastMember,
  type VideoResult,
} from '../services/catalog';
import { playButtonLabel } from '../services/progress';
import { setRuntime } from '../services/runtimeCache';
import type { MediaItem } from '../types';

const props = defineProps<{
  id: string | number;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
}>();

const { tmdbClient } = useAppServices();
const myListStore = useMyListStore();
const progressStore = useProgressStore();
const playerStore = usePlayerStore();
const deviceStore = useDeviceStore();
const toast = useToast();
const router = useRouter();

const LANG = 'es-ES';
const IMG = TMDB_IMG_BASE;

/**
 * DetailData — forma del payload de `/{type}/{id}?append_to_response=
 * credits,videos,recommendations,similar`. Refleja exactamente los campos
 * que `dpRenderPage` lee (líneas ~8902-9006); el resto del payload de TMDB
 * se ignora igual que en el original.
 */
interface DetailData {
  id: number | string;
  title?: string;
  name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number | null;
  vote_count?: number | null;
  runtime?: number | null;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  status?: string | null;
  backdrop_path?: string | null;
  poster_path?: string | null;
  origin_country?: string[];
  genres?: { id: number; name: string }[];
  credits?: { cast?: CastMember[] };
  videos?: { results?: VideoResult[] };
  recommendations?: { results?: MediaItem[] };
  similar?: { results?: MediaItem[] };
}

interface EpisodeItem {
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  runtime?: number | null;
}

// ── Estado ───────────────────────────────────────────────────────────────
const loading = ref(true);
const loadError = ref(false);
const data = ref<DetailData | null>(null);

const episodes = ref<EpisodeItem[]>([]);
const episodesLoading = ref(false);
const episodesError = ref(false);
const activeSeason = ref(props.season && props.season > 0 ? props.season : 1);

const trailerKey = ref<string | null>(null);

// Contadores de generación — preservan el patrón anti-condición-de-carrera
// usado en `useTmdbList`/`SearchView`: si el usuario navega a otro detalle
// (p.ej. desde "También te puede gustar") antes de que termine un fetch
// anterior, la respuesta obsoleta se descarta.
let detailGeneration = 0;
let seasonGeneration = 0;

// ── Derivados — preservan la extracción de campos de `dpRenderPage` (líneas ~8902-8912) ──
const isTV = computed(() => props.type === 'tv');
const title = computed(() => (data.value ? data.value.title || data.value.name || '' : ''));
const year = computed(() => (data.value ? (data.value.release_date || data.value.first_air_date || '').slice(0, 4) : ''));
const rating = computed(() => (data.value?.vote_average ? data.value.vote_average.toFixed(1) : '?'));
const overview = computed(() => data.value?.overview || '');
const genreNames = computed(() => (data.value?.genres || []).map((g) => g.name));
const runtimeLabel = computed(() => detailRuntimeLabel(data.value?.runtime, data.value?.number_of_seasons));
const totalSeasons = computed(() => data.value?.number_of_seasons || 0);
const backdropUrl = computed(() => (data.value?.backdrop_path ? `${IMG}original${data.value.backdrop_path}` : ''));
const typeBadge = computed(() => detailTypeBadge(isTV.value));

const prog = computed(() => progressStore.get(props.id, props.type));
const inList = computed(() => myListStore.inList(props.id));

/** playLabel — preserva `progLabel`/el texto del botón Reproducir EXACTO (línea ~8917/8930), incluido el doble ▶ cuando no hay progreso. */
const playLabel = computed(() => playButtonLabel(prog.value, isTV.value, data.value?.runtime));

const listBtnLabel = computed(() => (inList.value ? '✓ En Mi Lista' : '+ Mi Lista'));

const stats = computed(() =>
  buildDetailStats({
    rating: rating.value,
    year: year.value,
    isTV: isTV.value,
    runtime: runtimeLabel.value,
    voteCount: data.value?.vote_count,
    numberOfSeasons: data.value?.number_of_seasons,
    numberOfEpisodes: data.value?.number_of_episodes,
    status: data.value?.status,
  })
);

/** cast — preserva `(d.credits?.cast||[]).slice(0,20)` (línea ~8948). */
const cast = computed(() => (data.value?.credits?.cast || []).slice(0, 20));

/**
 * NO_PHOTO — el avatar SVG de fallback para reparto sin foto, preservado
 * EXACTO (línea ~8951) — un dataURI inline, no un asset, igual que el original.
 */
const NO_PHOTO =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23252525%22/%3E%3Ccircle cx=%2250%22 cy=%2236%22 r=%2220%22 fill=%22%23444%22/%3E%3Cellipse cx=%2250%22 cy=%2285%22 rx=%2234%22 ry=%2224%22 fill=%22%23444%22/%3E%3C/svg%3E';

function castAvatarUrl(member: CastMember): string {
  return member.profile_path ? `${IMG}w185${member.profile_path}` : NO_PHOTO;
}

/** trailers — preserva `filterYoutubeTrailers` (línea ~8961). */
const trailers = computed(() => filterYoutubeTrailers(data.value?.videos?.results || []));

/** isAnime — preserva la detección de anime japonés (línea ~8972), usada para resolver fuentes especiales al abrir el reproductor. */
const isAnime = computed(() => isJapaneseAnimeDetail(genreNames.value, data.value?.origin_country || []));

/** seasonTabs — un tab por temporada 1..N, etiqueta "Episodios" si solo hay una (preserva líneas ~8982-8989). */
const seasonTabs = computed(() => {
  const total = totalSeasons.value;
  const tabs: { n: number; label: string }[] = [];
  for (let s = 1; s <= total; s++) tabs.push({ n: s, label: seasonTabLabel(s, total) });
  return tabs;
});

/** recommendations — preserva `dedupeRecommendations` (línea ~8994). */
const recommendations = computed(() =>
  dedupeRecommendations(data.value?.recommendations?.results || [], data.value?.similar?.results || [])
);

const recPosterSize = computed(() => posterSize(deviceStore.isTV));

function recPosterUrl(item: MediaItem): string {
  return item.poster_path ? `${IMG}${recPosterSize.value}${item.poster_path}` : '';
}

function recTitle(item: MediaItem): string {
  return item.title || item.name || '';
}

/** recRating — preserva `r.vote_average?\`★ ${r.vote_average.toFixed(1)}\`:''` (línea ~9003) sin asserts no-nulos en el template. */
function recRating(item: MediaItem): string {
  return item.vote_average ? item.vote_average.toFixed(1) : '';
}

// ── Carga del detalle — preserva `dpLoadDetail`/`dpRenderPage` (líneas ~8891-9007) ──
async function loadDetail() {
  const myGen = ++detailGeneration;
  loading.value = true;
  loadError.value = false;
  data.value = null;
  episodes.value = [];
  trailerKey.value = null;
  activeSeason.value = props.season && props.season > 0 ? props.season : 1;

  try {
    const res = await tmdbClient.get<DetailData>(
      `/${props.type}/${props.id}?language=${LANG}&append_to_response=credits,videos,recommendations,similar`
    );
    if (myGen !== detailGeneration) return; // navegó a otro detalle antes de que esto resolviera
    data.value = res;
    if (res.runtime) setRuntime(props.id, props.type, res.runtime);
    document.title = `${res.title || res.name || ''} — MaldoxFilm`;

    // Series con temporadas — cargar la temporada activa (preserva `dpLoadSeason(1,...)`, línea ~8990,
    // ajustado para respetar la temporada inicial pasada por la ruta).
    if (isTV.value && (res.number_of_seasons || 0) > 0) {
      const initial = Math.min(Math.max(activeSeason.value, 1), res.number_of_seasons || 1);
      activeSeason.value = initial;
      loadSeason(initial);
    }
  } catch {
    if (myGen !== detailGeneration) return;
    loadError.value = true;
  } finally {
    if (myGen === detailGeneration) loading.value = false;
  }
}

/** loadSeason — preserva `dpLoadSeason` (líneas ~9009-9034): carga episodios y marca el tab activo. */
async function loadSeason(n: number) {
  const myGen = ++seasonGeneration;
  activeSeason.value = n;
  episodesLoading.value = true;
  episodesError.value = false;
  episodes.value = [];
  try {
    const sd = await tmdbClient.get<{ episodes?: EpisodeItem[] }>(`/tv/${props.id}/season/${n}?language=${LANG}`);
    if (myGen !== seasonGeneration) return;
    episodes.value = Array.isArray(sd?.episodes) ? sd.episodes : [];
  } catch {
    if (myGen !== seasonGeneration) return;
    episodesError.value = true;
  } finally {
    if (myGen === seasonGeneration) episodesLoading.value = false;
  }
}

function selectSeason(n: number) {
  if (activeSeason.value === n && !episodesError.value) return;
  loadSeason(n);
}

// ── Acciones del hero ────────────────────────────────────────────────────

/**
 * playMain — preserva `openPlayer({id,type,title,seasons})` del botón
 * "Reproducir"/"Continuar..." (línea ~8930): para series, retoma la
 * temporada/episodio guardados en el progreso (o 1/1 si no hay), igual que
 * `openPlayer` resolvía `startSeason`/`startEp` internamente
 * (líneas ~7546-7548). Navegamos a `/ver/:type/:id` — la URL compartible
 * que `PlayerView` consume vía `route.query.s`/`route.query.e`.
 */
function playMain() {
  presetAnimeDetection();
  if (isTV.value) {
    const s = prog.value?.season || 1;
    const e = prog.value?.episode || 1;
    router.push({ path: `/ver/tv/${props.id}`, query: { s: String(s), e: String(e) } });
  } else {
    router.push(`/ver/movie/${props.id}`);
  }
}

/**
 * playEpisode — preserva `openPlayer({id:tvId,type:'tv',...,startS:n,startE:ep.episode_number,...})`
 * de cada tarjeta de episodio (línea ~9021).
 */
function playEpisode(episodeNumber: number) {
  presetAnimeDetection();
  router.push({ path: `/ver/tv/${props.id}`, query: { s: String(activeSeason.value), e: String(episodeNumber) } });
}

/**
 * presetAnimeDetection — empuja `_dpIsAnime`/`_dpAnimeTitle`/`_dpAnimeTmdbId`
 * (líneas ~8973-8976) al `playerStore` justo antes de navegar al
 * reproductor — preserva la detección "precacheada al abrir el detalle"
 * que `openPlayer`/`loadPlayerSource` consultaban (líneas ~7583/7768) sin
 * tener que volver a calcularla allí.
 */
function presetAnimeDetection() {
  if (!data.value) return;
  playerStore.presetAnimeDetection(isAnime.value, data.value.name || data.value.title || '', props.id);
}

/** toggleList — preserva `dpToggleList` (líneas ~9041-9057): añade/quita de Mi Lista y muestra el toast con el mismo texto. */
function toggleList() {
  const result = myListStore.toggle({
    id: props.id,
    title: title.value,
    type: props.type,
    poster: data.value?.poster_path || '',
  });
  if (result.toast) toast.show(result.toast);
}

/**
 * goBack — el botón "← Volver". Vuelve a la pantalla ANTERIOR (`router.back()`),
 * preservando la sección y el filtro de donde vino el usuario: p.ej. desde
 * Películas → género Terror → ficha → "Volver" regresa a `/peliculas?genero=27`
 * (el género ya viaja en la URL). Esto restaura el comportamiento del original
 * (`_navState`, líneas ~6564-6581) que el usuario pidió explícitamente.
 *
 * Fallback a Inicio SOLO si no hay historial previo (entrada directa/deep-link):
 * `window.history.state.back` lo setea Vue Router cuando existe una entrada anterior;
 * si es null estamos en la primera página y `router.back()` saldría de la app.
 */
function goBack() {
  const prev = typeof window !== 'undefined' && window.history.state ? window.history.state.back : null;
  // Si la entrada anterior es el REPRODUCTOR (`/ver/...`), NO volver ahí: reabriría
  // la película. Pasa cuando el usuario abrió el player y volvió — `closePlayer` hace
  // `router.push` del detalle, dejando el player justo debajo en el stack. En ese caso
  // vamos directo al Inicio (la pantalla anterior real ya no está accesible con back).
  if (typeof prev === 'string' && prev.startsWith('/ver/')) {
    router.push('/');
    return;
  }
  if (prev != null) router.back();
  else router.push('/');
}

// ── Tráilers — preserva `dpOpenTM`/`dpCloseTM` (líneas ~9129-9130) ──────────
function openTrailer(key: string) {
  trailerKey.value = key;
}
function closeTrailer() {
  trailerKey.value = null;
}
function onModalBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) closeTrailer();
}

// ── Recomendaciones — preserva `onclick="showDetailPage(${r.id},'${rtype}')"` (línea ~9001) ──
function openRecommendation(item: MediaItem) {
  const rtype = resolveMediaType(item, props.type);
  router.push(rtype === 'tv' ? `/serie/${item.id}/1/1` : `/pelicula/${item.id}`);
}

watch(
  () => [props.id, props.type],
  () => loadDetail(),
  { immediate: false }
);

onMounted(() => loadDetail());

onBeforeUnmount(() => {
  // Invalidar cualquier fetch en vuelo — evita escribir estado en un componente desmontado.
  detailGeneration++;
  seasonGeneration++;
});
</script>

<template>
  <div class="detail-page">
    <!-- Hero -->
    <div class="dp-hero">
      <div class="dp-hero-bg" :style="backdropUrl ? { backgroundImage: `url(${backdropUrl})` } : {}"></div>
      <div class="dp-hero-body">
        <div v-if="loading" class="spinner" style="margin: 0 auto"></div>
        <div v-else-if="loadError" class="dp-error">
          Error al cargar.
          <span class="dp-error-link" @click="router.push('/')">← Volver</span>
        </div>
        <template v-else-if="data">
          <div class="dp-type-badge">{{ typeBadge }}</div>
          <div class="dp-title">{{ title }}</div>
          <div class="dp-meta">
            <span class="dp-meta-star">★ {{ rating }}</span>
            <span class="dp-meta-dot"></span>
            <span style="font-size: 0.82rem; color: var(--text-muted)">{{ year }}</span>
            <template v-if="runtimeLabel">
              <span class="dp-meta-dot"></span>
              <span class="dp-meta-tag gold">{{ runtimeLabel }}</span>
            </template>
            <span v-for="g in genreNames.slice(0, 3)" :key="g" class="dp-meta-tag">{{ g }}</span>
          </div>
          <div class="dp-overview">{{ overview }}</div>
          <div class="dp-actions">
            <button class="dp-play-btn" @click="playMain">{{ playLabel }}</button>
            <button class="dp-sec-btn" :class="{ added: inList }" @click="toggleList">{{ listBtnLabel }}</button>
            <button class="dp-sec-btn" @click="goBack">← Volver</button>
          </div>
        </template>
      </div>
    </div>

    <!-- Body -->
    <div v-if="data" class="dp-body">
      <div class="dp-stats">
        <div v-for="s in stats" :key="s.l" class="dp-stat">
          <div class="dp-stat-l">{{ s.l }}</div>
          <div class="dp-stat-v" :class="{ gold: s.g }">{{ s.v }}</div>
        </div>
      </div>

      <!-- Reparto -->
      <div v-if="cast.length" class="dp-section">
        <div class="dp-sec-hd">Reparto</div>
        <div class="dp-cast-row">
          <div v-for="member in cast" :key="member.id" class="dp-cast-item">
            <img class="dp-cast-avatar" :src="castAvatarUrl(member)" :alt="member.name" loading="lazy" />
            <div class="dp-cast-name">{{ member.name }}</div>
            <div class="dp-cast-char">{{ member.character || '' }}</div>
          </div>
        </div>
      </div>

      <!-- Episodios (series con temporadas) -->
      <div v-if="isTV && totalSeasons > 0" class="dp-section">
        <div class="dp-sec-hd">Episodios</div>
        <div class="dp-stabs">
          <div
            v-for="tab in seasonTabs"
            :key="tab.n"
            class="dp-stab"
            :class="{ active: activeSeason === tab.n }"
            @click="selectSeason(tab.n)"
          >
            {{ tab.label }}
          </div>
        </div>
        <div class="dp-ep-grid">
          <template v-if="episodesLoading">
            <div v-for="n in 4" :key="n" class="dp-skel-ep">
              <div class="dp-skel" style="flex-shrink: 0; width: 108px; height: 61px; border-radius: var(--radius)"></div>
              <div style="flex: 1; padding-top: 2px">
                <div class="dp-skel" style="height: 9px; width: 38%; margin-bottom: 7px"></div>
                <div class="dp-skel" style="height: 8px; width: 88%; margin-bottom: 5px"></div>
                <div class="dp-skel" style="height: 8px; width: 62%"></div>
              </div>
            </div>
          </template>
          <p v-else-if="episodesError" class="dp-ep-error">No se pudo cargar esta temporada.</p>
          <template v-else>
            <div v-for="ep in episodes" :key="ep.episode_number" class="dp-ep-card" @click="playEpisode(ep.episode_number)">
              <div class="dp-ep-thumb">
                <img v-if="ep.still_path" :src="`${IMG}w300${ep.still_path}`" :alt="episodeDisplayName(ep.name, ep.episode_number)" loading="lazy" />
                <div v-else class="dp-ep-thumb-fallback">▶</div>
                <div class="dp-ep-ov"><div class="dp-ep-pc">▶</div></div>
              </div>
              <div class="dp-ep-info">
                <div class="dp-ep-row">
                  <span class="dp-ep-num">E{{ ep.episode_number }}</span>
                  <span class="dp-ep-name">{{ episodeDisplayName(ep.name, ep.episode_number) }}</span>
                </div>
                <div class="dp-ep-desc">{{ ep.overview || '' }}</div>
                <div v-if="ep.runtime" class="dp-ep-rt">{{ ep.runtime }} min</div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Tráilers -->
      <div v-if="trailers.length" class="dp-section">
        <div class="dp-sec-hd">Tráilers</div>
        <div class="dp-trailers-row">
          <div v-for="v in trailers" :key="v.key" class="dp-tr-card" @click="openTrailer(v.key)">
            <div class="dp-tr-thumb">
              <img :src="`https://img.youtube.com/vi/${v.key}/mqdefault.jpg`" loading="lazy" />
              <div class="dp-tr-ov"><div class="dp-tr-play">▶</div></div>
            </div>
            <div class="dp-tr-info">
              <div class="dp-tr-name">{{ v.name }}</div>
              <div class="dp-tr-type">{{ v.type }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recomendaciones -->
      <div v-if="recommendations.length" class="dp-section">
        <div class="dp-sec-hd">También te puede gustar</div>
        <div class="dp-rec-row">
          <div v-for="r in recommendations" :key="r.id" class="dp-rec-card" @click="openRecommendation(r)">
            <img v-if="recPosterUrl(r)" :src="recPosterUrl(r)" :alt="recTitle(r)" loading="lazy" />
            <div v-else class="dp-rec-fallback">{{ recTitle(r) }}</div>
            <div class="dp-rec-ov">
              <div class="dp-rec-title">{{ recTitle(r) }}</div>
              <div v-if="recRating(r)" class="dp-rec-rating">★ {{ recRating(r) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal de tráiler — preserva `dpTrailerModal`/`dpOpenTM`/`dpCloseTM` (líneas ~3515-3520/9129-9130) -->
    <div class="dp-tr-modal" :class="{ open: trailerKey }" @click="onModalBackdropClick">
      <div class="dp-tr-modal-inner">
        <button class="dp-tr-close" @click="closeTrailer">✕</button>
        <iframe
          v-if="trailerKey"
          :src="`https://www.youtube.com/embed/${trailerKey}?autoplay=1`"
          allow="autoplay; fullscreen"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.dp-*` (líneas ~1546-1670, ~2116-2167) */
.detail-page {
  padding-bottom: 24px;
}
.dp-hero {
  position: relative;
  height: 88vh;
  min-height: 480px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  padding-bottom: 44px;
}
.dp-hero-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center 20%;
  transition: opacity 1s;
}
.dp-hero-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(14, 14, 14, 0.97) 0%, rgba(14, 14, 14, 0.72) 40%, rgba(14, 14, 14, 0.12) 68%, transparent 100%),
    linear-gradient(0deg, rgba(14, 14, 14, 1) 0%, rgba(14, 14, 14, 0.55) 28%, transparent 55%);
}
.dp-hero-body {
  position: relative;
  z-index: 2;
  padding: 0 60px;
  max-width: 680px;
}
.dp-error {
  color: var(--accent, #3d5afe);
  font-family: 'Oswald', sans-serif;
  padding: 20px;
}
.dp-error-link {
  cursor: pointer;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.9rem;
}
.dp-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--accent, #3d5afe);
  color: #000;
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 2px;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 3px;
  margin-bottom: 12px;
}
.dp-title {
  font-family: 'Oswald', sans-serif;
  font-size: clamp(2.2rem, 5vw, 4.4rem);
  font-weight: 700;
  line-height: 1.02;
  text-transform: uppercase;
  margin-bottom: 10px;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.7);
  text-wrap: balance;
}
.dp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.dp-meta-star {
  color: var(--accent, #3d5afe);
  font-weight: 700;
  font-size: 0.88rem;
}
.dp-meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-dim, #6a6a6a);
}
.dp-meta-tag {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text-muted, #9a9a9a);
  font-size: 0.68rem;
  padding: 2px 9px;
  border-radius: 3px;
  font-weight: 500;
}
.dp-meta-tag.gold {
  border-color: rgba(61, 90, 254, 0.3);
  color: var(--accent, #3d5afe);
  background: rgba(61, 90, 254, 0.08);
}
.dp-overview {
  font-size: 0.88rem;
  line-height: 1.72;
  color: rgba(240, 240, 240, 0.76);
  margin-bottom: 22px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 520px;
}
.dp-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.dp-play-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--accent, #3d5afe);
  color: #000;
  border: none;
  padding: 12px 28px;
  border-radius: var(--radius, 8px);
  font-family: 'Roboto', sans-serif;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--trans, 0.2s);
  letter-spacing: 0.3px;
}
.dp-play-btn:hover {
  background: var(--accent2, #5b73ff);
  transform: scale(1.03);
  box-shadow: 0 4px 24px var(--accent-glow, rgba(61, 90, 254, 0.4));
}
.dp-sec-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text, #f0f0f0);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 12px 20px;
  border-radius: var(--radius, 8px);
  font-family: 'Roboto', sans-serif;
  font-weight: 500;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--trans, 0.2s);
}
.dp-sec-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}
.dp-sec-btn.added {
  background: rgba(61, 90, 254, 0.12);
  border-color: var(--accent, #3d5afe);
  color: var(--accent, #3d5afe);
}
.dp-body {
  padding: 0 60px 80px;
  max-width: 1400px;
  margin: 0 auto;
}
.dp-stats {
  display: flex;
  background: var(--surface, #161616);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  margin-bottom: 36px;
  flex-wrap: wrap;
}
.dp-stat {
  flex: 1;
  min-width: 100px;
  padding: 14px 18px;
  border-right: 1px solid var(--border, #2a2a2a);
}
.dp-stat:last-child {
  border-right: none;
}
.dp-stat-l {
  font-size: 0.58rem;
  color: var(--text-dim, #6a6a6a);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
  margin-bottom: 4px;
}
.dp-stat-v {
  font-size: 0.9rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dp-stat-v.gold {
  color: var(--accent, #3d5afe);
}
.dp-sec-hd {
  font-family: 'Oswald', sans-serif;
  font-size: 1.05rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-left: 12px;
  border-left: 3px solid var(--accent, #3d5afe);
  margin-bottom: 14px;
}
.dp-section {
  margin-bottom: 38px;
}

.dp-cast-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 86px;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.dp-cast-row::-webkit-scrollbar {
  display: none;
}
.dp-cast-item {
  text-align: center;
}
.dp-cast-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface2, #1a1a1a);
  border: 2px solid transparent;
  transition: border-color var(--trans, 0.2s);
  display: block;
}
.dp-cast-item:hover .dp-cast-avatar {
  border-color: var(--accent, #3d5afe);
}
.dp-cast-name {
  font-size: 0.68rem;
  font-weight: 600;
  margin-top: 6px;
  line-height: 1.3;
}
.dp-cast-char {
  font-size: 0.6rem;
  color: var(--text-muted, #9a9a9a);
}

.dp-stabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.dp-stab {
  padding: 5px 15px;
  border-radius: 20px;
  border: 1px solid var(--border, #2a2a2a);
  background: var(--surface, #161616);
  color: var(--text-muted, #9a9a9a);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--trans, 0.2s);
}
.dp-stab:hover {
  border-color: var(--accent, #3d5afe);
  color: var(--accent, #3d5afe);
}
.dp-stab.active {
  background: var(--accent, #3d5afe);
  color: #000;
  border-color: var(--accent, #3d5afe);
}

.dp-ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.dp-ep-card {
  display: flex;
  gap: 10px;
  background: var(--surface, #161616);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: var(--radius-lg, 12px);
  padding: 10px;
  cursor: pointer;
  transition: all var(--trans, 0.2s);
}
.dp-ep-card:hover {
  border-color: rgba(61, 90, 254, 0.35);
  background: var(--surface2, #1a1a1a);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.dp-ep-thumb {
  flex-shrink: 0;
  width: 108px;
  height: 61px;
  border-radius: var(--radius, 8px);
  overflow: hidden;
  background: var(--surface2, #1a1a1a);
  position: relative;
}
.dp-ep-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.dp-ep-thumb-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim, #6a6a6a);
  font-size: 1.2rem;
}
.dp-ep-ov {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--trans, 0.2s);
}
.dp-ep-card:hover .dp-ep-ov {
  opacity: 1;
}
.dp-ep-pc {
  width: 28px;
  height: 28px;
  background: var(--accent, #3d5afe);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  font-size: 0.75rem;
}
.dp-ep-info {
  flex: 1;
  min-width: 0;
}
.dp-ep-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 3px;
}
.dp-ep-num {
  font-size: 0.63rem;
  color: var(--accent, #3d5afe);
  font-weight: 800;
  flex-shrink: 0;
}
.dp-ep-name {
  font-size: 0.79rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dp-ep-desc {
  font-size: 0.68rem;
  color: var(--text-muted, #9a9a9a);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dp-ep-rt {
  font-size: 0.6rem;
  color: var(--text-dim, #6a6a6a);
  margin-top: 3px;
}
.dp-ep-error {
  color: var(--text-muted, #9a9a9a);
  font-size: 0.84rem;
  padding: 12px 0;
}

.dp-skel-ep {
  display: flex;
  gap: 10px;
  background: var(--surface, #161616);
  border-radius: var(--radius-lg, 12px);
  padding: 10px;
}
.dp-skel {
  border-radius: 4px;
  background: linear-gradient(90deg, var(--surface, #161616) 25%, var(--surface2, #1a1a1a) 50%, var(--surface, #161616) 75%);
  background-size: 200% 100%;
  animation: dpShim 1.5s infinite;
}
@keyframes dpShim {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.dp-trailers-row {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.dp-trailers-row::-webkit-scrollbar {
  display: none;
}
.dp-tr-card {
  flex-shrink: 0;
  width: 248px;
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  border: 1px solid var(--border, #2a2a2a);
  cursor: pointer;
  transition: all var(--trans, 0.2s);
}
.dp-tr-card:hover {
  border-color: rgba(61, 90, 254, 0.3);
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
}
.dp-tr-thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--surface2, #1a1a1a);
}
.dp-tr-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.dp-tr-ov {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--trans, 0.2s);
}
.dp-tr-card:hover .dp-tr-ov {
  background: rgba(0, 0, 0, 0.18);
}
.dp-tr-play {
  width: 40px;
  height: 40px;
  background: rgba(61, 90, 254, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  font-size: 0.95rem;
  transition: transform var(--trans, 0.2s);
}
.dp-tr-card:hover .dp-tr-play {
  transform: scale(1.1);
}
.dp-tr-info {
  padding: 8px 11px;
  background: var(--surface, #161616);
}
.dp-tr-name {
  font-size: 0.74rem;
  font-weight: 600;
  line-height: 1.3;
}
.dp-tr-type {
  font-size: 0.61rem;
  color: var(--text-muted, #9a9a9a);
  margin-top: 2px;
}

.dp-rec-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 148px;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.dp-rec-row::-webkit-scrollbar {
  display: none;
}
.dp-rec-card {
  cursor: pointer;
  border-radius: var(--radius, 8px);
  overflow: hidden;
  aspect-ratio: 2 / 3;
  background: var(--surface, #161616);
  position: relative;
  transition: transform var(--trans, 0.2s), box-shadow var(--trans, 0.2s);
}
.dp-rec-card:hover {
  transform: scale(1.06) translateY(-4px);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(61, 90, 254, 0.2);
}
.dp-rec-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.dp-rec-fallback {
  width: 100%;
  height: 100%;
  background: var(--surface2, #1a1a1a);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: var(--text-dim, #6a6a6a);
  text-align: center;
  padding: 8px;
}
.dp-rec-ov {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(14, 14, 14, 0.97) 0%, transparent 65%);
  padding: 20px 8px 8px;
  opacity: 0;
  transition: opacity var(--trans, 0.2s);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.dp-rec-card:hover .dp-rec-ov {
  opacity: 1;
}
.dp-rec-title {
  font-size: 0.69rem;
  font-weight: 600;
  line-height: 1.3;
}
.dp-rec-rating {
  font-size: 0.62rem;
  color: var(--accent, #3d5afe);
  font-weight: 700;
  margin-top: 2px;
}

.dp-tr-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s;
  backdrop-filter: blur(4px);
}
.dp-tr-modal.open {
  opacity: 1;
  pointer-events: all;
}
.dp-tr-modal-inner {
  position: relative;
  width: 100%;
  max-width: 880px;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.9);
}
.dp-tr-modal-inner iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}
.dp-tr-close {
  position: absolute;
  top: -44px;
  right: 0;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--trans, 0.2s);
}
.dp-tr-close:hover {
  background: rgba(61, 90, 254, 0.2);
  border-color: var(--accent, #3d5afe);
  color: var(--accent, #3d5afe);
}

.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--accent, #3d5afe);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .dp-hero-body {
    padding: 0 20px;
    max-width: 100%;
  }
  .dp-hero {
    height: 72vh;
    min-height: 380px;
  }
  .dp-title {
    font-size: 1.9rem;
  }
  .dp-body {
    padding: 0 16px 60px;
  }
  .dp-stats {
    flex-wrap: wrap;
  }
  .dp-stat {
    flex: none;
    width: 50%;
  }
  .dp-ep-grid {
    grid-template-columns: 1fr;
  }
  .dp-ep-thumb {
    width: 92px;
    height: 52px;
  }
  .dp-actions {
    gap: 8px;
  }
  .dp-play-btn,
  .dp-sec-btn {
    padding: 10px 18px;
    font-size: 0.82rem;
  }
}

@media (min-width: 1600px) {
  .dp-hero-body {
    padding: 0 80px;
    max-width: 820px;
  }
  .dp-title {
    font-size: 5rem;
  }
  .dp-body {
    padding: 0 100px 100px;
    max-width: 1700px;
  }
}

/* TV mode — preservado de `html.tv-mode .dp-*` (líneas ~2116-2167) */
:global(html.tv-mode) .dp-title {
  font-size: 2.6rem !important;
}
:global(html.tv-mode) .dp-overview {
  font-size: 0.95rem !important;
  line-height: 1.7 !important;
}
:global(html.tv-mode) .dp-play-btn {
  font-size: 1.18rem !important;
  padding: 18px 38px !important;
}
:global(html.tv-mode) .dp-sec-btn {
  font-size: 1.05rem !important;
  padding: 16px 28px !important;
}
/* El foco de los botones del detalle en TV se define en `style.css` (global):
   `:global(html.tv-mode) .x:focus` en scoped rompía el compilador y aplicaba el
   outline a `<html>` entero (la "línea azul"). */
</style>
