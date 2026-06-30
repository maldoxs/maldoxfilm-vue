<script setup lang="ts">
/**
 * SearchView — resultados de búsqueda unificada (TMDB `/search/multi`).
 *
 * Reemplaza `doSearchUnified` (líneas ~7361-7411 de assets/index.html).
 * Preserva: el título `"{query}"`, el contador "{N} resultados", el filtro
 * que excluye personas y resultados sin poster/título (igual que
 * `isSearchableMedia`, ya extraída y testeada en `services/catalog.ts`), la
 * sección "🎬 Películas y Series", y el mensaje de "No se encontraron
 * resultados." cuando `total === 0`.
 *
 * NOTA — canales IPTV: el comentario original dice explícitamente "Canales
 * TV excluidos del buscador" (línea ~7397) — aunque `doSearchUnified` SÍ
 * computa `channelResults`, nunca los renderiza (`container.innerHTML` se
 * sobreescribe sin usarlos). Se preserva ese comportamiento EXACTO: no se
 * buscan ni muestran canales aquí.
 *
 * GANANCIA REAL vs el original: la búsqueda ahora vive en una URL real
 * (`/buscar?q=...`) — refrescar conserva la búsqueda, compartir el link
 * funciona, y cambiar de query dispara un nuevo `watch` reactivo en vez de
 * reescribir `innerHTML` a mano.
 */
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import MovieCard from '../components/catalog/MovieCard.vue';
import SearchBar from '../components/catalog/SearchBar.vue';
import { useAppServices } from '../composables/useAppServices';
import { useTmdbList } from '../composables/useTmdbList';
import { useDeviceStore } from '../stores/device';
import { isSearchableMedia, resolveMediaType, TMDB_IMG_BASE } from '../services/catalog';
import type { MediaItem } from '../types';

const props = defineProps<{
  /** El query `q` de la URL (`/buscar?q=...`) — preserva el query param del plan (línea ~187). */
  query: string;
}>();

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();

const LANG = 'es-ES';

const results = ref<MediaItem[]>([]);
const loading = ref(false);
const searched = ref(false);

// Recomendados — tendencias de la semana. Se muestran cuando aún no se busca nada
// (estilo Netflix móvil: "Series y películas recomendadas") en vez de pantalla vacía.
const recommended = useTmdbList(tmdbClient);

const IMG_THUMB = `${TMDB_IMG_BASE}w300`;
function thumbUrl(item: MediaItem): string {
  const path = item.backdrop_path || item.poster_path;
  return path ? `${IMG_THUMB}${path}` : '';
}
function itemTitle(item: MediaItem): string {
  return item.title || item.name || 'Sin título';
}

let generation = 0;

/** runSearch — preserva `doSearchUnified` (líneas ~7361-7387): pide `/search/multi`, filtra personas/sin-poster. */
async function runSearch(query: string) {
  const myGen = ++generation;
  const trimmed = query.trim();
  if (!trimmed) {
    results.value = [];
    searched.value = false;
    loading.value = false;
    return;
  }
  loading.value = true;
  searched.value = true;
  try {
    const data = await tmdbClient.get<{ results?: MediaItem[] }>(
      `/search/multi?language=${LANG}&query=${encodeURIComponent(trimmed)}`
    );
    if (myGen !== generation) return; // respuesta obsoleta — el usuario ya cambió de búsqueda
    const list = Array.isArray(data?.results) ? data.results : [];
    results.value = list.filter(isSearchableMedia);
  } catch {
    if (myGen !== generation) return;
    results.value = [];
  } finally {
    if (myGen === generation) loading.value = false;
  }
}

watch(
  () => props.query,
  (q) => runSearch(q),
  { immediate: false }
);

onMounted(() => {
  runSearch(props.query);
  recommended.load(`/trending/all/week?language=${LANG}`);
});

function onSelect({ id, type }: { id: MediaItem['id']; type: 'movie' | 'tv' }) {
  router.push(type === 'tv' ? `/serie/${id}/1/1` : `/pelicula/${id}`);
}

// ── Barra de búsqueda en TV — el `SearchBar` (input) solo vive en NavDesktop;
// en TV no había dónde tipear. Se replica la `.tv-search-bar` del original
// (input bajo el nav). Al tipear se actualiza el query de la URL → `watch` busca.
function onTypeSearch(q: string) {
  if (q !== props.query) router.replace({ path: '/buscar', query: { q } });
}
function onClearSearch() {
  if (props.query) router.replace({ path: '/buscar' });
}

// En TV cuesta acertarle al input finito con el puntero; hacer clic en CUALQUIER
// parte de la barra enfoca el input (abre el teclado de la TV).
const tvSearchBarRef = ref<HTMLElement | null>(null);
function focusSearchInput() {
  tvSearchBarRef.value?.querySelector('input')?.focus();
}
</script>

<template>
  <div class="search-results-page">
    <!-- Barra de búsqueda TV (input) — replica `.tv-search-bar` del original.
         En desktop la búsqueda se tipea desde el nav, así que aquí solo se muestra en TV. -->
    <div v-if="deviceStore.isTV" ref="tvSearchBarRef" class="tv-search-bar" @click="focusSearchInput">
      <SearchBar
        :model-value="props.query"
        placeholder="Buscar películas, series, canales..."
        :autofocus="true"
        @search="onTypeSearch"
        @clear="onClearSearch"
      />
    </div>

    <!-- Barra de búsqueda MÓVIL (input arriba, estilo Netflix). En desktop el input
         vive en el nav; en móvil no había dónde tipear → la pantalla quedaba negra. -->
    <div v-if="deviceStore.isMobile" class="mobile-search-bar">
      <SearchBar
        :model-value="props.query"
        placeholder="Buscar series, películas, juegos…"
        :autofocus="true"
        @search="onTypeSearch"
        @clear="onClearSearch"
      />
    </div>

    <div v-if="props.query" class="results-title">"{{ props.query }}"</div>
    <div v-if="props.query || !deviceStore.isMobile" class="results-count">
      <span v-if="loading">Buscando...</span>
      <span v-else-if="searched">{{ results.length }} resultados</span>
    </div>

    <div v-if="loading" class="search-spinner">
      <div class="spinner"></div>
    </div>

    <template v-else-if="searched">
      <div v-if="results.length" class="results-section">
        <h3>🎬 Películas y Series</h3>
        <div class="results-grid">
          <MovieCard
            v-for="item in results"
            :key="item.id"
            :item="item"
            :fallback-type="resolveMediaType(item, 'movie')"
            :is-tv-mode="deviceStore.isTV"
            @select="onSelect"
          />
        </div>
      </div>
      <p v-else class="no-results">No se encontraron resultados.</p>
    </template>

    <!-- Sin búsqueda activa (móvil): lista de recomendados estilo Netflix. -->
    <div v-else-if="deviceStore.isMobile" class="reco-section">
      <h3 class="reco-title">Series y películas recomendadas</h3>
      <ul class="reco-list">
        <li
          v-for="item in recommended.items.value"
          :key="item.id"
          class="reco-row"
          @click="onSelect({ id: item.id, type: resolveMediaType(item, 'movie') })"
        >
          <div class="reco-thumb">
            <img v-if="thumbUrl(item)" :src="thumbUrl(item)" :alt="itemTitle(item)" loading="lazy" />
          </div>
          <span class="reco-name">{{ itemTitle(item) }}</span>
          <span class="reco-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" /></svg>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.search-results-page`/`.results-title`/`.results-count`/`.results-section`/`.results-grid` (líneas ~847-854) */
.search-results-page {
  padding: 24px 40px 60px;
}
/* Barra de búsqueda TV — full-width bajo el nav, estilo `.tv-search-bar` del
   original (~líneas 1458-1486). Solo se renderiza en TV (v-if). El `:deep`
   reestiliza el input del componente SearchBar (que por defecto es un pill). */
.tv-search-bar {
  display: flex;
  align-items: center;
  margin: -24px -40px 22px;
  padding: 0 24px;
  height: 66px;
  background: rgba(14, 14, 14, 0.98);
  border-bottom: 1px solid rgba(61, 90, 254, 0.2);
  cursor: text; /* indica que toda la barra enfoca el input */
}
.tv-search-bar :deep(.search-bar) {
  width: 100%;
  height: 100%;
}
.tv-search-bar :deep(.search-input) {
  background: none;
  border: none;
  border-radius: 0;
  height: 100%; /* el input ocupa todo el alto → click target grande y fácil en TV */
  font-size: 1.1rem;
  font-weight: 400;
  padding: 0 14px 0 44px;
  caret-color: var(--accent, #3d5afe);
}
.tv-search-bar :deep(.search-input):focus {
  background: none;
}
.tv-search-bar :deep(.search-icon) {
  color: var(--accent, #3d5afe);
  width: 20px;
  height: 20px;
  left: 10px;
}
.results-title {
  font-family: 'Oswald', sans-serif;
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: 6px;
  text-transform: uppercase;
  padding-left: 12px;
  border-left: 3px solid var(--accent, #3d5afe);
}
.results-count {
  color: var(--text-muted, #9a9a9a);
  font-size: 0.83rem;
  margin-bottom: 24px;
  min-height: 1.2em;
}
.results-section {
  margin-bottom: 36px;
}
.results-section h3 {
  font-size: 1rem;
  margin-bottom: 14px;
  color: var(--text, #f0f0f0);
  border-left: 3px solid var(--accent, #3d5afe);
  padding-left: 12px;
  font-weight: 700;
  font-family: 'Oswald', sans-serif;
  text-transform: uppercase;
}
.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 10px;
}
.no-results {
  color: var(--text-muted, #9a9a9a);
  text-align: center;
  padding: 40px;
}
.search-spinner {
  display: flex;
  justify-content: center;
  padding: 40px 0;
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
  .search-results-page {
    padding: 12px 14px 40px;
  }
}

/* ── Barra de búsqueda móvil + lista de recomendados (estilo Netflix) ── */
.mobile-search-bar {
  margin-bottom: 18px;
}
.mobile-search-bar :deep(.search-bar) {
  width: 100%;
}
.mobile-search-bar :deep(.search-input) {
  width: 100%;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  border-radius: 8px;
  height: 46px;
  font-size: 0.95rem;
  padding: 0 14px 0 44px;
  color: #fff;
}
.mobile-search-bar :deep(.search-icon) {
  color: rgba(255, 255, 255, 0.7);
  left: 14px;
}
.reco-title {
  font-size: 1.25rem;
  font-weight: 800;
  margin: 4px 0 14px;
  color: #fff;
}
.reco-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.reco-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 0;
  cursor: pointer;
}
.reco-thumb {
  width: 132px;
  height: 74px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}
.reco-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.reco-name {
  flex: 1;
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
  line-height: 1.25;
}
.reco-play {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  color: #fff;
}
.reco-play svg {
  width: 34px;
  height: 34px;
}
</style>
