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
    loading.value = true;
    error.value = null;
    try {
      const data = await tmdbClient.get<{ results?: MediaItem[] }>(endpoint);
      if (myGen !== generation) return; // respuesta obsoleta — el usuario ya pidió otra cosa
      items.value = Array.isArray(data?.results) ? data.results : [];
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
