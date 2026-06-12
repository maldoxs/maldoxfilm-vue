/**
 * services/anime1 — cliente de la API de Anime1V + helpers puros para el
 * selector de servidores de anime dentro de `PlayerView`.
 *
 * Reemplaza `anime1Search`/`anime1Info`/`anime1Episode`/`findBestMatch`/
 * `_renderAnimeSourceSelector` (líneas ~4505-4546 y ~4556-4597 de
 * `assets/index.html`). Es el "puente" final del flujo de detección de anime
 * que arranca en `DetailView.presetAnimeDetection()` (ver `stores/player.ts`):
 * cuando `playerStore.current.isAnime` es `true` y el contenido es una serie,
 * `PlayerView` busca el anime en Anime1V por título, resuelve los servidores
 * SUB/DUB del episodio activo, y los combina con la fuente "StreamiX"
 * (UnlimPlay) en un único selector.
 *
 * Se separa la parte de RED (async, requiere `fetchImpl` inyectable para
 * tests) de la parte PURA (`findBestMatch`/`buildAnimeServerList`/
 * `pickEpisodeByNumber`), siguiendo el mismo patrón "pure function + cliente"
 * que `services/tmdb.ts`/`services/torrentio.ts`.
 */

/** Base + API key — preservadas EXACTAS de las líneas ~4492-4493. La key viaja
 * en la URL en el original (no es un secreto de servidor como `RD_TOKEN`,
 * sino una clave pública de un proxy de terceros) — se preserva tal cual. */
export const ANIME_API_BASE = 'https://anime1v-api-cloned.onrender.com';
export const ANIME_API_KEY = '86d6451302f2150096aa561c7311ed6f';

export interface Anime1SearchResult {
  title: string;
  url: string;
  [key: string]: unknown;
}

export interface Anime1SearchResponse {
  data?: { results?: Anime1SearchResult[] };
  [key: string]: unknown;
}

export interface Anime1Episode {
  number: string | number;
  url: string;
  [key: string]: unknown;
}

export interface Anime1InfoResponse {
  data?: { episodes?: Anime1Episode[] };
  [key: string]: unknown;
}

export interface Anime1Server {
  server: string;
  url: string;
  [key: string]: unknown;
}

/** Forma de `epRes.data` — soporta los dos formatos que el original maneja
 * (`streamLinks.{SUB,DUB}` o `servers.{sub,dub}`, líneas ~4563-4570). */
export interface Anime1EpisodeServersData {
  streamLinks?: { SUB?: Anime1Server[]; DUB?: Anime1Server[] };
  servers?: { sub?: Anime1Server[]; dub?: Anime1Server[] };
  [key: string]: unknown;
}

export interface Anime1EpisodeResponse {
  success?: boolean;
  data?: Anime1EpisodeServersData;
  [key: string]: unknown;
}

// ── Cliente de red — preservado EXACTO de anime1Search/anime1Info/anime1Episode ──
// (líneas ~4505-4524). Cada llamada atrapa errores y devuelve `null` — igual
// que el original — para que el llamador siga con el fallback "solo StreamiX".

export async function anime1Search(query: string, fetchImpl: typeof fetch = fetch): Promise<Anime1SearchResponse | null> {
  try {
    const res = await fetchImpl(`${ANIME_API_BASE}/api/v1/anime/search?q=${encodeURIComponent(query)}&apiKey=${ANIME_API_KEY}`);
    return (await res.json()) as Anime1SearchResponse;
  } catch {
    return null;
  }
}

export async function anime1Info(url: string, fetchImpl: typeof fetch = fetch): Promise<Anime1InfoResponse | null> {
  try {
    const res = await fetchImpl(`${ANIME_API_BASE}/api/v1/anime/info?url=${encodeURIComponent(url)}&apiKey=${ANIME_API_KEY}`);
    return (await res.json()) as Anime1InfoResponse;
  } catch {
    return null;
  }
}

export async function anime1Episode(url: string, fetchImpl: typeof fetch = fetch): Promise<Anime1EpisodeResponse | null> {
  try {
    const res = await fetchImpl(`${ANIME_API_BASE}/api/v1/anime/episode?url=${encodeURIComponent(url)}&apiKey=${ANIME_API_KEY}`);
    return (await res.json()) as Anime1EpisodeResponse;
  } catch {
    return null;
  }
}

// ── findBestMatch — preservado EXACTO del algoritmo de 3 pasadas (líneas ~4526-4546):
// 1) coincidencia exacta tras normalizar, 2) "contains" en cualquier dirección,
// 3) puntaje por solapamiento de palabras (>2 letras). Pura — 100% testable. ──
function normalizeAnimeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function findBestMatch(title: string, results: Anime1SearchResult[] | null | undefined): Anime1SearchResult | null {
  if (!results || results.length === 0) return null;
  const cleanTitle = normalizeAnimeTitle(title);

  const exact = results.find((r) => normalizeAnimeTitle(r.title) === cleanTitle);
  if (exact) return exact;

  const contains = results.find((r) => {
    const rTitle = normalizeAnimeTitle(r.title);
    return rTitle.includes(cleanTitle) || cleanTitle.includes(rTitle);
  });
  if (contains) return contains;

  const titleWords = cleanTitle.split(' ').filter((w) => w.length > 2);
  let bestScore = 0;
  let bestResult = results[0];
  results.forEach((r) => {
    const rTitle = normalizeAnimeTitle(r.title);
    const rWords = rTitle.split(' ').filter((w) => w.length > 2);
    const overlap = titleWords.filter((w) => rWords.some((rw) => rw.includes(w) || w.includes(rw))).length;
    const score = overlap / Math.max(titleWords.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestResult = r;
    }
  });
  return bestResult;
}

/**
 * pickEpisodeByNumber — preservado EXACTO de la búsqueda de episodio dentro
 * de `_fetchAnimeServersForEpisode` (líneas ~4669-4671): primero por número
 * absoluto exacto, si no se encuentra cae al índice posicional.
 */
export function pickEpisodeByNumber(episodes: Anime1Episode[] | null | undefined, episode: number): Anime1Episode | null {
  if (!episodes || episodes.length === 0) return null;
  const byNumber = episodes.find((e) => parseInt(String(e.number), 10) === episode);
  if (byNumber) return byNumber;
  return episodes[episode - 1] ?? null;
}

/** Una entrada del selector de servidores — preserva `{label,url,type}` (línea ~4564-4577). */
export interface AnimeServerEntry {
  label: string;
  url: string;
  type: 'MX' | 'SUB' | 'DUB';
}

/**
 * buildAnimeServerList — preservado EXACTO del armado de `allServers` dentro
 * de `_renderAnimeSourceSelector` (líneas ~4561-4578): combina "StreamiX"
 * (UnlimPlay, siempre primero) con los servidores SUB (🇯🇵) y DUB (🇲🇽) que
 * trajo la API de Anime1V — soportando los dos formatos de respuesta que el
 * original tolera (`streamLinks` o `servers`).
 */
export function buildAnimeServerList(streamixUrl: string, serversData: Anime1EpisodeServersData | null | undefined): AnimeServerEntry[] {
  let subServers: AnimeServerEntry[] = [];
  let dubServers: AnimeServerEntry[] = [];

  if (serversData?.streamLinks) {
    subServers = (serversData.streamLinks.SUB || []).map((s) => ({ label: `🇯🇵 ${s.server}`, url: s.url, type: 'SUB' as const }));
    dubServers = (serversData.streamLinks.DUB || []).map((s) => ({ label: `🇲🇽 ${s.server}`, url: s.url, type: 'DUB' as const }));
  }
  if (!subServers.length && serversData?.servers) {
    subServers = (serversData.servers.sub || []).map((s) => ({ label: `🇯🇵 ${s.server}`, url: s.url, type: 'SUB' as const }));
  }
  if (!dubServers.length && serversData?.servers) {
    dubServers = (serversData.servers.dub || []).map((s) => ({ label: `🇲🇽 ${s.server}`, url: s.url, type: 'DUB' as const }));
  }

  return [{ label: '🇲🇽 StreamiX', url: streamixUrl, type: 'MX' as const }, ...subServers, ...dubServers];
}

/**
 * hasApiServers — equivalente a `hasApi` (línea ~4581): determina si se debe
 * mostrar el toggle SUB/DUB (solo cuando la API trajo al menos un servidor).
 */
export function hasApiServers(servers: AnimeServerEntry[]): boolean {
  return servers.some((s) => s.type === 'SUB' || s.type === 'DUB');
}
