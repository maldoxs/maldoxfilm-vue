/**
 * stores/myList — "Mi Lista" reactiva, respaldada por localStorage.
 *
 * Reemplaza las variables globales `dpMyList` + funciones sueltas
 * (`dpToggleList`, `mlRemoveItem`, `_mlInList`...) de assets/index.html
 * (líneas ~8847, ~9037-9127) por un store de Pinia. Toda la lógica de
 * mutación/lookup vive en `services/myList.ts` (pura, testeada) — este
 * store solo orquesta estado reactivo + persistencia + side-effects
 * (toast), preservando los mismos mensajes y comportamiento.
 */

import { defineStore } from 'pinia';
import type { MyListItem } from '../types';
import {
  isInList,
  loadMyList,
  normalizeItem,
  persistMyList,
  removeItem as removeItemPure,
  toggleItem as toggleItemPure,
  countLabel,
} from '../services/myList';

export interface MyListStateShape {
  items: MyListItem[];
}

export const useMyListStore = defineStore('myList', {
  state: (): MyListStateShape => ({
    items: loadMyList(),
  }),
  getters: {
    count: (state) => state.items.length,
    countLabel: (state) => countLabel(state.items.length),
    isEmpty: (state) => state.items.length === 0,
    /** Mismo orden que `showMiListaPage` (línea ~9083): más reciente primero. */
    reversedItems: (state) => state.items.slice().reverse().map(normalizeItem),
  },
  actions: {
    inList(id: string | number): boolean {
      return isInList(this.items, id);
    },
    /**
     * toggle — añade/quita y persiste. Devuelve `{ added, toast }` para que
     * el componente decida cómo mostrar el toast (en el original era
     * `showToast(...)` directo — se mantiene el mismo texto).
     */
    toggle(entry: { id: string | number; title?: string; type?: 'movie' | 'tv'; poster?: string }) {
      const result = toggleItemPure(this.items, entry);
      this.items = result.list;
      persistMyList(this.items);
      return { added: result.added, toast: result.toast };
    },
    /**
     * remove — quita por id y persiste. Devuelve info para el toast, igual
     * que `mlRemoveItem` (líneas ~9119-9127).
     */
    remove(id: string | number) {
      const result = removeItemPure(this.items, id);
      if (result.removed) {
        this.items = result.list;
        persistMyList(this.items);
      }
      return { removed: result.removed, toast: result.toast };
    },
  },
});
