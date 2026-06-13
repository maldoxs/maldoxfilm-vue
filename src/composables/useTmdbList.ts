/**
 * useTmdbList — orquestación mínima para cargar una lista de TMDB
 * (`/trending/...`, `/movie/popular`, `/discover/movie?with_genres=...`, etc.)
 * y exponerla reactivamente a un `<Carousel>`.
 *
 * Reemplaza el patrón repetido `loadCarousel(id, endpoint, type)`/
 * `loadCarouselInfinite(...)` (referenciado en `filterMoviesGenre`, línea
 * ~6851-6870, y usado para cada sección de Inicio/Películas/Series/Anime).
 *
 * ⚠️ Toca red (vía `tmdbClient.get`, inyectado) — no es lógica pura. La
 * decisión de "qué endpoint pedir para qué género" SÍ es pura y vive en
 * `services/catalog.ts` (`sectionTitleForGenre`/`GENRE_NAMES_MAP`); aquí solo
 * se dispara el fetch y se gestiona el estado de carga/cancelación.
 *
 * Se preserva la cancelación de carreras (equivalente a `_playerGen`/
 * `isStale` del reproductor, pero aplicado a "cambié de género antes de que
 * la respuesta anterior llegara" — el original sufre justamente ese bug
 * cuando el usuario clickea géneros rápido; aquí se evita con un contador
 * de generación local).
 */
import { ref, shallowRef, type Ref } from 'vue';
import type { TmdbClient } from '../services/tmdb';
import type { MediaItem } from '../types';
import { safeStorage } from '../services/safeStorage';

/**
 * Cache de listas TMDB (stale-while-revalidate). MOTIVO: al volver del reproductor
 * `HomeView` se RE-MONTA y volvía a pedir TODOS los carruseles → mostraba las
 * "tarjetas grises (skeleton) que se están cargando" cada vez. Con cache, una lista
 * ya vista se pinta AL INSTANTE (sin `loading` → sin skeleton) y se revalida en
 * segundo plano. El usuario pidió justamente esto ("antes persistían con localStorage").
 *
 * - `memCache`: vive durante la sesión SPA → cubre el caso clave (play → volver, sin
 *   recargar la página).
 * - `safeStorage` (localStorage con fallback a memoria, no lanza en TVs viejas): cubre
 *   el arranque en frío entre sesiones, con un TTL para no servir datos muy viejos.
 */
const memCache = new Map<string, MediaItem[]>();
const LS_PREFIX = 'tmdblist:';
const LS_TTL_MS = 1000 * 60 * 60 * 6; // 6 h

function readCache(endpoint: string): MediaItem[] | null {
  const mem = memCache.get(endpoint);
  if (mem) return mem;
  try {
    const raw = safeStorage.getItem(LS_PREFIX + endpoint);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; d: MediaItem[] };
    if (!parsed || Date.now() - parsed.t > LS_TTL_MS || !Array.isArray(parsed.d)) return null;
    memCache.set(endpoint, parsed.d);
    return parsed.d;
  } catch {
    return null;
  }
}

function writeCache(endpoint: string, data: MediaItem[]): void {
  memCache.set(endpoint, data);
  try {
    safeStorage.setItem(LS_PREFIX + endpoint, JSON.stringify({ t: Date.now(), d: data }));
  } catch {
    /* silenciar — cuota/serialización; el memCache ya quedó */
  }
}

export interface UseTmdbListReturn {
  items: Ref<MediaItem[]>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** Pide `endpoint` y reemplaza `items` — cancela resultados de pedidos anteriores en vuelo. */
  load(endpoint: string): Promise<void>;
}

export function useTmdbList(tmdbClient: TmdbClient): UseTmdbListReturn {
  const items = shallowRef<MediaItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let generation = 0;

  async function load(endpoint: string): Promise<void> {
    const myGen = ++generation;
    error.value = null;

    // Cache hit → pintar al instante SIN skeleton, y revalidar en 2º plano (SWR).
    const cached = readCache(endpoint);
    if (cached) {
      items.value = cached;
      loading.value = false;
      try {
        const fresh = await tmdbClient.get<{ results?: MediaItem[] }>(endpoint);
        if (myGen !== generation) return;
        const results = Array.isArray(fresh?.results) ? fresh.results : [];
        if (results.length) {
          items.value = results;
          writeCache(endpoint, results);
        }
      } catch {
        /* mantener lo cacheado — sin skeleton, sin error visible */
      }
      return;
    }

    // Sin cache (primera vez) → skeleton mientras llega la respuesta.
    loading.value = true;
    try {
      const data = await tmdbClient.get<{ results?: MediaItem[] }>(endpoint);
      if (myGen !== generation) return; // respuesta obsoleta — el usuario ya pidió otra cosa
      const results = Array.isArray(data?.results) ? data.results : [];
      items.value = results;
      if (results.length) writeCache(endpoint, results);
    } catch (e) {
      if (myGen !== generation) return;
      error.value = e instanceof Error ? e.message : 'Error desconocido';
      items.value = [];
    } finally {
      if (myGen === generation) loading.value = false;
    }
  }

  return { items, loading, error, load };
}
