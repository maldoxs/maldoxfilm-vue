<script setup lang="ts">
/**
 * Carousel — una fila horizontal de `MovieCard`s con flechas de navegación
 * y título de sección (p.ej. "Tendencias esta semana", "Populares").
 *
 * Reemplaza el patrón de sección repetido (líneas ~2727-2769:
 * `.section > .section-header + .carousel-wrapper > [.carousel-arrow, .carousel, .carousel-arrow]`)
 * y `scrollCarousel(id, dir)` (línea ~7064: `el.scrollBy({left: dir*640, behavior:'smooth'})`).
 *
 * GANANCIA REAL vs el original: el original identifica cada carrusel por
 * `id` de DOM y usa `document.getElementById(id).scrollBy(...)`'; aquí se usa
 * un template ref local — no hay colisiones de id global ni necesidad de
 * limpiar nada al desmontar. El skeleton de carga (`.card-skeleton`) se
 * controla con `loading` en vez de `innerHTML` placeholder.
 */
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import MovieCard from './MovieCard.vue';
import type { MediaItem } from '../../types';
import { CAROUSEL_SCROLL_PX } from '../../services/catalog';

const props = defineProps<{
  /** Título de la sección — puede incluir un subtítulo, ver slot `subtitle`. */
  title: string;
  subtitle?: string;
  items: MediaItem[];
  fallbackType: 'movie' | 'tv';
  isTvMode?: boolean;
  /** Mientras es true, se muestran tarjetas-skeleton en vez de `items` (carga inicial). */
  loading?: boolean;
  /** Cantidad de skeletons a mostrar durante `loading` (línea ~2727 usa ~6-8). */
  skeletonCount?: number;
  /** Ruta del "VER TODO ›" — p.ej. `/peliculas` o `/series` según el tipo. Si no se pasa, no se muestra el enlace (preserva `.see-all-btn`, índex.html ~2718). */
  seeAllTo?: string;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { id: MediaItem['id']; type: 'movie' | 'tv' }): void;
}>();

const railRef = ref<HTMLElement | null>(null);

/** scrollCarousel — preservado EXACTO de la línea ~7064 (640px, scroll suave). */
function scroll(direction: -1 | 1) {
  railRef.value?.scrollBy({ left: direction * CAROUSEL_SCROLL_PX, behavior: 'smooth' });
}

const skeletons = (n: number) => Array.from({ length: n }, (_, i) => i);
</script>

<template>
  <div class="section">
    <div class="section-header">
      <div class="section-title">
        {{ title }}
        <span v-if="subtitle" class="sub">{{ subtitle }}</span>
      </div>
      <RouterLink v-if="seeAllTo" class="see-all-btn" :to="seeAllTo">Ver todo ›</RouterLink>
    </div>

    <div class="carousel-wrapper">
      <button class="carousel-arrow prev" aria-label="Anterior" @click="scroll(-1)">‹</button>

      <div ref="railRef" class="carousel">
        <template v-if="loading">
          <div v-for="i in skeletons(skeletonCount ?? 7)" :key="'sk-' + i" class="card-skeleton"></div>
        </template>
        <template v-else>
          <MovieCard
            v-for="item in items"
            :key="item.id"
            :item="item"
            :fallback-type="fallbackType"
            :is-tv-mode="isTvMode"
            @select="emit('select', $event)"
          />
        </template>
      </div>

      <button class="carousel-arrow next" aria-label="Siguiente" @click="scroll(1)">›</button>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.section`/`.carousel-wrapper`/`.carousel`/`.carousel-arrow` (líneas ~494-513, ~2368-2429) */
.section {
  margin: 28px 0;
  /* PERF/MEMORIA (preserva índex.html ~líneas de `.section`): el navegador NO
     renderiza las secciones fuera de viewport hasta que se acercan — clave para
     que TV/móvil (poca RAM) no se "peguen" en el Inicio con muchos carruseles e
     imágenes. `contain-intrinsic-size` reserva el alto estimado para no romper el scroll. */
  content-visibility: auto;
  contain-intrinsic-size: 0 400px;
}
.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 52px;
}
.section-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text, #f0f0f0);
}
.section-title .sub {
  margin-left: 8px;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-muted, #9a9a9a);
}
/* "Ver todo ›" — preserva `.see-all-btn` (índex.html ~2718). */
.see-all-btn {
  flex-shrink: 0;
  text-decoration: none;
  background: none;
  border: none;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.78rem;
  cursor: pointer;
  transition: color var(--trans, 0.25s ease);
}
.see-all-btn:hover {
  color: #fff;
}
.carousel-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.carousel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 220px;
  gap: 14px;
  overflow-x: auto;
  /* ⚠️ NO usar `scroll-snap-type: x mandatory`: el original (índex.html ~495)
     NO lo tenía, y en trackpad de macOS ese snap mandatory SECUESTRA el scroll
     vertical de la página cuando el cursor está sobre un carrusel (solo se podía
     hacer scroll en las zonas negras). Se quita para devolver el scroll global. */
  scroll-behavior: smooth;
  /* `overflow-x:auto` convierte implícitamente `overflow-y` en `auto`, lo que
     dejaba SCROLL VERTICAL atrapado dentro de cada carrusel (se "pegaba" al
     scrollear la página). Se fuerza `overflow-y:hidden`; el padding vertical da
     aire para que el zoom de hover de las cards no quede recortado. */
  overflow-y: hidden;
  /* Más aire a la izquierda (estilo Netflix) — las cards arrancan más adentro. */
  padding: 16px 52px;
  scrollbar-width: none;
}
.carousel::-webkit-scrollbar {
  display: none;
}
/* Flechas estilo Netflix: blancas, grandes, fondo translúcido a toda la altura. */
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
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--trans, 0.25s ease), background var(--trans, 0.25s ease);
}
.carousel-wrapper:hover .carousel-arrow {
  opacity: 1;
}
.carousel-arrow:hover {
  background: linear-gradient(to right, rgba(14, 14, 14, 0.97), rgba(14, 14, 14, 0.25));
}
.carousel-arrow.prev {
  left: 0;
}
.carousel-arrow.next {
  right: 0;
  background: linear-gradient(to left, rgba(14, 14, 14, 0.9), rgba(14, 14, 14, 0.15));
}
.carousel-arrow.next:hover {
  background: linear-gradient(to left, rgba(14, 14, 14, 0.97), rgba(14, 14, 14, 0.25));
}
.card-skeleton {
  border-radius: var(--radius, 8px);
  aspect-ratio: 2 / 3;
  background: linear-gradient(110deg, #1a1a1a 8%, #232323 18%, #1a1a1a 33%);
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
@keyframes shimmer {
  to {
    background-position-x: -200%;
  }
}

@media (max-width: 1024px) {
  .carousel {
    grid-auto-columns: 175px;
  }
}
@media (max-width: 640px) {
  .carousel {
    grid-auto-columns: 130px;
    gap: 10px;
    padding: 4px 14px;
  }
  .section-header {
    padding: 0 14px;
  }
  .carousel-arrow {
    display: none;
  }
}
</style>
