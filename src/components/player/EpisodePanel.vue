<script setup lang="ts">
/**
 * EpisodePanel — panel deslizante de episodios estilo Netflix (entra desde la
 * derecha). Componente PRESENTACIONAL: recibe los episodios ya cargados y emite
 * eventos; toda la orquestación (fetch por temporada, navegación) vive en
 * `PlayerView`. Acordeón: el episodio activo se expande (miniatura + sinopsis +
 * play), el resto quedan como filas con número + título + línea de progreso.
 */
import { ref, watch } from 'vue';
import type { EpisodeMeta } from '../../services/episodes';
import { formatRuntime } from '../../services/runtimeCache';

const props = defineProps<{
  open: boolean;
  loading: boolean;
  /** Episodios de la temporada que se está viendo en el panel. */
  episodes: EpisodeMeta[];
  /** Temporada mostrada en el panel (controlada por el padre). */
  viewedSeason: number;
  /** Opciones de temporada para el selector. */
  seasons: { value: number; label: string }[];
  /** Temporada/episodio que se está reproduciendo (para el badge y el expandido inicial). */
  playingSeason: number;
  playingEpisode: number;
  /** % de avance (0-100) por número de episodio — opcional, para la línea de progreso. */
  progressByEpisode?: Record<number, number>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select-season', season: number): void;
  (e: 'play', payload: { season: number; episode: number }): void;
  /** Puente de hover: el mouse entró al panel → mantenerlo abierto. */
  (e: 'hover-keep'): void;
  /** Puente de hover: el mouse salió del panel → cerrar con delay. */
  (e: 'hover-end'): void;
}>();

/** Número del episodio expandido (acordeón de uno por vez). */
const expanded = ref<number>(props.playingEpisode);

function defaultExpanded(): number {
  if (props.viewedSeason === props.playingSeason) return props.playingEpisode;
  return props.episodes[0]?.number ?? 1;
}

watch(
  () => [props.open, props.viewedSeason, props.episodes] as const,
  ([isOpen]) => {
    if (isOpen) expanded.value = defaultExpanded();
  },
);

function isPlaying(ep: EpisodeMeta): boolean {
  return props.viewedSeason === props.playingSeason && ep.number === props.playingEpisode;
}

function progressOf(ep: EpisodeMeta): number {
  const p = props.progressByEpisode?.[ep.number] ?? 0;
  return Math.max(0, Math.min(100, p));
}

function onRowClick(ep: EpisodeMeta) {
  expanded.value = ep.number;
}

function play(ep: EpisodeMeta) {
  emit('play', { season: props.viewedSeason, episode: ep.number });
}

function onSeasonChange(e: Event) {
  emit('select-season', Number((e.target as HTMLSelectElement).value));
}
</script>

<template>
  <transition name="epp-slide">
    <aside
      v-if="open"
      class="epp"
      role="dialog"
      aria-label="Lista de episodios"
      @mouseenter="emit('hover-keep')"
      @mouseleave="emit('hover-end')"
    >
      <header class="epp-head">
        <div class="epp-season">
          <select class="epp-season-sel" :value="viewedSeason" @change="onSeasonChange">
            <option v-for="opt in seasons" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <svg class="epp-season-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg>
        </div>
        <button class="epp-close" aria-label="Cerrar" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </header>

      <div class="epp-list">
        <div v-if="loading" class="epp-loading">
          <span class="epp-spinner"></span> Cargando episodios…
        </div>
        <p v-else-if="!episodes.length" class="epp-empty">No hay episodios disponibles.</p>

        <article
          v-for="ep in episodes"
          v-else
          :key="ep.number"
          class="epp-item"
          :class="{ 'is-expanded': ep.number === expanded, 'is-playing': isPlaying(ep) }"
          @click="onRowClick(ep)"
        >
          <div class="epp-item-head">
            <span class="epp-num">{{ ep.number }}</span>
            <span class="epp-title">{{ ep.name }}</span>
            <span v-if="isPlaying(ep)" class="epp-badge">Reproduciendo</span>
            <span v-if="ep.runtime" class="epp-time">{{ formatRuntime(ep.runtime) }}</span>
            <span class="epp-line"><i :style="{ width: progressOf(ep) + '%' }"></i></span>
          </div>

          <div v-if="ep.number === expanded" class="epp-item-body">
            <button class="epp-thumb" :aria-label="`Reproducir episodio ${ep.number}`" @click.stop="play(ep)">
              <img v-if="ep.stillUrl" :src="ep.stillUrl" :alt="ep.name" loading="lazy" />
              <span v-else class="epp-thumb-ph">{{ ep.number }}</span>
              <span class="epp-thumb-play">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </span>
              <span v-if="progressOf(ep) > 0" class="epp-thumb-prog"><i :style="{ width: progressOf(ep) + '%' }"></i></span>
            </button>
            <p class="epp-overview">{{ ep.overview || 'Sin descripción disponible.' }}</p>
          </div>
        </article>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.epp {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 92vw);
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: rgba(14, 14, 14, 0.96);
  backdrop-filter: blur(6px);
  border-left: 1px solid var(--border, #333);
}
.epp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  flex: 0 0 auto;
}
.epp-season {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.epp-season-sel {
  appearance: none;
  background: transparent;
  color: var(--text, #f0f0f0);
  border: none;
  font-size: 19px;
  font-weight: 700;
  padding: 4px 28px 4px 2px;
  cursor: pointer;
}
.epp-season-sel:focus-visible {
  outline: 2px solid var(--accent, #3d5afe);
  border-radius: 4px;
}
.epp-season-sel option {
  background: var(--surface, #1c1c1c);
  color: var(--text, #f0f0f0);
  font-weight: 500;
}
.epp-season-caret {
  position: absolute;
  right: 4px;
  width: 18px;
  height: 18px;
  color: var(--text-muted, #9a9a9a);
  pointer-events: none;
}
.epp-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text, #f0f0f0);
  cursor: pointer;
  transition: background var(--trans, 0.25s);
}
.epp-close:hover {
  background: rgba(255, 255, 255, 0.18);
}
.epp-close svg {
  width: 19px;
  height: 19px;
}
.epp-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 14px 20px;
}
.epp-loading,
.epp-empty {
  color: var(--text-muted, #9a9a9a);
  font-size: 14px;
  padding: 20px 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.epp-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent, #3d5afe);
  border-radius: 50%;
  animation: epp-spin 0.8s linear infinite;
}
@keyframes epp-spin {
  to { transform: rotate(360deg); }
}
.epp-item {
  border-radius: var(--radius-lg, 8px);
  padding: 12px 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--trans, 0.25s);
}
.epp-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.epp-item.is-expanded {
  background: rgba(255, 255, 255, 0.06);
  cursor: default;
}
.epp-item.is-playing.is-expanded {
  border-color: var(--accent, #3d5afe);
}
.epp-item-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.epp-num {
  flex: 0 0 22px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-muted, #9a9a9a);
}
.epp-item.is-playing .epp-num {
  color: var(--accent, #3d5afe);
}
.epp-title {
  flex: 1 1 auto;
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #f0f0f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.epp-badge {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--accent, #3d5afe);
  padding: 2px 8px;
  border-radius: 5px;
}
.epp-time {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-muted, #9a9a9a);
}
.epp-line {
  flex: 0 0 54px;
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  overflow: hidden;
}
.epp-line i {
  display: block;
  height: 100%;
  background: var(--accent, #3d5afe);
  border-radius: 2px;
}
.epp-item-body {
  display: flex;
  gap: 14px;
  padding: 12px 2px 4px;
}
.epp-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 132px;
  height: 76px;
  border-radius: var(--radius-lg, 8px);
  overflow: hidden;
  border: none;
  padding: 0;
  background: var(--surface3, #2e2e2e);
  cursor: pointer;
}
.epp-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.epp-thumb-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted, #9a9a9a);
}
.epp-thumb-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity var(--trans, 0.25s);
}
.epp-thumb:hover .epp-thumb-play,
.epp-thumb:focus-visible .epp-thumb-play {
  opacity: 1;
}
.epp-thumb-play svg {
  width: 30px;
  height: 30px;
  color: #fff;
}
.epp-thumb-prog {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  height: 3px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  overflow: hidden;
}
.epp-thumb-prog i {
  display: block;
  height: 100%;
  background: var(--accent, #3d5afe);
}
.epp-overview {
  flex: 1 1 auto;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted, #c7c7c7);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.epp-slide-enter-active,
.epp-slide-leave-active {
  transition: transform 0.28s ease;
}
.epp-slide-enter-from,
.epp-slide-leave-to {
  transform: translateX(100%);
}

@media (max-width: 600px) {
  .epp {
    width: 100%;
    background: rgba(14, 14, 14, 0.98);
  }
}
</style>
