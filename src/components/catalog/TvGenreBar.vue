<script setup lang="ts">
/**
 * TvGenreBar — selector de géneros estilo Netflix para TV, con SCROLL INFINITO real.
 *
 * Comportamiento (confirmado con el usuario):
 *  - El género activo queda anclado a la IZQUIERDA, con borde blanco; al moverse la
 *    barra se DESLIZA para anclar el nuevo.
 *  - **Infinito sin gap**: la lista se renderiza TRIPLICADA, así SIEMPRE hay géneros
 *    a la derecha (y a la izquierda). Después del último viene el primero (Todos)
 *    de inmediato, sin espacio negro — "un scroll que nunca termina". Cuando el
 *    índice se acerca a un borde, se "reasienta" al bloque del medio sin animación
 *    (invisible, porque el contenido es idéntico cada N chips).
 *  - El FILTRO real (emit 'select') se aplica al ASENTARSE (~350ms); Enter/clic al toque.
 *  - Integrado al control: ←/→ género; ↓ contenido; ↑ nav. (El chip activo lleva la
 *    clase `.tv-genre-chip.active` para que lo enfoquen NavTV/useTvSpatialNav.)
 *
 * Drop-in del `GenreFilter` (misma firma); SOLO TV.
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import type { GenreOption } from '../../services/catalog';

const props = defineProps<{ options: GenreOption[]; activeId: number }>();
const emit = defineEmits<{ (e: 'select', id: number): void }>();

const chipRefs = ref<(HTMLElement | null)[]>([]);
const offsetX = ref(0);
const instantJump = ref(false);

function setChipRef(el: Element | { $el?: Element } | null, i: number) {
  chipRefs.value[i] = (el as HTMLElement) ?? null;
}

const n = computed(() => props.options.length);
const indexOfId = (id: number) => Math.max(0, props.options.findIndex((o) => o.id === id));

/** Lista TRIPLICADA — `_real` es el índice real (0..n-1); el `key` del v-for es la pos. */
const displayList = computed(() =>
  [...props.options, ...props.options, ...props.options].map((opt, i) => ({
    id: opt.id,
    label: opt.label,
    real: i % (n.value || 1),
    pos: i,
  }))
);

// Índice VIRTUAL (posición en la lista triplicada). Se mantiene en el bloque del medio.
const vIndex = ref(0);
const realIndex = computed(() => (n.value ? ((vIndex.value % n.value) + n.value) % n.value : 0));

let initialized = false;
function initVIndex() {
  if (!n.value) return;
  vIndex.value = n.value + indexOfId(props.activeId);
  initialized = true;
  updateOffset();
}
// Inicializa cuando hay opciones, y re-inicializa si cambian (otra vista).
watch(
  () => props.options,
  () => {
    initialized = false;
    initVIndex();
  },
  { immediate: true }
);

// Si el padre cambia activeId desde afuera y NO coincide con el actual, re-anclar.
watch(
  () => props.activeId,
  (id) => {
    if (!initialized || !n.value) return;
    if (indexOfId(id) !== realIndex.value) vIndex.value = n.value + indexOfId(id);
  }
);

async function updateOffset() {
  await nextTick();
  const el = chipRefs.value[vIndex.value];
  offsetX.value = el ? el.offsetLeft : 0;
}
watch(vIndex, updateOffset);

let settleTimer: ReturnType<typeof setTimeout> | null = null;
function applyFilter(immediate: boolean) {
  if (settleTimer) clearTimeout(settleTimer);
  const id = props.options[realIndex.value]?.id;
  if (id === undefined) return;
  if (immediate) emit('select', id);
  else settleTimer = setTimeout(() => emit('select', id), 350);
}

// Reasienta vIndex al bloque del medio [n, 2n) cuando está idle (invisible: misma
// posición visual cada N chips). Mantiene el infinito sin que se agoten las copias.
let reseatTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReseat() {
  if (reseatTimer) clearTimeout(reseatTimer);
  reseatTimer = setTimeout(reseat, 320);
}
function reseat() {
  if (!n.value) return;
  let v = vIndex.value;
  while (v < n.value) v += n.value;
  while (v >= 2 * n.value) v -= n.value;
  if (v !== vIndex.value) {
    instantJump.value = true;
    vIndex.value = v;
    nextTick(() => {
      chipRefs.value[v]?.focus();
      requestAnimationFrame(() => (instantJump.value = false));
    });
  }
}

function goToDisplay(di: number, immediate = false) {
  if (di < 0 || di >= displayList.value.length) return;
  instantJump.value = false;
  vIndex.value = di;
  nextTick(() => chipRefs.value[di]?.focus());
  applyFilter(immediate);
  scheduleReseat();
}

function move(dir: 1 | -1) {
  if (!n.value) return;
  goToDisplay(vIndex.value + dir);
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
      applyFilter(true);
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

onBeforeUnmount(() => {
  if (settleTimer) clearTimeout(settleTimer);
  if (reseatTimer) clearTimeout(reseatTimer);
});
</script>

<template>
  <div class="tv-genre-bar" role="tablist">
    <div
      class="tv-genre-track"
      :class="{ 'no-anim': instantJump }"
      :style="{ transform: `translateX(${-offsetX}px)` }"
    >
      <button
        v-for="item in displayList"
        :key="item.pos"
        :ref="(el) => setChipRef(el, item.pos)"
        class="tv-genre-chip"
        :class="{ active: item.pos === vIndex }"
        role="tab"
        :aria-selected="item.pos === vIndex"
        :tabindex="item.pos === vIndex ? 0 : -1"
        @click="goToDisplay(item.pos, true)"
        @keydown="onKeydown($event)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tv-genre-bar {
  overflow: hidden;
  padding: 16px 52px;
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 36px, #000 calc(100% - 90px), transparent 100%);
}
.tv-genre-track {
  display: flex;
  gap: 16px;
  width: max-content;
  transition: transform 0.25s ease-out;
  will-change: transform;
}
.tv-genre-track.no-anim {
  transition: none; /* reasiento invisible del scroll infinito */
}
.tv-genre-chip {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid transparent;
  border-radius: 14px;
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Roboto', sans-serif;
  font-size: 1.25rem;
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
