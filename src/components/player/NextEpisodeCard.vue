<script setup lang="ts">
/**
 * NextEpisodeCard — card "Siguiente episodio" que aparece (en hover sobre ⏭) en
 * la esquina inferior derecha, sobre la barra de controles. Muestra miniatura +
 * número + título + sinopsis del próximo episodio. Componente presentacional:
 * recibe el episodio ya resuelto y emite `play`. Emite `hover-keep`/`hover-end`
 * para el "puente" de hover (que no se cierre al mover el mouse del botón a la card).
 */
import type { EpisodeMeta } from '../../services/episodes';

defineProps<{
  open: boolean;
  loading: boolean;
  episode: EpisodeMeta | null;
  /** Centrada y justo encima del botón ⏭ (caso iframe/anime, cuyo disparador está al
   *  medio). En false va a la esquina inferior derecha (caso RD, ⏭ en la barra). */
  centered?: boolean;
}>();

const emit = defineEmits<{
  (e: 'play'): void;
  (e: 'hover-keep'): void;
  (e: 'hover-end'): void;
}>();
</script>

<template>
  <transition name="nec-fade">
    <div
      v-if="open"
      class="nec"
      :class="{ centered }"
      @mouseenter="emit('hover-keep')"
      @mouseleave="emit('hover-end')"
    >
      <div class="nec-head">Siguiente episodio</div>
      <div class="nec-body">
        <div v-if="loading" class="nec-loading"><span class="nec-spinner"></span></div>
        <p v-else-if="!episode" class="nec-empty">No hay un episodio siguiente.</p>
        <button v-else class="nec-card" aria-label="Reproducir siguiente episodio" @click="emit('play')">
          <span class="nec-thumb">
            <img v-if="episode.stillUrl" :src="episode.stillUrl" :alt="episode.name" loading="lazy" />
            <span v-else class="nec-thumb-ph">{{ episode.number }}</span>
            <span class="nec-thumb-play">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          <span class="nec-info">
            <span class="nec-num">{{ episode.number }}&nbsp;&nbsp;{{ episode.name }}</span>
            <span class="nec-overview">{{ episode.overview || 'Sin descripción disponible.' }}</span>
          </span>
        </button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.nec {
  position: absolute;
  right: 18px;
  bottom: 92px;
  z-index: 28;
  /* Fallback Chromium 38: 420px acotado por max-width:84vw = min(420px,84vw). Moderno usa min() abajo. */
  width: 420px;
  max-width: 84vw;
  width: min(420px, 84vw);
  background: rgba(20, 20, 20, 0.97);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-lg, 8px);
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}
.nec-head {
  font-size: 17px;
  font-weight: 700;
  color: var(--text, #f0f0f0);
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.nec-body {
  padding: 14px 16px;
}
.nec-loading {
  display: flex;
  justify-content: center;
  padding: 24px;
}
.nec-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent, #3d5afe);
  border-radius: 50%;
  animation: nec-spin 0.8s linear infinite;
}
@keyframes nec-spin {
  to { transform: rotate(360deg); }
}
.nec-empty {
  margin: 0;
  color: var(--text-muted, #9a9a9a);
  font-size: 13px;
}
.nec-card {
  display: flex;
  gap: 14px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.nec-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 132px;
  height: 76px;
  border-radius: var(--radius, 5px);
  overflow: hidden;
  background: var(--surface3, #2e2e2e);
}
.nec-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.nec-thumb-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted, #9a9a9a);
}
.nec-thumb-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity var(--trans, 0.25s);
}
.nec-card:hover .nec-thumb-play,
.nec-card:focus-visible .nec-thumb-play {
  opacity: 1;
}
.nec-thumb-play svg {
  width: 30px;
  height: 30px;
  color: #fff;
}
.nec-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.nec-num {
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #f0f0f0);
}
.nec-overview {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-muted, #b8b8b8);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Modo centrado (iframe/anime): justo encima del botón ⏭ centrado, para que el
   "puente" de hover funcione (sin hueco entre el botón y la card). */
.nec.centered {
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  bottom: 58px;
}

/* Transición solo-opacidad: el modo centrado usa `transform: translateX(-50%)`,
   así que animar transform acá lo pisaría. */
.nec-fade-enter-active,
.nec-fade-leave-active {
  transition: opacity 0.18s ease;
}
.nec-fade-enter-from,
.nec-fade-leave-to {
  opacity: 0;
}

@media (max-width: 600px) {
  .nec {
    right: 10px;
    left: 10px;
    width: auto;
    bottom: 84px;
  }
  .nec.centered {
    transform: none;
    bottom: 58px;
  }
}
</style>
