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
 */

import { defineStore } from 'pinia';
import {
  loadAllProgress,
  persistAllProgress,
  getProgressEntry,
  withSavedProgress,
  withoutProgress,
  type ProgressEntry,
  type ProgressMap,
} from '../services/progress';

export interface ProgressStateShape {
  all: ProgressMap;
}

export const useProgressStore = defineStore('progress', {
  state: (): ProgressStateShape => ({
    all: loadAllProgress(),
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
    /** remove — preserva `removeProgress(id,type)` (línea ~7471-7476). */
    remove(id: string | number, type: 'movie' | 'tv'): void {
      this.all = withoutProgress(this.all, id, type);
      persistAllProgress(this.all);
    },
    /** clearAll — preserva `clearAllProgress()` (botón "Limpiar historial", línea ~2717): vacía todo el historial. */
    clearAll(): void {
      this.all = {};
      persistAllProgress(this.all);
    },
  },
});
