/**
 * stores/player — estado del reproductor, reactivo.
 *
 * Reemplaza dos cosas del original (assets/index.html):
 *   1. `playerState` — objeto global suelto (línea ~5553):
 *      {id,type,season,episode,totalSeasons,totalEpisodes,title,runtimeMin}
 *   2. `_playerGen` — contador manual de "generación" (línea ~5556) usado
 *      para cancelar callbacks async obsoletos cuando el usuario cambia de
 *      contenido antes de que termine de cargar el anterior:
 *        let _playerGen = 0;
 *        // dentro de loadPlayerSource(): const myGen = ++_playerGen;
 *        // en cada callback async: if(_playerGen !== myGen) return;
 *
 * Con Pinia, el PROPIO incremento de `generation` en `load()` sigue siendo
 * necesario (la cancelación de callbacks async obsoletos NO es automática
 * por reactividad — sigue siendo un problema de "promesas en vuelo", no de
 * UI desactualizada). Lo que SÍ elimina la migración es la necesidad de
 * variables globales sueltas (`_myGen`) repartidas por 50 funciones: ahora
 * `playerStore.generation` vive en un solo lugar reactivo, y los composables
 * pueden leerlo con `storeToRefs` sin duplicar contadores.
 *
 * NOTA: se preserva `generation` (no se "simplifica" a quitarlo) porque
 * sigue resolviendo un problema real — cancelar fetch/transcode en vuelo —
 * que la reactividad de Vue no resuelve por sí sola.
 */

import { defineStore } from 'pinia';
import type { PlayerState } from '../types';
import { RD_SRC_IDX } from '../services/playerSources';

export interface PlayerStoreState {
  current: PlayerState;
  /** Generación activa — se incrementa en cada `load()`. */
  generation: number;
  /**
   * Fuente activa: índice en `SOURCES`, o `RD_SRC_IDX` (99) para Real-Debrid.
   * Preserva `playerState._srcIdx`/`_defaultSrcIdx = RD_SRC_IDX` (líneas
   * ~7753-7755): el original SIEMPRE arranca en RD por defecto — el usuario
   * puede cambiar a UnlimPlay/vidlink desde el selector, y esa elección
   * persiste mientras siga viendo el mismo contenido (cambios de episodio
   * incluidos), hasta que `close()`/`load()` reinicia la sesión.
   */
  sourceIndex: number;
  isActive: boolean;
}

const emptyPlayerState = (): PlayerState => ({
  id: null,
  type: 'movie',
  season: 1,
  episode: 1,
  totalSeasons: 0,
  totalEpisodes: 0,
  title: '',
  runtimeMin: 0,
  isAnime: false,
  animeTitle: '',
  animeTmdbId: null,
});

export const usePlayerStore = defineStore('player', {
  state: (): PlayerStoreState => ({
    current: emptyPlayerState(),
    generation: 0,
    sourceIndex: RD_SRC_IDX,
    isActive: false,
  }),
  getters: {
    /**
     * isStale — el helper que reemplaza `if(_playerGen !== myGen) return;`
     * en cada callback async. Se captura `myGen = playerStore.generation`
     * al iniciar la carga, y se compara luego: `if (playerStore.isStale(myGen)) return;`
     */
    isStale: (state) => (myGen: number) => state.generation !== myGen,
  },
  actions: {
    /**
     * load — equivalente al inicio de `loadPlayerSource` (línea ~7550):
     * fija el nuevo `playerState` Y devuelve el número de generación que el
     * llamador debe capturar para sus checks de "stale" posteriores.
     * Preserva exactamente el patrón `const myGen = ++_playerGen`.
     */
    load(params: {
      id: string | number;
      type: 'movie' | 'tv';
      season?: number;
      episode?: number;
      totalSeasons?: number;
      totalEpisodes?: number;
      title?: string;
      runtimeMin?: number;
    }): number {
      this.generation += 1;
      // CRÍTICO — preserva `playerState={id,type,...}` (líneas ~7550-7551 del
      // original): ese REEMPLAZO COMPLETO del objeto (sin la clave `_srcIdx`)
      // es lo que garantiza que `_activeSrcIdx` recalcule a `_defaultSrcIdx =
      // RD_SRC_IDX` (líneas ~7753-7755) en CADA apertura de un título nuevo —
      // sin importar en qué fuente haya quedado el título anterior. Sin este
      // reset aquí, `sourceIndex` arrastra el valor (p.ej. `0`/UnlimPlay) que
      // dejó el auto-fallback de RD o un cambio manual del título previo, y
      // `loadActiveSource()` salta directo al iframe en vez de intentar RD.
      this.sourceIndex = RD_SRC_IDX;
      // Preserva `_dpIsAnime`/`_dpAnimeTitle`/`_dpAnimeTmdbId` precacheados por
      // `presetAnimeDetection` (ver comentario de `PlayerState`/líneas ~7583/7768
      // del original) — `load()` fija el resto del estado de reproducción sin
      // pisar la detección de anime que `DetailView` dejó lista de antemano.
      this.current = {
        id: params.id,
        type: params.type,
        season: params.season ?? 1,
        episode: params.episode ?? 1,
        totalSeasons: params.totalSeasons ?? 0,
        totalEpisodes: params.totalEpisodes ?? 0,
        title: params.title ?? '',
        runtimeMin: params.runtimeMin ?? 0,
        isAnime: this.current.isAnime,
        animeTitle: this.current.animeTitle,
        animeTmdbId: this.current.animeTmdbId,
      };
      this.isActive = true;
      return this.generation;
    },
    /**
     * presetAnimeDetection — preserva el "precache" que `dpRenderPage` dejaba
     * en `_dpIsAnime`/`_dpAnimeTitle`/`_dpAnimeTmdbId` (líneas ~8973-8976) al
     * abrir un detalle, para que el reproductor pudiera resolver fuentes
     * especiales de anime (Anime1V) sin volver a pedir el detalle a TMDB.
     * `DetailView` la llama justo antes de navegar a `/ver/...`; `PlayerView`
     * lee `playerStore.current.isAnime`/`animeTitle`/`animeTmdbId`.
     */
    presetAnimeDetection(isAnime: boolean, animeTitle: string, animeTmdbId: number | string | null) {
      this.current.isAnime = isAnime;
      this.current.animeTitle = animeTitle;
      this.current.animeTmdbId = animeTmdbId;
    },
    /** close — cierra el reproductor (incrementa generación para cancelar lo pendiente). */
    close() {
      this.generation += 1;
      this.isActive = false;
      this.current = emptyPlayerState();
      this.sourceIndex = RD_SRC_IDX;
    },
    /**
     * bumpGeneration — preserva `const _myGen = ++_playerGen` AL INICIO de
     * `loadPlayerSource` (línea ~7742): a diferencia de `load()` (que solo
     * corre una vez, al abrir el reproductor desde `openPlayer`), ESTA
     * generación se renueva en CADA `loadPlayerSource` — es decir, en cada
     * cambio de episodio/temporada/fuente — para invalidar streams/timers/
     * fetches en vuelo de la carga anterior SIN resetear `current` (eso
     * destruiría season/episode/title que la navegación de episodios necesita
     * preservar). `PlayerView.loadActiveSource()` la llama justo antes de
     * orquestar la carga (RD vía `usePlayer.loadRdSource`, o iframe).
     */
    bumpGeneration(): number {
      this.generation += 1;
      return this.generation;
    },
    setSourceIndex(idx: number) {
      this.sourceIndex = idx;
    },
    setEpisode(season: number, episode: number) {
      this.current.season = season;
      this.current.episode = episode;
    },
    /**
     * setRuntime — preserva la asignación directa `playerState.runtimeMin = ...`
     * que hacía `fetchEpisodeRuntime` (línea ~7614): runtime estimado del
     * episodio/película activo, usado por `progressPctFromElapsed`/`autoNextDelayMs`.
     */
    setRuntime(min: number) {
      this.current.runtimeMin = min;
    },
    /**
     * setTotals — preserva `playerState.totalSeasons`/`totalEpisodes = ...`
     * (líneas ~7600-7602/7663): se actualizan tras consultar la temporada en TMDB.
     */
    setTotals(totalSeasons: number, totalEpisodes: number) {
      this.current.totalSeasons = totalSeasons;
      this.current.totalEpisodes = totalEpisodes;
    },
  },
});
