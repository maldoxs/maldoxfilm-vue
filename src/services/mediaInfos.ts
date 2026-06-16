/**
 * mediaInfos — FASE 3: usar `/streaming/mediaInfos/{rdId}` de Real-Debrid como
 * FUENTE DE VERDAD de las pistas reales del archivo (audio/subtítulos/códec),
 * en vez de adivinar por el nombre del torrent/filename.
 *
 * Forma real de la respuesta de RD (observada en vivo):
 *   {
 *     duration: 10528.145,
 *     details: {
 *       video: { codec: 'h264', ... },
 *       audio: { ita1: { stream, lang:'Italian', lang_iso:'ita', codec:'ac3', ... },
 *                eng1: { ... } },        // ← clave = TOKEN para la URL de transcode
 *       subtitles: { eng1: { lang_iso:'eng', type:'SRT' }, ... }  // o [] si no hay
 *     }
 *   }
 *
 * La CLAVE de cada pista de audio (`ita1`, `eng1`, `spa1`, `lat1`...) es justo el
 * token `{audio}` del `modelUrl` de RD, así que sirve para pedir el transcode con
 * el idioma deseado: `…/t/{id}/{audio}/{subs}/{audioCodec}/{quality}.{format}`.
 */

export interface RdAudioTrack {
  token: string; // clave en details.audio (ej. 'spa1') → token de la URL de transcode
  lang: string;
  langIso: string;
  codec: string;
}

export interface RdSubTrack {
  token: string;
  lang: string;
  langIso: string;
  type: string;
}

export interface MediaInfos {
  durationSec: number;
  videoCodec: string | null;
  audio: RdAudioTrack[];
  subtitles: RdSubTrack[];
}

/** Convierte un mapa `{ token: {...} }` (o un array) en lista normalizada. */
function toEntries(raw: unknown): Array<[string, Record<string, unknown>]> {
  if (Array.isArray(raw)) {
    return raw.map((v, i) => [String(i), (v ?? {}) as Record<string, unknown>]);
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, Record<string, unknown>>);
  }
  return [];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * parseMediaInfos — normaliza la respuesta cruda de RD a {@link MediaInfos}.
 * Tolera campos faltantes / formas raras (devuelve listas vacías), nunca lanza.
 */
export function parseMediaInfos(raw: unknown): MediaInfos {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const details = (root.details && typeof root.details === 'object' ? root.details : {}) as Record<string, unknown>;

  const video = (details.video && typeof details.video === 'object' ? details.video : {}) as Record<string, unknown>;
  const videoCodec = video.codec ? str(video.codec).toLowerCase() : null;

  const audio: RdAudioTrack[] = toEntries(details.audio).map(([token, a]) => ({
    token,
    lang: str(a.lang),
    langIso: str(a.lang_iso).toLowerCase(),
    codec: str(a.codec).toLowerCase(),
  }));

  const subtitles: RdSubTrack[] = toEntries(details.subtitles).map(([token, s]) => ({
    token,
    lang: str(s.lang),
    langIso: str(s.lang_iso).toLowerCase(),
    type: str(s.type),
  }));

  return {
    durationSec: Number(root.duration) || 0,
    videoCodec,
    audio,
    subtitles,
  };
}

const SPANISH_ISO = new Set(['spa', 'es', 'lat']);
const isSpanishTrack = (t: { lang: string; langIso: string; token: string }): boolean =>
  SPANISH_ISO.has(t.langIso) ||
  /spanish|español|espanol|castellano|latino|latin/i.test(t.lang) ||
  /^(spa|lat|es)\d*$/i.test(t.token);

/** ¿La pista es español LATINO (no castellano de España)? */
const isLatinoTrack = (t: { lang: string; token: string }): boolean =>
  /lat/i.test(t.token) || /latino|latin/i.test(t.lang);

/**
 * pickSpanishAudioToken — token de la pista de audio en **LATINO** para pedir el
 * transcode en ese idioma. Preferencia del usuario: latino → sí; castellano (España)
 * → NO (mejor inglés + subtítulos). Por eso SOLO devuelve un token claramente latino;
 * si el audio español es castellano o ambiguo, devuelve null → el reproductor queda en
 * inglés y los subtítulos español (OpenSubtitles) cubren el idioma.
 */
export function pickSpanishAudioToken(info: MediaInfos): string | null {
  const latino = info.audio.find(isLatinoTrack);
  return latino ? latino.token : null;
}

/** ¿El archivo tiene subtítulos en español embebidos? (sincronizados, del propio archivo). */
export function pickSpanishSubToken(info: MediaInfos): string | null {
  const spa = info.subtitles.find(isSpanishTrack);
  return spa ? spa.token : null;
}
