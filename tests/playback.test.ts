import { describe, test, expect } from 'vitest';
import {
  detectHevcSupport,
  checkBadAudioForDirectPlay,
  buildSpanishTrackUrl,
  buildDashBaseUrl,
  buildLoadingMessageTimeline,
  messageAtElapsed,
  isDashManifest,
  applyTranscodeQuality,
  TRANSCODE_QUALITY,
  SPANISH_TRACK_CANDIDATES,
  MIN_VALID_DURATION_SEC,
  PLAYBACK_STARTED_THRESHOLD_SEC,
  pickPreferredAudioTrack,
  applyPreferredAudioTrack,
} from '../src/services/playback';

describe('applyTranscodeQuality — pedir transcode en 720p (seek fluido)', () => {
  test('cambia full.mpd → 720p en DASH', () => {
    const url = 'https://28.stream.real-debrid.com/t/ID/spa1/none/aac/full.mpd';
    expect(applyTranscodeQuality(url)).toBe(`https://28.stream.real-debrid.com/t/ID/spa1/none/aac/${TRANSCODE_QUALITY}.mpd`);
  });
  test('cambia full.m3u8 → 720p en HLS', () => {
    const url = 'https://28.stream.real-debrid.com/t/ID/eng1/none/aac/full.m3u8';
    expect(applyTranscodeQuality(url)).toContain(`${TRANSCODE_QUALITY}.m3u8`);
  });
  test('URL que NO es de transcode RD → intacta (no-op seguro)', () => {
    const direct = 'https://torrentio.strem.fun/resolve/realdebrid/abc/hash/null/0/Movie.mp4';
    expect(applyTranscodeQuality(direct)).toBe(direct);
  });
});

describe('detectHevcSupport — soporte HEVC nativo del navegador', () => {
  test('detecta soporte si CUALQUIERA de los 3 mime-types HEVC está soportado', () => {
    const ms = { isTypeSupported: (t: string) => t.includes('hvc1') };
    expect(detectHevcSupport(ms)).toBe(true);
  });
  test('sin soporte si ninguno de los mime-types matchea', () => {
    const ms = { isTypeSupported: () => false };
    expect(detectHevcSupport(ms)).toBe(false);
  });
  test('sin MediaSource (undefined/null) → false', () => {
    expect(detectHevcSupport(undefined)).toBe(false);
    expect(detectHevcSupport(null)).toBe(false);
  });
});

describe('checkBadAudioForDirectPlay — cascada de detección de audio incompatible', () => {
  test('detecta audio explícitamente incompatible (AC3/DTS/TrueHD/Atmos/DD5.1/MP2/etc.)', () => {
    expect(checkBadAudioForDirectPlay('Movie.AC3.mkv', false).hasBadAudioExplicit).toBe(true);
    expect(checkBadAudioForDirectPlay('Movie.DTS-HD.mkv', false).hasBadAudioExplicit).toBe(true);
    expect(checkBadAudioForDirectPlay('Movie.DD5.1.mkv', false).hasBadAudioExplicit).toBe(true);
    expect(checkBadAudioForDirectPlay('Movie.MP2.mkv', false).hasBadAudioExplicit).toBe(true);
    expect(checkBadAudioForDirectPlay('Movie.AAC.mkv', false).hasBadAudioExplicit).toBe(false);
  });

  test('detecta MKV sin AAC explícito como riesgo (isMkvNoAac)', () => {
    const r = checkBadAudioForDirectPlay('Movie.2020.1080p.mkv', false);
    expect(r.isMkvNoAac).toBe(true);
    expect(r.hasBadAudioExplicit).toBe(false);
  });

  test('MKV sin AAC + SIN rdId → hasBadAudio false (no hay forma más segura, se intenta directo)', () => {
    const r = checkBadAudioForDirectPlay('Movie.2020.1080p.mkv', false);
    expect(r.hasBadAudio).toBe(false);
  });

  test('MKV sin AAC + CON rdId → hasBadAudio true ("más seguro usar transcode que adivinar")', () => {
    const r = checkBadAudioForDirectPlay('Movie.2020.1080p.mkv', true);
    expect(r.hasBadAudio).toBe(true);
  });

  test('audio explícitamente malo → hasBadAudio true sin importar rdId', () => {
    expect(checkBadAudioForDirectPlay('Movie.AC3.mp4', false).hasBadAudio).toBe(true);
    expect(checkBadAudioForDirectPlay('Movie.AC3.mp4', true).hasBadAudio).toBe(true);
  });

  test('MP4 con AAC explícito → todo limpio, reproducible directo', () => {
    const r = checkBadAudioForDirectPlay('Movie.2020.1080p.AAC.mp4', true);
    expect(r.hasBadAudioExplicit).toBe(false);
    expect(r.isMkvNoAac).toBe(false);
    expect(r.hasBadAudio).toBe(false);
  });

  test('caso Alien: MP4 "Surround" → audio incompatible (no quedar SIN audio en Direct Play)', () => {
    const r = checkBadAudioForDirectPlay('A3 Alien (1979) 1080p Surround.mp4', true);
    expect(r.hasBadAudioExplicit).toBe(true);
    expect(r.hasBadAudio).toBe(true);
  });
});

describe('Probing de pista de audio español en manifest DASH', () => {
  const validBase = 'https://abc123.stream.real-debrid.com/t/XYZ/eng1/none/aac/full.mpd';

  test('SPANISH_TRACK_CANDIDATES preserva el orden exacto de prueba', () => {
    expect(SPANISH_TRACK_CANDIDATES).toEqual(['spa1', 'lat1', 'spa2', 'lat2']);
  });

  test('buildSpanishTrackUrl sustituye el segmento de track por el candidato', () => {
    expect(buildSpanishTrackUrl(validBase, 'spa1')).toBe(
      'https://abc123.stream.real-debrid.com/t/XYZ/spa1/none/aac/full.mpd'
    );
    expect(buildSpanishTrackUrl(validBase, 'lat2')).toBe(
      'https://abc123.stream.real-debrid.com/t/XYZ/lat2/none/aac/full.mpd'
    );
  });

  test('buildSpanishTrackUrl devuelve null si la URL no matchea el patrón esperado (cortar el loop)', () => {
    expect(buildSpanishTrackUrl('https://no-coincide.com/x.mpd', 'spa1')).toBeNull();
  });

  test('buildDashBaseUrl extrae la base "https://X.../t/ID/" para el panel de audio', () => {
    expect(buildDashBaseUrl(validBase)).toBe('https://abc123.stream.real-debrid.com/t/XYZ/');
  });

  test('buildDashBaseUrl devuelve null si no matchea', () => {
    expect(buildDashBaseUrl('https://otra-cosa.com/x.mpd')).toBeNull();
  });
});

describe('Timeline de mensajes de carga durante transcode', () => {
  test('buildLoadingMessageTimeline cambia el mensaje inicial y el de 15s según isBadAudio', () => {
    const bad = buildLoadingMessageTimeline(true);
    const ok = buildLoadingMessageTimeline(false);
    expect(bad[0][1]).toBe('🔊 Convirtiendo audio a formato compatible...');
    expect(ok[0][1]).toBe('📡 Conectando con el servidor...');
    expect(bad[2][1]).toContain('Transcodeando audio AC3 → AAC');
    expect(ok[2][1]).toContain('El servidor está procesando el video');
  });

  test('el resto de los mensajes del timeline son idénticos sin importar isBadAudio', () => {
    const bad = buildLoadingMessageTimeline(true);
    const ok = buildLoadingMessageTimeline(false);
    for (let i = 3; i < bad.length; i++) {
      expect(bad[i]).toEqual(ok[i]);
    }
    expect(bad).toHaveLength(9);
  });

  test('messageAtElapsed devuelve el mensaje vigente según el tiempo transcurrido', () => {
    const timeline = buildLoadingMessageTimeline(false);
    expect(messageAtElapsed(timeline, 0)).toBe('📡 Conectando con el servidor...');
    expect(messageAtElapsed(timeline, 4999)).toBe('📡 Conectando con el servidor...');
    expect(messageAtElapsed(timeline, 5000)).toBe('⏳ Preparando segmentos de video...');
    expect(messageAtElapsed(timeline, 200000)).toContain('3 min');
    expect(messageAtElapsed(timeline, 999999)).toContain('Últimos 30 segundos');
  });

  test('messageAtElapsed antes del primer hito devuelve null', () => {
    const timeline = [[1000, 'mensaje'] as const];
    expect(messageAtElapsed(timeline, 500)).toBeNull();
  });
});

describe('Constantes de umbral preservadas', () => {
  test('MIN_VALID_DURATION_SEC = 35 (descarta manifests/trailers vacíos)', () => {
    expect(MIN_VALID_DURATION_SEC).toBe(35);
  });
  test('PLAYBACK_STARTED_THRESHOLD_SEC = 0.1 (currentTime > 0.1 = "ya arrancó de verdad")', () => {
    expect(PLAYBACK_STARTED_THRESHOLD_SEC).toBe(0.1);
  });
});

describe('isDashManifest — distingue DASH (Shaka) de HLS (hls.js)', () => {
  test('.mpd → DASH', () => {
    expect(isDashManifest('https://x.com/t/full.mpd')).toBe(true);
  });
  test('.m3u8 → no es DASH (HLS)', () => {
    expect(isDashManifest('https://x.com/t/full.m3u8')).toBe(false);
  });
});

// ── Pista de audio en reproduccion directa (2026-10-12) ─────────────────────────
// Comprobado en vivo en un LG webOS: la TV expone `audioTracks` y deja cambiarla.
// Con "Un lugar tranquilo 2" (eng/spa/hin) el audio paso a español manteniendo la
// reproduccion directa, que es lo que permite tener latino SIN convertir.
describe('pickPreferredAudioTrack / applyPreferredAudioTrack', () => {
  const lista = (ts: Array<{ language?: string; label?: string; enabled?: boolean }>) => {
    const arr = ts.map((t) => ({ enabled: !!t.enabled, language: t.language, label: t.label }));
    return Object.assign(arr, { length: arr.length });
  };

  test('caso real "Un lugar tranquilo 2": pista "es" ambigua, el nombre dice LATINO', () => {
    const t = lista([
      { language: 'en', enabled: true },
      { language: 'es' },
      { language: 'hi' },
    ]);
    // El nombre del release (`...ENG.LATINO.HINDI...`) confirma que ese "es" es latino.
    expect(pickPreferredAudioTrack(t, true)).toBe(1);
    expect(applyPreferredAudioTrack(t, true)).toBe(true);
    expect(t[1].enabled).toBe(true);
    expect(t[0].enabled).toBe(false);
  });

  test('pista "es" ambigua SIN señal de latino en el nombre: no se activa', () => {
    const t = lista([
      { language: 'en', enabled: true },
      { language: 'es' },
    ]);
    expect(pickPreferredAudioTrack(t)).toBe(-1);
    expect(applyPreferredAudioTrack(t)).toBe(false);
    expect(t[0].enabled).toBe(true); // queda ingles, con subtitulos
  });

  test('castellano de España NUNCA se activa, ni con señal en el nombre', () => {
    const t = lista([
      { language: 'en', enabled: true },
      { language: 'es', label: 'Castellano' },
    ]);
    expect(pickPreferredAudioTrack(t, true)).toBe(-1);
    expect(applyPreferredAudioTrack(t, true)).toBe(false);
    expect(t[0].enabled).toBe(true);
  });

  test('si el castellano ya venia activo, se informa como NO español', () => {
    const t = lista([
      { language: 'en' },
      { language: 'es', label: 'Castellano', enabled: true },
    ]);
    expect(applyPreferredAudioTrack(t, true)).toBe(false); // subtitulos encendidos
  });

  test('con latino Y español, gana el latino', () => {
    const t = lista([
      { language: 'en', enabled: true },
      { language: 'es', label: 'Castellano' },
      { language: 'es', label: 'Latino' },
    ]);
    expect(pickPreferredAudioTrack(t)).toBe(2);
  });

  test('una sola pista: no se toca nada', () => {
    const t = lista([{ language: 'en', enabled: true }]);
    expect(pickPreferredAudioTrack(t)).toBe(-1);
    expect(applyPreferredAudioTrack(t)).toBe(false);
    expect(t[0].enabled).toBe(true);
  });

  test('sin pista en español: no se toca y se informa que no es español', () => {
    const t = lista([
      { language: 'en', enabled: true },
      { language: 'it' },
    ]);
    expect(pickPreferredAudioTrack(t)).toBe(-1);
    expect(applyPreferredAudioTrack(t)).toBe(false);
    expect(t[0].enabled).toBe(true);
  });

  test('el latino ya esta activo: no se reescribe, pero se informa que si', () => {
    const t = lista([
      { language: 'en' },
      { language: 'es', label: 'Latino', enabled: true },
    ]);
    expect(pickPreferredAudioTrack(t)).toBe(-1);
    expect(applyPreferredAudioTrack(t)).toBe(true);
  });

  test('sin lista no rompe', () => {
    expect(pickPreferredAudioTrack(null)).toBe(-1);
    expect(applyPreferredAudioTrack(undefined)).toBe(false);
  });
});
