/**
 * rd-t-pipeline — cliente del pipeline /t/ de Real-Debrid.
 *
 * Llama a la Netlify function `rd-tpipeline` (server-side) que resuelve
 * mediaId, CDN, audio tracks, y construye URLs de MPD/seek. El token RD
 * nunca llega al navegador.
 *
 * Flujo: resolve(rdId) → { mediaId, fullPathId, cdn, audioTracks, duration }
 *        → pingSeek(mediaId, seconds) → waitForSegmentAt(...) → buildMpdUrl(...)
 */

const FUNCTION_BASE = '/.netlify/functions/rd-tpipeline';

export interface TpipelineAudioTrack {
  id: string;
  lang: string;
  iso: string;
  codec: string;
  channels?: number;
}

export interface TpipelineResolveResult {
  mediaId: string;
  fullPathId: string;
  cdn: string;
  modelUrl: string;
  duration: number;
  audioTracks: TpipelineAudioTrack[];
  filename: string;
}

async function callFunction(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${FUNCTION_BASE}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
}

export async function resolveTpipeline(rdId: string): Promise<TpipelineResolveResult> {
  return (await callFunction({ action: 'resolve', rdId })) as TpipelineResolveResult;
}

/**
 * resolveRawToRdId — para títulos sin rdId (no matcheados en /downloads): sigue
 * el link CRUDO de Torrentio server-side y devuelve el download id de RD (o null).
 * Con ese id se puede correr el pipeline `/t/` (AAC), igual que el reproductor
 * oficial de RD. Ver `handleResolveRaw` en netlify/functions/rd-tpipeline.js.
 */
export async function resolveRawToRdId(rawUrl: string): Promise<string | null> {
  try {
    const data = (await callFunction({ action: 'resolveRaw', url: rawUrl })) as { rdId?: string | null };
    return data.rdId ?? null;
  } catch {
    return null;
  }
}

export async function pingSeek(mediaId: string, seconds: number): Promise<boolean> {
  const data = (await callFunction({
    action: 'seek',
    mediaId,
    seconds: String(Math.floor(seconds)),
  })) as { ok: boolean };
  return data.ok;
}

export function buildMpdUrl(fullPathId: string, cdn: string, audio: string, t: number): string {
  return `https://${cdn}/t/${fullPathId}/${audio}/none/aac/full.mpd?t=${Math.floor(t)}`;
}

/**
 * waitForSegmentAt — polling HEAD al CDN hasta que el primer segmento exista.
 * Cuando se carga `full.mpd?t=X`, RD reinicia el timeline: el primer segmento
 * es siempre `video-1.m4s` (relativo al `?t=`), NO `video-{X/5}.m4s` (absoluto).
 * Chequear el segmento absoluto daba timeout siempre → 8s de demora innecesaria.
 */
export async function waitForSegmentAt(
  cdn: string,
  fullPathId: string,
  audio: string,
  _t: number,
  maxWait = 5000
): Promise<boolean> {
  const url = `https://${cdn}/t/${fullPathId}/${audio}/none/aac/video-1.m4s`;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    // AbortController + setTimeout en vez de `AbortSignal.timeout(2000)`: esta última
    // NO existe en navegadores viejos (p.ej. webOS de smart-TV) → lanzaba
    // "AbortSignal.timeout is not a function", haciendo fallar TODO el resolve de /t/
    // y cayendo al transcode (seek lento) SOLO en TV. AbortController sí es universal.
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    try {
      const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
      if (r.ok) return true;
    } catch {
      // retry
    } finally {
      clearTimeout(tid);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * pickBestAudio — elige la pista de audio del pipeline /t/.
 * Preferencia: latino > español > inglés > primera disponible.
 */
export function pickBestAudio(tracks: TpipelineAudioTrack[]): string {
  const latino = tracks.find(
    (t) => /lat/i.test(t.id) || /latino|latin/i.test(t.lang)
  );
  if (latino) return latino.id;

  const spanish = tracks.find(
    (t) => /^(spa|es)/i.test(t.iso) || /spanish|español/i.test(t.lang)
  );
  if (spanish) return spanish.id;

  const english = tracks.find(
    (t) => /^eng/i.test(t.iso) || /english/i.test(t.lang)
  );
  if (english) return english.id;

  return tracks[0]?.id || 'eng1';
}
