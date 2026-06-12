/**
 * myList — helpers puros de "Mi Lista" (favoritos persistidos en localStorage).
 *
 * Extraído 1:1 de assets/index.html:
 *   - `_mlId`, `_mlInList`, `_mlIdx`           → líneas ~9037-9039
 *   - lógica de `dpToggleList` / `mlRemoveItem` → líneas ~9041-9050, ~9119-9127
 *
 * El array original (`dpMyList`) podía contener strings sueltos (formato
 * legado: solo el id) mezclados con objetos `{id,type,title,poster}`. Se
 * preserva esa unión (`MyListItem`) para no romper datos ya guardados por
 * usuarios existentes — exactamente como hacía `_mlId`.
 */

import type { MyListItem, MyListItemObject } from '../types';

export const MY_LIST_STORAGE_KEY = 'sx_mylist';

/**
 * itemId — normaliza el id de un item, sea string suelto (legado) u objeto
 * completo. Preservado de `_mlId` (línea ~9037):
 *   String(typeof item === 'object' ? item.id : item)
 */
export function itemId(item: MyListItem): string {
  return String(typeof item === 'object' ? item.id : item);
}

/**
 * isInList — ¿el id ya está guardado? Preservado de `_mlInList` (línea ~9038).
 */
export function isInList(list: MyListItem[], id: string | number): boolean {
  return list.some((item) => itemId(item) === String(id));
}

/**
 * indexOfItem — posición del id en la lista, o -1. Preservado de `_mlIdx`
 * (línea ~9039).
 */
export function indexOfItem(list: MyListItem[], id: string | number): number {
  return list.findIndex((item) => itemId(item) === String(id));
}

/**
 * toggleItem — añade o quita un item de la lista (inmutable: devuelve una
 * nueva lista + info para mostrar el toast correspondiente). Preserva la
 * lógica de `dpToggleList` (líneas ~9041-9050): si ya estaba, lo quita por
 * índice; si no, lo agrega como objeto completo con defaults
 * (`type: 'movie'`, strings vacíos para title/poster).
 */
export function toggleItem(
  list: MyListItem[],
  entry: { id: string | number; title?: string; type?: 'movie' | 'tv'; poster?: string }
): { list: MyListItem[]; added: boolean; toast: string } {
  const id = entry.id;
  const idx = indexOfItem(list, id);
  if (idx !== -1) {
    const next = [...list];
    next.splice(idx, 1);
    return { list: next, added: false, toast: 'Eliminado de Mi Lista' };
  }
  const newItem: MyListItemObject = {
    id: String(id),
    type: entry.type || 'movie',
    title: entry.title || '',
    poster: entry.poster || '',
  };
  return {
    list: [...list, newItem],
    added: true,
    toast: `"${entry.title || ''}" añadido a Mi Lista`,
  };
}

/**
 * removeItem — quita un item por id (inmutable). Preserva `mlRemoveItem`
 * (líneas ~9119-9127): si no existe, no cambia nada (`removed: false`); si
 * existe, devuelve también el título para el mensaje de confirmación.
 */
export function removeItem(
  list: MyListItem[],
  id: string | number
): { list: MyListItem[]; removed: boolean; title: string; toast: string } {
  const idx = indexOfItem(list, id);
  if (idx === -1) return { list, removed: false, title: '', toast: '' };
  const target = list[idx];
  const title = typeof target === 'object' ? target.title : '';
  const next = [...list];
  next.splice(idx, 1);
  return {
    list: next,
    removed: true,
    title,
    toast: title ? `"${title}" eliminado de Mi Lista` : 'Eliminado de Mi Lista',
  };
}

/**
 * normalizeItem — extrae los campos para renderizar una card desde un item
 * (sea legado-string u objeto). Preservado de las líneas ~9084-9087.
 */
export function normalizeItem(item: MyListItem): { id: string; type: 'movie' | 'tv'; title: string; poster: string } {
  return {
    id: itemId(item),
    type: (typeof item === 'object' && item.type) || 'movie',
    title: (typeof item === 'object' && item.title) || '',
    poster: (typeof item === 'object' && item.poster) || '',
  };
}

/**
 * countLabel — el texto "N título(s)" del header de Mi Lista. Preservado de
 * la línea ~9081.
 */
export function countLabel(count: number): string {
  return count + ' título' + (count !== 1 ? 's' : '');
}

// ── Persistencia (localStorage vía safeStorage) ──────────────────────────────
import { safeStorage } from './safeStorage';

/**
 * isValidStoredItem — guarda de tipo en runtime para entradas leídas de
 * localStorage. `JSON.parse` devuelve `any`: sin esta validación, datos
 * corruptos/alterados (extensión maliciosa, escritura manual en devtools,
 * versión futura/pasada del esquema) pasarían tal cual a `state.items` y
 * podrían romper getters como `reversedItems`/`countLabel` (type confusion)
 * o, peor, propagarse como HTML hacia `MovieCard`/`MyListView`. Se acepta el
 * formato legado (string suelto) y el objeto completo — igual que `_mlId` —
 * pero se exige que `id`/`type`/`title`/`poster` tengan los tipos esperados.
 */
function isValidStoredItem(item: unknown): item is MyListItem {
  // `MyListItem = MyListItemObject | string` — el formato legado es un id-string
  // suelto (`_mlId` también tolera números vía `String(item)`, pero el tipo
  // declarado no los incluye; aceptarlos aquí mentiría sobre el predicado de
  // tipo, así que se descartan — son, en la práctica, inexistentes en datos
  // reales guardados por `persistMyList`, que siempre serializa objetos/strings).
  if (typeof item === 'string') return true;
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    (typeof obj.id === 'string' || typeof obj.id === 'number') &&
    (obj.type === undefined || obj.type === 'movie' || obj.type === 'tv') &&
    (obj.title === undefined || typeof obj.title === 'string') &&
    (obj.poster === undefined || typeof obj.poster === 'string')
  );
}

export function loadMyList(): MyListItem[] {
  try {
    const parsed: unknown = JSON.parse(safeStorage.getItem(MY_LIST_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidStoredItem);
  } catch {
    return [];
  }
}

export function persistMyList(list: MyListItem[]): void {
  safeStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(list));
}
