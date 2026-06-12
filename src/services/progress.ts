/**
 * progress — funciones puras para "Continuar viendo" / progreso de
 * reproducción persistido en localStorage.
 *
 * Extraído de `getAllProgress`/`getProgress`/`saveProgress`/`removeProgress`
 * (líneas ~7452-7482 de assets/index.html). El original mantenía un objeto
 * plano `{ "tipo:id": {pct, season, episode, title, ts} }` cacheado en una
 * variable de módulo (`_progressCache`) — aquí la persistencia/lookup quedan
 * en funciones puras testeables, y el cacheo reactivo lo da Pinia
 * (`stores/progress.ts`) sin necesitar la variable global.
 */

import { safeStorage } from './safeStorage';

/** PROGRESS_STORAGE_KEY — preservada EXACTA de la línea ~7452 (`PROG_KEY = 'sx_prog_v2'`). */
export const PROGRESS_STORAGE_KEY = 'sx_prog_v2';

export interface ProgressEntry {
  id: string | number;
  type: 'movie' | 'tv';
  pct: number;
  season?: number;
  episode?: number;
  title?: string;
  ts: number;
}

export type ProgressMap = Record<string, ProgressEntry>;

/** progressKey — preserva la clave compuesta `${type}:${id}` (línea ~7464/7469). */
export function progressKey(id: string | number, type: 'movie' | 'tv'): string {
  return `${type}:${id}`;
}

/**
 * loadAllProgress — lee y parsea el mapa completo desde `safeStorage`,
 * cayendo a `{}` ante cualquier error de parseo (preserva el `try/catch`
 * de `getAllProgress`, línea ~7456-7460).
 */
export function loadAllProgress(): ProgressMap {
  try {
    const parsed: unknown = JSON.parse(safeStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ProgressMap;
    return {};
  } catch {
    return {};
  }
}

/** persistAllProgress — guarda el mapa completo, ignorando errores de cuota (línea ~7466/7475). */
export function persistAllProgress(all: ProgressMap): void {
  try {
    safeStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Silencioso — preserva el `catch(e){}` vacío del original.
  }
}

/** getProgressEntry — preserva `getAllProgress()[\`${type}:${id}\`]||null` (línea ~7468-7470). */
export function getProgressEntry(all: ProgressMap, id: string | number, type: 'movie' | 'tv'): ProgressEntry | null {
  return all[progressKey(id, type)] || null;
}

/**
 * withSavedProgress — devuelve un nuevo mapa con la entrada `${type}:${id}`
 * actualizada (`{...data, id, type, ts:Date.now()}`). Preservado EXACTO de
 * `saveProgress` (línea ~7462-7467); inmutable para encajar con el patrón
 * reactivo de Pinia (el store reemplaza `this.all` en vez de mutarlo).
 */
export function withSavedProgress(
  all: ProgressMap,
  id: string | number,
  type: 'movie' | 'tv',
  data: Partial<ProgressEntry>
): ProgressMap {
  return { ...all, [progressKey(id, type)]: { ...data, id, type, ts: Date.now() } as ProgressEntry };
}

/** withoutProgress — devuelve un nuevo mapa sin la entrada `${type}:${id}` (preserva `removeProgress`, línea ~7471-7476). */
export function withoutProgress(all: ProgressMap, id: string | number, type: 'movie' | 'tv'): ProgressMap {
  const key = progressKey(id, type);
  if (!(key in all)) return all;
  const next = { ...all };
  delete next[key];
  return next;
}

/**
 * playButtonLabel — el texto del botón "Reproducir"/"Continuar..." del
 * detalle. Preservado EXACTO de `progLabel`+template del botón (líneas
 * ~8917/8930):
 *   const progLabel = prog
 *     ? (isTV && prog.season ? `Continuar T${s}·E${e}` : `Continuar ${pct}%`)
 *     : '▶ Reproducir';
 *   `<button ...>▶ ${escapeHtml(progLabel)}</button>`
 *
 * NOTA — el original concatena `▶ ` delante de `progLabel`, y cuando NO hay
 * progreso `progLabel` YA es `'▶ Reproducir'` — el botón final muestra
 * literalmente "▶ ▶ Reproducir" (dos símbolos ▶, un detalle visual curioso
 * del original). Se preserva tal cual: "no remover funcionalidad" incluye
 * no corregir peculiaridades visuales que el usuario podría reconocer.
 */
export function playButtonLabel(prog: ProgressEntry | null, isTV: boolean): string {
  const progLabel = prog
    ? isTV && prog.season
      ? `Continuar T${prog.season}·E${prog.episode}`
      : `Continuar ${Math.round(prog.pct)}%`
    : 'Reproducir';
  return `▶ ${progLabel}`;
}
