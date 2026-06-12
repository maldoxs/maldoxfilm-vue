<script setup lang="ts">
/**
 * MoviesView — catálogo de Películas: cabecera + barra de géneros + 5 carruseles
 * que se recargan según el género seleccionado.
 *
 * Reemplaza `#moviesPage` + `filterMoviesGenre`/`loadMoviesPage`
 * (índex.html líneas ~3043-3120, ~6840-6890). Preserva EXACTO:
 *   - los 5 carruseles (Tendencias/Populares/Mejor Valoradas/En Cartelera/
 *     Próximos) con sus íconos y subtítulos,
 *   - la reescritura de títulos al filtrar (🔥 {género} más populares ahora, …),
 *   - los endpoints de `/discover/movie?with_genres=…` con cada `sort_by`
 *     (incluido el rango de fechas de "recientes (últimos 2 años)" y "próximos").
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import Carousel from '../components/catalog/Carousel.vue';
import GenreFilter from '../components/catalog/GenreFilter.vue';
import { useAppServices } from '../composables/useAppServices';
import { useTmdbList } from '../composables/useTmdbList';
import { useDeviceStore } from '../stores/device';
import { TODOS_GENRE_ID, GENRE_NAMES_MAP, buildGenreOptions } from '../services/catalog';
import type { MediaItem } from '../types';

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();
const route = useRoute();
const LANG = 'es-ES';

// Géneros de la barra de Películas — lista COMPLETA (Todos + los 19 géneros de
// cine de TMDB). La barra hace scroll horizontal si no caben todos.
const movieGenreOptions = buildGenreOptions();

// El género se persiste en la URL (`?genero=27`) para que al volver desde la
// grilla "Ver todo" se restaure el filtro seleccionado (no "Todos").
const genreId = ref(Number(route.query.genero) || TODOS_GENRE_ID);

const trending = useTmdbList(tmdbClient);
const popular = useTmdbList(tmdbClient);
const topRated = useTmdbList(tmdbClient);
const nowPlaying = useTmdbList(tmdbClient);
const upcoming = useTmdbList(tmdbClient);

/** Endpoints por género — preserva `filterMoviesGenre` (líneas ~6856-6885). */
function endpointsFor(gid: number) {
  if (gid === TODOS_GENRE_ID) {
    return {
      trending: `/trending/movie/week?language=${LANG}`,
      popular: `/movie/popular?language=${LANG}`,
      topRated: `/movie/top_rated?language=${LANG}`,
      nowPlaying: `/movie/now_playing?language=${LANG}`,
      upcoming: `/movie/upcoming?language=${LANG}`,
    };
  }
  const g = `with_genres=${gid}`;
  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    trending: `/discover/movie?language=${LANG}&${g}&sort_by=popularity.desc`,
    popular: `/discover/movie?language=${LANG}&${g}&sort_by=vote_count.desc`,
    topRated: `/discover/movie?language=${LANG}&${g}&sort_by=vote_average.desc&vote_count.gte=50`,
    nowPlaying: `/discover/movie?language=${LANG}&${g}&primary_release_date.gte=${twoYearsAgo}&sort_by=release_date.desc`,
    upcoming: `/discover/movie?language=${LANG}&${g}&primary_release_date.gte=${today}&sort_by=popularity.desc`,
  };
}

function reload() {
  const ep = endpointsFor(genreId.value);
  trending.load(ep.trending);
  popular.load(ep.popular);
  topRated.load(ep.topRated);
  nowPlaying.load(ep.nowPlaying);
  upcoming.load(ep.upcoming);
}

function selectGenre(id: number) {
  if (genreId.value === id) return;
  genreId.value = id;
  // Refleja el género en la URL (replace, sin agregar entrada al historial) —
  // así "Volver" desde "Ver todo" regresa a Películas con este género activo.
  router.replace({ query: id === TODOS_GENRE_ID ? {} : { genero: String(id) } });
  reload();
}

const isFiltered = computed(() => genreId.value !== TODOS_GENRE_ID);
const genreName = computed(() => GENRE_NAMES_MAP[genreId.value] || 'Género');

/** Títulos reescritos según el género (preserva `_setSectionTitle`, líneas ~6873-6877). */
const titles = computed(() => {
  if (!isFiltered.value) {
    return {
      trending: ['🔥 Tendencias', 'esta semana'],
      popular: ['⭐ Más Populares', 'del momento'],
      topRated: ['🏆 Mejor Valoradas', 'de todos los tiempos'],
      nowPlaying: ['🎬 En Cartelera', 'en cines ahora'],
      upcoming: ['🗓️ Próximos Estrenos', 'no te los pierdas'],
    };
  }
  const n = genreName.value;
  return {
    trending: [`🔥 ${n}`, 'más populares ahora'],
    popular: [`⭐ ${n}`, 'más vistas por el público'],
    topRated: [`🏆 ${n}`, 'mejor puntuadas'],
    nowPlaying: [`🎬 ${n}`, 'recientes (últimos 2 años)'],
    upcoming: [`🗓️ ${n}`, 'próximos lanzamientos'],
  };
});

onMounted(reload);

// Endpoints reactivos por sección (para el "Ver todo").
const eps = computed(() => endpointsFor(genreId.value));

/** URL del "Ver todo" → grilla paginada con el endpoint de ESA sección. */
function allUrl(t: string[], endpoint: string): string {
  const title = `${t[0]} ${t[1]}`;
  return `/ver-todo?title=${encodeURIComponent(title)}&endpoint=${encodeURIComponent(endpoint)}&type=movie`;
}

function onSelect({ id }: { id: MediaItem['id'] }) {
  router.push(`/pelicula/${id}`);
}
</script>

<template>
  <div class="movies-view">
    <!-- Cabecera — preserva `#moviesPage` header (líneas ~3045-3052). -->
    <div class="page-head">
      <div class="page-head-bar"></div>
      <div>
        <div class="page-head-title">🎬 Películas</div>
        <div class="page-head-sub">Todo el catálogo de cine a tu alcance</div>
      </div>
    </div>

    <GenreFilter :options="movieGenreOptions" :active-id="genreId" @select="selectGenre" />

    <Carousel
      :title="titles.trending[0]"
      :subtitle="titles.trending[1]"
      :items="trending.items.value"
      :loading="trending.loading.value"
      fallback-type="movie"
      :see-all-to="allUrl(titles.trending, eps.trending)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.popular[0]"
      :subtitle="titles.popular[1]"
      :items="popular.items.value"
      :loading="popular.loading.value"
      fallback-type="movie"
      :see-all-to="allUrl(titles.popular, eps.popular)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.topRated[0]"
      :subtitle="titles.topRated[1]"
      :items="topRated.items.value"
      :loading="topRated.loading.value"
      fallback-type="movie"
      :see-all-to="allUrl(titles.topRated, eps.topRated)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.nowPlaying[0]"
      :subtitle="titles.nowPlaying[1]"
      :items="nowPlaying.items.value"
      :loading="nowPlaying.loading.value"
      fallback-type="movie"
      :see-all-to="allUrl(titles.nowPlaying, eps.nowPlaying)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="titles.upcoming[0]"
      :subtitle="titles.upcoming[1]"
      :items="upcoming.items.value"
      :loading="upcoming.loading.value"
      fallback-type="movie"
      :see-all-to="allUrl(titles.upcoming, eps.upcoming)"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.movies-view {
  padding-top: 12px;
  padding-bottom: 48px;
}
/* Cabecera de página — preserva el header de `#moviesPage` (líneas ~3045-3052). */
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
</style>
