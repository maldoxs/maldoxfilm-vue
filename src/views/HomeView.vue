<script setup lang="ts">
/**
 * HomeView — la página de Inicio completa: hero rotativo + tabs
 * (Películas/Series/Populares) + barra de géneros + "Continuar viendo" +
 * carruseles dinámicos (Tendencias/Populares/Mejor Valoradas/Próximos) +
 * TOP 10 Películas/Series + carruseles por género.
 *
 * Reemplaza `showHome()` + `#homePage` (índex.html líneas ~2686-2895) y la
 * lógica `loadHero`/`switchTab`/`filterGenre`/`loadCarousel`/`loadTopCarousel`.
 *
 * Pendientes (a evaluar de a poco): Anime y Deportes del home.
 */
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import HeroBanner from '../components/catalog/HeroBanner.vue';
import Carousel from '../components/catalog/Carousel.vue';
import TopNumbered from '../components/catalog/TopNumbered.vue';
import ContinueWatching from '../components/catalog/ContinueWatching.vue';
import GenreFilter from '../components/catalog/GenreFilter.vue';
import { useAppServices } from '../composables/useAppServices';
import { useTmdbList } from '../composables/useTmdbList';
import { useGenreCatalog } from '../composables/useGenreCatalog';
import { useDeviceStore } from '../stores/device';
import { TODOS_GENRE_ID, buildHomeGenreOptions } from '../services/catalog';
import type { MediaItem } from '../types';

// Lista reducida (13) de géneros para el Inicio — preserva la barra de producción.
const homeGenreOptions = buildHomeGenreOptions();

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();
const LANG = 'es-ES';

type HomeTab = 'movies' | 'series' | 'popular';
const tab = ref<HomeTab>('movies');

// ── Carruseles DINÁMICOS (responden a tab + género) ──────────────────────────
const trending = useTmdbList(tmdbClient);
const popular = useTmdbList(tmdbClient);
const topRated = useTmdbList(tmdbClient);
const upcoming = useTmdbList(tmdbClient);

// ── Carruseles ESTÁTICOS ─────────────────────────────────────────────────────
const topMovies = useTmdbList(tmdbClient);
const topSeries = useTmdbList(tmdbClient);
const mostWatched = useTmdbList(tmdbClient);
const topRatedSeries = useTmdbList(tmdbClient);
const comedyMovies = useTmdbList(tmdbClient);
const netflixSeries = useTmdbList(tmdbClient);
const actionMovies = useTmdbList(tmdbClient);
const horrorMovies = useTmdbList(tmdbClient);
const docMovies = useTmdbList(tmdbClient);

/**
 * dynEndpoints — endpoints de los 4 carruseles dinámicos según tab + género.
 * Preserva `switchTab` (líneas ~7087-7091) y los filtros de género
 * (`filterMoviesGenre`, líneas ~6596-6599).
 */
function dynEndpoints(t: HomeTab, g: number) {
  if (t === 'movies') {
    if (g === TODOS_GENRE_ID)
      return {
        trending: `/trending/movie/week?language=${LANG}`,
        popular: `/movie/popular?language=${LANG}`,
        toprated: `/movie/top_rated?language=${LANG}`,
        upcoming: `/movie/upcoming?language=${LANG}`,
      };
    return {
      trending: `/discover/movie?language=${LANG}&with_genres=${g}&sort_by=popularity.desc`,
      popular: `/discover/movie?language=${LANG}&with_genres=${g}&sort_by=vote_count.desc`,
      toprated: `/discover/movie?language=${LANG}&with_genres=${g}&sort_by=vote_average.desc&vote_count.gte=50`,
      upcoming: `/discover/movie?language=${LANG}&with_genres=${g}&sort_by=release_date.desc`,
    };
  }
  if (t === 'series') {
    if (g === TODOS_GENRE_ID)
      return {
        trending: `/trending/tv/week?language=${LANG}`,
        popular: `/tv/popular?language=${LANG}`,
        toprated: `/tv/top_rated?language=${LANG}`,
        upcoming: `/tv/on_the_air?language=${LANG}`,
      };
    return {
      trending: `/discover/tv?language=${LANG}&with_genres=${g}&sort_by=popularity.desc`,
      popular: `/discover/tv?language=${LANG}&with_genres=${g}&sort_by=vote_count.desc`,
      toprated: `/discover/tv?language=${LANG}&with_genres=${g}&sort_by=vote_average.desc&vote_count.gte=50`,
      upcoming: `/discover/tv?language=${LANG}&with_genres=${g}&sort_by=first_air_date.desc`,
    };
  }
  // 'popular' (mixto) — el género no aplica (preserva el branch `else` de switchTab).
  return {
    trending: `/trending/all/week?language=${LANG}`,
    popular: `/movie/popular?language=${LANG}`,
    toprated: `/tv/top_rated?language=${LANG}`,
    upcoming: `/discover/movie?language=${LANG}&sort_by=vote_average.desc&vote_count.gte=1000`,
  };
}

function reloadDynamic() {
  const ep = dynEndpoints(tab.value, genre.activeGenreId.value);
  trending.load(ep.trending);
  popular.load(ep.popular);
  topRated.load(ep.toprated);
  upcoming.load(ep.upcoming);
}

const genre = useGenreCatalog({
  endpointForGenre: (id) => dynEndpoints(tab.value, id).popular,
  onGenreChange: () => reloadDynamic(),
});

/** switchTab — preserva `switchTab` (líneas ~7087-7091): cambia el tipo y resetea el género a "Todos". */
function switchTab(t: HomeTab) {
  if (tab.value === t) return;
  tab.value = t;
  if (genre.activeGenreId.value !== TODOS_GENRE_ID) {
    genre.selectGenre(TODOS_GENRE_ID); // dispara onGenreChange → reloadDynamic()
  } else {
    reloadDynamic();
  }
}

const dynFallback = computed<'movie' | 'tv'>(() => (tab.value === 'series' ? 'tv' : 'movie'));
const dynSeeAll = computed(() => (tab.value === 'series' ? '/series' : '/peliculas'));
const showGenreBar = computed(() => tab.value !== 'popular');

onMounted(() => {
  reloadDynamic();
  // TOP 10 + estáticos (endpoints EXACTOS del original, líneas ~6999-7010).
  topMovies.load(`/movie/popular?language=${LANG}`);
  topSeries.load(`/tv/popular?language=${LANG}`);
  mostWatched.load(`/movie/now_playing?language=${LANG}`);
  topRatedSeries.load(`/tv/top_rated?language=${LANG}`);
  comedyMovies.load(`/discover/movie?language=${LANG}&with_genres=35&sort_by=popularity.desc`);
  netflixSeries.load(`/discover/tv?language=${LANG}&with_networks=213&sort_by=popularity.desc`);
  actionMovies.load(`/discover/movie?language=${LANG}&with_genres=28&sort_by=vote_count.desc`);
  horrorMovies.load(`/discover/movie?language=${LANG}&with_genres=27&sort_by=popularity.desc`);
  docMovies.load(`/discover/movie?language=${LANG}&with_genres=99&sort_by=vote_average.desc&vote_count.gte=200`);
});

function onSelect({ id, type }: { id: MediaItem['id']; type: 'movie' | 'tv' }) {
  router.push(type === 'movie' ? `/pelicula/${id}` : `/serie/${id}/1/1`);
}
</script>

<template>
  <div class="home-view">
    <HeroBanner />

    <!-- Tabs Películas / Series / Populares — preserva `.tabs-bar` (línea ~2701). -->
    <div class="tabs-bar">
      <button class="tab" :class="{ active: tab === 'movies' }" @click="switchTab('movies')">Películas</button>
      <button class="tab" :class="{ active: tab === 'series' }" @click="switchTab('series')">Series</button>
      <button class="tab" :class="{ active: tab === 'popular' }" @click="switchTab('popular')">Populares</button>
    </div>

    <!-- Barra de géneros — solo para Películas/Series (preserva `#categories`). -->
    <GenreFilter
      v-if="showGenreBar"
      :options="homeGenreOptions"
      :active-id="genre.activeGenreId.value"
      @select="genre.selectGenre"
    />

    <!-- Continuar viendo -->
    <ContinueWatching @select="onSelect" />

    <!-- ── Carruseles dinámicos ── -->
    <Carousel
      title="Tendencias"
      subtitle="esta semana"
      :items="trending.items.value"
      :loading="trending.loading.value"
      :fallback-type="dynFallback"
      :see-all-to="dynSeeAll"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Más Populares"
      subtitle="del momento"
      :items="popular.items.value"
      :loading="popular.loading.value"
      :fallback-type="dynFallback"
      :see-all-to="dynSeeAll"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Mejor Valoradas"
      subtitle="de todos los tiempos"
      :items="topRated.items.value"
      :loading="topRated.loading.value"
      :fallback-type="dynFallback"
      :see-all-to="dynSeeAll"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Próximos Estrenos"
      subtitle="no te los pierdas"
      :items="upcoming.items.value"
      :loading="upcoming.loading.value"
      :fallback-type="dynFallback"
      :see-all-to="dynSeeAll"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />

    <!-- ── TOP 10 numerados (estilo Netflix) ── -->
    <TopNumbered
      type-label="Películas"
      when="Hoy"
      :items="topMovies.items.value"
      :loading="topMovies.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      @select="onSelect"
    />
    <TopNumbered
      type-label="Series"
      when="Hoy"
      :items="topSeries.items.value"
      :loading="topSeries.loading.value"
      fallback-type="tv"
      see-all-to="/series"
      @select="onSelect"
    />

    <!-- ── Carruseles por categoría (estáticos) ── -->
    <Carousel
      title="Películas más vistas"
      subtitle="del momento"
      :items="mostWatched.items.value"
      :loading="mostWatched.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Series mejores valoradas"
      subtitle="de todos los tiempos"
      :items="topRatedSeries.items.value"
      :loading="topRatedSeries.loading.value"
      fallback-type="tv"
      see-all-to="/series"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Películas de comedia"
      subtitle="para reír a carcajadas"
      :items="comedyMovies.items.value"
      :loading="comedyMovies.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Series de Netflix"
      subtitle="originales"
      :items="netflixSeries.items.value"
      :loading="netflixSeries.loading.value"
      fallback-type="tv"
      see-all-to="/series"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Acción y aventura"
      subtitle="adrenalina pura"
      :items="actionMovies.items.value"
      :loading="actionMovies.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Películas de terror"
      subtitle="para los valientes"
      :items="horrorMovies.items.value"
      :loading="horrorMovies.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      title="Documentales"
      subtitle="aprende y descubre"
      :items="docMovies.items.value"
      :loading="docMovies.loading.value"
      fallback-type="movie"
      see-all-to="/peliculas"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.home-view {
  padding-bottom: 48px;
}
/* Tabs — preserva `.tabs-bar`/`.tab` (índex.html líneas ~350-363). */
.tabs-bar {
  display: flex;
  padding: 8px 52px 0;
  border-bottom: 1px solid var(--border, #333);
  margin: 8px 0 20px;
}
.tab {
  padding: 10px 18px;
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--text-muted, #9a9a9a);
  cursor: pointer;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  letter-spacing: 0.3px;
  transition: all var(--trans, 0.25s ease);
}
.tab.active {
  color: var(--accent, #3d5afe);
  border-bottom-color: var(--accent, #3d5afe);
}
.tab:hover:not(.active) {
  color: var(--text, #f0f0f0);
}
</style>
