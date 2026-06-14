/**
 * streamSelector — la cascada de selección de streams de Real-Debrid/Torrentio.
 *
 * Extraído 1:1 desde `rdGetStream()` en assets/index.html (líneas ~4707-4919).
 * NO se ha simplificado ni cambiado ningún peso/regex/orden de la lógica
 * original — solo se separó en funciones puras y testeables.
 *
 * Casos reales que esta lógica resuelve (documentados en PLAN_MIGRACION_VUE3.md):
 *   - "El Padrino": debe elegir H264+AAC sobre AC3 aunque AC3 tenga mejor calidad
 *   - "Alien": casos con idiomas mixtos / mal etiquetados
 *   - "Punisher": detectar audio AC3/DTS/TrueHD incompatible y buscar alternativa
 */

import type {
  TorrentioStream,
  RDDownload,
  ScoredStream,
  SelectedStream,
} from '../types';

// ── Extracción de info combinada (title + name + filename) ──────────────────
export function streamInfo(s: TorrentioStream): string {
  return (
    (s.title || '') + ' ' + (s.name || '') + ' ' + (s.behaviorHints?.filename || '')
  ).toLowerCase();
}

// ── Detectores de codec / audio / origen ─────────────────────────────────────
export const hasAAC = (s: TorrentioStream): boolean => /\baac\b/.test(streamInfo(s));
export const hasH264 = (s: TorrentioStream): boolean =>
  /\bh\.?264\b|\bx264\b/.test(streamInfo(s));
export const hasRD = (s: TorrentioStream): boolean =>
  /\brd\b|\[rd\]/.test(streamInfo(s)) || (s.name || '').toUpperCase().includes('RD');
export const isX265 = (s: TorrentioStream): boolean =>
  /\bx265\b|\bhevc\b|\bh\.?265\b/i.test(streamInfo(s));

// ── Contenedor (clave para SEEKABILIDAD en TV) ───────────────────────────────
// El `<video>` reproduce MP4 directo (seek por HTTP Range = casi instantáneo). El MKV
// no se reproduce directo en el navegador → obliga a transcode (seek lejano lento). Por
// eso en TV preferimos MP4 con fuerza (ver `scoreStream`). Detección por extensión/etiqueta.
export const isMp4 = (s: TorrentioStream): boolean => /\.mp4\b|\bmp4\b/i.test(streamInfo(s));
export const isMkv = (s: TorrentioStream): boolean => /\.mkv\b|\bmkv\b|\bmatroska\b/i.test(streamInfo(s));

// ── Detección de idioma ──────────────────────────────────────────────────────
export const hasSpa = (s: TorrentioStream): boolean =>
  /\bspa\b|\bspanish\b|\bcastellano\b|\blatino\b|\blat\b|\bes\b/.test(streamInfo(s));
export const hasEng = (s: TorrentioStream): boolean =>
  /\beng\b|\benglish\b/.test(streamInfo(s));
export const hasBadLang = (s: TorrentioStream): boolean => {
  const t = streamInfo(s);
  const bad =
    /\bita\b|\bitalian\b|\bkor\b|\bkorean\b|\brus\b|\brussian\b|\bukr\b|\bfra\b|\bfrench\b|\bvff\b|\bpor\b|\bportuguese\b/.test(
      t
    );
  return bad && !hasEng(s) && !hasSpa(s); // solo descarta si NO acompaña ENG o SPA
};

// ── Tamaño del archivo (extraído del emoji 💾 en el title de Torrentio) ──────
export function getGb(s: TorrentioStream): number {
  const m = (s.title || '').match(/💾\s*([\d.]+)\s*GB/i);
  return m ? parseFloat(m[1]) : 5;
}
export const isHuge = (s: TorrentioStream): boolean => getGb(s) > 15;

// ── Resolución ───────────────────────────────────────────────────────────────
export const is4k = (s: TorrentioStream): boolean => /\b4k\b|\b2160p\b/i.test(streamInfo(s));
export const is1080 = (s: TorrentioStream): boolean => /\b1080p\b/i.test(streamInfo(s));
export const is720 = (s: TorrentioStream): boolean => /\b720p\b/i.test(streamInfo(s));

// ── Audio incompatible con reproducción nativa (necesita transcode RD) ──────
export const BAD_AUDIO_RE =
  /\bac3\b|\bac-3\b|\bdts\b|\btruehd\b|\batmos\b|\bdd[\d\+]|\bddp\b|\bflac\b|\bpcm\b/i;
export const hasBadAudio = (s: TorrentioStream): boolean => BAD_AUDIO_RE.test(streamInfo(s));

// ── AV1 — soporte de navegador/TV pobre y decode pesado → evitar ─────────────
export const isAV1 = (s: TorrentioStream): boolean => /\bav1\b|\bavo1\b/i.test(streamInfo(s));

/**
 * audioCompatScore — compatibilidad del audio para Direct Play (PRIORIDAD 3).
 * Orden: AAC > AC3 > EAC3/DDP > DTS > TrueHD > Atmos. AAC reproduce nativo (sin
 * transcode); el resto fuerza transcode RD o falla — peor cuanto más "avanzado".
 * Se evalúa del MÁS pesado al más liviano (Atmos/TrueHD suelen venir junto a DDP).
 */
export function audioCompatScore(s: TorrentioStream): number {
  const t = streamInfo(s);
  if (/\baac\b/.test(t)) return 50; // nativo → Direct Play
  if (/\batmos\b/.test(t)) return -30;
  if (/\btruehd\b/.test(t)) return -30;
  if (/\bdts\b/.test(t)) return -20;
  if (/\beac3\b|\bddp\b|\bdd\+|\bdd[57]\b|\bdd\b/.test(t)) return 10; // EAC3/DDP
  if (/\bac3\b|\bac-3\b/.test(t)) return 20;
  if (/\bflac\b|\bpcm\b/.test(t)) return -20;
  return 5; // sin etiqueta de audio → asumir aceptable
}

// ── Detección de archivos "basura" (NO son la peli/episodio real) ────────────
// Caso real "Scary Movie": Torrentio devolvió un torrent cuyo archivo elegido era
// "6 - Pec Minor Length Test.mp4" (7 MB) → se reproducía basura (pantalla azul,
// sin audio ni subtítulos). Estos guards evitan ELEGIR o ACEPTAR ese tipo de
// archivo: por nombre (sample/trailer/test) y por tamaño mínimo creíble.
export const JUNK_FILE_RE =
  /\bsample\b|\btrailer\b|\bteaser\b|\bfeaturette\b|\bproof\b|\breadme\b|\bminor\s*length\s*test\b|\blength\s*test\b|\btest\s*file\b/i;
/** Tamaño mínimo creíble para una peli/episodio real (50 MB). Por debajo = basura. */
export const MIN_VALID_FILE_BYTES = 50 * 1024 * 1024;
export const isJunkFilename = (name: string | null | undefined): boolean => JUNK_FILE_RE.test(name || '');
export const isJunkStream = (s: TorrentioStream): boolean => JUNK_FILE_RE.test(streamInfo(s));
/** ¿El download cacheado en RD es basura? (tamaño ínfimo o nombre de sample/test) */
export function isJunkMatch(d: RDDownload): boolean {
  const tooSmall = typeof d.filesize === 'number' && d.filesize > 0 && d.filesize < MIN_VALID_FILE_BYTES;
  return tooSmall || isJunkFilename(d.filename);
}

/**
 * scoreStream — puntaje orientado a FLUIDEZ/ESTABILIDAD (que NUNCA se congele),
 * no a máxima calidad. Tiers por prioridad (rangos no solapados → respetan el orden):
 *
 *   P1 Disponibilidad RD:  [RD+] +200 · [RD download] -200   (cacheado = precondición)
 *   P2 Códec video:        H264 +100 · HEVC/H265 -60 (TV -150) · AV1 -80
 *   P3 Códec audio:        AAC +50 · AC3 +20 · EAC3/DDP +10 · DTS -20 · TrueHD/Atmos -30
 *   P4 Tamaño:             2-8GB +40 · <2GB +20 · 8-12GB 0 · 12-20GB -40 · >20GB -100
 *   P5 Resolución:         1080p +20 · 720p +10 · 4K -40 (TV -100)   (4K pesa, no ayuda)
 *   P6 Idioma:             SPA/Latino +25 · ENG +10   (desempate, NO sobre compat)
 *   P7 Contenedor:         MP4 +8 · MKV -5   (BONUS MENOR — un MP4 puede traer H265)
 *   Descarte (-10000):     basura (sample/test) · idioma incompatible (ITA/KOR sin ENG/SPA)
 *
 * Diseño basado en evidencia real: lo pesado (4K/HEVC/DTS/+20GB) CRASHEA al seek/pause;
 * H264+AAC+2-8GB es lo más estable. El contenedor MP4 NO es criterio principal (un .mp4
 * con H265 4K 21GB —caso Maze Runner— NO es fluido). La compatibilidad gana al idioma:
 * mejor reproducir en inglés+subs que congelarse intentando el latino pesado.
 */
export function scoreStream(s: TorrentioStream, isTv = false): number {
  // ── Descartes automáticos ──
  if (isJunkStream(s)) return -10000; // sample/trailer/test → nunca
  if (hasBadLang(s)) return -10000; // idioma incompatible sin ENG/SPA

  let pts = 0;

  // ── P1 — Disponibilidad RD (precondición: cacheado se reproduce YA) ──
  const nm = (s.name || '').toLowerCase();
  if (/\[rd\+\]/.test(nm)) pts += 200;
  else if (/\[rd download\]/.test(nm)) pts -= 200;
  else if (hasRD(s)) pts += 0;

  // ── P2 — Códec de video (H264 = Direct Play estable; HEVC/AV1 = pesado/incompat) ──
  if (hasH264(s)) pts += 100;
  if (isX265(s)) pts -= isTv ? 150 : 60; // HEVC en webOS = audio sin imagen
  if (isAV1(s)) pts -= 80;

  // ── P3 — Códec de audio (AAC nativo > AC3 > EAC3 > DTS > TrueHD/Atmos) ──
  pts += audioCompatScore(s);

  // ── P4 — Tamaño (los enormes crashean al seek/pause; 2-8GB es el punto dulce) ──
  const gb = getGb(s);
  if (gb > 20) pts -= 100;
  else if (gb > 12) pts -= 40;
  else if (gb >= 2 && gb <= 8) pts += 40;
  else if (gb < 2) pts += 20;
  // 8-12GB → 0 (neutro)

  // ── P5 — Resolución (1080p sweet spot; 4K pesa y no mejora la experiencia) ──
  if (is1080(s)) pts += 20;
  else if (is720(s)) pts += 10;
  else if (is4k(s)) pts -= isTv ? 100 : 40;

  // ── P6 — Idioma (desempate; NO por encima de compatibilidad — ver nota de cabecera) ──
  if (hasSpa(s)) pts += 25; // español/latino
  else pts += 10; // inglés / sin etiqueta

  // ── P7 — Contenedor (BONUS MENOR; jamás criterio principal) ──
  if (isMp4(s)) pts += 8;
  else if (isMkv(s)) pts -= 5;

  return pts;
}

/**
 * rankStreams — ordena por puntaje descendente, descartando los marcados con
 * idioma incompatible (pts <= -500). Si todos quedan descartados, cae a la
 * lista completa con pts=0 (preserva el comportamiento original — siempre
 * intentar reproducir algo en vez de no reproducir nada).
 */
export function rankStreams(
  streams: TorrentioStream[],
  isTv = false
): {
  withUrl: TorrentioStream[];
  scored: ScoredStream[];
  pool: ScoredStream[];
} {
  const withUrl = streams.filter((s) => !!s.url);
  const scored = withUrl
    .map((s) => ({ s, pts: scoreStream(s, isTv) }))
    .filter((x) => x.pts > -5000)
    .sort((a, b) => b.pts - a.pts);
  const pool = scored.length ? scored : withUrl.map((s) => ({ s, pts: 0 }));
  return { withUrl, scored, pool };
}

/**
 * pickFallbackUrl — Plan B: si el stream elegido es x265 (más pesado de
 * decodificar, falla en TVs viejas), busca una alternativa en h264 priorizando
 * RD. Cascada exacta preservada (línea ~4804-4807).
 */
export function pickFallbackUrl(
  best: TorrentioStream,
  withUrl: TorrentioStream[]
): string | null {
  if (!isX265(best)) return null;
  const altBest =
    withUrl.find((s) => s !== best && hasRD(s) && hasH264(s)) ||
    withUrl.find((s) => s !== best && hasH264(s)) ||
    withUrl.find((s) => s !== best && hasRD(s) && !isX265(s)) ||
    withUrl.find((s) => s !== best && !isX265(s));
  return altBest && altBest.url ? altBest.url : null;
}

// ── Filename / infoHash del stream elegido ───────────────────────────────────
export function extractFilename(s: TorrentioStream): string {
  if (s.behaviorHints?.filename) return s.behaviorHints.filename;
  const url = s.url || '';
  return decodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
}

const INFOHASH_RE = /\/resolve\/realdebrid\/[^/]+\/([a-f0-9]{40})\//i;

export function extractInfoHash(s: TorrentioStream): string {
  return s.infoHash || (s.url || '').match(INFOHASH_RE)?.[1] || '';
}

// ── Normalización de URL para comparar contra `downloads` de RD ──────────────
const normUrl = (u: string): string => u.toLowerCase().split('?')[0];

/**
 * matchInDownloads — busca el stream en la lista de `downloads` de RD probando
 * 4 estrategias en cascada (preservadas de tryMatch, línea ~4841-4853):
 *   1. URL resuelta exacta
 *   2. URL original exacta
 *   3. filename exacto
 *   4. filename sin extensión
 */
export function matchInDownloads(
  resolvedUrl: string,
  originalUrl: string,
  filename: string | null,
  downloads: RDDownload[]
): RDDownload | undefined {
  let m = downloads.find((d) => d.download && normUrl(d.download) === normUrl(resolvedUrl));
  if (!m) m = downloads.find((d) => d.download && normUrl(d.download) === normUrl(originalUrl));
  if (!m && filename) {
    const fn = filename.toLowerCase();
    m = downloads.find((d) => d.filename && d.filename.toLowerCase() === fn);
  }
  if (!m && filename) {
    const fnBase = filename.toLowerCase().replace(/\.[^.]+$/, '');
    m = downloads.find(
      (d) => d.filename && d.filename.toLowerCase().replace(/\.[^.]+$/, '') === fnBase
    );
  }
  return m;
}

export interface ActiveStreamMatch {
  match: RDDownload | undefined;
  activeBest: TorrentioStream;
  activeUrl: string;
  activeFilename: string;
}

/**
 * resolveActiveStream — replica el flujo completo de búsqueda de coincidencia
 * en `downloads` + las DOS rondas de fallback (línea ~4855-4903):
 *
 *   Ronda 1: intenta el top stream tal cual.
 *   Ronda 2 (solo si el top tiene idioma incompatible Y no hubo match):
 *            recorre el `pool` (top 6) buscando una alternativa con match.
 *   Ronda 3 (solo si AÚN no hay rdId Y el audio del activo es incompatible):
 *            recorre `scored` (top 8) buscando alternativa reproducible.
 *
 * Devuelve el stream "activo" final (puede ser distinto al `best` original).
 */
export function resolveActiveStream(
  best: TorrentioStream,
  resolvedUrl: string,
  streamFilename: string,
  pool: ScoredStream[],
  scored: ScoredStream[],
  downloads: RDDownload[]
): ActiveStreamMatch & {
  rdId: string | null;
  rdDownloadUrl: string | null;
  rdFilesize: number;
  unavailableInRd: boolean;
} {
  let activeBest = best;
  let activeUrl = resolvedUrl;
  let activeFilename = streamFilename;
  let rdId: string | null = null;
  let rdDownloadUrl: string | null = null;
  let rdFilesize = 0;
  let unavailableInRd = false;

  // Ronda 1 — top stream
  let match = matchInDownloads(resolvedUrl, best.url || '', streamFilename, downloads);

  // GUARD anti-basura: si el archivo cacheado es un sample/test o ínfimo (<50MB),
  // NO es la película → se descarta el match para que sigan las rondas de rescate
  // (o quede sin rdId y caiga a iframe) en vez de reproducir basura. Caso "Scary Movie".
  if (match && isJunkMatch(match)) {
    console.warn('[RD] Match descartado — archivo basura/sample:', match.filename, '| size:', match.filesize);
    match = undefined;
  }

  // Ronda 2 — solo si el top stream tiene idioma incompatible (pts <= -500)
  const topHasBadLang = scored.length > 0 && scored[0].pts <= -5000;
  if (!match && topHasBadLang && pool.length > 1) {
    // ⚠️ Logs de diagnóstico [RD] preservados 1:1 — el original los emite en
    // cada paso de la cascada (índex.html líneas ~4862-4900); se habían perdido
    // al extraer `rdGetStream` en funciones puras testeables, dejando al
    // usuario sin visibilidad de por qué el reproductor "salta" o no.
    console.warn('[RD] Top stream idioma incompatible y sin match — buscando alternativa...'); // línea ~4862
    for (let i = 1; i < Math.min(pool.length, 6); i++) {
      const alt = pool[i].s;
      const altFn = extractFilename(alt);
      const altMatch = matchInDownloads(alt.url || '', alt.url || '', altFn, downloads);
      if (altMatch && !isJunkMatch(altMatch)) {
        match = altMatch;
        activeBest = alt;
        activeUrl = alt.url || '';
        activeFilename = altFn;
        console.warn('[RD] Alternativa encontrada pos', i, '| score:', pool[i].pts, '| filename:', altFn); // línea ~4872
        break;
      }
    }
  }

  if (match) {
    rdId = match.id;
    rdDownloadUrl = match.download || null;
    rdFilesize = match.filesize || 0;
    console.warn('[RD] Match → id:', rdId, '| filename:', match.filename, '| size:', rdFilesize); // línea ~4878
  } else {
    console.warn('[RD] Sin match en downloads — rdId null'); // línea ~4880
    const activeInfoLow = streamInfo(activeBest);
    const badAudio = BAD_AUDIO_RE.test(activeInfoLow);
    // RESCATE GENERALIZADO (Solución 1 refinada — mejora sobre el original):
    // El original solo buscaba alternativa cuando el AUDIO del top era incompatible
    // y SOLO en el top 8 del pool. Problema real (caso "Weapons"): el top elegido
    // (x265 AAC) está caído por DMCA y sin rdId, mientras que una versión que SÍ
    // está cacheada en RD (x264 DDP/Atmos) queda MUY ABAJO en el ranking (penalizada
    // por audio incompatible) → el top-8 nunca la alcanzaba. Aquí:
    //   1) la búsqueda se activa SIEMPRE que no haya rdId (no solo audio malo), y
    //   2) recorre TODO el pool (no solo top 8),
    // para quedarse con la mejor versión que SÍ tenga rdId (cacheada), igual que el
    // reproductor de RD. Riesgo bajo: solo corre donde hoy ya da `rdId null`; si no
    // hay ninguna cacheada, el resultado es idéntico al actual.
    if (scored.length > 1) {
      console.warn('[RD] Sin rdId → buscando la mejor versión cacheada del pool...'); // espíritu del log ~4886
      for (let i = 1; i < scored.length; i++) {
        const alt = scored[i].s;
        const altFn = extractFilename(alt);
        const altMatch = matchInDownloads(alt.url || '', alt.url || '', altFn, downloads);
        if (altMatch && !isJunkMatch(altMatch)) {
          rdId = altMatch.id;
          rdDownloadUrl = altMatch.download || null;
          rdFilesize = altMatch.filesize || 0;
          activeBest = alt;
          activeUrl = alt.url || '';
          activeFilename = altFn;
          console.warn('[RD] Versión cacheada encontrada pos', i, '| score:', scored[i].pts, '| filename:', altFn); // línea ~4894
          break;
        }
      }
    }
    // `unavailableInRd` (toast del llamador) se mantiene EXACTO como el original:
    // solo cuando el audio era incompatible y no hubo alternativa. Sin toasts nuevos.
    if (!rdId && badAudio) {
      console.warn('[RD] Sin alternativa disponible — película no cacheada en RD'); // líneas ~4899-4900
      unavailableInRd = true;
    }
  }

  return { match, activeBest, activeUrl, activeFilename, rdId, rdDownloadUrl, rdFilesize, unavailableInRd };
}

/**
 * buildSelectedStream — ensambla el resultado final {@link SelectedStream}
 * exactamente como lo hace `rdGetStream` al final (línea ~4907-4917).
 */
export function buildSelectedStream(params: {
  best: TorrentioStream;
  withUrl: TorrentioStream[];
  resolvedUrl: string;
  streamFilename: string;
  infoHash: string;
  imdbId: string | null;
  active: ActiveStreamMatch & {
    rdId: string | null;
    rdDownloadUrl: string | null;
    rdFilesize: number;
    unavailableInRd: boolean;
  };
}): SelectedStream {
  // NOTA — `streamFilename` se recibe en `params` (preserva la firma/orden de
  // argumentos del `.then(...)` original, línea ~7826) pero NUNCA se lee aquí
  // en el ensamblado final: el original también solo usa `activeFilename`
  // (semilla = `streamFilename`, ya resuelta en `resolveActiveStream`/`active`)
  // — se omite del destructuring para no disparar `noUnusedLocals`/TS6133.
  const { best, withUrl, resolvedUrl, infoHash, imdbId, active } = params;
  const bestFinal = active.activeBest;
  const resolvedUrlFinal = active.activeUrl;
  const streamFilenameFinal = active.activeFilename;

  const streamHasAAC = hasAAC(bestFinal);
  let finalUrl: string | null = resolvedUrlFinal !== bestFinal.url ? resolvedUrlFinal : (bestFinal.url || resolvedUrl);
  const finalHash = extractInfoHash(bestFinal) || infoHash || '';
  const fallbackUrl = pickFallbackUrl(best, withUrl);

  // GUARD anti-basura final: si el stream que quedó elegido es un sample/test
  // (no se encontró alternativa real), NO entregar su URL → evita que se
  // reproduzca directo (caso "Scary Movie"). El camino server-side (rd-stream,
  // que elige el archivo MÁS GRANDE del torrent) o el iframe toman el control.
  const finalIsJunk = isJunkStream(bestFinal);
  if (finalIsJunk) {
    console.warn('[RD] Stream final es basura/sample — URL anulada para no reproducir basura:', streamFilenameFinal);
    finalUrl = null;
  }

  // Líneas ~4915-4916 — logs de diagnóstico finales (preservados 1:1)
  console.warn('[RD] Resultado final → url:', finalUrl, '| rdId:', active.rdId, '| isX265:', isX265(bestFinal), '| hasAAC:', streamHasAAC);
  console.warn('[RD] infoHash:', finalHash || '(no encontrado)');

  return {
    url: finalUrl || null,
    rdId: active.rdId,
    isX265: isX265(bestFinal),
    fallbackUrl,
    imdbId,
    streamFilename: streamFilenameFinal || null,
    hasAAC: streamHasAAC,
    rdDownloadUrl: active.rdDownloadUrl,
    rdFilesize: active.rdFilesize,
    infoHash: finalHash,
    unavailableInRd: active.unavailableInRd,
  };
}

/**
 * selectBestStream — punto de entrada principal: dado un array de streams de
 * Torrentio (ya con `.url` resueltos), devuelve el `best` elegido + datos
 * derivados, SIN tocar red (eso lo hace rd.service.ts en una capa superior).
 *
 * Esta es la función que se debe testear con los casos reales documentados
 * (Padrino, Alien, Punisher).
 */
export function selectBestStream(
  streams: TorrentioStream[],
  isTv = false
): {
  best: TorrentioStream | null;
  withUrl: TorrentioStream[];
  scored: ScoredStream[];
  pool: ScoredStream[];
  fallbackUrl: string | null;
  streamFilename: string;
  infoHash: string;
} {
  const { withUrl, scored, pool } = rankStreams(streams, isTv);
  const best = pool[0]?.s || withUrl[0] || streams[0] || null;

  if (!best || !best.url) {
    console.warn('[RD] No se encontró stream válido'); // línea ~4790
    return { best: null, withUrl, scored, pool, fallbackUrl: null, streamFilename: '', infoHash: '' };
  }

  // Líneas ~4792-4799 — logs de diagnóstico de la selección (preservados 1:1)
  if (scored.length < withUrl.length) {
    console.warn('[RD] Descartados', withUrl.length - scored.length, 'streams por idioma incompatible');
  }
  const detectedLang = hasSpa(best) ? '🇪🇸 SPA' : hasEng(best) ? '🇬🇧 ENG' : '⚠️ otro';
  console.warn(
    '[RD] Stream elegido — name:', best.name || '—',
    '| lang:', detectedLang, '| score:', pool[0]?.pts,
    '| gb:', getGb(best).toFixed(1),
    '| H264:', hasH264(best), '| AAC:', hasAAC(best)
  );

  const fallbackUrl = pickFallbackUrl(best, withUrl);
  const streamFilename = extractFilename(best);
  const infoHash = extractInfoHash(best);

  return { best, withUrl, scored, pool, fallbackUrl, streamFilename, infoHash };
}
