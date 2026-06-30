<script setup lang="ts">
/**
 * AnimeView — catálogo de Anime: barra de géneros (subconjunto TMDB) + 5
 * carruseles ("En Emisión", "Últimos Capítulos", "Más Populares", "Mejor
 * Valorados", "Más Vistos"), 100% TMDB vía `with_genres=16&with_keywords=210024`
 * (el keyword 210024 = "anime" excluye animación occidental).
 *
 * Reemplaza `loadAnimePage`/`filterAnimeGenre`/`_setAnimeTitle`
 * (líneas ~7104-7160), incluyendo el comportamiento de "Todos" (gid===0)
 * que restaura los títulos/subtítulos/endpoints originales.
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Carousel from '../components/catalog/Carousel.vue';
import GenreFilter from '../components/catalog/GenreFilter.vue';
import { useAppServices } from '../composables/useAppServices';
import { useTmdbList } from '../composables/useTmdbList';
import { useDeviceStore } from '../stores/device';
import {
  buildAnimeGenreOptions,
  buildAnimeGenreFilter,
  animeCarouselHeading,
  TODOS_GENRE_ID,
  type AnimeCarouselKey,
} from '../services/catalog';
import type { MediaItem } from '../types';

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();

const LANG = 'es-ES';

// ── Los 5 carruseles — orden EXACTO del original (líneas ~7104-7109) ────────
const airing = useTmdbList(tmdbClient);
const latestEps = useTmdbList(tmdbClient);
const topAll = useTmdbList(tmdbClient);
const season = useTmdbList(tmdbClient);
const upcoming = useTmdbList(tmdbClient);

/**
 * endpointsForGenre — los 5 endpoints `/discover/tv` con sus `sort_by`/filtros
 * EXACTOS, parametrizados por el filtro de género activo. Preservado de
 * `loadAnimePage` (líneas ~7105-7109) y de la rama filtrada de
 * `filterAnimeGenre` (líneas ~7156-7161) — ambas usan los MISMOS `sort_by`,
 * solo cambia el fragmento `with_genres`.
 */
function endpointsForGenre(genreId: number) {
  const g = buildAnimeGenreFilter(genreId);
  return {
    airing: `/discover/tv?language=${LANG}&${g}&with_status=0&sort_by=popularity.desc`,
    latestEps: `/discover/tv?language=${LANG}&${g}&sort_by=first_air_date.desc&vote_count.gte=5`,
    topAll: `/discover/tv?language=${LANG}&${g}&sort_by=popularity.desc`,
    season: `/discover/tv?language=${LANG}&${g}&sort_by=vote_average.desc&vote_count.gte=50`,
    upcoming: `/discover/tv?language=${LANG}&${g}&sort_by=vote_count.desc`,
  };
}

// ── Filtro de géneros — propio (NO `useGenreCatalog`): el subconjunto de
// géneros de anime y la lógica de headers (`animeCarouselHeading`) son
// completamente distintos al patrón compartido por Películas/Series
// (`buildGenreOptions`/`sectionTitleForGenre`). Forzar el contrato genérico
// aquí habría significado o bien "simplificar" el comportamiento real de
// `filterAnimeGenre` (líneas ~7134-7163) o ensuciar el composable compartido
// con ramas anime-específicas — ninguna opción preserva la separación de
// responsabilidades del plan.
const animeGenreOptions = buildAnimeGenreOptions();
const activeGenreId = ref(TODOS_GENRE_ID);

function loadAll(genreId: number) {
  const eps = endpointsForGenre(genreId);
  airing.load(eps.airing);
  latestEps.load(eps.latestEps);
  topAll.load(eps.topAll);
  season.load(eps.season);
  upcoming.load(eps.upcoming);
}

/** selectGenre — preserva `filterAnimeGenre` (líneas ~7134-7137): marca el pill activo y recarga los 5 carruseles. */
function selectGenre(genreId: number) {
  if (activeGenreId.value === genreId) return;
  activeGenreId.value = genreId;
  loadAll(genreId);
}

/** heading — título+subtítulo reactivo de cada carrusel según el género activo (preserva `_setAnimeTitle`). */
function heading(key: AnimeCarouselKey) {
  return animeCarouselHeading(key, activeGenreId.value);
}

onMounted(() => {
  // Carga inicial — preserva los `setTimeout` escalonados de `loadAnimePage`
  // (150/300/450/600ms) que evitaban saturar la API TMDB con 5 fetches
  // simultáneos al entrar a la página (líneas ~7105-7109).
  const eps = endpointsForGenre(activeGenreId.value);
  airing.load(eps.airing);
  setTimeout(() => latestEps.load(eps.latestEps), 150);
  setTimeout(() => topAll.load(eps.topAll), 300);
  setTimeout(() => season.load(eps.season), 450);
  setTimeout(() => upcoming.load(eps.upcoming), 600);
});

function onSelect({ id }: { id: MediaItem['id'] }) {
  // Todo el catálogo de anime es TMDB `tv` — preserva `item.media_type||'tv'` (línea ~7117).
  router.push(`/serie/${id}/1/1`);
}
</script>

<template>
  <div class="anime-view">
    <!-- Cabecera centrada — solo móvil (estilo Netflix). -->
    <div v-if="deviceStore.isMobile" class="anime-head-mobile">Anime</div>
    <GenreFilter :options="animeGenreOptions" :active-id="activeGenreId" @select="selectGenre" />

    <Carousel
      :title="heading('airing').title"
      :subtitle="heading('airing').subtitle"
      :items="airing.items.value"
      :loading="airing.loading.value"
      fallback-type="tv"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="heading('latestEps').title"
      :subtitle="heading('latestEps').subtitle"
      :items="latestEps.items.value"
      :loading="latestEps.loading.value"
      fallback-type="tv"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="heading('topAll').title"
      :subtitle="heading('topAll').subtitle"
      :items="topAll.items.value"
      :loading="topAll.loading.value"
      fallback-type="tv"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="heading('season').title"
      :subtitle="heading('season').subtitle"
      :items="season.items.value"
      :loading="season.loading.value"
      fallback-type="tv"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
    <Carousel
      :title="heading('upcoming').title"
      :subtitle="heading('upcoming').subtitle"
      :items="upcoming.items.value"
      :loading="upcoming.loading.value"
      fallback-type="tv"
      :is-tv-mode="deviceStore.isTV"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.anime-view {
  padding-top: 12px;
  padding-bottom: 48px;
}
.anime-head-mobile {
  font-family: 'Oswald', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  text-align: center;
  padding: 16px 16px 4px;
}
</style>
