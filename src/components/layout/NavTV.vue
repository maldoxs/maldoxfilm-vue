<script setup lang="ts">
/**
 * NavTV — la barra horizontal superior para modo TV (`#tvTopNav`), con
 * navegación por D-pad (roving focus) y botones especiales de Buscar/Fullscreen.
 *
 * Reemplaza `.tv-topnav`/`.tv-topnav-item` (líneas ~2530-2571),
 * `setTopNavActive` (línea ~8490) y `setupTopNavDpad` + el listener de
 * "retorno de foco" (líneas ~8505-8550).
 *
 * NOTA: el original también mantiene un `<aside class="tv-sidebar">` legacy
 * (líneas ~2573-2604, `display:none` en `tv-mode`) — NO se replica aquí
 * porque está oculto/inactivo en el modo que de verdad se usa (preserva
 * comportamiento visible, no código muerto).
 *
 * GANANCIA REAL vs el original: el roving-tabindex (`tabIndex = i===focusedIndex ? 0 : -1`)
 * y el wraparound circular de `ArrowLeft`/`ArrowRight` viven en
 * `services/navigation.ts::nextDpadIndex` (puro, testeado); aquí solo se
 * aplican sobre refs de botones reales — se preserva el mismo algoritmo
 * (`(i + count) % count`) sin reimplementarlo a mano en el componente.
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { NAV_ITEMS_TV, nextDpadIndex, isReturnToNavKey, type RouteKey } from '../../services/navigation';

const props = defineProps<{
  active: RouteKey;
  isFullscreen?: boolean;
}>();

const emit = defineEmits<{
  (e: 'navigate', key: RouteKey): void;
  (e: 'open-search'): void;
  (e: 'toggle-fullscreen'): void;
}>();

// ── Roving focus — preserva `setupTopNavDpad` (líneas ~8505-8533) ───────────
// Botones navegables: los NAV_ITEMS_TV + Buscar + Fullscreen (mismo conjunto
// que `_tvTopNavIds`, línea ~8407, que incluye 'tnSearch').
const buttonRefs = ref<(HTMLElement | null)[]>([]);
const totalButtons = computed(() => NAV_ITEMS_TV.length + 2); // + Buscar + Fullscreen
const focusedIndex = ref(0);

function setButtonRef(el: Element | { $el?: Element } | null, index: number) {
  buttonRefs.value[index] = (el as HTMLElement) ?? null;
}

function tabIndexFor(index: number): 0 | -1 {
  return index === focusedIndex.value ? 0 : -1;
}

async function focusButton(index: number) {
  focusedIndex.value = index;
  await nextTick();
  buttonRefs.value[index]?.focus();
}

/** Maneja ArrowLeft/ArrowRight sobre los botones del topnav — preservado de la línea ~8505-8533. */
function onTopnavKeydown(e: KeyboardEvent, index: number) {
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    focusButton(nextDpadIndex(index, 'right', totalButtons.value));
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    focusButton(nextDpadIndex(index, 'left', totalButtons.value));
  } else if (e.key === 'ArrowDown') {
    // Salta al primer `.card`/`.channel-card-compact` enfocable del contenido
    // (línea ~8520-8528). En Vue, el contenido vive fuera de este componente,
    // así que se delega al documento — preservando el mismo selector.
    e.preventDefault();
    const target = document.querySelector<HTMLElement>('.card[tabindex="0"], .channel-card-compact[tabindex="0"]');
    target?.focus();
  }
}

/** Segundo listener — devuelve el foco al topnav si el usuario presiona ArrowUp cerca del tope (líneas ~8536-8550). */
function onDocumentKeydown(e: KeyboardEvent) {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return;
  if (buttonRefs.value.includes(el)) return; // ya estamos en el topnav
  const rect = el.getBoundingClientRect();
  if (isReturnToNavKey(e.key, rect.top)) {
    e.preventDefault();
    focusButton(focusedIndex.value);
  }
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown));

function onItemClick(key: RouteKey, index: number) {
  focusedIndex.value = index;
  emit('navigate', key);
}

function onSearchClick() {
  focusedIndex.value = NAV_ITEMS_TV.length;
  emit('open-search');
}

function onFullscreenClick() {
  focusedIndex.value = NAV_ITEMS_TV.length + 1;
  emit('toggle-fullscreen');
}
</script>

<template>
  <nav class="tv-topnav">
    <div class="logo">MALDOX<span>FILM</span></div>
    <div class="tv-topnav-items">
      <button
        v-for="(item, i) in NAV_ITEMS_TV"
        :key="item.key"
        :ref="(el) => setButtonRef(el, i)"
        class="tv-topnav-item"
        :class="{ active: active === item.key }"
        :tabindex="tabIndexFor(i)"
        @click="onItemClick(item.key, i)"
        @keydown="onTopnavKeydown($event, i)"
      >
        {{ item.label }}
      </button>

      <button
        :ref="(el) => setButtonRef(el, NAV_ITEMS_TV.length)"
        class="tv-topnav-item tv-topnav-search"
        :class="{ active: active === 'search' }"
        :tabindex="tabIndexFor(NAV_ITEMS_TV.length)"
        title="Buscar"
        @click="onSearchClick"
        @keydown="onTopnavKeydown($event, NAV_ITEMS_TV.length)"
      >
        🔍
      </button>

      <button
        :ref="(el) => setButtonRef(el, NAV_ITEMS_TV.length + 1)"
        class="tv-topnav-item tv-topnav-fullscreen"
        :tabindex="tabIndexFor(NAV_ITEMS_TV.length + 1)"
        title="Pantalla completa"
        @click="onFullscreenClick"
        @keydown="onTopnavKeydown($event, NAV_ITEMS_TV.length + 1)"
      >
        <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 3v4a1 1 0 0 1-1 1H4M21 9h-4a1 1 0 0 1-1-1V4M3 15h4a1 1 0 0 1 1 1v4M15 21v-4a1 1 0 0 1 1-1h4" />
        </svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* Preservados de `.tv-topnav`/`.tv-topnav-item`/`.tv-topnav-item:focus`/`.tv-topnav-item.active` (líneas ~1977-2024, ~2072-2172) */
.tv-topnav {
  display: none;
  align-items: center;
  gap: 28px;
  padding: 16px 40px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 70;
  background: linear-gradient(to bottom, rgba(14, 14, 14, 0.96), transparent);
  height: 76px;
  box-sizing: border-box;
}
html.tv-mode .tv-topnav {
  display: flex;
}
.logo {
  font-weight: 800;
  font-size: 1.3rem;
  letter-spacing: 0.5px;
  color: var(--text, #f0f0f0);
}
.logo span {
  color: var(--accent, #3d5afe);
}
.tv-topnav-items {
  display: flex;
  align-items: center;
  gap: 14px;
}
.tv-topnav-item {
  background: rgba(255, 255, 255, 0.05);
  border: 2px solid transparent;
  border-radius: var(--radius, 8px);
  color: var(--text-muted, #c2c2c2);
  font-size: 1rem;
  font-weight: 600;
  padding: 10px 22px;
  cursor: pointer;
  transition: background var(--trans, 0.25s ease), color var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease), transform var(--trans, 0.25s ease);
}
.tv-topnav-item:hover {
  color: #fff;
}
.tv-topnav-item.active {
  background: rgba(61, 90, 254, 0.18);
  color: #fff;
}
.tv-topnav-item:focus,
.tv-topnav-item:focus-visible {
  outline: none;
  border-color: var(--accent, #3d5afe);
  background: var(--accent, #3d5afe);
  color: #000;
  transform: scale(1.06);
}
.tv-topnav-search,
.tv-topnav-fullscreen {
  font-size: 1.2rem;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tv-topnav-fullscreen svg {
  width: 22px;
  height: 22px;
}
</style>
