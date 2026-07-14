import { describe, test, expect } from 'vitest';
import {
  tsToMs,
  msToVttTs,
  srtToVtt,
  parseSrt,
  findActiveCue,
  buildOffsetStorageKey,
  buildSubImdbId,
  deriveVideoHints,
  scoreSubtitle,
  pickBestSubtitle,
  isSubtitleValid,
  buildReleaseName,
  numericImdbId,
} from '../src/services/subtitles';
import type { OpenSubtitle } from '../src/types';

const sub = (over: Partial<OpenSubtitle['attributes']>): OpenSubtitle => ({
  attributes: {
    release: '',
    language: 'es',
    fps: 0,
    hd: false,
    ai_translated: false,
    from_trusted: false,
    files: [{ file_id: 1 }],
    ...over,
  },
});

describe('Conversión de timestamps SRT ↔ ms ↔ VTT', () => {
  test('tsToMs convierte HH:MM:SS,mmm a milisegundos', () => {
    expect(tsToMs('00:00:01,500')).toBe(1500);
    expect(tsToMs('01:02:03,004')).toBe(3723004);
    expect(tsToMs('00:00:00,000')).toBe(0);
  });

  test('tsToMs también acepta el separador con punto (formato VTT)', () => {
    expect(tsToMs('00:00:01.500')).toBe(1500);
  });

  test('msToVttTs formatea ms a HH:MM:SS.mmm con padding', () => {
    expect(msToVttTs(1500)).toBe('00:00:01.500');
    expect(msToVttTs(3723004)).toBe('01:02:03.004');
    expect(msToVttTs(0)).toBe('00:00:00.000');
  });

  test('msToVttTs nunca devuelve negativos (clamp a 0)', () => {
    expect(msToVttTs(-500)).toBe('00:00:00.000');
  });

  test('srtToVtt agrega cabecera WEBVTT y aplica el offset a cada rango de tiempo', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHola\n';
    const vtt = srtToVtt(srt, 500);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:01.500 --> 00:00:02.500');
  });

  test('srtToVtt soporta offsets negativos', () => {
    const srt = '00:00:05,000 --> 00:00:06,000';
    const vtt = srtToVtt(srt, -2000);
    expect(vtt).toContain('00:00:03.000 --> 00:00:04.000');
  });
});

describe('parseSrt — parseo de bloques SRT a cues', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    'Primera línea',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    '<i>Segunda</i> línea\ncon salto',
    '',
  ].join('\n');

  test('produce cues con offset aplicado y limpia tags HTML', () => {
    const cues = parseSrt(srt, 1000);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ s: 2000, e: 4000, text: 'Primera línea' });
    expect(cues[1].text).toBe('Segunda línea\ncon salto'); // sin <i></i>
    expect(cues[1].s).toBe(5000);
  });

  test('descarta bloques sin línea de tiempos o sin texto', () => {
    const broken = '1\nsolo texto sin timestamp\n\n2\n00:00:01,000 --> 00:00:02,000\n';
    expect(parseSrt(broken, 0)).toHaveLength(0);
  });

  test('normaliza CRLF/CR a LF antes de parsear', () => {
    const crlf = srt.replace(/\n/g, '\r\n');
    expect(parseSrt(crlf, 0)).toHaveLength(2);
  });
});

describe('findActiveCue', () => {
  const cues = [
    { s: 1000, e: 2000, text: 'A' },
    { s: 3000, e: 4000, text: 'B' },
  ];
  test('devuelve el cue cuyo rango contiene el tiempo actual', () => {
    expect(findActiveCue(cues, 1500)?.text).toBe('A');
    expect(findActiveCue(cues, 3500)?.text).toBe('B');
  });
  test('devuelve undefined si no hay cue activo en ese momento', () => {
    expect(findActiveCue(cues, 2500)).toBeUndefined();
  });
});

describe('Claves de identificación / crowdsourcing de offset', () => {
  test('buildSubImdbId prioriza infoHash > streamFilename > imdbId', () => {
    expect(buildSubImdbId('abc123', 'file.mkv', 'tt0000001')).toBe('abc123');
    expect(buildSubImdbId(null, 'file.mkv', 'tt0000001')).toBe('file.mkv');
    expect(buildSubImdbId(null, null, 'tt0000001')).toBe('tt0000001');
  });

  test('buildOffsetStorageKey usa infoHash si existe (clave más estable)', () => {
    expect(buildOffsetStorageKey('abc123def', 'Movie.2020.mkv', 'tt0000001')).toBe('sub_off_abc123def');
  });

  test('buildOffsetStorageKey cae a streamFilename sin extensión si no hay infoHash', () => {
    expect(buildOffsetStorageKey(null, 'Movie.2020.mkv', 'tt0000001')).toBe('sub_off_Movie.2020');
  });

  test('buildOffsetStorageKey cae a imdbId si no hay infoHash ni filename', () => {
    expect(buildOffsetStorageKey(null, null, 'tt0000001')).toBe('sub_off_tt0000001');
  });
});

describe('deriveVideoHints — pistas del filename del video', () => {
  test('detecta calidad, grupo, origen (Bluray/WebDL) y tipo de corte', () => {
    const h = deriveVideoHints('The.Movie.2020.1080p.BluRay.x264-RARBG.mkv');
    expect(h.qualHint).toBe('1080p');
    expect(h.groupHint).toBe('rarbg');
    expect(h.vidBluray).toBe(true);
    expect(h.vidWebDl).toBe(false);
  });

  test('detecta WEB-DL y Director\'s Cut / Extended', () => {
    const h1 = deriveVideoHints('Movie.2020.720p.WEB-DL.DC.mkv');
    expect(h1.vidWebDl).toBe(true);
    expect(h1.vidIsDC).toBe(true);

    const h2 = deriveVideoHints('Movie.2020.Extended.Cut.1080p.mkv');
    expect(h2.vidIsExtend).toBe(true);
  });

  test('con filename vacío/null devuelve hints neutros', () => {
    const h = deriveVideoHints(null);
    expect(h.qualHint).toBe('');
    expect(h.groupHint).toBe('');
    expect(h.vidBluray).toBe(false);
  });
});

describe('scoreSubtitle / pickBestSubtitle — selección del mejor subtítulo', () => {
  const hints = deriveVideoHints('The.Movie.2020.1080p.BluRay.x264-RARBG.mkv');

  test('favorece coincidencia de calidad, grupo, origen y popularidad', () => {
    const goodMatch = sub({
      release: 'The.Movie.2020.1080p.BluRay.x264-RARBG',
      hd: true,
      from_trusted: true,
      fps: 23.976,
      download_count: 60000,
    });
    const poorMatch = sub({
      release: 'The.Movie.2020.480p.CAM',
      hd: false,
      ai_translated: true,
      fps: 25,
      download_count: 10,
    });
    expect(scoreSubtitle(goodMatch, hints)).toBeGreaterThan(scoreSubtitle(poorMatch, hints));
  });

  test('penaliza traducciones IA y FPS de 25 (probable PAL, video es 23.976)', () => {
    const ai25 = sub({ release: 'x', ai_translated: true, fps: 25 });
    const human24 = sub({ release: 'x', ai_translated: false, fps: 23.976 });
    expect(scoreSubtitle(human24, hints)).toBeGreaterThan(scoreSubtitle(ai25, hints));
  });

  test('penaliza idiomas sospechosos (-ITA/French/German) en el release', () => {
    const suspicious = sub({ release: 'Movie.2020.FRENCH.1080p' });
    const clean = sub({ release: 'Movie.2020.SPANiSH.1080p' });
    expect(scoreSubtitle(clean, hints)).toBeGreaterThan(scoreSubtitle(suspicious, hints));
  });

  test('pickBestSubtitle elige el de mayor puntaje y devuelve su file_id', () => {
    const low = sub({ release: 'Movie.CAM.480p', files: [{ file_id: 11 }], download_count: 5 });
    const high = sub({
      release: 'The.Movie.2020.1080p.BluRay.x264-RARBG',
      hd: true,
      from_trusted: true,
      download_count: 80000,
      files: [{ file_id: 99 }],
    });
    const { best, fileId } = pickBestSubtitle([low, high], hints);
    expect(fileId).toBe(99);
    expect(best?.attributes.release).toContain('RARBG');
  });

  test('pickBestSubtitle devuelve fileId null si el mejor candidato no tiene archivos', () => {
    const noFiles = sub({ release: 'x', files: [] });
    const { fileId } = pickBestSubtitle([noFiles], hints);
    expect(fileId).toBeNull();
  });
});

describe('Helpers de búsqueda (release name / IMDB numérico / validación de cues)', () => {
  test('buildReleaseName quita la extensión del archivo', () => {
    expect(buildReleaseName('Movie.2020.1080p.mkv')).toBe('Movie.2020.1080p');
    expect(buildReleaseName(null)).toBe('');
  });

  test('numericImdbId quita el prefijo "tt"', () => {
    expect(numericImdbId('tt1234567')).toBe('1234567');
    expect(numericImdbId('TT1234567')).toBe('1234567');
    expect(numericImdbId(null)).toBe('');
  });

  test('isSubtitleValid exige un mínimo de 100 cues (descarta .srt truncados)', () => {
    const few = Array.from({ length: 50 }, (_, i) => ({ s: i * 1000, e: i * 1000 + 500, text: 't' }));
    const many = Array.from({ length: 120 }, (_, i) => ({ s: i * 1000, e: i * 1000 + 500, text: 't' }));
    expect(isSubtitleValid(few)).toBe(false);
    expect(isSubtitleValid(many)).toBe(true);
  });
});

// ── ADR-009 fix 2 — piso de confianza + verificación IMDB ────────────────────
import {
  imdbVerdict,
  filterTrustworthySubtitles,
  MIN_SUBTITLE_CONFIDENCE,
} from '../src/services/subtitles';

describe('imdbVerdict / filterTrustworthySubtitles — nunca un sub de OTRA película', () => {
  const hints = deriveVideoHints('The.Movie.2020.1080p.BluRay.x264-GROUP.mkv');

  test('mismatch: feature_details con imdb distinto → descarte duro (aunque el score sea alto)', () => {
    const ajeno = sub({
      release: 'Maze.Runner.The.Death.Cure.2018.1080p.BluRay',
      from_trusted: true,
      download_count: 100000,
      feature_details: { imdb_id: 4500922 },
    });
    expect(imdbVerdict(ajeno, '1234567')).toBe('mismatch');
    const r = filterTrustworthySubtitles([ajeno], '1234567', hints);
    expect(r.kept).toHaveLength(0);
    expect(r.mismatches).toBe(1);
  });

  test('match por imdb_id o parent_imdb_id (series) → se conserva SIN piso (AI incluido)', () => {
    const aiVerificado = sub({ ai_translated: true, feature_details: { imdb_id: 1234567 } });
    const episodio = sub({ ai_translated: true, feature_details: { imdb_id: 999, parent_imdb_id: 1234567 } });
    expect(imdbVerdict(aiVerificado, '1234567')).toBe('match');
    expect(imdbVerdict(episodio, '1234567')).toBe('match');
    // Comportamiento documentado preservado: el AI verificado sigue siendo elegible
    // aunque su score sea negativo (-8 por AI).
    const r = filterTrustworthySubtitles([aiVerificado, episodio], '1234567', hints);
    expect(r.kept).toHaveLength(2);
  });

  test('unverifiable: sin feature_details o sin imdb nuestro → exige el piso de score', () => {
    const bueno = sub({ release: 'The.Movie.2020.1080p.BluRay.x264-GROUP', from_trusted: true, download_count: 20000 });
    const dudoso = sub({ ai_translated: true, fps: 25 }); // score muy bajo, no verificable
    expect(imdbVerdict(bueno, '')).toBe('unverifiable');
    expect(imdbVerdict(dudoso, '1234567')).toBe('unverifiable');
    expect(scoreSubtitle(bueno, hints)).toBeGreaterThanOrEqual(MIN_SUBTITLE_CONFIDENCE);
    expect(scoreSubtitle(dudoso, hints)).toBeLessThan(MIN_SUBTITLE_CONFIDENCE);
    const r = filterTrustworthySubtitles([bueno, dudoso], '1234567', hints);
    expect(r.kept).toHaveLength(1);
    expect(r.lowConfidence).toBe(1);
  });

  test('feature_details vacío (sin ids) cuenta como unverifiable, no como mismatch', () => {
    const s = sub({ from_trusted: true, download_count: 20000, feature_details: {} });
    expect(imdbVerdict(s, '1234567')).toBe('unverifiable');
  });
});
