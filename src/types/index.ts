/**
 * Tipos compartidos — extraídos 1:1 de las estructuras reales que devuelven
 * Torrentio, Real-Debrid y OpenSubtitles en assets/index.html (rdGetStream,
 * fetchAndInjectSubtitle). Mantener sincronizados con esas respuestas reales.
 */

// ── Torrentio (catálogo de streams de un torrent ya cacheado/no en RD) ──────
export interface TorrentioStream {
  name?: string;
  title?: string;
  url?: string;
  infoHash?: string;
  behaviorHints?: {
    filename?: string;
  };
}

export interface TorrentioResponse {
  streams: TorrentioStream[];
}

// ── Real-Debrid ──────────────────────────────────────────────────────────────
export interface RDDownload {
  id: string;
  download?: string;
  filename?: string;
  filesize?: number;
}

export interface RDTranscodeResponse {
  apple?: { full: string };
  dash?: { full: string };
  liveMP4?: { full: string };
}

// ── Resultado final de la selección de stream (lo que devuelve rdGetStream) ──
export interface SelectedStream {
  url: string | null;
  rdId: string | null;
  isX265: boolean;
  fallbackUrl: string | null;
  imdbId: string | null;
  streamFilename: string | null;
  hasAAC: boolean;
  rdDownloadUrl: string | null;
  rdFilesize: number;
  infoHash?: string;
  /**
   * unavailableInRd — preserva la señal de `rdGetStream` (índex.html líneas
   * ~4898-4901): se activa cuando, tras agotar la Ronda 3 de alternativas,
   * el stream activo sigue con audio incompatible Y sin `rdId` — el original
   * dispara `showToast('⚠️ No disponible en RD — cambiando de reproductor')`
   * en ese momento (aunque el playback continúe igual con `rdId=null`, NO
   * cambia de fuente ahí mismo). El llamador (`usePlayer.loadRdSource`) debe
   * mostrar ese toast informativo cuando esta bandera viene en `true`.
   */
  unavailableInRd?: boolean;
  /**
   * server* — resolución SERVER-SIDE (Netlify Function `rd-stream`, ver ADR-004)
   * para contenido NO cacheado: cuando `rdId` es null y ninguna versión estaba
   * cacheada, la function hace `addMagnet→selectFiles→unrestrict→transcode` y
   * devuelve estas URLs ya listas (sin pasar por el proxy de Torrentio, con Range
   * y sin exponer el token). Si vienen, `usePlayer.loadRdSource` las reproduce
   * directo: prioriza `serverDashUrl` (multi-audio + Range vía Shaka); `liveMP4`
   * y HLS son respaldo. Vacío en el camino cacheado normal (ese no cambia).
   */
  serverDashUrl?: string | null;
  serverLiveMp4Url?: string | null;
  serverHlsUrl?: string | null;
  serverDirectUrl?: string | null;
  /**
   * serverTorrentId — id del torrent que `rd-stream` agregó a la cuenta RD para
   * resolver este stream. Se usa para BORRARLO al cerrar/cambiar de título y
   * evitar acumulación (ADR-006). Solo viene en el camino server-side.
   */
  serverTorrentId?: string | null;
  /**
   * hasLatinoTag — el título/nombre del torrent elegido menciona audio latino/español
   * (ver `hasLatino` en streamSelector.ts). Bug real encontrado (2026-07-13): el camino
   * server-side (`rd-stream`, ADR-004) hardcodeaba `hasNativeSpanish: false` SIEMPRE, sin
   * mirar esto — un torrent "Dual Audio Español Latino Ing" reproducía en inglés porque
   * nada le pedía a Shaka la pista en español. Se usa para configurar
   * `preferredAudioLanguage` en Shaka en ese camino.
   */
  hasLatinoTag?: boolean;
}

// ── Resultado intermedio del scoring (stream + puntaje) ──────────────────────
export interface ScoredStream {
  s: TorrentioStream;
  pts: number;
}

// ── OpenSubtitles ────────────────────────────────────────────────────────────
export interface OpenSubtitleFile {
  file_id: number;
}

export interface OpenSubtitleAttributes {
  release: string;
  language: string;
  fps: number;
  hd: boolean;
  ai_translated: boolean;
  from_trusted: boolean;
  files: OpenSubtitleFile[];
  ratings?: number;
  download_count?: number;
  new_download_count?: number;
}

export interface OpenSubtitle {
  attributes: OpenSubtitleAttributes;
}

// ── Mi Lista (localStorage 'sx_mylist') ──────────────────────────────────────
// El array original mezclaba strings sueltos (formato legado, solo id) con
// objetos completos {id,type,title,poster} — se preserva esa unión para no
// romper datos ya guardados por usuarios existentes.
export interface MyListItemObject {
  id: string;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
}
export type MyListItem = MyListItemObject | string;

// ── Estado del reproductor (reemplaza `playerState` global) ──────────────────
export interface PlayerState {
  id: string | number | null;
  type: 'movie' | 'tv';
  season: number;
  episode: number;
  totalSeasons: number;
  totalEpisodes: number;
  title: string;
  runtimeMin: number;
  /**
   * isAnime/animeTitle/animeTmdbId — preservan el "precache" de detección de
   * anime japonés que `dpRenderPage` calculaba al abrir el detalle
   * (`_dpIsAnime`/`_dpAnimeTitle`/`_dpAnimeTmdbId`, líneas ~4499-4501/8973-8975)
   * para que `openPlayer`/`loadPlayerSource` (líneas ~7583/7768) pudieran
   * resolver fuentes especiales (Anime1V) sin re-pedir el detalle a TMDB.
   * Como `DetailView` y `PlayerView` ahora son rutas reales (componentes
   * separados que no comparten variables de módulo), `DetailView` calcula
   * estos valores y los deja aquí ANTES de navegar a `/ver/...` — el store
   * hace de "puente" entre ambas pantallas, igual que las globales lo hacían
   * dentro de la SPA original.
   */
  isAnime: boolean;
  animeTitle: string;
  animeTmdbId: number | string | null;
}

// ── Detección de dispositivo (reemplaza las clases tv-mode/desktop-mode/...) ──
export type DeviceMode = 'tv' | 'desktop' | 'mobile';

// ── Ítem de catálogo TMDB (películas/series, tal como llegan de `/discover`,
// `/trending`, `/search/multi`, etc.) — forma mínima usada por `createCard`/
// `MovieCard`/`Carousel` (líneas ~7049-7063 de assets/index.html). Se
// preservan ambos pares title/name y release_date/first_air_date porque TMDB
// los devuelve distinto según `media_type`.
export interface MediaItem {
  id: number | string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number | null;
  release_date?: string | null;
  first_air_date?: string | null;
  media_type?: 'movie' | 'tv' | 'person';
  runtime?: number | null;
  number_of_seasons?: number | null;
}
