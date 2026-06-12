<script setup lang="ts">
/**
 * TopNumbered — fila "TOP 10" con números grandes detrás de cada póster,
 * estilo Netflix. Preserva `#topMoviesSection`/`#topSeriesSection` +
 * `loadTopCarousel`/`buildTopCard` (índex.html líneas ~2773-2799, ~7019-7037),
 * pero con la numeración estilo Netflix (números oscuros con contorno gris
 * en vez del azul del original, según lo pedido).
 */
import { ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useDeviceStore } from '../../stores/device';
import { buildPosterUrl, CAROUSEL_SCROLL_PX } from '../../services/catalog';
import type { MediaItem } from '../../types';

const props = defineProps<{
  /** Etiqueta de tipo ("Películas" / "Series"). */
  typeLabel: string;
  /** Cuándo ("Hoy"). */
  when?: string;
  items: MediaItem[];
  loading?: boolean;
  fallbackType: 'movie' | 'tv';
  /** Ruta del "Ver todo ›" (/peliculas o /series). */
  seeAllTo?: string;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { id: MediaItem['id']; type: 'movie' | 'tv' }): void;
}>();

const deviceStore = useDeviceStore();
const railRef = ref<HTMLElement | null>(null);

// Solo los primeros 10 (preserva el "TOP 10" del original).
const top10 = computed(() => props.items.slice(0, 10));

function poster(item: MediaItem): string {
  return buildPosterUrl(item.poster_path, deviceStore.isTV);
}
function itemTitle(item: MediaItem): string {
  return item.title || item.name || '';
}
function itemType(item: MediaItem): 'movie' | 'tv' {
  return (item.media_type as 'movie' | 'tv') || props.fallbackType;
}
function scroll(direction: -1 | 1) {
  railRef.value?.scrollBy({ left: direction * CAROUSEL_SCROLL_PX, behavior: 'smooth' });
}
function onSelect(item: MediaItem) {
  emit('select', { id: item.id, type: itemType(item) });
}
</script>

<template>
  <div class="top-section">
    <div class="top-section-header">
      <div class="top-label">TOP</div>
      <div class="top-label-sub">
        <span class="top-type">{{ typeLabel }}</span>
        <span class="top-when">{{ when || 'Hoy' }}</span>
      </div>
      <RouterLink v-if="seeAllTo" class="top-see-all" :to="seeAllTo">Ver todo ›</RouterLink>
    </div>
    <div class="carousel-wrapper">
      <button class="carousel-arrow prev" aria-label="Anterior" @click="scroll(-1)">‹</button>
      <div ref="railRef" class="top-carousel">
        <template v-if="loading">
          <div v-for="i in 8" :key="'tsk-' + i" class="top-card">
            <div class="top-card-num">{{ i }}</div>
            <div class="top-card-img card-skeleton"></div>
          </div>
        </template>
        <template v-else>
          <div v-for="(item, i) in top10" :key="item.id" class="top-card" @click="onSelect(item)">
            <div class="top-card-num">{{ i + 1 }}</div>
            <div class="top-card-img">
              <img v-if="poster(item)" :src="poster(item)" :alt="itemTitle(item)" loading="lazy" decoding="async" />
              <div v-else class="top-card-fallback">{{ itemTitle(item) }}</div>
            </div>
          </div>
        </template>
      </div>
      <button class="carousel-arrow next" aria-label="Siguiente" @click="scroll(1)">›</button>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.top-section`/`.top-label`/`.top-card*` (índex.html ~1693-1732),
   con la numeración re-estilizada a "estilo Netflix" (oscura con contorno gris). */
.top-section {
  padding: 0 52px 40px;
}
.top-section-header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 22px;
}
.top-label {
  font-family: 'Oswald', sans-serif;
  font-size: 3rem;
  font-weight: 900;
  color: var(--accent, #3d5afe);
  line-height: 1;
  letter-spacing: -1px;
}
/* Tipo + "Hoy" en UNA línea, al lado del TOP (sin salto de línea). */
.top-label-sub {
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.top-label-sub .top-type {
  font-family: 'Oswald', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #fff;
}
.top-label-sub .top-when {
  font-family: 'Oswald', sans-serif;
  font-size: 0.9rem;
  color: var(--text-muted, #9a9a9a);
  text-transform: uppercase;
}
.top-see-all {
  margin-left: auto;
  text-decoration: none;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.78rem;
  cursor: pointer;
  transition: color var(--trans, 0.25s ease);
}
.top-see-all:hover {
  color: #fff;
}
.carousel-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.top-carousel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: end;
  gap: 28px;
  overflow-x: auto;
  /* Sin scroll vertical dentro del slide (evita que el número quede desalineado). */
  overflow-y: hidden;
  scroll-behavior: smooth;
  padding: 6px 0;
  scrollbar-width: none;
}
.top-carousel::-webkit-scrollbar {
  display: none;
}
.top-card {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  cursor: pointer;
}
/* Número estilo Netflix: GRANDE y bien asomado a la izquierda; el póster solo
   solapa una porción de su lado derecho. `line-height:1` + `align-items:flex-end`
   evitan que el glifo cuelgue por debajo del póster. */
.top-card-num {
  font-family: 'Oswald', sans-serif;
  font-size: 15rem;
  font-weight: 900;
  color: #0e0e0e;
  line-height: 1;
  letter-spacing: -5px;
  margin-right: -26px;
  /* Baja el glifo para que su base quede al ras de la base del póster (el hueco
     de descendente —vacío en dígitos— lo recorta `overflow-y:hidden`). */
  margin-bottom: -0.18em;
  z-index: 2;
  flex-shrink: 0;
  -webkit-text-stroke: 3px rgba(150, 150, 150, 0.5);
  user-select: none;
}
/* Pósters grandes como Netflix (≈6 visibles por fila). */
.top-card-img {
  width: 200px;
  height: 300px;
  border-radius: var(--radius-lg, 8px);
  overflow: hidden;
  background: var(--surface2, #252525);
  flex-shrink: 0;
  position: relative;
  z-index: 3;
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.6);
  transition: transform 0.2s, box-shadow 0.2s;
}
.top-card:hover .top-card-img {
  transform: scale(1.05) translateY(-4px);
  box-shadow: 6px 8px 24px rgba(0, 0, 0, 0.8);
}
.top-card-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.top-card-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  text-align: center;
  padding: 8px;
  color: var(--text-dim, #555);
}
.card-skeleton {
  background: linear-gradient(110deg, #1a1a1a 8%, #232323 18%, #1a1a1a 33%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
@keyframes shimmer {
  to {
    background-position-x: -200%;
  }
}
.carousel-arrow {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  width: 52px;
  border: none;
  background: linear-gradient(to right, rgba(14, 14, 14, 0.9), rgba(14, 14, 14, 0.15));
  color: #fff;
  font-size: 2.6rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* Siempre visibles (atenuadas) para que se note que hay más TOP a la derecha. */
  opacity: 0.55;
  transition: opacity var(--trans, 0.25s ease);
}
.carousel-wrapper:hover .carousel-arrow {
  opacity: 1;
}
.carousel-arrow.prev {
  left: -52px;
}
.carousel-arrow.next {
  right: -52px;
  background: linear-gradient(to left, rgba(14, 14, 14, 0.9), rgba(14, 14, 14, 0.15));
}

@media (max-width: 640px) {
  .top-section {
    padding: 0 12px 30px;
  }
  .top-label {
    font-size: 2.5rem;
  }
  .top-card-num {
    font-size: 8rem;
    letter-spacing: -4px;
    margin-right: -24px;
  }
  .top-card-img {
    width: 130px;
    height: 195px;
  }
}
</style>
