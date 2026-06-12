/**
 * safeStorage — wrapper sobre localStorage que jamás lanza (TVs antiguas /
 * modo incógnito / cuotas agotadas pueden tirar excepciones en cada acceso).
 *
 * Extraído 1:1 de `safeStorage` (líneas ~4689-4702 de assets/index.html):
 * intenta `localStorage` y, si falla, cae a un store en memoria (`_memStore`)
 * que vive solo durante la sesión — exactamente la misma estrategia.
 */

const _memStore: Record<string, string> = {};

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return _memStore[key] ?? null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      _memStore[key] = String(value);
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      delete _memStore[key];
    }
  },
};

/** Solo para tests — vacía el store en memoria entre casos. */
export function _resetMemStoreForTests(): void {
  for (const k of Object.keys(_memStore)) delete _memStore[k];
}
