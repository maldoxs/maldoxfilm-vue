<script setup lang="ts">
/**
 * TvGenreBar — selector de géneros estilo Netflix para TV (Magic remote / D-pad).
 *
 * Comportamiento (confirmado con el usuario):
 *  - El género activo queda anclado a la IZQUIERDA, con borde blanco; al moverse
 *    la barra se DESLIZA (transform) para anclar el nuevo y esconder los anteriores.
 *  - **Wrap infinito**: después del último vuelve al primero (Todos) y viceversa.
 *    En el salto del wrap NO rebobina (transición instantánea) para que no se vea
 *    "pasando todas las opciones de vuelta".
 *  - El FILTRO real (emit 'select') se aplica al ASENTARSE (~350ms); Enter/clic al toque.
 *  - **Integrado al flujo del control:** ←/→ cambia de género; ↓ baja al contenido;
 *    ↑ vuelve al nav. (NavTV baja a esta barra, y el contenido sube a ella — el
 *    chip activo lleva la clase `.tv-genre-chip.active` para que lo enfoquen desde afuera.)
 *  - Con el puntero: clic selecciona. El hover NO desliza (eso causaba un bucle).
 *
 * Drop-in del `GenreFilter` (misma firma); se usa SOLO en TV. Botones grandes.
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import type { GenreOption } from '../../services/catalog';

const props = defineProps<{ options: GenreOption[]; activeId: number }>();
const emit = defineEmits<{ (e: 'select', id: number): void }>();

const chipRefs = ref<(HTMLElement | null)[]>([]);
const offsetX = ref(0);
const instantJump = ref(false); // true durante el salto del wrap (sin animación)

function setChipRef(el: Element | { $el?: Element } | null, i: number) {
  chipRefs.value[i] = (el as HTMLElement) ?? null;
}

const indexOfId = (id: number) => props.options.findIndex((o) => o.id === id);

// Índice ENFOCADO (visual, inmediato). El filtro real (activeId) lo maneja el padre.
const focusedIndex = ref(Math.max(0, indexOfId(props.activeId)));

watch(
  () => props.activeId,
  (id) => {
    const i = indexOfId(id);
    if (i >= 0 && i !== focusedIndex.value) focusedIndex.value = i;
  }
);

/** Ancla el chip enfocado a la izquierda (recalcula el desplazamiento). */
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
function applyFilter(i: number, immediate: boolean) {
  clearSettle();
  const id = props.options[i]?.id;
  if (id === undefined) return;
  if (immediate) emit('select', id);
  else settleTimer = setTimeout(() => emit('select', id), 350);
}

function goTo(i: number, opts: { immediate?: boolean; wrapped?: boolean } = {}) {
  if (i < 0 || i >= props.options.length) return;
  if (i === focusedIndex.value) {
    if (opts.immediate) applyFilter(i, true);
    return;
  }
  instantJump.value = !!opts.wrapped; // en el wrap, saltar instantáneo (no rebobinar)
  focusedIndex.value = i;
  nextTick(() => {
    chipRefs.value[i]?.focus();
    if (opts.wrapped) requestAnimationFrame(() => (instantJump.value = false));
  });
  applyFilter(i, !!opts.immediate);
}

/** Mueve un género con WRAP infinito (último → primero y viceversa). */
function move(dir: 1 | -1) {
  const n = props.options.length;
  if (!n) return;
  let next = focusedIndex.value + dir;
  let wrapped = false;
  if (next < 0) {
    next = n - 1;
    wrapped = true;
  } else if (next >= n) {
    next = 0;
    wrapped = true;
  }
  goTo(next, { wrapped });
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      move(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      move(-1);
      break;
    case 'Enter':
      e.preventDefault();
      applyFilter(focusedIndex.value, true);
      break;
    case 'ArrowDown':
      e.preventDefault();
      document.querySelector<HTMLElement>('.card, .top-card, .continue-card')?.focus();
      break;
    case 'ArrowUp':
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
    <div
      class="tv-genre-track"
      :class="{ 'no-anim': instantJump }"
      :style="{ transform: `translateX(${-offsetX}px)` }"
    >
      <button
        v-for="(opt, i) in options"
        :key="opt.id"
        :ref="(el) => setChipRef(el, i)"
        class="tv-genre-chip"
        :class="{ active: i === focusedIndex }"
        role="tab"
        :aria-selected="i === focusedIndex"
        :tabindex="i === focusedIndex ? 0 : -1"
        @click="goTo(i, { immediate: true })"
        @keydown="onKeydown($event)"
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
  /* Fade en los bordes para indicar "hay más" géneros. */
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
}
.tv-genre-track {
  display: flex;
  gap: 16px;
  width: max-content;
  transition: transform 0.25s ease-out; /* deslizamiento suave */
  will-change: transform;
}
.tv-genre-track.no-anim {
  transition: none; /* salto instantáneo en el wrap (no rebobina) */
}
.tv-genre-chip {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid transparent;
  border-radius: 14px;
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Roboto', sans-serif;
  font-size: 1.25rem; /* botones grandes */
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
.tv-genre-chip.active {
  background: rgba(255, 255, 255, 0.16);
  border-color: #fff;
  color: #fff;
}
</style>
