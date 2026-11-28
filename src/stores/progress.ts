/**
 * stores/progress — progreso de reproducción reactivo, respaldado por
 * localStorage ("Continuar viendo" + label "Continuar T1·E2"/"Continuar 43%"
 * del botón Reproducir en `DetailView`).
 *
 * Reemplaza la variable global `_progressCache` + `getAllProgress`/
 * `getProgress`/`saveProgress`/`removeProgress` (líneas ~7452-7482 de
 * assets/index.html) por un store de Pinia — mismo patrón que
 * `stores/myList.ts`: la lógica pura vive en `services/progress.ts`
 * (testeada), el store solo orquesta estado reactivo + persistencia.
 *
 * `episodes` lleva aparte el progreso de cada capitulo (barra en la lista de
 * capitulos y retomar cada uno en su minuto). No reemplaza a `all`.
 */

import { defineStore } from 'pinia';
import {
  loadAllProgress,
  persistAllProgress,
  getProgressEntry,
  withSavedProgress,
  withoutProgress,
  loadEpisodeProgress,
  persistEpisodeProgress,
  episodeKey,
  withSavedEpisode,
  withoutSeriesEpisodes,
  resumeSecForEpisode,
  type ProgressEntry,
  type ProgressMap,
  type EpisodeProgress,
  type EpisodeProgressMap,
} from '../services/progress';

export interface ProgressStateShape {
  all: ProgressMap;
  episodes: EpisodeProgressMap;
}

export const useProgressStore = defineStore('progress', {
  state: (): ProgressStateShape => ({
    all: loadAllProgress(),
    episodes: loadEpisodeProgress(),
  }),
  actions: {
    /** get — preserva `getProgress(id,type)` (línea ~7468). */
    get(id: string | number, type: 'movie' | 'tv'): ProgressEntry | null {
      return getProgressEntry(this.all, id, type);
    },
    /** save — preserva `saveProgress(id,type,data)` (línea ~7462-7467): mergea, marca `ts` y persiste. */
    save(id: string | number, type: 'movie' | 'tv', data: Partial<ProgressEntry>): void {
      this.all = withSavedProgress(this.all, id, type, data);
      persistAllProgress(this.all);
    },
    /** remove — preserva `removeProgress(id,type)` (línea ~7471-7476); en series también sus capitulos. */
    remove(id: string | number, type: 'movie' | 'tv'): void {
      this.all = withoutProgress(this.all, id, type);
      persistAllProgress(this.all);
      if (type === 'tv') {
        this.episodes = withoutSeriesEpisodes(this.episodes, id);
        persistEpisodeProgress(this.episodes);
      }
    },
    /** clearAll — preserva `clearAllProgress()` (botón "Limpiar historial", línea ~2717): vacía todo el historial. */
    clearAll(): void {
      this.all = {};
      persistAllProgress(this.all);
      this.episodes = {};
      persistEpisodeProgress(this.episodes);
    },
    getEpisode(id: string | number, season: number, episode: number): EpisodeProgress | null {
      return this.episodes[episodeKey(id, season, episode)] || null;
    },
    saveEpisode(
      id: string | number,
      season: number,
      episode: number,
      data: { positionSec: number; pct: number; runtimeMin?: number; visto?: boolean }
    ): void {
      this.episodes = withSavedEpisode(this.episodes, id, season, episode, data);
      persistEpisodeProgress(this.episodes);
    },
    /** Desde donde retomar: el minuto del propio capitulo, o undefined para empezar de cero. */
    resumeSecForEpisode(id: string | number, season: number, episode: number): number | undefined {
      return resumeSecForEpisode(this.get(id, 'tv'), this.getEpisode(id, season, episode), season, episode);
    },
  },
});
