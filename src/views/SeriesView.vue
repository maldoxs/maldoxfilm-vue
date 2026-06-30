<script setup lang="ts">
/**
 * SeriesView — catálogo de Series: cabecera + barra de géneros + 5 carruseles
 * que se recargan según el género seleccionado.
 *
 * Reemplaza `#seriesPage` + `filterSeriesGenre`/`loadSeriesPage`
 * (índex.html líneas ~3250-3320, ~6900-6940). Preserva EXACTO:
 *   - los 5 carruseles (Tendencias/En Emisión/Más Populares/Mejor Valoradas/
 *     Próximos) con sus íconos y subtítulos,
 *   - la reescritura de títulos al filtrar (🔥 {género} más populares ahora, …),
 *   - los endpoints `/discover/tv?with_genres=…` con cada `sort_by` (incluido
 *     `with_status=0` de "en emisión" y `first_air_date.gte` de "próximos").
 * Los géneros usan ids de TV (Acción=10759, Sci-Fi=10765, etc.).
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Carousel from '../components/catalog/Carousel.vue';
import GenreFilter from '../components/catalog/GenreFilter.vue';
import BackButtonMobile from '../components/layout/BackButtonMobile.vue';
import { useAppServices } from '../composables/useAppServices';
import { useTmdbList } from '../composables/useTmdbList';
import { useDeviceStore } from '../stores/device';
import { TODOS_GENRE_ID } from '../services/catalog';
import type { MediaItem } from '../types';

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();
const route = useRoute();
const LANG = 'es-ES';

// Géneros de la barra de Series — lista COMPLETA con ids de TV de TMDB.
const seriesGenreOptions = [
  { id: TODOS_GENRE_ID, label: 'Todas' },
  { id: 10759, label: 'Acción y Aventura' },
  { id: 16, label: 'Animación' },
  { id: 35, label: 'Comedia' },
  { id: 80, label: 'Crimen' },
  { id: 99, label: 'Documental' },
  { id: 18, label: 'Drama' },
  { id: 10751, label: 'Familiar' },
  { id: 10762, label: 'Kids' },
  { id: 9648, label: 'Misterio' },
  { id: 10763, label: 'Noticias' },
  { id: 10764, label: 'Reality' },
  { id: 10765, label: 'Sci-Fi y Fantasía' },
  { id: 10766, label: 'Telenovela' },
  { id: 10767, label: 'Talk' },
  { id: 10768, label: 'Bélica y Política' },
  { id: 37, label: 'Western' },
];

// El género se persiste en la URL (`?genero=10765`) para restaurar el filtro al
// volver desde la grilla "Ver todo".
const genreId = ref(Number(route.query.genero) || TODOS_GENRE_ID);

const trending = useTmdbList(tmdbClient);
const onAir = useTmdbList(tmdbClient);
const popular = useTmdbList(tmdbClient);
const topRated = useTmdbList(tmdbClient);
const upcoming = useTmdbList(tmdbClient);

/** Endpoints por género — preserva `filterSeriesGenre` (líneas ~6916-6932). */
function endpointsFor(gid: number) {
  if (gid === TODOS_GENRE_ID) {
    return {
      trending: `/trending/tv/week?language=${LANG}`,
      onAir: `/tv/on_the_air?language=${LANG}`,
      popular: `/tv/popular?language=${LANG}`,
      topRated: `/tv/top_rated?language=${LANG}`,
      upcoming: `/tv/airing_today?language=${LANG}`,
    };
  }
  const g = `with_genres=${gid}`;
  const today = new Date().toISOString().slice(0, 10);
  return {
    trending: `/discover/tv?language=${LANG}&${g}&sort_by=popularity.desc`,
    onAir: `/discover/tv?language=${LANG}&${g}&with_status=0&sort_by=popularity.desc`,
    popular: `/discover/tv?language=${LANG}&${g}&sort_by=vote_count.desc`,
    topRated: `/discover/tv?language=${LANG}&${g}&sort_by=vote_average.desc&vote_count.gte=50`,
    upcoming: `/discover/tv?language=${LANG}&${g}&first_air_date.gte=${today}&sort_by=popularity.desc`,
  };
}

function reload() {
  const ep = endpointsFor(genreId.value);
  trending.load(ep.trending);
  onAir.load(ep.onAir);
  popular.load(ep.popular);
  topRated.load(ep.topRated);
  upcoming.load(ep.upcoming);
}

function selectGenre(id: number) {
  if (genreId.value === id) return;
  genreId.value = id;
  router.replace({ query: id === TODOS_GENRE_ID ? {} : { genero: String(id) } });
  reload();
}

const isFiltered = computed(() => genreId.value !== TODOS_GENRE_ID);
const genreName = computed(() => seriesGenreOptions.find((o) => o.id === genreId.value)?.label || 'Género');

/** Títulos reescritos según el género (preserva `_setSectionTitle`, líneas ~6920-6924). */
const titles = computed(() => {
  if (!isFiltered.value) {
    return {
      trending: ['🔥 Tendencias', 'esta semana'],
      onAir: ['📡 En Emisión', 'transmitiendo ahora'],
      popular: ['⭐ Más Populares', 'del momento'],
      topRated: ['🏆 Mejor Valoradas', 'de todos los tiempos'],
      upcoming: ['🗓️ Próximos Estrenos', 'series que vienen'],
    };
  }
  const n = genreName.value;
  return {
    trending: [`🔥 ${n}`, 'más populares ahora'],
    onAir: [`📡 ${n}`, 'en emisión'],
    popular: [`⭐ ${n}`, 'más vistas'],
    topRated: [`🏆 ${n}`, 'mejor puntuadas'],
    upcoming: [`🗓️ ${n}`, 'próximos estrenos'],
  };
});

onMounted(reload);

const eps = computed(() => endpointsFor(genreId.value));

/** URL del "Ver todo" → grilla paginada con el endpoint de ESA sección. */
function allUrl(t: string[], endpoint: string): string {
  const title = `${t[0]} ${t[1]}`;
  return `/ver-todo?title=${encodeURIComponent(title)}&endpoint=${encodeURIComponent(endpoint)}&type=tv`;
}

function onSelect({ id }: { id: MediaItem['id'] }) {
  router.push(`/serie/${id}/1/1`);
}
</script>

<template>
  <div class="series-view">
    <BackButtonMobile />
    <div class="page-head">
      <div class="page-head-bar"></div>
      <div>
        <div class="page-head-title"><span class="ph-emoji">📺 </span>Series</div>
        <div class="page-head-sub">Lo mejor de la televisión a tu alcance</div>
      </div>
    </div>

    <GenreFilter :options="seriesGenreOptions" :active-id="genreId" @select="selectGenre" />

    <Carousel
      :title="titles.trending[0]"
      :subtitle="titles.trending[1]"
      :items="trending.items.value"
      :loading="trending.loading.value"
      fallback-type="tv"
      :see-all-to="allUrl(titles.trending, eps.trending)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.onAir[0]"
      :subtitle="titles.onAir[1]"
      :items="onAir.items.value"
      :loading="onAir.loading.value"
      fallback-type="tv"
      :see-all-to="allUrl(titles.onAir, eps.onAir)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.popular[0]"
      :subtitle="titles.popular[1]"
      :items="popular.items.value"
      :loading="popular.loading.value"
      fallback-type="tv"
      :see-all-to="allUrl(titles.popular, eps.popular)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.topRated[0]"
      :subtitle="titles.topRated[1]"
      :items="topRated.items.value"
      :loading="topRated.loading.value"
      fallback-type="tv"
      :see-all-to="allUrl(titles.topRated, eps.topRated)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.upcoming[0]"
      :subtitle="titles.upcoming[1]"
      :items="upcoming.items.value"
      :loading="upcoming.loading.value"
      fallback-type="tv"
      :see-all-to="allUrl(titles.upcoming, eps.upcoming)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.series-view {
  padding-top: 12px;
  padding-bottom: 48px;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 52px 4px;
}
.page-head-bar {
  width: 4px;
  height: 32px;
  background: var(--accent, #3d5afe);
  border-radius: 2px;
  flex-shrink: 0;
}
.page-head-title {
  font-family: 'Oswald', sans-serif;
  font-size: 1.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.page-head-sub {
  font-size: 0.78rem;
  color: var(--text-muted, #9a9a9a);
  margin-top: 2px;
}

/* ── Móvil: cabecera centrada estilo Netflix (título arriba, dropdown debajo) ── */
@media (max-width: 640px) {
  .series-view {
    padding-top: 16px;
    position: relative;
  }
  .page-head {
    justify-content: center;
    padding: 8px 16px 8px;
  }
  .page-head-bar {
    display: none;
  }
  .page-head-title {
    font-size: 1.35rem;
    text-align: center;
  }
  .ph-emoji {
    display: none;
  }
  .page-head-sub {
    display: none;
  }
}
</style>
