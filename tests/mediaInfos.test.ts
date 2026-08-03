import { describe, test, expect } from 'vitest';
import { parseMediaInfos, pickSpanishAudioToken, pickSpanishSubToken } from '../src/services/mediaInfos';

// Forma REAL observada en vivo (La Momia Dr4gon): solo ita/eng, sin español.
const momiaRaw = {
  duration: 10528.145,
  details: {
    video: { codec: 'h264' },
    audio: {
      ita1: { stream: '0:1', lang: 'Italian', lang_iso: 'ita', codec: 'ac3', channels: 5.1 },
      eng1: { stream: '0:2', lang: 'English', lang_iso: 'eng', codec: 'ac3', channels: 5.1 },
    },
    subtitles: {
      ita1: { stream: '0:3', lang: 'Italian', lang_iso: 'ita', type: 'SRT' },
      eng1: { stream: '0:5', lang: 'English', lang_iso: 'eng', type: 'SRT' },
    },
  },
};

// Dual-Lat con audio español + subtítulo español embebido.
const dualLatRaw = {
  duration: 7200,
  details: {
    video: { codec: 'h264' },
    audio: {
      eng1: { lang: 'English', lang_iso: 'eng', codec: 'aac' },
      lat1: { lang: 'Spanish Latino', lang_iso: 'spa', codec: 'ac3' },
    },
    subtitles: {
      spa1: { lang: 'Spanish', lang_iso: 'spa', type: 'SRT' },
    },
  },
};

describe('parseMediaInfos — normaliza la respuesta de RD', () => {
  test('extrae duración, códec de video y pistas de audio/subs (mapa → lista con token)', () => {
    const info = parseMediaInfos(momiaRaw);
    expect(info.durationSec).toBeCloseTo(10528.145);
    expect(info.videoCodec).toBe('h264');
    expect(info.audio.map((a) => a.token)).toEqual(['ita1', 'eng1']);
    expect(info.audio[1]).toMatchObject({ token: 'eng1', langIso: 'eng', codec: 'ac3' });
    expect(info.subtitles.map((s) => s.token)).toEqual(['ita1', 'eng1']);
  });

  test('tolera entrada vacía / rara sin lanzar', () => {
    expect(parseMediaInfos(null)).toMatchObject({ durationSec: 0, videoCodec: null, audio: [], subtitles: [] });
    expect(parseMediaInfos({ details: { audio: [] } }).audio).toEqual([]);
  });
});

describe('pickSpanishAudioToken — token para pedir el transcode en español', () => {
  test('La Momia (solo ita/eng) → null (no hay audio español en ese archivo)', () => {
    expect(pickSpanishAudioToken(parseMediaInfos(momiaRaw))).toBeNull();
  });

  test('Dual-Lat → devuelve el token de la pista latina', () => {
    expect(pickSpanishAudioToken(parseMediaInfos(dualLatRaw))).toBe('lat1');
  });

  test('prefiere Latino sobre Castellano cuando ambos existen', () => {
    const info = parseMediaInfos({
      details: {
        audio: {
          spa1: { lang: 'Spanish Castellano', lang_iso: 'spa', codec: 'ac3' },
          lat1: { lang: 'Latino', lang_iso: 'spa', codec: 'ac3' },
        },
      },
    });
    expect(pickSpanishAudioToken(info)).toBe('lat1');
  });
});

describe('pickSpanishSubToken — subtítulo español embebido del propio archivo', () => {
  test('Dual-Lat tiene sub español → su token', () => {
    expect(pickSpanishSubToken(parseMediaInfos(dualLatRaw))).toBe('spa1');
  });
  test('La Momia (ita/eng) → null (sin sub español embebido)', () => {
    expect(pickSpanishSubToken(parseMediaInfos(momiaRaw))).toBeNull();
  });
});

// ── ADR-009 fix 3 — audio real antes de Direct Play ─────────────────────────
import { hasNativeDecodableAudio, videoNeedsHevcSupport } from '../src/services/mediaInfos';

describe('hasNativeDecodableAudio — ¿el navegador puede decodificar el audio nativo?', () => {
  const infoWith = (codecs: string[]) =>
    parseMediaInfos({
      details: {
        audio: Object.fromEntries(codecs.map((c, i) => [`t${i}`, { lang: 'x', lang_iso: 'x', codec: c }])),
      },
    });

  test('caso real "El Padrino": Latin(ac3) + English(ac3) → false (Direct Play sería mudo en desktop)', () => {
    expect(hasNativeDecodableAudio(infoWith(['ac3', 'ac3']))).toBe(false);
  });

  test('al menos una pista AAC/MP3 → true (aunque acompañe un AC3)', () => {
    expect(hasNativeDecodableAudio(infoWith(['ac3', 'aac']))).toBe(true);
    expect(hasNativeDecodableAudio(infoWith(['mp3']))).toBe(true);
    expect(hasNativeDecodableAudio(infoWith(['mp4a.40.2']))).toBe(true);
  });

  test('DTS/EAC3/TrueHD sin pista nativa → false', () => {
    expect(hasNativeDecodableAudio(infoWith(['dts', 'eac3', 'truehd']))).toBe(false);
  });

  test('sin pistas parseadas → null (no cambiar el comportamiento por nombre)', () => {
    expect(hasNativeDecodableAudio(parseMediaInfos(null))).toBeNull();
    expect(hasNativeDecodableAudio(parseMediaInfos({ details: {} }))).toBeNull();
  });
});

// ── videoNeedsHevcSupport — el códec REAL del video decide, no el nombre ──────────
// Caso real medido el 2026-08-02 ("Sueños de Fuga"): el release
// `Sueños.De.Fuga.1994.1080P-Dual-Lat.mkv` no declara NINGÚN códec en su nombre, así
// que la heurística lo trataba como incompatible y lo mandaba a transcodificar. La
// respuesta real de RD para ese archivo (verificada contra la API) es h264 + aac: se
// podía reproducir directo, sin conversión y sin cortes.
describe('videoNeedsHevcSupport — ¿el video real exige soporte HEVC?', () => {
  const conVideo = (codec: unknown) => parseMediaInfos({ details: { video: { codec } } });

  test('h264/avc → false (reproduce directo en cualquier navegador)', () => {
    expect(videoNeedsHevcSupport(conVideo('h264'))).toBe(false);
    expect(videoNeedsHevcSupport(conVideo('H264'))).toBe(false);
    expect(videoNeedsHevcSupport(conVideo('avc1'))).toBe(false);
    expect(videoNeedsHevcSupport(conVideo('x264'))).toBe(false);
  });

  test('hevc/h265 → true (solo directo donde haya soporte)', () => {
    expect(videoNeedsHevcSupport(conVideo('hevc'))).toBe(true);
    expect(videoNeedsHevcSupport(conVideo('h265'))).toBe(true);
    expect(videoNeedsHevcSupport(conVideo('x265'))).toBe(true);
  });

  test('códec desconocido o ausente → null (se sigue con la heurística por nombre)', () => {
    expect(videoNeedsHevcSupport(conVideo('av1'))).toBeNull();
    expect(videoNeedsHevcSupport(conVideo(''))).toBeNull();
    expect(videoNeedsHevcSupport(parseMediaInfos({ details: {} }))).toBeNull();
    expect(videoNeedsHevcSupport(parseMediaInfos(null))).toBeNull();
  });

  test('caso REAL "Sueños de Fuga": el .mkv sin códec en el nombre es h264 + aac', () => {
    // Respuesta EXACTA de la API de RD para rdId 65KSIPEY2X37E, copiada tal cual: `video`
    // es un MAPA de pistas, no un objeto plano. Esa forma es la que hacía que el códec
    // saliera "desconocido" antes del fix de `parseMediaInfos`.
    const real = parseMediaInfos({
      duration: 8549.563,
      details: {
        video: {
          und1: { stream: '0:0', lang: 'Unknown', lang_iso: 'und', codec: 'h264', width: 0, height: 0 },
        },
        audio: {
          spa1: { lang: 'Spanish', lang_iso: 'spa', codec: 'aac' },
          eng1: { lang: 'English', lang_iso: 'eng', codec: 'aac' },
        },
      },
    });
    expect(real.videoCodec).toBe('h264'); // antes salía null → "desconocido"
    expect(videoNeedsHevcSupport(real)).toBe(false);
    expect(hasNativeDecodableAudio(real)).toBe(true); // → Direct Play, sin transcodificar
  });
});
