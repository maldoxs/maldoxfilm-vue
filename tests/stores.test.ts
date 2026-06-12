import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePlayerStore } from '../src/stores/player';
import { RD_SRC_IDX } from '../src/services/playerSources';
import { useMyListStore } from '../src/stores/myList';
import { useDeviceStore } from '../src/stores/device';
import { _resetMemStoreForTests } from '../src/services/safeStorage';
import { MY_LIST_STORAGE_KEY } from '../src/services/myList';

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  _resetMemStoreForTests();
});

describe('usePlayerStore — reemplaza playerState global + _playerGen', () => {
  test('estado inicial vacío y generación en 0', () => {
    const store = usePlayerStore();
    expect(store.current.id).toBeNull();
    expect(store.generation).toBe(0);
    expect(store.isActive).toBe(false);
  });

  test('load() fija el nuevo playerState y devuelve la nueva generación (equivalente a ++_playerGen)', () => {
    const store = usePlayerStore();
    const gen1 = store.load({ id: 550, type: 'movie', title: 'Fight Club', runtimeMin: 139 });
    expect(gen1).toBe(1);
    expect(store.generation).toBe(1);
    expect(store.current).toEqual({
      id: 550,
      type: 'movie',
      season: 1,
      episode: 1,
      totalSeasons: 0,
      totalEpisodes: 0,
      title: 'Fight Club',
      runtimeMin: 139,
      // load() preserva la detección de anime precacheada (ver presetAnimeDetection) —
      // estado inicial vacío al no haberse llamado todavía.
      isAnime: false,
      animeTitle: '',
      animeTmdbId: null,
    });
    expect(store.isActive).toBe(true);
  });

  test('presetAnimeDetection guarda la detección de anime y load() la preserva (puente DetailView → PlayerView)', () => {
    const store = usePlayerStore();
    store.presetAnimeDetection(true, 'Attack on Titan', 1429);
    expect(store.current.isAnime).toBe(true);
    expect(store.current.animeTitle).toBe('Attack on Titan');
    expect(store.current.animeTmdbId).toBe(1429);

    // load() (equivalente a abrir el reproductor) NO debe pisar la detección precacheada.
    store.load({ id: 1429, type: 'tv', season: 1, episode: 1, title: 'Attack on Titan' });
    expect(store.current.isAnime).toBe(true);
    expect(store.current.animeTitle).toBe('Attack on Titan');
    expect(store.current.animeTmdbId).toBe(1429);
  });

  test('close() restablece también los campos de detección de anime', () => {
    const store = usePlayerStore();
    store.presetAnimeDetection(true, 'One Piece', 37854);
    store.close();
    expect(store.current.isAnime).toBe(false);
    expect(store.current.animeTitle).toBe('');
    expect(store.current.animeTmdbId).toBeNull();
  });

  test('cada load() sucesivo incrementa la generación (cancela callbacks viejos)', () => {
    const store = usePlayerStore();
    const gen1 = store.load({ id: 1, type: 'movie' });
    const gen2 = store.load({ id: 2, type: 'movie' });
    expect(gen2).toBe(gen1 + 1);
    // El patrón de cancelación: capturar myGen al iniciar, comparar luego
    expect(store.isStale(gen1)).toBe(true); // la carga vieja ya quedó obsoleta
    expect(store.isStale(gen2)).toBe(false); // la actual sigue vigente
  });

  test('close() incrementa generación y resetea el estado', () => {
    const store = usePlayerStore();
    const gen1 = store.load({ id: 1, type: 'tv', season: 2, episode: 5 });
    store.close();
    expect(store.isActive).toBe(false);
    expect(store.current.id).toBeNull();
    expect(store.isStale(gen1)).toBe(true);
  });

  test('setEpisode actualiza season/episode sin tocar el resto', () => {
    const store = usePlayerStore();
    store.load({ id: 1, type: 'tv', season: 1, episode: 1, title: 'Show' });
    store.setEpisode(2, 7);
    expect(store.current.season).toBe(2);
    expect(store.current.episode).toBe(7);
    expect(store.current.title).toBe('Show');
  });

  test('setRuntime/setTotals actualizan campos puntuales sin tocar el resto (preserva asignaciones directas de fetchEpisodeRuntime/season fetch)', () => {
    const store = usePlayerStore();
    store.load({ id: 1, type: 'tv', season: 1, episode: 1, title: 'Show' });
    store.setRuntime(45);
    expect(store.current.runtimeMin).toBe(45);
    store.setTotals(3, 12);
    expect(store.current.totalSeasons).toBe(3);
    expect(store.current.totalEpisodes).toBe(12);
    expect(store.current.title).toBe('Show'); // resto intacto
  });

  test('bumpGeneration incrementa generación SIN resetear `current` (preserva `const _myGen = ++_playerGen` de loadPlayerSource — distinto de load(), que sí resetea)', () => {
    const store = usePlayerStore();
    store.load({ id: 1, type: 'tv', season: 1, episode: 1, title: 'Show', totalSeasons: 3, totalEpisodes: 10 });
    const genBefore = store.generation;
    store.setEpisode(1, 2); // navegación de episodio — NO debe perder el resto del estado
    const newGen = store.bumpGeneration();
    expect(newGen).toBe(genBefore + 1);
    expect(store.generation).toBe(newGen);
    expect(store.isStale(genBefore)).toBe(true);
    expect(store.isStale(newGen)).toBe(false);
    // current se preserva intacto — bumpGeneration no resetea nada
    expect(store.current).toMatchObject({ id: 1, type: 'tv', season: 1, episode: 2, title: 'Show', totalSeasons: 3, totalEpisodes: 10 });
  });

  test('setSourceIndex cambia la fuente activa — arranca en RD_SRC_IDX (preserva `_defaultSrcIdx = RD_SRC_IDX`, líneas ~7753-7755: el original SIEMPRE prueba RD primero)', () => {
    const store = usePlayerStore();
    expect(store.sourceIndex).toBe(RD_SRC_IDX);
    store.setSourceIndex(1);
    expect(store.sourceIndex).toBe(1);
  });

  test('close() restablece sourceIndex a RD_SRC_IDX (nueva sesión = vuelve a intentar RD primero)', () => {
    const store = usePlayerStore();
    store.setSourceIndex(0);
    store.close();
    expect(store.sourceIndex).toBe(RD_SRC_IDX);
  });
});

describe('useMyListStore — Mi Lista reactiva + persistencia', () => {
  test('arranca cargando lo que haya en localStorage (vacío si no hay nada)', () => {
    const store = useMyListStore();
    expect(store.items).toEqual([]);
    expect(store.isEmpty).toBe(true);
    expect(store.countLabel).toBe('0 títulos');
  });

  test('toggle agrega, persiste en localStorage y actualiza getters', () => {
    const store = useMyListStore();
    const { added, toast } = store.toggle({ id: 278, title: 'Cadena perpetua', type: 'movie', poster: '/p.jpg' });
    expect(added).toBe(true);
    expect(toast).toContain('añadido a Mi Lista');
    expect(store.count).toBe(1);
    expect(store.inList(278)).toBe(true);

    // Persistido — round-trip real contra localStorage
    const raw = JSON.parse(localStorage.getItem(MY_LIST_STORAGE_KEY)!);
    expect(raw).toEqual([{ id: '278', type: 'movie', title: 'Cadena perpetua', poster: '/p.jpg' }]);
  });

  test('toggle sobre un item ya existente lo quita', () => {
    const store = useMyListStore();
    store.toggle({ id: 1, title: 'X' });
    const { added, toast } = store.toggle({ id: 1, title: 'X' });
    expect(added).toBe(false);
    expect(toast).toBe('Eliminado de Mi Lista');
    expect(store.isEmpty).toBe(true);
  });

  test('remove quita por id y persiste', () => {
    const store = useMyListStore();
    store.toggle({ id: 1, title: 'Alien', type: 'movie' });
    store.toggle({ id: 2, title: 'Show', type: 'tv' });
    const { removed, toast } = store.remove(1);
    expect(removed).toBe(true);
    expect(toast).toBe('"Alien" eliminado de Mi Lista');
    expect(store.count).toBe(1);
    expect(store.inList(1)).toBe(false);
    expect(store.inList(2)).toBe(true);
  });

  test('reversedItems devuelve lo más reciente primero, ya normalizado', () => {
    const store = useMyListStore();
    store.toggle({ id: 1, title: 'Primero', type: 'movie', poster: '/a.jpg' });
    store.toggle({ id: 2, title: 'Segundo', type: 'tv', poster: '/b.jpg' });
    expect(store.reversedItems.map((i) => i.title)).toEqual(['Segundo', 'Primero']);
  });

  test('persiste entre instancias del store (recarga de la página)', () => {
    const store1 = useMyListStore();
    store1.toggle({ id: 42, title: 'Persistente', type: 'movie' });

    setActivePinia(createPinia());
    const store2 = useMyListStore();
    expect(store2.count).toBe(1);
    expect(store2.items[0]).toEqual({ id: '42', type: 'movie', title: 'Persistente', poster: '' });
  });
});

describe('useDeviceStore — detección de plataforma reactiva (una sola vez)', () => {
  test('detect() corre la heurística, fija el modo y aplica la clase al <html>', () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13; Mobile)',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

    document.documentElement.className = '';
    const store = useDeviceStore();
    store.detect();

    expect(store.detected).toBe(true);
    expect(store.mode).toBe('mobile');
    expect(store.isMobile).toBe(true);
    expect(document.documentElement.classList.contains('mobile-mode')).toBe(true);

    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
  });

  test('detect() es idempotente — solo corre una vez', () => {
    const store = useDeviceStore();
    store.detect();
    const modeAfterFirst = store.mode;
    document.documentElement.className = ''; // limpiar clases para verificar que NO se reaplica
    store.detect();
    expect(store.mode).toBe(modeAfterFirst);
    // como detect() no corrió de nuevo, la clase no se reaplicó
    expect(document.documentElement.className).toBe('');
  });
});
