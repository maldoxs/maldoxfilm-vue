import { describe, test, expect } from 'vitest';
import { createLruCache, tmdbCacheMaxSize } from '../src/services/lruCache';

describe('createLruCache — caché FIFO con eviction por tamaño', () => {
  test('get/set/has básico', () => {
    const c = createLruCache<number>(3);
    expect(c.has('a')).toBe(false);
    c.set('a', 1);
    expect(c.has('a')).toBe(true);
    expect(c.get('a')).toBe(1);
    expect(c.size()).toBe(1);
  });

  test('al superar maxSize, desaloja la clave insertada primero (FIFO)', () => {
    const c = createLruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // debe desalojar 'a'
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
    expect(c.size()).toBe(2);
  });

  test('sobreescribir una clave existente NO cambia su antigüedad ni dispara eviction extra', () => {
    const c = createLruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 99); // sobreescribe — sigue siendo la más antigua
    expect(c.keys()).toEqual(['a', 'b']);
    c.set('c', 3); // debe desalojar 'a' (la más antigua), no 'b'
    expect(c.has('a')).toBe(false);
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  test('keys() devuelve el orden de inserción de las claves vivas', () => {
    const c = createLruCache<number>(5);
    c.set('x', 1);
    c.set('y', 2);
    c.set('z', 3);
    expect(c.keys()).toEqual(['x', 'y', 'z']);
  });
});

describe('tmdbCacheMaxSize — límite de caché según el modo', () => {
  test('en modo TV el límite es 40 (menos RAM disponible)', () => {
    expect(tmdbCacheMaxSize(true)).toBe(40);
  });
  test('fuera de TV el límite es 120', () => {
    expect(tmdbCacheMaxSize(false)).toBe(120);
  });
});
