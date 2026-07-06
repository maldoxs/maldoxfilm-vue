<script setup lang="ts">
/**
 * App — el shell raíz: monta la navbar correspondiente al modo de
 * dispositivo (`NavDesktop`/`NavMobile`/`NavTV`), el `<router-view>` y el
 * `<Toast>` global.
 *
 * Reemplaza `window.setAppMode(mode)` (líneas ~6358-6403): el original
 * mostraba/ocultaba `#mainNav`/`#bottomNav`/`#tvSidebar`/`#tvTopNav` con
 * `style.display` inline y ajustaba el `padding-top` del body a mano; aquí
 * cada nav se autogestiona su propia visibilidad por CSS (`html.tv-mode
 * .tv-topnav { display:flex }`, etc., ver estilos de cada componente) — el
 * shell solo decide CUÁL montar según `deviceStore.mode`, evitando montar
 * (y suscribir listeners de) navs que no se van a usar.
 */
import { computed, ref, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import NavDesktop from './components/layout/NavDesktop.vue';
import NavMobile from './components/layout/NavMobile.vue';
import NavTV from './components/layout/NavTV.vue';
import Toast from './components/Toast.vue';
import { useDeviceStore } from './stores/device';
import { useTvSpatialNav } from './composables/useTvSpatialNav';
import type { RouteKey } from './services/navigation';

const deviceStore = useDeviceStore();

// Navegación espacial con flechas/control en TV (recorre cards y categorías).
// Solo actúa cuando el modo es TV (con puntero/D-pad del Magic remote).
useTvSpatialNav(() => deviceStore.isTV);
const router = useRouter();
const route = useRoute();

// ── Mapea la ruta activa → RouteKey de las navbars (deriva el "active" de cada nav) ──
const ROUTE_NAME_TO_KEY: Record<string, RouteKey> = {
  home: 'home',
  movies: 'movies',
  series: 'series',
  anime: 'anime',
  mylist: 'mylist',
  search: 'search',
  // 'channels' se omite — Fase 6 (Canales/IPTV) excluida a pedido del usuario,
  // la ruta `/canales` ya no existe (ver `router/index.ts`).
};
// Última SECCIÓN visitada (home/movies/series/anime/mylist/search). Sirve para que,
// al entrar a una ficha (`movie-detail`/`series-detail`), al reproductor (`player`) o
// a "Ver todo" (`all-results`) —rutas que NO son secciones del nav— el nav siga
// marcando la sección de la que vino el usuario (p.ej. quedarse en "Películas" al abrir
// una peli), en vez de saltar a "Inicio". El género ya se preserva aparte vía la URL
// (`/peliculas?genero=27`), así que al Volver se mantiene el filtro de Terror, etc.
const lastSection = ref<RouteKey>('home');
watch(
  () => route.name,
  (name) => {
    const key = ROUTE_NAME_TO_KEY[String(name ?? '')];
    if (key) lastSection.value = key;
  },
  { immediate: true }
);
const activeKey = computed<RouteKey>(() => {
  const name = String(route.name ?? '');
  return ROUTE_NAME_TO_KEY[name] ?? lastSection.value;
});

// FIX webOS (TV): tras reproducir+volver, la página queda en FULLSCREEN (hack que oculta la
// barra del navegador — ver sessions/2026-06-13). Al navegar entre secciones del catálogo en
// ese estado, webOS deja el layout con un ancho de viewport STALE → el catálogo (sobre todo Mi
// Lista) se ve "cortado/zoom" hasta refrescar. NO se puede salir del fullscreen (reaparece la
// barra). Solución: forzar un recálculo de layout (evento `resize`) tras cada navegación, así el
// catálogo se re-mide con el viewport real del fullscreen. SOLO en TV → no afecta móvil/desktop.
watch(
  () => route.name,
  () => {
    if (!deviceStore.isTV) return;
    setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
  }
);

// ── Navegación — reemplaza showHome()/loadSection()/showChannelsPage()/... ──
const KEY_TO_PATH: Record<RouteKey, string> = {
  home: '/',
  movies: '/peliculas',
  series: '/series',
  anime: '/anime',
  mylist: '/mi-lista',
  search: '/buscar',
};
function onNavigate(key: RouteKey) {
  router.push(KEY_TO_PATH[key]);
}
function onSearch(query: string) {
  router.push({ path: '/buscar', query: { q: query } });
}
function onOpenSearch() {
  router.push('/buscar');
}

// ── Fullscreen de toda la app (botón del NavTV — toggleAppFullscreen, línea ~8550+) ──
function onToggleAppFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// FIX (2026-07-06, a pedido): que el fullscreen se sienta "por defecto" en TV, sin que el
// usuario tenga que buscar el botón del NavTV. El navegador NO permite pedir fullscreen sin
// un gesto real del usuario (rechaza silenciosamente cualquier intento al cargar la app sin
// interacción) — así que no se puede activar literalmente "al cargar". Se engancha al
// PRIMER click/tecla en cualquier parte de la app (ya es un gesto válido), pide fullscreen
// una sola vez, y se desengancha — el usuario lo siente como si viniera activado de entrada.
onMounted(() => {
  if (!deviceStore.isTV) return;
  const requestOnce = () => {
    document.removeEventListener('click', requestOnce);
    document.removeEventListener('keydown', requestOnce);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };
  document.addEventListener('click', requestOnce);
  document.addEventListener('keydown', requestOnce);
});
</script>

<template>
  <div id="app-shell">
    <NavDesktop v-if="deviceStore.mode === 'desktop'" :active="activeKey" @navigate="onNavigate" @search="onSearch" />
    <NavMobile v-else-if="deviceStore.mode === 'mobile'" :active="activeKey" @navigate="onNavigate" @open-search="onOpenSearch" />
    <NavTV v-else :active="activeKey" @navigate="onNavigate" @open-search="onOpenSearch" @toggle-fullscreen="onToggleAppFullscreen" />

    <main class="app-main" :class="`mode-${deviceStore.mode}`">
      <router-view />
    </main>

    <Toast />
  </div>
</template>

<style scoped>
.app-main {
  min-height: 100vh;
}
.app-main.mode-tv {
  /* SIN padding-top: el NavTV ahora es `position: sticky` (no `fixed`), así que ocupa
     sus 76px en el flujo del documento y empuja el contenido naturalmente. Con `fixed`
     hacía falta este padding para compensar; con `sticky` lo duplicaría. */
  padding-top: 0;
}
.app-main.mode-mobile {
  padding-bottom: 64px; /* deja espacio para `.bottom-nav` fija */
  /* iOS Safari: `body { overflow-x: hidden }` NO siempre corta el scroll horizontal (el
     desborde ocurre en `html`) → quedaba un ESPACIO VACÍO a la derecha en el catálogo. Se
     clipea acá SOLO en móvil (no hay nav sticky que romper, a diferencia de TV). `clip` no
     crea contexto de scroll (no afecta sticky ni el scroll interno de los carruseles). */
  overflow-x: hidden; /* fallback Chromium 38 / iOS viejo (sin overflow:clip) — moderno usa clip abajo */
  overflow-x: clip;
  max-width: 100vw;
}
</style>
