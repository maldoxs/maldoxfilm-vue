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
