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
import { ref, computed, nextTick } from 'vue';
import { NAV_ITEMS_TV, nextDpadIndex, type RouteKey } from '../../services/navigation';

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
    // Baja al contenido. Si la vista tiene barra de géneros TV, primero enfoca el
    // género activo (queda integrada al flujo: nav ↓ géneros ↓ películas); si no,
    // va directo a la primera card.
    e.preventDefault();
    const target =
      document.querySelector<HTMLElement>('.tv-genre-chip.active') ||
      document.querySelector<HTMLElement>('.card[tabindex="0"], .channel-card-compact[tabindex="0"]');
    target?.focus();
  }
}

// NOTA: el "return-to-nav en ArrowUp" del original se removió — ahora lo maneja
// `useTvSpatialNav` (App.vue): ArrowUp sube de carrusel y, desde el primero, vuelve
// al nav enfocando la opción ACTIVA (no `focusedIndex`, que podía quedar en otra
// opción y "robaba" el foco mientras recorrías un carrusel). Da prioridad al
// desplazamiento donde el usuario está posicionado.

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
    </div>

    <!-- Buscar + Fullscreen FUERA de `.tv-topnav-items` → con `flex:1` en los
         items, estos quedan empujados a la DERECHA (preserva el original ~2558). -->
    <button
      :ref="(el) => setButtonRef(el, NAV_ITEMS_TV.length)"
      class="tv-topnav-search"
      :tabindex="tabIndexFor(NAV_ITEMS_TV.length)"
      title="Buscar"
      @click="onSearchClick"
      @keydown="onTopnavKeydown($event, NAV_ITEMS_TV.length)"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      Buscar
    </button>

    <button
      :ref="(el) => setButtonRef(el, NAV_ITEMS_TV.length + 1)"
      class="tv-topnav-fullscreen"
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
  </nav>
</template>

<style scoped>
/* Preservados FIEL del original `.tv-topnav*` (índex.html ~1977-2065). Clave:
   `.tv-topnav-items { flex:1 }` empuja Buscar/Fullscreen a la derecha; el item
   activo lleva subrayado (`::after`), no fondo; logo Oswald MALDOX(azul)/FILM(blanco). */
.tv-topnav {
  display: none;
  align-items: center;
  gap: 0;
  padding: 0 52px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 300;
  /* Fondo negro sólido — el degradado a transparente dejaba ver las carátulas/letras
     de atrás. Sólido para que la barra fija no muestre el contenido por debajo. */
  background: #0e0e0e;
  height: 76px;
  box-sizing: border-box;
}
html.tv-mode .tv-topnav {
  display: flex;
}
.logo {
  font-family: 'Oswald', sans-serif;
  font-weight: 800;
  font-size: 1.75rem;
  letter-spacing: 3px;
  color: var(--accent, #3d5afe);
  margin-right: 36px;
  flex-shrink: 0;
  user-select: none;
}
.logo span {
  color: #fff;
}
.tv-topnav-items {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1; /* ← empuja Buscar/Fullscreen a la derecha */
}
.tv-topnav-item {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.68);
  font-family: 'Roboto', sans-serif;
  font-size: 1.05rem;
  font-weight: 500;
  padding: 10px 22px;
  border-radius: var(--radius, 8px);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  letter-spacing: 0.2px;
  position: relative;
  outline: none;
}
.tv-topnav-item:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.tv-topnav-item:focus,
.tv-topnav-item:focus-visible {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  outline: 2px solid rgba(61, 90, 254, 0.6);
  outline-offset: 2px;
}
.tv-topnav-item.active {
  color: #fff;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.14);
}
/* Línea bajo el item activo */
.tv-topnav-item.active::after {
  content: '';
  position: absolute;
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 3px;
  background: var(--accent, #3d5afe);
  border-radius: 2px;
}
/* Buscar — a la derecha (margin-left:auto), icono + texto */
.tv-topnav-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.78);
  padding: 9px 20px;
  border-radius: var(--radius, 8px);
  font-family: 'Roboto', sans-serif;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  outline: none;
}
.tv-topnav-search:hover,
.tv-topnav-search:focus,
.tv-topnav-search:focus-visible {
  background: rgba(255, 255, 255, 0.16);
  border-color: var(--accent, #3d5afe);
  color: #fff;
  outline: 2px solid rgba(61, 90, 254, 0.5);
  outline-offset: 2px;
}
.tv-topnav-search svg {
  width: 20px;
  height: 20px;
}
/* Fullscreen — botón cuadrado al lado de Buscar */
.tv-topnav-fullscreen {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.78);
  width: 44px;
  height: 44px;
  border-radius: var(--radius, 8px);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  outline: none;
}
.tv-topnav-fullscreen:hover,
.tv-topnav-fullscreen:focus,
.tv-topnav-fullscreen:focus-visible {
  background: rgba(255, 255, 255, 0.16);
  border-color: var(--accent, #3d5afe);
  color: #fff;
  outline: 2px solid rgba(61, 90, 254, 0.5);
  outline-offset: 2px;
}
.tv-topnav-fullscreen svg {
  width: 22px;
  height: 22px;
}
</style>
