import { describe, test, expect } from 'vitest';
import {
  NAV_ITEMS_DESKTOP,
  NAV_ITEMS_MOBILE,
  NAV_ITEMS_TV,
  MORE_MENU_ITEMS,
  nextDpadIndex,
  isReturnToNavKey,
} from '../src/services/navigation';

describe('listas de ítems de navegación (preservadas de los markups originales)', () => {
  test('NAV_ITEMS_DESKTOP conserva el orden de .nav-links (línea ~2499-2515) — MENOS "Canales", excluido a pedido del usuario (Fase 6 fuera de alcance)', () => {
    expect(NAV_ITEMS_DESKTOP.map((i) => i.key)).toEqual(['home', 'movies', 'series', 'anime', 'mylist']);
  });

  test('NAV_ITEMS_MOBILE conserva los 5 botones de .bottom-nav (línea ~2627-2660)', () => {
    expect(NAV_ITEMS_MOBILE.map((i) => i.key)).toEqual(['home', 'search', 'series', 'movies']);
  });

  test('MORE_MENU_ITEMS conserva Anime — "Canales TV" se quitó del submenú "Más" (Fase 6 excluida a pedido del usuario)', () => {
    expect(MORE_MENU_ITEMS.map((i) => i.key)).toEqual(['anime']);
  });

  test('NAV_ITEMS_TV conserva _tvTopNavIds (línea ~8407) — MENOS "Canales TV", excluido a pedido del usuario (Fase 6 fuera de alcance)', () => {
    expect(NAV_ITEMS_TV.map((i) => i.key)).toEqual(['home', 'movies', 'series', 'anime', 'mylist']);
  });
});

describe('nextDpadIndex — roving focus circular (preservado de setupTopNavDpad línea ~8505-8533)', () => {
  test('ArrowRight avanza, con wraparound al final', () => {
    expect(nextDpadIndex(0, 'right', 6)).toBe(1);
    expect(nextDpadIndex(5, 'right', 6)).toBe(0);
  });

  test('ArrowLeft retrocede, con wraparound al inicio', () => {
    expect(nextDpadIndex(2, 'left', 6)).toBe(1);
    expect(nextDpadIndex(0, 'left', 6)).toBe(5);
  });

  test('count <= 0 devuelve 0 sin lanzar', () => {
    expect(nextDpadIndex(0, 'right', 0)).toBe(0);
  });
});

describe('isReturnToNavKey — devuelve el foco al topnav (preservado del listener línea ~8536-8550)', () => {
  test('ArrowUp cerca del tope del viewport devuelve true', () => {
    expect(isReturnToNavKey('ArrowUp', 50)).toBe(true);
    expect(isReturnToNavKey('ArrowUp', 199)).toBe(true);
  });

  test('ArrowUp lejos del tope, o cualquier otra tecla, devuelve false', () => {
    expect(isReturnToNavKey('ArrowUp', 200)).toBe(false);
    expect(isReturnToNavKey('ArrowUp', 500)).toBe(false);
    expect(isReturnToNavKey('ArrowDown', 50)).toBe(false);
    expect(isReturnToNavKey('Enter', 50)).toBe(false);
  });

  test('respeta un threshold custom', () => {
    expect(isReturnToNavKey('ArrowUp', 250, 300)).toBe(true);
    expect(isReturnToNavKey('ArrowUp', 250, 100)).toBe(false);
  });
});
