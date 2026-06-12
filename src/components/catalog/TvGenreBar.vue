<script setup lang="ts">
/**
 * TvGenreBar — selector de géneros estilo Netflix para TV (Magic remote / D-pad).
 *
 * Comportamiento (confirmado con el usuario, capturas de Netflix):
 *  - El género ACTIVO queda anclado a la IZQUIERDA, con borde blanco.
 *  - Al moverse a otro, la barra se DESLIZA (transform) para anclar el nuevo a la
 *    izquierda; los anteriores se esconden hacia la izquierda y aparecen los
 *    siguientes por la derecha.
 *  - El FILTRO real (emit 'select') se aplica al ASENTARSE (~350ms), NO en cada
 *    paso → no recarga el catálogo en cada tecla (UX fluida). Enter aplica al toque.
 *
 * Drop-in del `GenreFilter` (misma firma `options`/`activeId`/`@select`); este se
 * usa SOLO en TV (lo decide `GenreFilter.vue`). Botones grandes para ver de lejos.
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import type { GenreOption } from '../../services/catalog';

const props = defineProps<{ options: GenreOption[]; activeId: number }>();
const emit = defineEmits<{ (e: 'select', id: number): void }>();

const chipRefs = ref<(HTMLElement | null)[]>([]);
const offsetX = ref(0);

function setChipRef(el: Element | { $el?: Element } | null, i: number) {
  chipRefs.value[i] = (el as HTMLElement) ?? null;
}

const indexOfId = (id: number) => props.options.findIndex((o) => o.id === id);

// Índice ENFOCADO (visual, inmediato). El filtro real (activeId) lo maneja el padre.
const focusedIndex = ref(Math.max(0, indexOfId(props.activeId)));

// Si el padre cambia activeId desde afuera (reset, etc.), sincronizar el visual.
watch(
  () => props.activeId,
  (id) => {
    const i = indexOfId(id);
    if (i >= 0 && i !== focusedIndex.value) focusedIndex.value = i;
  }
);

/** Recalcula el desplazamiento para anclar el chip enfocado a la izquierda. */
async function updateOffset() {
  await nextTick();
  const el = chipRefs.value[focusedIndex.value];
  offsetX.value = el ? el.offsetLeft : 0;
}
watch([focusedIndex, () => props.options.length], updateOffset, { immediate: true });

let settleTimer: ReturnType<typeof setTimeout> | null = null;
function clearSettle() {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

/** Mueve el foco visual al género `i`; aplica el filtro al asentarse (o inmediato). */
function goTo(i: number, immediate = false) {
  if (i < 0 || i >= props.options.length || i === focusedIndex.value) {
    if (immediate) emit('select', props.options[i]?.id);
    return;
  }
  focusedIndex.value = i;
  nextTick(() => chipRefs.value[i]?.focus());
  clearSettle();
  if (immediate) emit('select', props.options[i].id);
  else settleTimer = setTimeout(() => emit('select', props.options[i].id), 350);
}

function onKeydown(e: KeyboardEvent, i: number) {
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      goTo(i + 1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      goTo(i - 1);
      break;
    case 'Enter':
      e.preventDefault();
      clearSettle();
      emit('select', props.options[i].id);
      break;
    case 'ArrowDown':
      // Bajar al contenido (primera card visible).
      e.preventDefault();
      document.querySelector<HTMLElement>('.card, .top-card, .continue-card')?.focus();
      break;
    case 'ArrowUp':
      // Subir al nav (opción activa).
      e.preventDefault();
      (
        document.querySelector<HTMLElement>('.tv-topnav-item.active') ||
        document.querySelector<HTMLElement>('.tv-topnav-item')
      )?.focus();
      break;
  }
}

onBeforeUnmount(clearSettle);
</script>

<template>
  <div class="tv-genre-bar" role="tablist">
    <div class="tv-genre-track" :style="{ transform: `translateX(${-offsetX}px)` }">
      <button
        v-for="(opt, i) in options"
        :key="opt.id"
        :ref="(el) => setChipRef(el, i)"
        class="tv-genre-chip"
        :class="{ active: i === focusedIndex }"
        role="tab"
        :aria-selected="i === focusedIndex"
        :tabindex="i === focusedIndex ? 0 : -1"
        @click="goTo(i, true)"
        @keydown="onKeydown($event, i)"
        @mouseenter="goTo(i)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tv-genre-bar {
  overflow: hidden;
  padding: 16px 52px;
  /* Fade en los bordes para indicar "hay más" géneros (izq y der). */
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
}
.tv-genre-track {
  display: flex;
  gap: 16px;
  width: max-content;
  transition: transform 0.25s ease-out; /* el deslizamiento suave */
  will-change: transform;
}
.tv-genre-chip {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid transparent;
  border-radius: 14px;
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Roboto', sans-serif;
  font-size: 1.25rem; /* botones grandes (pedido del usuario) */
  font-weight: 600;
  padding: 16px 36px;
  cursor: pointer;
  white-space: nowrap;
  outline: none;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}
.tv-genre-chip:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}
/* Activo: anclado a la izquierda, con borde blanco (estilo Netflix). */
.tv-genre-chip.active {
  background: rgba(255, 255, 255, 0.16);
  border-color: #fff;
  color: #fff;
}
</style>
