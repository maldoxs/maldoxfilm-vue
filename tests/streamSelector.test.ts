import { describe, test, expect } from 'vitest';
import {
  scoreStream,
  rankStreams,
  selectBestStream,
  hasBadAudio,
  hasAAC,
  hasH264,
  hasSpa,
  hasBadLang,
  isX265,
  pickFallbackUrl,
  matchInDownloads,
  resolveActiveStream,
  buildSelectedStream,
  isJunkStream,
  isJunkMatch,
  MIN_VALID_FILE_BYTES,
} from '../src/services/streamSelector';
import type { TorrentioStream, RDDownload } from '../src/types';

// Helper para crear streams de prueba con forma realista de Torrentio
const stream = (over: Partial<TorrentioStream>): TorrentioStream => ({
  name: 'RD',
  title: '',
  url: 'https://example.com/resolve/realdebrid/abc/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/file.mkv',
  ...over,
});

describe('"El Padrino" — debe elegir H264+AAC sobre AC3', () => {
  // Caso real documentado: hay un release con mejor calidad (AC3 5.1, más GB)
  // pero con audio incompatible con reproducción nativa, y otro con
  // H264 + AAC que SÍ reproduce nativamente — el segundo debe ganar.
  const ac3Release = stream({
    title: 'El Padrino 1972 1080p BluRay x264 AC3 5.1 Spanish 💾 12.4 GB',
    behaviorHints: { filename: 'El.Padrino.1972.1080p.BluRay.x264.AC3.5.1-GROUP.mkv' },
  });
  const aacRelease = stream({
    title: 'El Padrino (1972) 1080p H264 AAC Spanish 💾 3.1 GB',
    behaviorHints: { filename: 'El.Padrino.1972.1080p.H264.AAC-RARBG.mkv' },
  });
  const streams = [ac3Release, aacRelease];

  test('detecta el release AC3 como audio incompatible', () => {
    expect(hasBadAudio(ac3Release)).toBe(true);
    expect(hasBadAudio(aacRelease)).toBe(false);
  });

  test('el release H264+AAC obtiene más puntaje (gana tamaño + AAC + H264)', () => {
    const ptsAac = scoreStream(aacRelease);
    const ptsAc3 = scoreStream(ac3Release);
    expect(ptsAac).toBeGreaterThan(ptsAc3);
  });

  test('selectBestStream elige el release H264+AAC ("AAC-RARBG")', () => {
    const { best } = selectBestStream(streams);
    expect(best?.behaviorHints?.filename).toContain('AAC-RARBG');
  });

  test('rankStreams pone primero el de mayor puntaje', () => {
    const { pool } = rankStreams(streams);
    expect(pool[0].s.behaviorHints?.filename).toContain('AAC-RARBG');
  });
});

describe('"Alien" — idiomas mixtos / mal etiquetados', () => {
  const spaRelease = stream({
    title: 'Alien 1979 1080p BluRay x264 AAC Spanish Latino 💾 4.2 GB',
    behaviorHints: { filename: 'Alien.1979.1080p.BluRay.x264.Latino.mkv' },
  });
  const itaOnlyRelease = stream({
    title: 'Alien 1979 1080p BluRay x264 ITA AC3 💾 6.0 GB',
    behaviorHints: { filename: 'Alien.1979.1080p.ITA.mkv' },
  });
  const dualRelease = stream({
    title: 'Alien 1979 1080p BluRay x264 ITA ENG AAC 💾 5.5 GB',
    behaviorHints: { filename: 'Alien.1979.1080p.Dual.ITA.ENG.mkv' },
  });

  test('release solo-italiano se marca como idioma malo (descartable)', () => {
    expect(hasBadLang(itaOnlyRelease)).toBe(true);
  });

  test('release dual ITA+ENG NO se descarta (acompaña ENG)', () => {
    expect(hasBadLang(dualRelease)).toBe(false);
  });

  test('scoreStream descarta el release solo-italiano (descarte fuerte)', () => {
    expect(scoreStream(itaOnlyRelease)).toBe(-10000);
  });

  test('selectBestStream prioriza el release en español sobre el dual/italiano', () => {
    const { best } = selectBestStream([itaOnlyRelease, dualRelease, spaRelease]);
    expect(hasSpa(best!)).toBe(true);
  });

  test('rankStreams filtra los streams con pts <= -500 del listado "scored"', () => {
    const { scored } = rankStreams([itaOnlyRelease, dualRelease, spaRelease]);
    expect(scored.find((x) => x.s === itaOnlyRelease)).toBeUndefined();
  });

  test('si TODOS son descartables, el pool cae a la lista completa con pts=0 (siempre reproducir algo)', () => {
    const onlyBad1 = stream({ title: 'Alien ITA only 💾 4 GB', behaviorHints: { filename: 'a.ita.mkv' } });
    const onlyBad2 = stream({ title: 'Alien KOR only 💾 4 GB', behaviorHints: { filename: 'a.kor.mkv' } });
    const { pool, scored } = rankStreams([onlyBad1, onlyBad2]);
    expect(scored.length).toBe(0);
    expect(pool.length).toBe(2);
    expect(pool[0].pts).toBe(0);
  });
});

describe('"Punisher" — detecta audio AC3/DTS incompatible y busca alternativa reproducible', () => {
  test('hasBadAudio detecta AC3, DTS, TrueHD, Atmos, DD+, FLAC, PCM', () => {
    expect(hasBadAudio(stream({ title: 'x AC3 5.1' }))).toBe(true);
    expect(hasBadAudio(stream({ title: 'x DTS-HD MA' }))).toBe(true);
    expect(hasBadAudio(stream({ title: 'x TrueHD 7.1' }))).toBe(true);
    expect(hasBadAudio(stream({ title: 'x Atmos' }))).toBe(true);
    // ⚠️ "DDP5.1" (sin '+' ni dígito pegado a "dd") NO matchea `\bdd[\d\+]` ni
    // `\bddp\b` en el original (`_badAudioCheck`, índex.html línea ~4883) — es
    // un punto ciego conocido del regex original que NO se debe "arreglar" en
    // la migración (preservar 1:1). "DD+5.1" sí matchea vía `\bdd[\d\+]` (el '+').
    expect(hasBadAudio(stream({ title: 'x DD+5.1' }))).toBe(true);
    expect(hasBadAudio(stream({ title: 'x FLAC' }))).toBe(true);
    expect(hasBadAudio(stream({ title: 'x AAC 2.0' }))).toBe(false);
  });

  test('resolveActiveStream: sin match directo y audio incompatible, busca alternativa en "scored" (ronda 3)', () => {
    // El release con DTS gana el scoring (H264 + 1080p + poco peso + RD = 128 pts)
    // aunque su audio sea incompatible — scoreStream no penaliza el audio,
    // por eso resolveActiveStream necesita su propia ronda de alternativas.
    const ac3Best = stream({
      url: 'https://example.com/a',
      title: 'The Punisher 2017 1080p BluRay x264 DTS 5.1 💾 4 GB',
      behaviorHints: { filename: 'Punisher.2017.1080p.x264.DTS.mkv' },
    });
    // El release AAC pesa menos en puntaje (720p + más GB) pero SÍ es
    // reproducible nativamente y tiene match en `downloads` de RD.
    const aacAlt = stream({
      url: 'https://example.com/b',
      title: 'The Punisher 2017 720p WEB-DL AAC 💾 8 GB',
      behaviorHints: { filename: 'Punisher.2017.AAC.mkv' },
    });
    const downloads: RDDownload[] = [
      { id: 'rd-aac-1', download: 'https://real-debrid.com/d/aac1', filename: 'Punisher.2017.AAC.mkv', filesize: 3_000_000_000 },
    ];
    const { scored, pool } = rankStreams([ac3Best, aacAlt]);
    const result = resolveActiveStream(
      ac3Best,
      ac3Best.url!,
      'Punisher.2017.DTS.mkv',
      pool,
      scored,
      downloads
    );
    // No había match para el DTS, pero sí para el AAC -> debe adoptarlo como activo
    expect(result.rdId).toBe('rd-aac-1');
    expect(result.activeFilename).toBe('Punisher.2017.AAC.mkv');
    expect(hasAAC(result.activeBest)).toBe(true);
  });

  test('matchInDownloads encuentra por URL resuelta, luego por filename, luego por filename sin extensión', () => {
    const downloads: RDDownload[] = [
      { id: '1', download: 'https://real-debrid.com/d/xyz?token=abc', filename: 'Movie.Name.2020.mkv', filesize: 100 },
    ];
    // 1. match por URL (normalizada, sin query string)
    expect(matchInDownloads('https://real-debrid.com/d/xyz', 'orig', null, downloads)?.id).toBe('1');
    // 2. match por filename exacto
    expect(matchInDownloads('nope', 'nope', 'Movie.Name.2020.mkv', downloads)?.id).toBe('1');
    // 3. match por filename sin extensión
    expect(matchInDownloads('nope', 'nope', 'Movie.Name.2020.mp4', downloads)?.id).toBe('1');
  });
});

describe('pickFallbackUrl — Plan B cuando el elegido es x265', () => {
  test('si el best es x265, busca alternativa h264 priorizando RD', () => {
    const x265Best = stream({ url: 'https://e.com/1', name: 'RD', title: 'Movie x265 HEVC' });
    const h264NoRD = stream({ url: 'https://e.com/2', name: 'OtroGrupo', title: 'Movie x264' });
    const h264RD = stream({ url: 'https://e.com/3', name: 'RD', title: 'Movie x264' });
    const fb = pickFallbackUrl(x265Best, [x265Best, h264NoRD, h264RD]);
    expect(fb).toBe('https://e.com/3'); // prioriza RD + h264
  });

  test('si el best NO es x265, no hay fallback (null)', () => {
    const h264Best = stream({ url: 'https://e.com/1', title: 'Movie x264' });
    expect(pickFallbackUrl(h264Best, [h264Best])).toBeNull();
  });

  test('isX265 detecta x265, HEVC y H.265 indistintamente', () => {
    expect(isX265(stream({ title: 'Movie x265' }))).toBe(true);
    expect(isX265(stream({ title: 'Movie HEVC' }))).toBe(true);
    expect(isX265(stream({ title: 'Movie H.265' }))).toBe(true);
    expect(isX265(stream({ title: 'Movie x264' }))).toBe(false);
  });
});

describe('detectores básicos de formato', () => {
  test('hasH264 reconoce h264, h.264 y x264', () => {
    expect(hasH264(stream({ title: 'a H264 b' }))).toBe(true);
    expect(hasH264(stream({ title: 'a H.264 b' }))).toBe(true);
    expect(hasH264(stream({ title: 'a x264 b' }))).toBe(true);
    expect(hasH264(stream({ title: 'a x265 b' }))).toBe(false);
  });

  test('hasSpa reconoce variantes en español', () => {
    expect(hasSpa(stream({ title: 'Spanish' }))).toBe(true);
    expect(hasSpa(stream({ title: 'Castellano' }))).toBe(true);
    expect(hasSpa(stream({ title: 'Latino' }))).toBe(true);
    expect(hasSpa(stream({ title: 'English' }))).toBe(false);
  });
});

describe('Archivo basura — caso "Scary Movie" (no reproducir samples/test)', () => {
  const download = (over: Partial<RDDownload>): RDDownload =>
    ({ id: 'X', filename: 'real.mkv', filesize: 2_000_000_000, download: 'https://cdn/d/X/real.mkv', ...over }) as RDDownload;

  test('isJunkStream detecta sample/trailer/"length test"', () => {
    expect(isJunkStream(stream({ behaviorHints: { filename: '6 - Pec Minor Length Test.mp4' } }))).toBe(true);
    expect(isJunkStream(stream({ title: 'Movie 1080p SAMPLE' }))).toBe(true);
    expect(isJunkStream(stream({ behaviorHints: { filename: 'movie-trailer.mp4' } }))).toBe(true);
    expect(isJunkStream(stream({ behaviorHints: { filename: 'La.Pelicula.1080p.H264.AAC.mkv' } }))).toBe(false);
  });

  test('scoreStream descarta el stream basura (descarte fuerte → fuera del ranking)', () => {
    const junk = stream({ title: 'Movie 1080p H264 AAC Spanish 💾 5 GB', behaviorHints: { filename: '6 - Pec Minor Length Test.mp4' } });
    expect(scoreStream(junk)).toBe(-10000);
    const { scored } = rankStreams([junk]);
    expect(scored).toHaveLength(0); // descartado, no entra al ranking
  });

  test('selectBestStream prefiere la película real sobre el sample', () => {
    const junk = stream({ title: 'Movie SAMPLE 💾 5 GB', behaviorHints: { filename: 'movie.sample.mp4' } });
    const real = stream({ title: 'Movie 1080p H264 AAC Spanish 💾 4 GB', behaviorHints: { filename: 'Movie.1080p.H264.AAC.mkv' } });
    const { best } = selectBestStream([junk, real]);
    expect(best?.behaviorHints?.filename).toBe('Movie.1080p.H264.AAC.mkv');
  });

  test('isJunkMatch: rechaza por tamaño ínfimo y por nombre', () => {
    expect(isJunkMatch(download({ filesize: 7_005_748 }))).toBe(true); // 7 MB
    expect(isJunkMatch(download({ filename: '6 - Pec Minor Length Test.mp4' }))).toBe(true);
    expect(isJunkMatch(download({ filesize: MIN_VALID_FILE_BYTES + 1 }))).toBe(false);
    expect(isJunkMatch(download({}))).toBe(false); // real.mkv 2GB
  });

  test('resolveActiveStream RECHAZA un match basura → rdId null (no reproduce basura)', () => {
    const best = stream({ title: 'Movie 1080p H264 AAC 💾 5 GB', url: 'https://x/resolve/realdebrid/t/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/6%20-%20Pec%20Minor%20Length%20Test.mp4', behaviorHints: { filename: '6 - Pec Minor Length Test.mp4' } });
    const downloads: RDDownload[] = [
      download({ id: 'JUNK', filename: '6 - Pec Minor Length Test.mp4', filesize: 7_005_748, download: best.url! }),
    ];
    const r = resolveActiveStream(best, best.url!, '6 - Pec Minor Length Test.mp4', [{ s: best, pts: 50 }], [{ s: best, pts: 50 }], downloads);
    expect(r.rdId).toBeNull(); // el match basura fue descartado
  });

  test('buildSelectedStream ANULA la URL si el stream final es basura (no se reproduce directo)', () => {
    const junk = stream({ url: 'https://x/sample.mp4', behaviorHints: { filename: 'movie.sample.mp4' } });
    const active = {
      match: undefined,
      activeBest: junk,
      activeUrl: junk.url!,
      activeFilename: 'movie.sample.mp4',
      rdId: null,
      rdDownloadUrl: null,
      rdFilesize: 0,
      unavailableInRd: false,
    };
    const sel = buildSelectedStream({
      best: junk,
      withUrl: [junk],
      resolvedUrl: junk.url!,
      streamFilename: 'movie.sample.mp4',
      infoHash: '',
      imdbId: null,
      active,
    });
    expect(sel.url).toBeNull(); // basura → sin URL → cae a server-side/iframe, nunca reproduce basura
  });
});

describe('Seekabilidad (Fase 1) — MP4+H264 manda sobre MKV/4K', () => {
  const mp4H264 = stream({
    name: 'RD',
    title: 'Movie 2024 1080p WEBRip 💾 2.5 GB',
    behaviorHints: { filename: 'Movie.2024.1080p.x264.AAC.mp4' },
  });
  const mkv4kHevc = stream({
    name: 'RD',
    title: 'Movie 2024 2160p 💾 16 GB',
    behaviorHints: { filename: 'Movie.2024.2160p.HEVC.x265.mkv' },
  });

  test('scoreStream: MP4 H264 (1080p) puntúa MÁS que MKV HEVC 4K — fluidez/seek sobre resolución', () => {
    expect(scoreStream(mp4H264)).toBeGreaterThan(scoreStream(mkv4kHevc));
  });

  test('selectBestStream elige el MP4 H264 aunque el MKV sea 4K', () => {
    const { best } = selectBestStream([mkv4kHevc, mp4H264]);
    expect(best?.behaviorHints?.filename).toContain('.mp4');
  });

  test('en TV el MP4 H264 también gana (HEVC/4K penalizados aún más)', () => {
    expect(scoreStream(mp4H264, true)).toBeGreaterThan(scoreStream(mkv4kHevc, true));
  });
});

describe('Disponibilidad RD — cacheado [RD+] manda sobre no cacheado [RD download]', () => {
  const cachedMkvSpa = stream({
    name: '[RD+] Torrentio',
    title: 'Movie 1080p Dual 💾 3 GB',
    behaviorHints: { filename: 'Movie.2026.1080p-Dual-Lat.mkv' },
  });
  const uncachedMp4Eng = stream({
    name: '[RD download] Torrentio',
    title: 'Movie 720p 💾 1.2 GB',
    behaviorHints: { filename: 'Movie.2026.720p.x264.AAC.mp4' },
  });

  test('una MKV CACHEADA (lista para stream) puntúa más que un MP4 NO cacheado', () => {
    expect(scoreStream(cachedMkvSpa)).toBeGreaterThan(scoreStream(uncachedMp4Eng));
  });

  test('selectBestStream elige la versión cacheada (no deja la peli "afuera")', () => {
    const { best } = selectBestStream([uncachedMp4Eng, cachedMkvSpa]);
    expect(best?.name).toContain('[RD+]');
  });
});
