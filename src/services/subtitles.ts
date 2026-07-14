/**
 * subtitles — lógica de subtítulos OpenSubtitles + SRT/VTT.
 *
 * Extraído 1:1 desde `assets/index.html`:
 *   - Conversión de tiempos y parseo SRT → cues:        líneas ~4932-4967
 *   - Scoring de subtítulos OpenSubtitles (`score`):    líneas ~5278-5308
 *   - Derivación de la clave de offset (crowdsourcing): línea ~5231
 *
 * Las funciones de RED (búsqueda en OpenSubtitles, descarga del .srt vía
 * Netlify Functions `subhash`/`offset`) viven en una capa superior
 * (`subtitlesApi.ts`, pendiente) — aquí solo está la lógica PURA y testeable:
 * parseo, conversión de formatos y scoring/selección del mejor candidato.
 */

import type { OpenSubtitle } from '../types';

// ── Conversión de timestamps SRT (HH:MM:SS,mmm) ↔ milisegundos ──────────────
export function tsToMs(ts: string): number {
  const [time, ms] = ts.replace(',', '.').split('.');
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms || '0', 10);
}

// ── ms → timestamp WEBVTT (HH:MM:SS.mmm) ─────────────────────────────────────
export function msToVttTs(msIn: number): string {
  let ms = Math.max(0, Math.round(msIn));
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0') +
    '.' +
    String(ms).padStart(3, '0')
  );
}

const SRT_TS_RANGE_RE = /(\d{2}:\d{2}:\d{2}[,.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,.]\d{3})/g;

/**
 * srtToVtt — convierte un bloque SRT completo a WEBVTT aplicando un offset
 * (en ms) a cada timestamp. Preservado de `_srtToVtt` (línea ~4944-4949).
 */
export function srtToVtt(srt: string, offsetMs: number): string {
  return (
    'WEBVTT\n\n' +
    srt.replace(
      SRT_TS_RANGE_RE,
      (_match, s: string, e: string) =>
        msToVttTs(tsToMs(s) + offsetMs) + ' --> ' + msToVttTs(tsToMs(e) + offsetMs)
    )
  );
}

export interface SubtitleCue {
  s: number; // inicio en ms (con offset aplicado)
  e: number; // fin en ms (con offset aplicado)
  text: string;
}

/**
 * parseSrt — parsea un .srt completo a cues `{s, e, text}` aplicando offset.
 * Preservado de `_parseSrt` (línea ~4954-4967): normaliza saltos de línea,
 * separa por bloques en blanco, descarta bloques sin línea de tiempos,
 * y limpia tags HTML del texto.
 */
export function parseSrt(srt: string, offsetMs: number): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\n+/);
  blocks.forEach((b) => {
    const lines = b.trim().split('\n');
    if (lines.length < 2) return;
    const tsLine = lines.find((l) => /-->/.test(l));
    if (!tsLine) return;
    const [s, e] = tsLine.split('-->').map((t) => tsToMs(t.trim()));
    const text = lines
      .slice(lines.indexOf(tsLine) + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '');
    if (text) cues.push({ s: s + offsetMs, e: e + offsetMs, text });
  });
  return cues;
}

/**
 * findActiveCue — busca el cue activo para un tiempo dado (en ms).
 * Replica `_subTimeUpdate`: `cues.find(c => t >= c.s && t <= c.e)`.
 */
export function findActiveCue(cues: SubtitleCue[], currentTimeMs: number): SubtitleCue | undefined {
  return cues.find((c) => currentTimeMs >= c.s && currentTimeMs <= c.e);
}

/**
 * buildOffsetStorageKey — clave de localStorage para el offset guardado,
 * preservada de la línea ~5231: prioriza infoHash (identifica el torrent
 * exacto), si no hay usa el filename/imdbId sin extensión.
 */
export function buildOffsetStorageKey(infoHash: string | null, streamFilename: string | null, imdbId: string | null): string {
  const base = infoHash || (streamFilename || imdbId || '').replace(/\.[^.]+$/, '');
  return 'sub_off_' + base;
}

/**
 * buildSubImdbId — identificador interno usado para el offset/crowdsourcing,
 * preservado de la línea ~5230: infoHash > streamFilename > imdbId.
 */
export function buildSubImdbId(infoHash: string | null, streamFilename: string | null, imdbId: string | null): string | null {
  return infoHash || streamFilename || imdbId;
}

// ── Hints derivados del nombre del archivo del video (para el scoring) ──────
const CODEC_WORDS_RE =
  /^(h264|x264|h265|x265|hevc|avc|aac|ac3|dts|mp3|dd5|ddp|atmos|truehd|bluray|bdrip|brrip|webrip|web|dl|hdr|sdr|10bit|remux|remastered|theatrical|directors|cut|extended|unrated|proper|mkv|mp4|avi)$/i;

export interface VideoHints {
  qualHint: string;
  groupHint: string;
  vidBluray: boolean;
  vidWebDl: boolean;
  vidIsDC: boolean;
  vidIsExtend: boolean;
}

/**
 * deriveVideoHints — extrae pistas del filename del video para puntuar
 * subtítulos por afinidad (misma calidad/grupo/corte). Preservado de las
 * líneas ~5266-5275.
 */
export function deriveVideoHints(streamFilename: string | null): VideoHints {
  const fileLow = (streamFilename || '').toLowerCase();
  const relParts = fileLow.replace(/\.[^.]+$/, '').split(/[.\-_\s]+/);
  const qualHint = relParts.find((p) => /^\d{3,4}p$/i.test(p)) || '';
  const groupHint =
    relParts.filter((p) => p.length > 2 && !CODEC_WORDS_RE.test(p) && !/^\d+$/.test(p)).pop() || '';
  return {
    qualHint,
    groupHint,
    vidBluray: /bluray|bdrip|brrip/i.test(fileLow),
    vidWebDl: /web.?dl|webrip|amzn/i.test(fileLow),
    vidIsDC: /directors?.cut|director.s.cut|\.dc\./i.test(fileLow),
    vidIsExtend: /extended|unrated|theatrical/i.test(fileLow),
  };
}

/**
 * scoreSubtitle — sistema de puntaje para elegir el mejor subtítulo entre los
 * resultados de OpenSubtitles. Pesos exactos preservados de `score` (línea
 * ~5278-5308):
 *   Afinidad release: qualHint +3 | groupHint +5
 *   Calidad:          hd +1 | no-AI +2 | from_trusted +1
 *   Origen (Bluray/WebDL): match +4 | mismatch -3
 *   Corte (Director's/Extended): match +4 | conflicto -3
 *   Idioma sospechoso (ITA/FR/DE): -4
 *   FPS:              25fps -5 | 23.976/24 +3 | sin info +1
 *   Popularidad (descargas): >50k +6 | >10k +4 | >1k +2 | >100 +1
 *
 * `vidDurationSec` se acepta por paridad con el original (se usaba para una
 * comparación de duración que en el código fuente quedó como placeholder
 * — `subDur` siempre 0 — así que no afecta el puntaje; se conserva el
 * parámetro para no "simplificar" la firma original).
 */
export function scoreSubtitle(s: OpenSubtitle, hints: VideoHints, _vidDurationSec = 0): number {
  const fn = (s.attributes.release || '').toLowerCase();
  const fps = Number(s.attributes.fps) || 0;
  let pts = 0;

  if (hints.qualHint && fn.includes(hints.qualHint)) pts += 3;
  if (hints.groupHint && fn.includes(hints.groupHint)) pts += 5;
  if (s.attributes.hd) pts += 1;
  // AI-translated = auto-traducido de OTRO release → casi siempre DESINCRONIZA
  // (caso La Momia: sub "Fandango" AI sobre video "Dr4gon"). Penalizar fuerte para
  // preferir subtítulos HUMANOS que matcheen el release (caso El Padrino: "adhd",
  // AI:false → sincroniza). Si el único disponible es AI, igual se elige (es lo que hay).
  pts += s.attributes.ai_translated ? -8 : 4;
  if (s.attributes.from_trusted) pts += 2;

  if (hints.vidBluray && /bluray|bdrip|brrip/i.test(fn)) pts += 4;
  if (hints.vidWebDl && /web.?dl|webrip|amzn/i.test(fn)) pts += 4;
  if (hints.vidBluray && /amzn|web.?dl|webrip/i.test(fn)) pts -= 3;

  if (hints.vidIsDC && /directors?.cut|director.s.cut|\.dc\./i.test(fn)) pts += 4;
  if (hints.vidIsDC && /theatrical/i.test(fn) && !/director/i.test(fn)) pts -= 3;
  if (hints.vidIsExtend && /extended|unrated/i.test(fn)) pts += 4;

  if (/-ita\b|\bfrench\b|\bgerman\b/i.test(fn)) pts -= 4;

  if (fps === 25) pts -= 5;
  if (fps === 23.976 || fps === 24) pts += 3;
  if (fps === 0) pts += 1;

  const dlCount = (s.attributes.new_download_count || 0) + (s.attributes.download_count || 0);
  if (dlCount > 50000) pts += 6;
  else if (dlCount > 10000) pts += 4;
  else if (dlCount > 1000) pts += 2;
  else if (dlCount > 100) pts += 1;

  return pts;
}

/**
 * ADR-009 fix 2 — piso de confianza + verificación de IMDB, para que nunca se
 * elija un subtítulo de OTRA película (caso real: `Maze.Runner...srt` con
 * score 19 reproduciendo otro título — `pickBestSubtitle` devolvía `ranked[0]`
 * sin ningún piso, y la búsqueda por release con `imdb_id=` vacío puede traer
 * cualquier cosa que matchee el texto).
 *
 * Reglas (diseñadas para NO romper el comportamiento documentado "si el único
 * disponible es AI, igual se elige"):
 *   1. Si el resultado declara `feature_details.imdb_id` y NO coincide con el
 *      título en reproducción → DESCARTE duro (es de otra película), sin
 *      importar el score.
 *   2. Si coincide → se mantiene el comportamiento actual INTACTO (sin piso:
 *      un AI-translated verificado sigue siendo elegible como último recurso).
 *   3. Si no se puede verificar (sin `feature_details`, o sin IMDB nuestro) →
 *      se exige un score mínimo (`MIN_SUBTITLE_CONFIDENCE`) para aceptarlo.
 */
export const MIN_SUBTITLE_CONFIDENCE = 5;

/** Resultado de la verificación IMDB de UN candidato. */
export type ImdbVerdict = 'match' | 'mismatch' | 'unverifiable';

export function imdbVerdict(s: OpenSubtitle, numericId: string): ImdbVerdict {
  const fd = s.attributes.feature_details;
  if (!numericId || !fd) return 'unverifiable';
  const own = Number(numericId);
  if (!own) return 'unverifiable';
  // Serie: el imdb del episodio difiere del de la serie → aceptar cualquiera de los dos.
  if (fd.imdb_id === own || fd.parent_imdb_id === own) return 'match';
  if (fd.imdb_id == null && fd.parent_imdb_id == null) return 'unverifiable';
  return 'mismatch';
}

/**
 * filterTrustworthySubtitles — aplica las reglas 1-3 sobre la lista completa.
 * Devuelve también cuántos se descartaron por mismatch (para el log).
 */
export function filterTrustworthySubtitles(
  subs: OpenSubtitle[],
  numericId: string,
  hints: VideoHints,
  vidDurationSec = 0
): { kept: OpenSubtitle[]; mismatches: number; lowConfidence: number } {
  let mismatches = 0;
  let lowConfidence = 0;
  const kept = subs.filter((s) => {
    const v = imdbVerdict(s, numericId);
    if (v === 'mismatch') {
      mismatches++;
      return false;
    }
    if (v === 'match') return true;
    if (scoreSubtitle(s, hints, vidDurationSec) >= MIN_SUBTITLE_CONFIDENCE) return true;
    lowConfidence++;
    return false;
  });
  return { kept, mismatches, lowConfidence };
}

/**
 * rankSubtitles — ordena candidatos de OpenSubtitles por puntaje descendente.
 * Preservado de `[...data.data].sort((a,b)=>score(b)-score(a))`.
 */
export function rankSubtitles(subs: OpenSubtitle[], hints: VideoHints, vidDurationSec = 0): OpenSubtitle[] {
  return [...subs].sort((a, b) => scoreSubtitle(b, hints, vidDurationSec) - scoreSubtitle(a, hints, vidDurationSec));
}

/**
 * pickBestSubtitle — el ganador del ranking + su file_id (o null si no
 * tiene archivos descargables). Preservado de las líneas ~5309-5311.
 */
export function pickBestSubtitle(
  subs: OpenSubtitle[],
  hints: VideoHints,
  vidDurationSec = 0
): { best: OpenSubtitle | null; fileId: number | null } {
  const ranked = rankSubtitles(subs, hints, vidDurationSec);
  const best = ranked[0] || null;
  const fileId = best?.attributes.files[0]?.file_id ?? null;
  return { best, fileId };
}

/**
 * MIN_VALID_CUES — umbral mínimo de cues para considerar un .srt descargado
 * como "válido" (preservado de la línea ~5343: `cues.length >= 100`). Por
 * debajo de este umbral se descarta y se prueba el siguiente candidato del
 * ranking (hasta 4 intentos, línea ~5335).
 */
export const MIN_VALID_CUES = 100;
export const MAX_DOWNLOAD_ATTEMPTS = 4;

export function isSubtitleValid(cues: SubtitleCue[]): boolean {
  return cues.length >= MIN_VALID_CUES;
}

/**
 * buildReleaseName — nombre de release usado para la búsqueda 1 en
 * OpenSubtitles (sin extensión). Preservado de la línea ~5239.
 */
export function buildReleaseName(streamFilename: string | null): string {
  return (streamFilename || '').replace(/\.[^.]+$/, '');
}

/**
 * numericImdbId — quita el prefijo "tt" del IMDB ID para las queries de
 * OpenSubtitles. Preservado de la línea ~5237.
 */
export function numericImdbId(imdbId: string | null): string {
  return (imdbId || '').replace(/^tt/i, '');
}
