/**
 * useGenreCatalog — orquestación compartida por `MoviesView`/`SeriesView`/
 * `AnimeView`: una barra de géneros (`GenreFilter`) que reescribe el título
 * y recarga las secciones al seleccionar.
 *
 * Reemplaza `filterMoviesGenre`/`filterSeriesGenre`/`filterAnimeGenre`
 * (líneas ~6851, ~6902, ~7134): el original reescribía `innerHTML` de los
 * títulos de sección y llamaba `loadCarouselInfinite(id, endpoint, type)`
 * por cada carrusel visible; aquí el `genreId` es estado reactivo y cada
 * vista decide qué endpoint pedir (vía `endpointForGenre`) — la decisión de
 * "qué nombre mostrar" sigue centralizada en `sectionTitleForGenre` (puro,
 * testeado en `catalog.test.ts`).
 */
import { ref } from 'vue';
import { buildGenreOptions, sectionTitleForGenre, TODOS_GENRE_ID, type GenreOption } from '../services/catalog';

export interface UseGenreCatalogOptions {
  /** Construye el endpoint de `/discover` para el género elegido (o el endpoint "default" si es TODOS_GENRE_ID). */
  endpointForGenre: (genreId: number) => string;
  /** Se llama cada vez que cambia el género — la vista decide qué `useTmdbList.load(...)` disparar. */
  onGenreChange: (genreId: number, endpoint: string) => void;
}

export interface UseGenreCatalogReturn {
  options: GenreOption[];
  activeGenreId: import('vue').Ref<number>;
  /** Título de sección reescrito según el género activo — usar en lugar del título estático. */
  titleFor(kind: string, originalTitle: string): string;
  selectGenre(genreId: number): void;
}

export function useGenreCatalog(opts: UseGenreCatalogOptions): UseGenreCatalogReturn {
  const options = buildGenreOptions();
  const activeGenreId = ref(TODOS_GENRE_ID);

  function selectGenre(genreId: number) {
    if (activeGenreId.value === genreId) return;
    activeGenreId.value = genreId;
    opts.onGenreChange(genreId, opts.endpointForGenre(genreId));
  }

  function titleFor(kind: string, originalTitle: string): string {
    return sectionTitleForGenre(activeGenreId.value, kind, originalTitle);
  }

  return { options, activeGenreId, titleFor, selectGenre };
}
