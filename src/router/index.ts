/**
 * router — rutas reales con Vue Router (reemplaza el sistema de "páginas"
 * basado en `showXxx()`/`.page.active`/`history.pushState` manual del original).
 *
 * Preserva el set de rutas EXACTO especificado en el plan de migración
 * (Fase 5, líneas ~178-187 de `docs/PLAN_MIGRACION_VUE3.md`):
 *
 *   /                      → HomeView
 *   /peliculas             → MoviesView
 *   /series                → SeriesView
 *   /pelicula/:id          → DetailView
 *   /serie/:id/:s/:e       → DetailView
 *   /ver/:type/:id         → PlayerView   ← URL compartible
 *   /mi-lista              → MyListView
 *   /buscar?q=...          → SearchView
 *
 * Se agrega además `/anime` — sección que SÍ existe en el original
 * (`showAnimePage`, líneas ~8849+) y que las 3 navbars (`NavDesktop`/
 * `NavMobile`/`NavTV`) ya enlazan vía `RouteKey` ('anime') — omitirla dejaría
 * ese botón sin destino, lo cual SÍ sería "remover funcionalidad".
 *
 * NOTA — `/canales` (Canales TV / IPTV, `showChannelsPage`) se EXCLUYE
 * deliberadamente: el usuario confirmó que "Fase 6 completa (IPTV/...)"
 * queda FUERA de alcance de esta migración y pidió eliminar la sección de
 * canales por completo — no se registra la ruta ni el componente
 * `ChannelsView`, y los 3 navs ya no ofrecen ese destino (ver
 * `services/navigation.ts`/`RouteKey`).
 *
 * GANANCIA REAL vs el original: URLs reales = compartir links, botón
 * "atrás" del navegador funciona, refrescar la página no pierde el estado de
 * navegación — exactamente la ganancia que el plan promete (línea ~191-192).
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/peliculas',
    name: 'movies',
    component: () => import('../views/MoviesView.vue'),
  },
  {
    path: '/series',
    name: 'series',
    component: () => import('../views/SeriesView.vue'),
  },
  {
    path: '/anime',
    name: 'anime',
    component: () => import('../views/AnimeView.vue'),
  },
  {
    // /pelicula/:id — DetailView en modo película (sin temporada/episodio)
    path: '/pelicula/:id',
    name: 'movie-detail',
    component: () => import('../views/DetailView.vue'),
    props: (route) => ({ id: route.params.id, type: 'movie' as const }),
  },
  {
    // /serie/:id/:s/:e — DetailView en modo serie (con temporada/episodio activos)
    path: '/serie/:id/:s/:e',
    name: 'series-detail',
    component: () => import('../views/DetailView.vue'),
    props: (route) => ({
      id: route.params.id,
      type: 'tv' as const,
      season: Number(route.params.s),
      episode: Number(route.params.e),
    }),
  },
  {
    // /ver/:type/:id — PlayerView; URL compartible (preserva el comentario del plan, línea ~185)
    path: '/ver/:type/:id',
    name: 'player',
    component: () => import('../views/PlayerView.vue'),
    props: (route) => ({
      type: route.params.type as 'movie' | 'tv',
      id: route.params.id,
      season: route.query.s ? Number(route.query.s) : undefined,
      episode: route.query.e ? Number(route.query.e) : undefined,
      // ?start=1 — "Ver desde el inicio" (DetailView): ignora la posición guardada
      // de "Continuar viendo" para ESTA carga, sin borrar el progreso persistido.
      fromStart: route.query.start === '1',
    }),
  },
  {
    path: '/mi-lista',
    name: 'mylist',
    component: () => import('../views/MyListView.vue'),
  },
  {
    // /buscar?q=... — preserva el query param `q` (línea ~187)
    path: '/buscar',
    name: 'search',
    component: () => import('../views/SearchView.vue'),
    props: (route) => ({ query: (route.query.q as string) ?? '' }),
  },
  {
    // /ver-todo?title=...&endpoint=...&type=... — grilla paginada "Ver todo"
    // (preserva `openAllResults`/`#allResultsPage`, índex.html ~428-469).
    path: '/ver-todo',
    name: 'all-results',
    component: () => import('../views/AllResultsView.vue'),
    props: (route) => ({
      title: (route.query.title as string) ?? 'Resultados',
      endpoint: (route.query.endpoint as string) ?? '',
      type: (route.query.type as string) === 'tv' ? 'tv' : 'movie',
    }),
  },
  {
    // Cualquier ruta desconocida vuelve a Inicio — equivalente a la página por defecto del original.
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    // El original siempre arrancaba cada "página" con scroll arriba (showXxx → window.scrollTo(0,0)).
    return { top: 0 };
  },
});

export default router;
