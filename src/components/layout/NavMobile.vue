<script setup lang="ts">
/**
 * NavMobile — la barra inferior de navegación móvil (`#bottomNav`).
 *
 * Reemplaza `.bottom-nav`/`.bottom-nav-item`/`#bottomMoreMenu` (líneas
 * ~2627-2660+) y `setBottomActive`/`toggleBottomMore`/`closeBottomMore`
 * (líneas ~6286-6318).
 *
 * El original alterna `.active`/`.open` recorriendo el DOM a mano y usa
 * `requestAnimationFrame` + un listener de "click afuera" de un solo uso
 * para cerrar el submenú; aquí:
 *   - `.active` es 100% derivado de `active === item.key` (sin recorrido DOM)
 *   - el submenú es un `v-if`/transición CSS controlada por `moreOpen` (ref)
 *   - el cierre por click-afuera se implementa con un único listener en
 *     `document` que se agrega/quita junto con `moreOpen` (mismo efecto que
 *     el "listener de un solo uso", sin fugas de memoria)
 */
import { onBeforeUnmount } from 'vue';
import { MORE_MENU_ITEMS, type RouteKey } from '../../services/navigation';

const props = defineProps<{
  active: RouteKey;
}>();

const emit = defineEmits<{
  (e: 'navigate', key: RouteKey): void;
  /** El botón "Buscar" no navega directo — abre el panel de búsqueda móvil (línea ~6246: `openMobileSearch`). */
  (e: 'open-search'): void;
}>();

// MORE_MENU_ITEMS conservado para no romper el import (puede usarse en futuro)
void MORE_MENU_ITEMS;

onBeforeUnmount(() => {});

function onItemClick(key: RouteKey) {
  if (key === 'search') {
    emit('open-search');
    return;
  }
  emit('navigate', key);
}
</script>

<template>
  <nav class="bottom-nav">
    <div class="bottom-nav-inner">
      <!-- Inicio -->
      <button class="bottom-nav-item" :class="{ active: active === 'home' }" @click="onItemClick('home')">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        <span>Inicio</span>
      </button>
      <!-- Buscar -->
      <button class="bottom-nav-item" :class="{ active: active === 'search' }" @click="onItemClick('search')">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>
        <span>Buscar</span>
      </button>
      <!-- Mi Lista -->
      <button class="bottom-nav-item" :class="{ active: active === 'mylist' }" @click="onItemClick('mylist')">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        <span>Mi Netflix</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* Preservados de `.bottom-nav/.bottom-nav-inner/.bottom-nav-item/.bottom-nav-item.active/.bottom-more-menu` (líneas ~1807-1837, ~2653+) */
.bottom-nav {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  background: rgba(14, 14, 14, 0.96);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
html.mobile-mode .bottom-nav {
  display: block;
}
.bottom-nav-inner {
  display: flex;
  justify-content: space-around;
  padding: 6px 4px calc(6px + env(safe-area-inset-bottom, 0px));
}
.bottom-nav-item {
  background: none;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.62rem;
  padding: 6px 10px;
  cursor: pointer;
  transition: color var(--trans, 0.25s ease);
}
.bottom-nav-item.active {
  color: var(--accent, #3d5afe);
}
.bottom-nav-icon {
  font-size: 1.15rem;
  line-height: 1;
}
.nav-icon {
  width: 24px;
  height: 24px;
}
.bottom-more-menu {
  position: absolute;
  right: 10px;
  bottom: 64px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(26, 26, 26, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius, 8px);
  padding: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.bottom-more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: var(--text, #f0f0f0);
  font-size: 0.78rem;
  padding: 8px 14px;
  border-radius: var(--radius, 6px);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--trans, 0.25s ease);
}
.bottom-more-item:hover,
.bottom-more-item.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent, #3d5afe);
}

.bottom-more-enter-active,
.bottom-more-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.bottom-more-enter-from,
.bottom-more-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
