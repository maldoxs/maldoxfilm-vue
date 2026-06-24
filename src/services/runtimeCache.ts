import { safeStorage } from './safeStorage';

const STORAGE_KEY = 'runtime_cache';
let cache: Record<string, number> = {};

try {
  cache = JSON.parse(safeStorage.getItem(STORAGE_KEY) || '{}');
} catch {
  cache = {};
}

function persist() {
  try {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch { /* cuota */ }
}

export function setRuntime(id: string | number, type: 'movie' | 'tv', minutes: number) {
  if (minutes > 0) {
    cache[`${type}:${id}`] = minutes;
    persist();
  }
}

export function getRuntime(id: string | number, type: 'movie' | 'tv'): number | null {
  return cache[`${type}:${id}`] || null;
}

export function formatRuntime(min: number | null | undefined): string {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}
