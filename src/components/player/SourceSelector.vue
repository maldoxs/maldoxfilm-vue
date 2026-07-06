<script setup lang="ts">
/**
 * SourceSelector — la barra de botones "⚡ RD | ▶ UnlimPlay | ▶ vidlink".
 *
 * Reemplaza `<div class="source-selector" id="sourceSelector">` + el
 * `innerHTML` armado a mano con template strings (líneas ~7767-7786 de
 * assets/index.html), incluyendo el botón especial RD (`RD_SRC_IDX = 99`,
 * línea ~4705) que siempre va primero.
 *
 * Preserva el orden EXACTO ("RD → SV → UnlimPlay → VidSrc", comentario línea
 * ~7753) y los datos de {@link SOURCES} (línea ~5365-5378). En Vue, el
 * `data-src-idx`/`querySelectorAll('.source-btn')` manual del original
 * (líneas ~8222-8224, para marcar el botón activo al cambiar de fuente) se
 * reemplaza por una clase reactiva `:class="{ active: ... }"`.
 */
import { computed } from 'vue';

/** RD_SRC_IDX — el índice mágico que identifica la fuente Real-Debrid (línea ~4705). */
export const RD_SRC_IDX = 99;

export interface SourceDescriptor {
  name: string;
  icon: string;
}

/**
 * SOURCES — preservado 1:1 de la línea ~5365-5378 (solo se preservan los
 * metadatos visuales aquí; las funciones `movie(id)`/`tv(id,s,e)` que arman
 * la URL del iframe viven en la vista del reproductor, que es quien conoce
 * `playerState`).
 */
export const SOURCES: SourceDescriptor[] = [
  { name: 'UnlimPlay', icon: '▶' },
  { name: 'vidlink', icon: '▶' },
];

const props = defineProps<{
  /** Índice de la fuente activa — `RD_SRC_IDX` (99) o un índice de `SOURCES`. */
  activeIndex: number;
  /** Si es anime de TV, el original oculta este selector (línea ~7768: `if(!_dpIsAnime || type !== 'tv')`). */
  hidden?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', index: number): void;
}>();

const visible = computed(() => !props.hidden);
</script>

<template>
  <div v-if="visible" class="source-selector">
    <button
      class="source-btn"
      :class="{ active: activeIndex === RD_SRC_IDX }"
      :data-src-idx="RD_SRC_IDX"
      @click="emit('select', RD_SRC_IDX)"
    >
      ⚡ RD
    </button>
    <button
      v-for="(src, i) in SOURCES"
      :key="src.name"
      class="source-btn"
      :class="{ active: activeIndex === i }"
      :data-src-idx="i"
      @click="emit('select', i)"
    >
      {{ src.icon }} {{ src.name }}
    </button>
  </div>
</template>

<style scoped>
/* Preservados de `.source-selector`/`.source-btn` (líneas ~1081, ~1284-1298) */
.source-selector {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.source-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius, 5px);
  color: var(--text, #f0f0f0);
  font-size: 0.7rem;
  padding: 3px 9px;
  cursor: pointer;
  transition: background var(--trans, 0.25s ease), color var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease);
}
.source-btn:hover,
.source-btn.active {
  background: var(--accent, #3d5afe);
  color: #000;
  border-color: var(--accent, #3d5afe);
}
.source-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(61, 90, 254, 0.7);
}

@media (max-width: 640px) {
  .source-btn {
    padding: 4px 9px;
    font-size: 0.68rem;
  }
}
</style>
