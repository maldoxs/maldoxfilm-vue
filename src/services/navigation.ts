/**
 * navigation — datos puros (qué ítems mostrar, en qué orden, a qué ruta
 * apuntan) para las 3 barras de navegación (`NavDesktop`/`NavMobile`/`NavTV`).
 *
 * Extraído de los arrays/markup estáticos de navegación (líneas ~2499-2523
 * desktop, ~2627-2660 mobile, ~2530-2571 TV topnav, `_tvTopNavIds` línea
 * ~8407) y de `setNavActive`/`setBottomActive`/`setTopNavActive` (líneas
 * ~6158, ~6286, ~8490) — esas funciones solo alternaban `.active`/`.open`
 * sobre listas fijas de ids; aquí esa lista fija se vuelve datos versionables
 * y el "alternar `.active`" se vuelve una prop reactiva (`active`) en cada
 * componente.
 *
 * `RouteKey` es la unión de "destinos" a los que cualquier nav puede apuntar
 * — deliberadamente independiente del router (Fase 5 aún no escrita): cada
 * nav emite `navigate(key)` y la vista raíz decide cómo enrutar
 * (`showHome`/`loadSection`/`showChannelsPage`/... → `router.push(...)`).
 */

/**
 * Las "páginas" a las que puede apuntar cualquier navbar (preserva el universo
 * de `showXxx()`/`loadSection()`).
 *
 * NOTA — `'channels'` (Canales TV / IPTV) se EXCLUYE deliberadamente: el
 * usuario confirmó explícitamente que "Fase 6 completa (IPTV/...)" queda
 * FUERA de alcance de esta migración y pidió quitar la sección de canales
 * por completo — no se replica el botón/ruta/destino en ninguna navbar.
 */
export type RouteKey = 'home' | 'movies' | 'series' | 'anime' | 'mylist' | 'search';

export interface NavItem {
  key: RouteKey;
  label: string;
  /** Emoji/ícono — preservado de los markups originales (íconos SVG inline o emoji según la barra). */
  icon?: string;
}

/**
 * NAV_ITEMS_DESKTOP — preservado del orden de `.nav-links` (línea ~2499-2515):
 * Inicio, Películas, Series, Anime, Mi Lista. (Nota: el original tiene un bug
 * donde `nlMiLista` queda fuera del array que limpia `.active` en
 * `setNavActive` — NO se replica ese bug; aquí el estado activo es
 * puramente derivado de `active === item.key`.)
 *
 * Se OMITE deliberadamente "Canales" (IPTV) — Fase 6, fuera de alcance,
 * el usuario pidió eliminar esa sección por completo (ver nota de `RouteKey`).
 */
export const NAV_ITEMS_DESKTOP: NavItem[] = [
  { key: 'home', label: 'Inicio' },
  { key: 'movies', label: 'Películas' },
  { key: 'series', label: 'Series' },
  { key: 'anime', label: 'Anime' },
  { key: 'mylist', label: 'Mi Lista' },
];

/**
 * NAV_ITEMS_MOBILE — los 5 botones de `.bottom-nav` (línea ~2627-2660):
 * Inicio, Buscar, Series, Películas, Más. "search"/"more" son especiales:
 * `search` abre el panel de búsqueda (no navega de inmediato), `more` abre
 * un submenú (`MORE_MENU_ITEMS`) — por eso van con `key` propio fuera de
 * `RouteKey` puro de "página" (se modelan igual como `RouteKey` porque
 * `'search'` SÍ es una página de resultados; `'more'` se maneja aparte).
 */
export const NAV_ITEMS_MOBILE: NavItem[] = [
  { key: 'home', label: 'Inicio', icon: '🏠' },
  { key: 'search', label: 'Buscar', icon: '🔍' },
  { key: 'series', label: 'Series', icon: '📺' },
  { key: 'movies', label: 'Películas', icon: '🎬' },
];

/**
 * MORE_MENU_ITEMS — submenú `#bottomMoreMenu` (botón "Más", línea ~2660+):
 * en el original tenía Canales TV y Anime (las 2 secciones que no caben en
 * la barra de 5). "Canales TV" se OMITE deliberadamente — Fase 6, fuera de
 * alcance, eliminada a pedido del usuario (ver nota de `RouteKey`); el
 * submenú conserva únicamente "Anime".
 */
export const MORE_MENU_ITEMS: NavItem[] = [{ key: 'anime', label: 'Anime', icon: '🎌' }];

/**
 * NAV_ITEMS_TV — preservado de `_tvTopNavIds` (línea ~8407) y el markup de
 * `.tv-topnav-items` (línea ~2530-2560): Inicio, Películas, Series, Anime,
 * Mi Lista — más Buscar/Fullscreen, que se manejan como botones especiales
 * (no son "páginas" navegables por roving-focus de la misma forma).
 *
 * Se OMITE deliberadamente "Canales TV" (IPTV) — Fase 6, fuera de alcance,
 * eliminada a pedido del usuario (ver nota de `RouteKey`).
 */
export const NAV_ITEMS_TV: NavItem[] = [
  { key: 'home', label: 'Inicio' },
  { key: 'movies', label: 'Películas' },
  { key: 'series', label: 'Series' },
  { key: 'anime', label: 'Anime' },
  { key: 'mylist', label: 'Mi Lista' },
];

/**
 * nextDpadIndex — la lógica pura de `setupTopNavDpad` (líneas ~8505-8533):
 * `ArrowRight`/`ArrowLeft` mueven el foco circularmente entre los `count`
 * botones del topnav. Devuelve el nuevo índice (siempre dentro de
 * `[0, count-1]`, con wraparound). Se preserva el wraparound porque el
 * original usa `(i + count) % count`.
 */
export function nextDpadIndex(current: number, direction: 'left' | 'right', count: number): number {
  if (count <= 0) return 0;
  const delta = direction === 'right' ? 1 : -1;
  return (current + delta + count) % count;
}

/**
 * isReturnToNavKey — preserva el segundo `keydown` listener (líneas
 * ~8536-8550): si el usuario presiona `ArrowUp` estando enfocado en una
 * tarjeta cerca del tope del viewport (`rect.top < threshold`), el foco
 * vuelve al topnav. Puro: solo decide "¿debo devolver el foco?", no toca el DOM.
 */
export function isReturnToNavKey(key: string, elementTop: number, threshold = 200): boolean {
  return key === 'ArrowUp' && elementTop < threshold;
}
