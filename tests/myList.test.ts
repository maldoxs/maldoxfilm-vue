import { describe, test, expect, beforeEach } from 'vitest';
import {
  itemId,
  isInList,
  indexOfItem,
  toggleItem,
  removeItem,
  normalizeItem,
  countLabel,
} from '../src/services/myList';
import type { MyListItem } from '../src/types';

describe('itemId — normaliza id de item legado (string) u objeto', () => {
  test('extrae .id de un objeto', () => {
    expect(itemId({ id: '123', type: 'movie', title: 'X', poster: '' })).toBe('123');
  });
  test('convierte un string suelto (formato legado) a su propio valor', () => {
    expect(itemId('456')).toBe('456');
  });
  test('siempre devuelve string (id numérico → string)', () => {
    // @ts-expect-error — simula dato legado guardado como número
    expect(itemId({ id: 789 })).toBe('789');
  });
});

describe('isInList / indexOfItem', () => {
  const list: MyListItem[] = ['100', { id: '200', type: 'tv', title: 'Show', poster: '' }];
  test('detecta presencia comparando como string', () => {
    expect(isInList(list, '100')).toBe(true);
    expect(isInList(list, 100)).toBe(true); // number vs string — preserva String(id) === String(id)
    expect(isInList(list, '200')).toBe(true);
    expect(isInList(list, '999')).toBe(false);
  });
  test('indexOfItem devuelve -1 si no existe', () => {
    expect(indexOfItem(list, '200')).toBe(1);
    expect(indexOfItem(list, '999')).toBe(-1);
  });
});

describe('toggleItem — añadir/quitar (inmutable)', () => {
  test('agrega un item nuevo como objeto completo con defaults', () => {
    const { list, added, toast } = toggleItem([], { id: 1, title: 'Alien', type: 'movie', poster: '/p.jpg' });
    expect(added).toBe(true);
    expect(list).toEqual([{ id: '1', type: 'movie', title: 'Alien', poster: '/p.jpg' }]);
    expect(toast).toBe('"Alien" añadido a Mi Lista');
  });

  test('usa defaults cuando faltan type/title/poster', () => {
    const { list } = toggleItem([], { id: 2 });
    expect(list).toEqual([{ id: '2', type: 'movie', title: '', poster: '' }]);
  });

  test('si ya estaba, lo quita (toggle)', () => {
    const seeded: MyListItem[] = [{ id: '1', type: 'movie', title: 'Alien', poster: '' }];
    const { list, added, toast } = toggleItem(seeded, { id: 1, title: 'Alien' });
    expect(added).toBe(false);
    expect(list).toEqual([]);
    expect(toast).toBe('Eliminado de Mi Lista');
  });

  test('no muta la lista original (inmutabilidad)', () => {
    const original: MyListItem[] = [];
    toggleItem(original, { id: 1, title: 'X' });
    expect(original).toEqual([]);
  });
});

describe('removeItem', () => {
  const seeded: MyListItem[] = [
    { id: '1', type: 'movie', title: 'Alien', poster: '' },
    { id: '2', type: 'tv', title: 'Show', poster: '' },
  ];

  test('quita por id y devuelve el título para el mensaje', () => {
    const { list, removed, title, toast } = removeItem(seeded, '1');
    expect(removed).toBe(true);
    expect(title).toBe('Alien');
    expect(toast).toBe('"Alien" eliminado de Mi Lista');
    expect(list).toEqual([{ id: '2', type: 'tv', title: 'Show', poster: '' }]);
  });

  test('si el id no existe, no cambia nada', () => {
    const result = removeItem(seeded, '999');
    expect(result.removed).toBe(false);
    expect(result.list).toBe(seeded); // misma referencia — sin cambios
    expect(result.toast).toBe('');
  });

  test('si el item legado es un string suelto, el título queda vacío pero igual se quita', () => {
    const legacy: MyListItem[] = ['100'];
    const { removed, title, toast } = removeItem(legacy, '100');
    expect(removed).toBe(true);
    expect(title).toBe('');
    expect(toast).toBe('Eliminado de Mi Lista');
  });
});

describe('normalizeItem — campos para renderizar la card', () => {
  test('extrae id/type/title/poster de un objeto completo', () => {
    expect(normalizeItem({ id: '1', type: 'tv', title: 'Show', poster: '/p.jpg' })).toEqual({
      id: '1',
      type: 'tv',
      title: 'Show',
      poster: '/p.jpg',
    });
  });
  test('un string legado normaliza a defaults (movie, sin título/poster)', () => {
    expect(normalizeItem('500')).toEqual({ id: '500', type: 'movie', title: '', poster: '' });
  });
});

describe('countLabel — pluralización del contador', () => {
  test('singular para 1, plural para el resto', () => {
    expect(countLabel(0)).toBe('0 títulos');
    expect(countLabel(1)).toBe('1 título');
    expect(countLabel(2)).toBe('2 títulos');
  });
});

// ── safeStorage / persistencia ────────────────────────────────────────────────
import { safeStorage, _resetMemStoreForTests } from '../src/services/safeStorage';
import { loadMyList, persistMyList, MY_LIST_STORAGE_KEY } from '../src/services/myList';

describe('safeStorage — wrapper resiliente sobre localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetMemStoreForTests();
  });

  test('set/get/remove delega en localStorage cuando está disponible', () => {
    safeStorage.setItem('k', 'v');
    expect(safeStorage.getItem('k')).toBe('v');
    safeStorage.removeItem('k');
    expect(safeStorage.getItem('k')).toBeNull();
  });
});

describe('loadMyList / persistMyList — persistencia JSON en localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetMemStoreForTests();
  });

  test('loadMyList devuelve [] si no hay nada guardado', () => {
    expect(loadMyList()).toEqual([]);
  });

  test('loadMyList devuelve [] si el JSON guardado está corrupto (no rompe la app)', () => {
    localStorage.setItem(MY_LIST_STORAGE_KEY, '{not-json');
    expect(loadMyList()).toEqual([]);
  });

  test('persistMyList + loadMyList hacen round-trip', () => {
    const list: MyListItem[] = [{ id: '1', type: 'movie', title: 'Alien', poster: '/p.jpg' }];
    persistMyList(list);
    expect(loadMyList()).toEqual(list);
  });

  test('loadMyList ignora valores que no son array (datos corruptos/alterados)', () => {
    localStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify({ id: 'no-soy-un-array' }));
    expect(loadMyList()).toEqual([]);
    localStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(42));
    expect(loadMyList()).toEqual([]);
  });

  test('loadMyList filtra entradas con forma inválida (defensa contra type-confusion)', () => {
    const stored = [
      { id: '1', type: 'movie', title: 'Alien', poster: '/p.jpg' }, // válido
      'legacy-id-123', // formato legado válido (string suelto)
      { id: '2', type: 'serie-malformada', title: 'X', poster: '/x.jpg' }, // type inválido
      { id: '3', title: 123, poster: '/x.jpg' }, // title con tipo incorrecto
      { type: 'movie', title: 'Sin id', poster: '/x.jpg' }, // sin id
      null,
      42, // número suelto — el tipo `MyListItem` no lo admite (solo string|objeto)
    ];
    localStorage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(stored));
    expect(loadMyList()).toEqual([
      { id: '1', type: 'movie', title: 'Alien', poster: '/p.jpg' },
      'legacy-id-123',
    ]);
  });
});
