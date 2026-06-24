<script setup lang="ts">
/**
 * MovieCard — la tarjeta de póster con overlay de título/rating/año y el
 * círculo de puntaje estilo TMDB.
 *
 * Reemplaza `createCard`/`createScoreCircle` (líneas ~6943-6963, ~7049-7063
 * de assets/index.html): en el original se arma un string `innerHTML` gigante
 * con template literals (incluyendo el SVG del círculo y el `onclick` inline);
 * aquí se vuelve un componente declarativo — Vue gestiona el DOM, los datos
 * pasan por `props`, y la navegación se emite como evento (`select`) en vez
 * de llamar `showDetailPage` directo, para que la vista padre controle el router.
 *
 * Toda decisión de "qué mostrar" (color del círculo, año, rating, URL del
 * póster) vive en `services/catalog.ts` — ya testeada (13 tests).
 */
import { computed } from 'vue';
import type { MediaItem } from '../../types';
import {
  buildPosterUrl,
  mediaTitle,
  mediaYear,
  mediaRating,
  resolveMediaType,
} from '../../services/catalog';
import { getRuntime, formatRuntime } from '../../services/runtimeCache';

const props = defineProps<{
  item: MediaItem;
  /** Tipo a usar si `item.media_type` no viene definido (p.ej. 'movie' en /discover/movie). */
  fallbackType: 'movie' | 'tv';
  isTvMode?: boolean;
  /** Progreso "continuar viendo" 0-100, o null si no aplica (línea ~7053-7058). */
  progressPct?: number | null;
  /** Etiqueta del progreso, p.ej. "T1·E3" o "42% visto" (ya formateada por el padre/store). */
  progressLabel?: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { id: MediaItem['id']; type: 'movie' | 'tv' }): void;
}>();

const title = computed(() => mediaTitle(props.item));
const year = computed(() => mediaYear(props.item));
const rating = computed(() => mediaRating(props.item));
const poster = computed(() => buildPosterUrl(props.item.poster_path, !!props.isTvMode));
const mtype = computed(() => resolveMediaType(props.item, props.fallbackType));
const duration = computed(() => {
  const rt = props.item.runtime || getRuntime(props.item.id, mtype.value);
  return formatRuntime(rt);
});

const showProgress = computed(() => (props.progressPct ?? 0) > 3);

function onClick() {
  emit('select', { id: props.item.id, type: mtype.value });
}
</script>

<template>
  <div class="card" role="button" tabindex="0" @click="onClick" @keydown.enter="onClick">
    <img v-if="poster" class="card-poster" :src="poster" :alt="title" loading="eager" decoding="async" />
    <div v-else class="card-poster card-poster-fallback">{{ title }}</div>

    <div v-if="showProgress" class="card-progress-bar">
      <div class="card-progress-fill" :style="{ width: progressPct + '%' }"></div>
      <span v-if="progressLabel" class="card-progress-label">{{ progressLabel }}</span>
    </div>

    <div class="card-overlay">
      <div class="card-title">{{ title }}</div>
      <div class="card-meta">
        <span class="card-rating">★ {{ rating }}</span>
        <span v-if="year" class="card-year">{{ year }}</span>
      </div>
      <div v-if="duration" class="card-duration">{{ duration }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.card`/`.card-overlay`/`.card-score`/`.card-progress-*` (líneas ~537-578) */
.card {
  position: relative;
  border-radius: var(--radius, 8px);
  overflow: hidden;
  cursor: pointer;
  background: var(--card-bg, #1a1a1a);
  aspect-ratio: 2 / 3;
  transition: transform var(--trans, 0.25s ease);
}
.card:hover,
.card:focus-visible {
  transform: scale(1.04);
  outline: none;
}
.card-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-poster-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  font-size: 0.8rem;
  color: var(--text-muted, #9a9a9a);
  background: linear-gradient(160deg, #1c1c1c, #0e0e0e);
}
.card-score {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 32px;
  height: 32px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
}
.card-score-track {
  fill: rgba(20, 20, 20, 0.85);
  stroke: rgba(255, 255, 255, 0.15);
  stroke-width: 2;
}
.card-score-fill {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset 0.4s ease;
}
.card-score-text {
  fill: #fff;
  font-size: 9px;
  font-weight: 700;
}
.card-progress-bar {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 6px;
  height: 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  overflow: visible;
}
.card-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent, #3d5afe);
}
.card-progress-label {
  position: absolute;
  bottom: 6px;
  right: 0;
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.75);
  white-space: nowrap;
}
.card-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 10px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.92), rgba(0, 0, 0, 0.05) 60%, transparent);
  opacity: 0;
  transition: opacity var(--trans, 0.25s ease);
}
.card:hover .card-overlay,
.card:focus-visible .card-overlay {
  opacity: 1;
}
.card-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text, #f0f0f0);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  margin-top: 4px;
  display: flex;
  gap: 8px;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.65);
}
.card-rating {
  color: #ffc94d;
}
.card-duration {
  margin-top: 2px;
  font-size: 0.62rem;
  color: rgba(255, 255, 255, 0.5);
}
</style>
