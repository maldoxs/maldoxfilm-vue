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
  /** Posición real en segundos para retomar ("Continuar viendo"). */
  positionSec?: number;
  /** Duración en minutos (de TMDB) — para mostrar "1h 38min" en tarjetas. */
  runtimeMin?: number;
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

// ── Progreso por capitulo ─────────────────────────────────────────────────────
// El progreso de una serie guarda un solo capitulo (el ultimo). Para mostrar cuanto se
// vio de cada uno y retomar cada uno en su minuto, se lleva aparte un registro por
// capitulo. El de la serie no se toca: lo siguen usando "Continuar viendo" y el boton.

export const EPISODE_PROGRESS_KEY = 'sx_prog_ep_v1';

/** Desde este porcentaje un capitulo cuenta como visto (los creditos no se ven). */
export const PCT_CAPITULO_VISTO = 90;

export interface EpisodeProgress {
  positionSec: number;
  /** Porcentaje visto, sobre la duracion real si se conocia; si no, sobre la de TMDB. */
  pct: number;
  runtimeMin?: number;
  visto?: boolean;
  ts: number;
}

export type EpisodeProgressMap = Record<string, EpisodeProgress>;

export function episodeKey(id: string | number, season: number, episode: number): string {
  return `tv:${id}:${season}:${episode}`;
}

export function loadEpisodeProgress(): EpisodeProgressMap {
  try {
    const parsed: unknown = JSON.parse(safeStorage.getItem(EPISODE_PROGRESS_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as EpisodeProgressMap;
    return {};
  } catch {
    return {};
  }
}

export function persistEpisodeProgress(all: EpisodeProgressMap): void {
  try {
    safeStorage.setItem(EPISODE_PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // Sin espacio o sin almacenamiento: el progreso por capitulo es un extra.
  }
}

/**
 * withSavedEpisode — nuevo mapa con el capitulo actualizado. Un capitulo ya visto sigue
 * visto aunque se vuelva a abrir y se guarde un minuto menor: volver a ver una escena no
 * lo desmarca. Si se ve de nuevo hasta el final, queda visto igual.
 */
export function withSavedEpisode(
  all: EpisodeProgressMap,
  id: string | number,
  season: number,
  episode: number,
  data: { positionSec: number; pct: number; runtimeMin?: number; visto?: boolean }
): EpisodeProgressMap {
  const key = episodeKey(id, season, episode);
  const antes = all[key];
  const visto = !!(data.visto || data.pct >= PCT_CAPITULO_VISTO || antes?.visto);
  return { ...all, [key]: { ...data, visto, ts: Date.now() } };
}

/** withoutSeriesEpisodes — saca todos los capitulos de una serie (al quitarla del historial). */
export function withoutSeriesEpisodes(all: EpisodeProgressMap, id: string | number): EpisodeProgressMap {
  const prefijo = `tv:${id}:`;
  const claves = Object.keys(all).filter((k) => k.startsWith(prefijo));
  if (!claves.length) return all;
  const next = { ...all };
  for (const k of claves) delete next[k];
  return next;
}

/**
 * episodeBarPct — ancho de la barra del capitulo, de 0 a 100. Visto = 100. Si se conoce
 * la duracion del capitulo (TMDB), se calcula con el minuto guardado; si no, con el
 * porcentaje que se guardo al verlo.
 */
export function episodeBarPct(entry: EpisodeProgress | null | undefined, runtimeMin?: number | null): number {
  if (!entry) return 0;
  if (entry.visto) return 100;
  const min = runtimeMin || entry.runtimeMin;
  const pct = min && min > 0 ? (entry.positionSec / (min * 60)) * 100 : entry.pct;
  return Math.max(0, Math.min(100, Math.round(pct || 0)));
}

/**
 * resumeSecForEpisode — desde donde retomar un capitulo. Manda su propio registro; un
 * capitulo visto empieza desde cero. Sin registro propio (datos anteriores a este cambio)
 * se usa el de la serie solo si es de ESE capitulo: antes se aplicaba a cualquiera.
 */
export function resumeSecForEpisode(
  serie: ProgressEntry | null,
  capitulo: EpisodeProgress | null | undefined,
  season: number,
  episode: number
): number | undefined {
  if (capitulo) {
    if (capitulo.visto) return undefined;
    return capitulo.positionSec > 30 ? capitulo.positionSec : undefined;
  }
  if (serie && serie.season === season && serie.episode === episode && serie.positionSec && serie.positionSec > 30) {
    return serie.positionSec;
  }
  return undefined;
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
export function playButtonLabel(prog: ProgressEntry | null, isTV: boolean, runtimeMin?: number | null): string {
  if (!prog) return '▶ Reproducir';
  if (isTV && prog.season) return `▶ Continuar T${prog.season}·E${prog.episode}`;
  if (prog.positionSec && prog.positionSec > 30) {
    const posMin = Math.floor(prog.positionSec / 60);
    if (runtimeMin && runtimeMin > 0) return `▶ Continuar · ${posMin} de ${runtimeMin} min`;
    return `▶ Continuar · min ${posMin}`;
  }
  return `▶ Continuar ${Math.round(prog.pct)}%`;
}
