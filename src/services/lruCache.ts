/**
 * lruCache — caché simple con eviction FIFO por límite de tamaño.
 *
 * Extraído 1:1 del patrón usado por `tmdb()` (líneas ~8822-8839 de
 * assets/index.html): objeto plano + array de claves para saber cuál es la
 * más antigua y desalojarla cuando se supera `_TMDB_CACHE_MAX`.
 *
 * Se separó como utilidad pura y genérica para poder testearla sin red y
 * reutilizarla en cualquier servicio que necesite memoizar respuestas
 * (TMDB, Torrentio, etc).
 */
export interface LruCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  size(): number;
  /** Solo para tests/inspección: orden de inserción de las claves vivas. */
  keys(): string[];
}

/**
 * createLruCache — preserva el comportamiento exacto del original:
 *   - lookup O(1) por objeto plano
 *   - al insertar una clave nueva que supera `maxSize`, desaloja la PRIMERA
 *     clave insertada (FIFO, vía `Array.prototype.shift`)
 *   - sobreescribir una clave existente NO cambia su posición de antigüedad
 *     (igual que el original: solo hace `_tmdbCache[endpoint] = data` sin
 *     tocar `_tmdbCacheKeys` si la clave ya existía)
 */
export function createLruCache<T>(maxSize: number): LruCache<T> {
  const store: Record<string, T> = {};
  let order: string[] = [];

  return {
    get(key) {
      return store[key];
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(store, key);
    },
    set(key, value) {
      const isNew = !Object.prototype.hasOwnProperty.call(store, key);
      if (isNew && order.length >= maxSize) {
        const oldest = order.shift();
        if (oldest !== undefined) delete store[oldest];
      }
      store[key] = value;
      if (isNew) order.push(key);
    },
    size() {
      return order.length;
    },
    keys() {
      return [...order];
    },
  };
}

/**
 * tmdbCacheMaxSize — el tamaño del caché depende del modo TV vs resto
 * (preservado de la línea ~8825: 40 en TV, 120 en otros modos — la TV tiene
 * menos RAM disponible).
 */
export function tmdbCacheMaxSize(isTvMode: boolean): number {
  return isTvMode ? 40 : 120;
}
