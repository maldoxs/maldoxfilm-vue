<script setup lang="ts">
/**
 * NavDesktop — la barra superior de escritorio (`#mainNav`).
 *
 * Reemplaza el markup de `.desktop-nav` (líneas ~2499-2523) y `setNavActive`
 * (línea ~6158): el original limpia `.active` recorriendo un array fijo de
 * ids (`nlInicio`/`nlPeliculas`/.../ — con el bug de que `nlMiLista` queda
 * afuera) y agrega la clase al ganador; aquí el estado activo es 100%
 * derivado de la prop `active` — no hay clases que limpiar ni bug que heredar.
 *
 * El buscador (`.search-wrap`, antes un `<input readonly>` que solo abría el
 * panel móvil vía `openMobileSearch()`) se reemplaza por `<SearchBar>` real
 * — en desktop SÍ tiene sentido buscar inline, así que se conecta directo
 * al evento `search` en vez de redirigir a un panel.
 */
import { ref, onBeforeUnmount } from 'vue';
import SearchBar from '../catalog/SearchBar.vue';
import { NAV_ITEMS_DESKTOP, type RouteKey } from '../../services/navigation';

const props = defineProps<{
  active: RouteKey;
  /** Inicial del avatar de perfil — preservado de `.nav-profile` ("S", línea ~2521). */
  profileInitial?: string;
}>();

const emit = defineEmits<{
  (e: 'navigate', key: RouteKey): void;
  (e: 'search', query: string): void;
}>();

/**
 * Overlay de búsqueda — preserva el patrón `openMobileSearch`/`#mobileSearchPanel`
 * (índex.html ~2666-2680, ~6260): el pill del nav NO busca inline; al hacer clic
 * abre un panel centrado fijo arriba con el input real + botón ✕ para cerrar.
 */
const searchOpen = ref(false);

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') closeSearch();
}
function openSearch() {
  searchOpen.value = true;
  window.addEventListener('keydown', onEsc);
}
function closeSearch() {
  searchOpen.value = false;
  window.removeEventListener('keydown', onEsc);
}
/** Mientras escribe: navega a resultados (quedan detrás del panel), sin cerrar. */
function onOverlaySearch(query: string) {
  emit('search', query);
}
/** Enter: busca y cierra el panel (como el original). */
function onOverlaySubmit(query: string) {
  if (query) emit('search', query);
  closeSearch();
}

onBeforeUnmount(() => window.removeEventListener('keydown', onEsc));
</script>

<template>
  <nav class="desktop-nav">
    <div class="nav-left">
      <div class="logo" @click="emit('navigate', 'home')">MALDOX<span>FILM</span></div>
      <ul class="nav-links">
        <li v-for="item in NAV_ITEMS_DESKTOP" :key="item.key">
          <a :class="{ active: active === item.key }" @click="emit('navigate', item.key)">{{ item.label }}</a>
        </li>
      </ul>
    </div>
    <div class="nav-right">
      <!-- Pill colapsado — al hacer clic abre el overlay centrado (como producción). -->
      <button class="nav-search-pill" title="Buscar" @click="openSearch">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Buscar título...</span>
      </button>
      <div class="nav-profile" :title="profileInitial ?? 'S'">{{ profileInitial ?? 'S' }}</div>
    </div>
  </nav>

  <!-- Overlay de búsqueda centrado — preserva `#mobileSearchPanel` (índex.html ~2666). -->
  <Teleport to="body">
    <div v-if="searchOpen" class="search-overlay">
      <SearchBar
        class="search-overlay-bar"
        autofocus
        placeholder="Buscar título..."
        @search="onOverlaySearch"
        @submit="onOverlaySubmit"
      />
      <button class="search-overlay-close" aria-label="Cerrar búsqueda" @click="closeSearch">✕</button>
    </div>
  </Teleport>
</template>

<style scoped>
/* Preservados de `.nav-left/.nav-links/.nav-links a/.nav-links a.active/.nav-right/.search-wrap` (líneas ~201-230) */
/* Fondo SÓLIDO oscuro (no degradado a transparente) para que NO se vean las
   letras/pósters de fondo al scrollear — preserva `.desktop-nav` (índex.html
   ~153-160: `background: rgba(14,14,14,0.98)` + borde inferior acento). */
.desktop-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 32px;
  background: rgba(14, 14, 14, 0.98);
  border-bottom: 1px solid rgba(61, 90, 254, 0.12);
  position: sticky;
  top: 0;
  z-index: 200;
}
.nav-left {
  display: flex;
  align-items: center;
  gap: 36px;
}
/* Logo EXACTO de producción (índex.html ~192-199): Oswald 700 1.6rem, ls 2px,
   mayúsculas; "MALDOX" en acento (azul) y "FILM" en texto (blanco). */
.logo {
  font-family: 'Oswald', sans-serif;
  font-weight: 700;
  font-size: 1.6rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent, #3d5afe);
  cursor: pointer;
  flex-shrink: 0;
}
.logo span {
  color: var(--text, #f0f0f0);
}
.nav-links {
  display: flex;
  gap: 2px;
  list-style: none;
}
/* Nav links EXACTO de producción (índex.html ~203-204): pill en hover, azul SIN
   subrayado en activo. */
.nav-links a {
  color: var(--text-muted, #9a9a9a);
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--radius, 5px);
  white-space: nowrap;
  transition: color var(--trans, 0.25s ease), background var(--trans, 0.25s ease);
}
.nav-links a:hover {
  color: var(--text, #f0f0f0);
  background: var(--surface, #1c1c1c);
}
.nav-links a.active {
  color: var(--accent, #3d5afe);
}
.nav-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
/* Pill colapsado del buscador (preserva `.search-wrap`, índex.html ~217). */
.nav-search-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.8rem;
  padding: 8px 16px;
  cursor: pointer;
  transition: background var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease);
}
.nav-search-pill:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}
.nav-search-pill svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.nav-profile {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent, #3d5afe);
  color: #000;
  font-weight: 700;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

@media (max-width: 1024px) {
  .desktop-nav {
    display: none; /* en mobile/TV se usan NavMobile/NavTV — preserva display:none de html.mobile-mode/tv-mode */
  }
}

/* ── Overlay de búsqueda — preserva `.mobile-search-panel` (índex.html ~2298-2338).
   No es scoped-friendly por el Teleport al body: igualmente Vue le inyecta el
   atributo data-v al nodo raíz teleportado, así que los selectores scoped aplican. */
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 20px;
  background: rgba(10, 10, 10, 0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(61, 90, 254, 0.15);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  animation: slideDownSearch 0.2s ease;
}
@keyframes slideDownSearch {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/* El SearchBar centrado, ancho máximo 700 (preserva `.mobile-search-inner`). */
.search-overlay-bar {
  flex: 1;
  max-width: 700px;
  margin: 0 auto;
}
.search-overlay-bar :deep(.search-input) {
  font-size: 1rem;
  padding: 11px 16px 11px 40px;
}
.search-overlay-close {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--surface, #1c1c1c);
  border: 1px solid var(--border, #333);
  color: var(--text-muted, #9a9a9a);
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--trans, 0.25s ease);
}
.search-overlay-close:hover {
  border-color: var(--accent, #3d5afe);
  color: var(--accent, #3d5afe);
}
</style>
