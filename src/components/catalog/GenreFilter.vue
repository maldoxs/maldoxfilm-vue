<script setup lang="ts">
/**
 * GenreFilter — la barra de "pills" de género ("Todos | Acción | Comedia | ...")
 * usada en las vistas de Películas/Series/Anime.
 *
 * Reemplaza `#moviesGenreBar`/`#seriesGenreBar`/`#animeFilterBar` (líneas
 * ~3054-3060, ~2985-2995) y `filterMoviesGenre`/`filterSeriesGenre`/
 * `filterAnimeGenre` (líneas ~6851, ~6902, ~7134): el original arma el
 * `innerHTML` con `onclick` inline y alterna `classList.toggle('active')`
 * a mano sobre todos los hermanos; aquí es un único `v-for` con `:class`
 * reactivo basado en `activeId` — selección única, sin tocar el DOM.
 *
 * `services/catalog.ts` ya expone `buildGenreOptions`/`GENRE_NAMES_MAP`/
 * `sectionTitleForGenre` (puros, testeados) — este componente solo pinta
 * las opciones y emite el id elegido; la vista padre decide cómo recargar
 * los carruseles (`loadCarouselInfinite(...&with_genres={id}...)`).
 */
import type { GenreOption } from '../../services/catalog';
import { useDeviceStore } from '../../stores/device';
import TvGenreBar from './TvGenreBar.vue';

const props = defineProps<{
  options: GenreOption[];
  activeId: number;
}>();

const emit = defineEmits<{
  (e: 'select', id: number): void;
}>();

const deviceStore = useDeviceStore();
</script>

<template>
  <!-- TV: menú deslizante estilo Netflix (activo anclado a la izquierda). En
       escritorio/móvil se mantiene la barra de pills de siempre (sin cambios). -->
  <TvGenreBar
    v-if="deviceStore.isTV"
    :options="props.options"
    :active-id="props.activeId"
    @select="emit('select', $event)"
  />
  <div v-else class="genre-bar" role="tablist">
    <button
      v-for="opt in options"
      :key="opt.id"
      class="genre-pill"
      :class="{ active: activeId === opt.id }"
      role="tab"
      :aria-selected="activeId === opt.id"
      @click="emit('select', opt.id)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
/* Preservados de `.genre-bar`/`.genre-pill`/`.genre-pill.active` (líneas ~330-345) */
.genre-bar {
  display: flex;
  gap: 8px;
  /* Alineado a 52px como los carruseles/cabeceras (antes 24px → se veía
     "cargado a la izquierda"). Scroll horizontal en vez de wrap para aguantar
     la lista completa de géneros en una sola fila (preserva `overflow-x:auto`). */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0 52px;
  margin-bottom: 18px;
}
.genre-bar::-webkit-scrollbar {
  display: none;
}
.genre-pill {
  flex-shrink: 0;
}
.genre-pill {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: var(--text-muted, #aaa);
  font-size: 0.74rem;
  padding: 6px 16px;
  cursor: pointer;
  transition: background var(--trans, 0.25s ease), color var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease);
}
.genre-pill:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.genre-pill.active {
  background: var(--accent, #3d5afe);
  border-color: var(--accent, #3d5afe);
  color: #000;
  font-weight: 600;
}

@media (max-width: 640px) {
  .genre-bar {
    padding: 0 14px;
    gap: 6px;
  }
  .genre-pill {
    font-size: 0.7rem;
    padding: 5px 12px;
  }
}
</style>
