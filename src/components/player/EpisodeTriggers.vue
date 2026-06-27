<script setup lang="ts">
/**
 * EpisodeTriggers — los dos botones de episodios (⏭ "Siguiente" y ⧉ "Lista") que
 * van en la barra de controles, al mismo nivel que audio/subtítulos/velocidad.
 * Mismo mecanismo que esos: HOVER abre (mouseenter) / leave cierra con delay /
 * click togglea (para touch). No tiene estado: solo emite; la orquestación del
 * card y el panel vive en `PlayerView`.
 *
 * Se usa en DOS lugares (mutuamente excluyentes): dentro de la barra `.nf-right`
 * de `VideoPlayer` (camino RD, vía slot) y en una mini-barra de `PlayerView`
 * (camino iframe/anime, que no tiene la barra del reproductor RD).
 */
const emit = defineEmits<{
  (e: 'next-enter'): void;
  (e: 'next-leave'): void;
  (e: 'next-tap'): void;
  (e: 'list-enter'): void;
  (e: 'list-leave'): void;
  (e: 'list-tap'): void;
}>();
</script>

<template>
  <button
    class="ep-trigger"
    title="Siguiente episodio"
    aria-label="Siguiente episodio"
    @mouseenter="emit('next-enter')"
    @mouseleave="emit('next-leave')"
    @click="emit('next-tap')"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  </button>
  <button
    class="ep-trigger"
    title="Lista de episodios"
    aria-label="Lista de episodios"
    @mouseenter="emit('list-enter')"
    @mouseleave="emit('list-leave')"
    @click="emit('list-tap')"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="8" width="12" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2" />
    </svg>
  </button>
</template>

<style scoped>
/* Replica el look de `.nf-btn` (scoped en VideoPlayer no alcanza al slot) para verse
   igual dentro de la barra de controles RD y en la mini-barra de PlayerView (iframe). */
.ep-trigger {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  color: #fff;
  opacity: 0.85;
  display: flex;
  align-items: center;
  transition: opacity var(--trans, 0.25s ease);
}
.ep-trigger:hover,
.ep-trigger:focus-visible {
  opacity: 1;
}
.ep-trigger svg {
  width: 22px;
  height: 22px;
}
</style>
