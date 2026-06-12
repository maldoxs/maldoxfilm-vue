/**
 * services/playerSources — helpers PUROS de orquestación de `PlayerView`:
 * fuentes-iframe (`SOURCES`), índice de Real-Debrid, navegación de
 * episodios/temporadas, cálculo de progreso y temporización del banner
 * "auto-next". Extrae la lógica de decisión de `loadPlayerSource`/
 * `goToNextEpisode`/`scheduleAutoNext`/`startProgressTracking`/`closePlayer`
 * (líneas ~7612-8402 y ~8735-8794 de `assets/index.html`) para que sea
 * testeable sin DOM — el componente solo encadena estas decisiones sobre
 * refs/elementos reales, igual que `usePlayer` hace con `services/playback`.
 */

/** Una fuente-iframe — preservada EXACTA de `SOURCES` (líneas ~5365-5378). */
export interface IframeSource {
  name: string;
  icon: string;
  movie: (id: string | number) => string;
  tv: (id: string | number, season: number, episode: number) => string;
}

/** Orden de fallback iframe: UnlimPlay(0) → vidlink(1) — preservado EXACTO. */
export const SOURCES: IframeSource[] = [
  {
    name: 'UnlimPlay',
    icon: '▶',
    movie: (id) => `https://unlimplay.com/play/embed/movie/${id}`,
    tv: (id, s, e) => `https://unlimplay.com/play/embed/tv/${id}/${s}/${e}`,
  },
  {
    name: 'vidlink',
    icon: '▶',
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
  },
];

/** Índice "mágico" que representa la fuente Real-Debrid — preservado EXACTO de la línea ~4705. */
export const RD_SRC_IDX = 99;

/**
 * buildIframeSourceUrl — preservado EXACTO de `_buildSrcUrl` (líneas ~7757-7762):
 * arma la URL del iframe según el tipo de contenido. Si el índice no existe
 * en `SOURCES`, cae a la fuente 0 (mismo fallback del original).
 */
export function buildIframeSourceUrl(
  sources: IframeSource[],
  idx: number,
  type: 'movie' | 'tv',
  id: string | number,
  season: number,
  episode: number
): string {
  const src = sources[idx] || sources[0];
  return type === 'tv' ? src.tv(id, season, episode) : src.movie(id);
}

/** Una opción de `<select>` — usada para temporada/episodio (preserva `renderEpisodeControls`, líneas ~7629-7633). */
export interface SelectOption {
  value: number;
  label: string;
  selected: boolean;
}

/** seasonOptions — preservado EXACTO del bucle `for(let s=1;s<=totalSeasons;s++)` (línea ~7630-7631). */
export function seasonOptions(totalSeasons: number, activeSeason: number): SelectOption[] {
  const opts: SelectOption[] = [];
  for (let s = 1; s <= totalSeasons; s++) {
    opts.push({ value: s, label: `Temporada ${s}`, selected: s === activeSeason });
  }
  return opts;
}

/** episodeOptions — preservado EXACTO del bucle `for(let e=1;e<=episodeCount;e++)` (línea ~7632-7633). */
export function episodeOptions(episodeCount: number, activeEpisode: number): SelectOption[] {
  const opts: SelectOption[] = [];
  for (let e = 1; e <= episodeCount; e++) {
    opts.push({ value: e, label: `Episodio ${e}`, selected: e === activeEpisode });
  }
  return opts;
}

/**
 * progressPctFromElapsed — preservado EXACTO de `startProgressTracking`/
 * `closePlayer` (líneas ~7702-7704 y ~8740-8742): minutos transcurridos sobre
 * duración estimada, clampado a 95% (nunca se marca como "visto" del todo,
 * para que "Continuar viendo" siga ofreciéndolo).
 */
export function progressPctFromElapsed(elapsedMin: number, runtimeMin: number): number {
  const runtime = runtimeMin > 0 ? runtimeMin : 22;
  return Math.min((elapsedMin / runtime) * 100, 95);
}

/**
 * shouldPersistProgressOnClose — preservado EXACTO del check `if(pct>3)`
 * dentro de `closePlayer` (línea ~8743): evita guardar "progreso" de aperturas
 * accidentales/instantáneas.
 */
export function shouldPersistProgressOnClose(pct: number): boolean {
  return pct > 3;
}

/**
 * autoNextDelayMs — preservado EXACTO de `doSchedule` dentro de `scheduleAutoNext`
 * (líneas ~8290-8291): dispara el banner al 85% del runtime estimado (mínimo
 * 22min de fallback aplicado por el llamador → aquí se preserva el fallback de
 * 24min específico de `scheduleAutoNext`, que es DISTINTO del de `progressPctFromElapsed` —
 * "curiosidad" preservada del original, no es un error de copiado).
 */
export function autoNextDelayMs(runtimeMin: number): number {
  const runtime = runtimeMin > 0 ? runtimeMin : 24;
  return Math.max(runtime * 60 * 1000 * 0.85, 40000);
}

/** Estado mínimo de episodio/temporada que necesitan los helpers de navegación. */
export interface EpisodeNavState {
  season: number;
  episode: number;
  totalSeasons: number;
  totalEpisodes: number;
}

/**
 * canScheduleAutoNext — preservado EXACTO del check `canNext` dentro del
 * `setTimeout` de `scheduleAutoNext` (líneas ~8294-8296): solo se ofrece
 * "siguiente" si hay a dónde ir (o si ni siquiera sabemos cuántos episodios hay).
 */
export function canScheduleAutoNext(state: EpisodeNavState): boolean {
  return (
    (state.totalEpisodes > 0 && state.episode < state.totalEpisodes) ||
    state.season < state.totalSeasons ||
    state.totalEpisodes === 0
  );
}

/** Destino de avance — `{season, episode}` o `null` si no hay siguiente. */
export interface NextEpisodeTarget {
  season: number;
  episode: number;
  /** `true` si el destino implica saltar a una nueva temporada (preserva el toast "▶ Temporada N"). */
  isNewSeason: boolean;
}

/**
 * nextEpisodeTarget — preservado EXACTO de la lógica combinada de
 * `goToNextEpisode`/`preloadNextEpData`/`nextEpisode` (líneas ~8315-8318,
 * ~8379-8390, ~8568-8580): siguiente episodio dentro de la temporada activa,
 * o episodio 1 de la siguiente temporada si ya se llegó al final. Devuelve
 * `null` si no hay a dónde avanzar.
 */
export function nextEpisodeTarget(state: EpisodeNavState): NextEpisodeTarget | null {
  if (state.episode < state.totalEpisodes) {
    return { season: state.season, episode: state.episode + 1, isNewSeason: false };
  }
  if (state.season < state.totalSeasons) {
    return { season: state.season + 1, episode: 1, isNewSeason: true };
  }
  return null;
}

/**
 * prevEpisodeTarget — preservado EXACTO de `prevEpisode` (líneas ~8584-8588):
 * solo retrocede dentro de la temporada activa (el original NO retrocede de
 * temporada — "curiosidad" preservada).
 */
export function prevEpisodeTarget(state: EpisodeNavState): { season: number; episode: number } | null {
  if (state.episode > 1) {
    return { season: state.season, episode: state.episode - 1 };
  }
  return null;
}

/** Etiqueta del toast de fuente — preservado EXACTO de `switchSource` (líneas ~8561-8565). */
export function sourceToastLabel(sources: IframeSource[], idx: number): string {
  if (idx === RD_SRC_IDX) return '⚡ Real-Debrid — Buscando stream...';
  const s = sources[idx];
  return s ? `${s.icon} ${s.name}` : '';
}
