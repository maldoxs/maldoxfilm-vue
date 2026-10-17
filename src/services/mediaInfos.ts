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

  // `details.video` viene como MAPA de pistas, igual que el audio:
  //   { und1: { stream:'0:0', lang:'Unknown', codec:'h264', width, height } }
  // El comentario de arriba (y este parser) asumían un objeto plano `{ codec }`, así que
  // `videoCodec` salía SIEMPRE null y el códec de video quedaba "desconocido" — bug real
  // verificado contra la API el 2026-08-02. Se aceptan las dos formas: la plana (por si RD
  // la devuelve así en algún caso) y el mapa, tomando la primera pista con códec.
  const video = (details.video && typeof details.video === 'object' ? details.video : {}) as Record<string, unknown>;
  const videoCodecRaw =
    video.codec ?? toEntries(details.video).map(([, v]) => v.codec).find((c) => !!c) ?? null;
  const videoCodec = videoCodecRaw ? str(videoCodecRaw).toLowerCase() : null;

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

// ── ADR-009 fix 3 — audio REAL antes de decidir Direct Play ──────────────────
// Códecs de audio que el <video> del navegador decodifica NATIVO (sin transcode).
// AC3/EAC3/DTS/TrueHD NO están: dependen de decoder de HARDWARE (una TV los suena,
// Chrome desktop queda MUDO — caso real "El Padrino": release "Dual Audio Español
// Latino" sin códec en el nombre, audio real ac3 → hasBadAudio=false por nombre →
// Direct Play mudo en desktop).
const NATIVE_AUDIO_CODECS = /^(aac|mp3|mp4a|opus|vorbis)/i;

// AC3/EAC3: dependen del decodificador de HARDWARE, asi que no son "nativos" en todos
// lados — por eso viven aparte y solo cuentan cuando el equipo declara soportarlos
// (ver `detectAc3Support` en playback.ts). Comprobado en un LG webOS el 2026-09-11
// reproduciendo un h264 + AC3 real sin convertir: se escucho. Antes se los excluia
// para TODOS, de modo que en la TV se mandaban a convertir archivos que la TV podia
// reproducir directo — y convertir es justamente el camino que se corta.
const HARDWARE_AUDIO_CODECS = /^(ac-?3|e-?ac-?3|eac-?3)/i;

/**
 * hasNativeDecodableAudio — ¿alguna pista de audio del archivo es decodificable
 * NATIVA por el navegador? Devuelve:
 *   true  → hay al menos una pista AAC/MP3/Opus/Vorbis (Direct Play seguro en audio)
 *   false → hay pistas y NINGUNA es nativa (AC3/DTS/... → mudo sin decoder HW)
 *   null  → no se pudo determinar (sin pistas parseadas) → NO cambiar el
 *           comportamiento actual (heurística por nombre de archivo).
 */
export function hasNativeDecodableAudio(info: MediaInfos, ac3Ok = false): boolean | null {
  if (!info.audio.length) return null;
  return info.audio.some(
    (t) => NATIVE_AUDIO_CODECS.test(t.codec) || (ac3Ok && HARDWARE_AUDIO_CODECS.test(t.codec))
  );
}

/**
 * videoNeedsHevcSupport — ¿el video REAL del archivo exige soporte HEVC para
 * reproducirse directo? Devuelve:
 *   true  → es HEVC/H265 (solo reproduce directo donde el navegador lo soporte)
 *   false → es H264/AVC (reproduce directo en todos lados)
 *   null  → códec desconocido o ausente → NO cambiar el comportamiento actual
 *           (se sigue con la heurística por nombre, `isX265`)
 *
 * Contraparte de {@link hasNativeDecodableAudio} para el video. Existe por el mismo
 * motivo: el NOMBRE del release miente en las dos direcciones. Caso real medido
 * (2026-08-02, "Sueños de Fuga"): `...1080P-Dual-Lat.mkv` no declara ningún códec y
 * la heurística por nombre lo mandaba a transcodificar, cuando RD reporta que por
 * dentro es h264 + aac — o sea, reproducible directo sin conversión alguna.
 */
/**
 * Codecs de video que NINGUN navegador reproduce de forma nativa. Son formatos de los
 * 2000 que todavia circulan en archivos .avi: MPEG-4 Parte 2 (el DivX/Xvid de la epoca),
 * MPEG-1/2, WMV, VC-1, Theora, RealVideo, Flash.
 *
 * OJO con `mpeg4`: NO es H.264. H.264 es MPEG-4 Parte 10 y se reporta como `h264`. Un
 * `mpeg4` a secas es Parte 2, que el navegador no decodifica.
 */
const UNPLAYABLE_VIDEO_RE = /^(mpeg4|mpeg-4|msmpeg|divx|xvid|mpeg2|mpeg1|mpegvideo|wmv|wmv\d|vc-?1|theora|rv\d|flv|svq)/i;

/**
 * videoCodecUnplayableInBrowser — ¿el video es de un formato que el navegador NO puede
 * reproducir, haya o no soporte HEVC?
 *
 * Caso real "Scrapbook" (2026-10-17): `Scrapbook 2000.avi`, unica copia disponible, con
 * `video: mpeg4 | audio: und1=ac3`. `videoNeedsHevcSupport` solo distingue HEVC de H264
 * y para `mpeg4` devuelve null, asi que el reproductor lo daba por bueno e intentaba
 * reproducirlo directo. En escritorio no se notaba porque el AC3 lo desviaba a
 * conversion; en TV, desde que el AC3 se reproduce directo, el intento llegaba hasta el
 * final y la imagen salia distorsionada.
 *
 * Sin dato de codec devuelve false: no se afirma nada y el comportamiento queda como
 * estaba.
 */
export function videoCodecUnplayableInBrowser(info: MediaInfos): boolean {
  const c = info.videoCodec;
  if (!c) return false;
  return UNPLAYABLE_VIDEO_RE.test(c);
}

export function videoNeedsHevcSupport(info: MediaInfos): boolean | null {
  const c = info.videoCodec;
  if (!c) return null;
  if (/^(hevc|h\.?265|x265)/.test(c)) return true;
  if (/^(h\.?264|avc|x264)/.test(c)) return false;
  return null;
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
 * firstAudioTrackIsSpanish — que idioma va a sonar REALMENTE en reproduccion directa.
 * Es la primera pista del archivo, sin mas. Devuelve null si no hay datos de pistas,
 * para que el llamador caiga a la heuristica por nombre de siempre.
 *
 * Existe porque el camino directo informaba el idioma leyendo el NOMBRE del archivo
 * (`isDualLatFilename`). Con `...ENG.LATINO.HINDI...` el nombre decia que habia
 * latino, el panel mostraba "Audio: Español" y se apagaban los subtitulos, mientras
 * sonaba ingles. El nombre describe el archivo; no dice que pista suena.
 */
export function firstAudioTrackIsSpanish(info: MediaInfos): boolean | null {
  if (!info.audio.length) return null;
  return isSpanishTrack(info.audio[0]);
}

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
