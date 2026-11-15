/**
 * useSubtitles — orquestación del overlay de subtítulos + búsqueda en
 * OpenSubtitles + crowdsourcing de offset.
 *
 * Capa de ORQUESTACIÓN sobre `services/subtitles.ts` (parseo/scoring/keys,
 * ya puro y testeado). Reemplaza el bloque OPENSUBTITLES completo de
 * assets/index.html (líneas ~4922-5359): `_injectSubtitle`,
 * `fetchAndInjectSubtitle`, `_adjustSubOffset`, `_clearSubOverlay`,
 * `_renderSubStatus`.
 *
 * ⚠️ Esta capa toca DOM (overlay que se mueve con fullscreen, eventos
 * `timeupdate`/`seeking`/`seeked`/`fullscreenchange`) y red (OpenSubtitles +
 * Netlify Functions `subhash`/`offset`) — no es testeable con Vitest puro.
 * El "cómo elegir el subtítulo" y "cómo parsear/convertir" SÍ lo es y ya
 * tiene 26 tests en `subtitles.test.ts`; aquí solo se orquesta.
 *
 * GANANCIA REAL vs el original: en Vue, el overlay deja de ser
 * `getElementById('subOverlay')` + `innerHTML` manual — pasa a ser un
 * `<SubtitleOverlay>` reactivo que recibe `activeCue` como prop. Este
 * composable expone exactamente ese dato (`activeCueText`) en vez de pintar
 * HTML — la Fase 4 (componentes UI) solo necesita renderizarlo.
 */

import { ref, shallowRef, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import {
  parseSrt,
  findActiveCue,
  buildOffsetStorageKey,
  buildSubImdbId,
  deriveVideoHints,
  pickBestSubtitle,
  rankSubtitles,
  scoreSubtitle,
  buildReleaseName,
  numericImdbId,
  isSubtitleValid,
  MAX_DOWNLOAD_ATTEMPTS,
  filterTrustworthySubtitles,
  subtitleDurationSec,
  durationLooksMismatched,
  type SubtitleCue,
} from '../services/subtitles';
import { safeStorage } from '../services/safeStorage';
import type { OpenSubtitle } from '../types';

const OS_KEY = 'BkJDwe4rThVSR3XRJ0F4Lhnn5loX6pYl';
const OS_UA = 'MaldoxFilm v1.0';
const OS_BASE = 'https://api.opensubtitles.com/api/v1/subtitles';

export interface UseSubtitlesOptions {
  /** Ref al elemento <video> activo. */
  videoRef: Ref<HTMLVideoElement | null | undefined>;
  /** Inyectable para tests — por defecto `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Override de tiempo (seg). Pipeline /t/: offset + currentTime. */
  timeOverride?: () => number | null;
}

export interface UseSubtitlesReturn {
  /** Texto del cue activo en el `currentTime` actual (o '' si no hay). Reactivo — listo para `<SubtitleOverlay :text="activeCueText" />`. */
  activeCueText: Ref<string>;
  /** Estado para el indicador "🔍 Buscando..." / "✅ ES | offset: Xs" / "❌ Sin subtítulos". */
  status: Ref<string>;
  /** ¿Subtítulos activados? (toggle del usuario). */
  enabled: Ref<boolean>;
  /** Offset actual en ms (positivo = adelantar). */
  offsetMs: Ref<number>;
  /**
   * ¿Ya se cargó un .srt para el stream activo? Preserva el guard `!_subSrtRaw`
   * que usa `spSetSubs`/`spSwitchAudio` (líneas ~4451/~4408) para decidir si
   * vale la pena re-disparar `fetchAndInject` al reactivar subtítulos o cambiar
   * de pista de audio (evita búsquedas duplicadas cuando ya hay un .srt listo).
   */
  hasSubtitleData: Ref<boolean>;
  /** Busca, puntúa, descarga e inyecta el mejor subtítulo ES disponible. */
  fetchAndInject(params: {
    imdbId: string | null;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    streamFilename: string | null;
    infoHash: string | null;
    /** Enlace directo del archivo, para buscar por huella (ver `pedirHuella`). */
    streamUrl?: string | null;
    /** Identificador del archivo en Real-Debrid, para resolver el enlace sin intermediarios. */
    rdId?: string | null;
  }): Promise<void>;
  /** Ajusta el offset +/- delta ms, re-renderiza y persiste (local + crowdsourcing). */
  adjustOffset(deltaMs: number): void;
  /** Estado del ajuste automático contra el audio: nada · midiendo · sin_senal · error. */
  estadoAlineacion: Ref<'nada' | 'midiendo' | 'sin_senal' | 'error'>;
  /** Dispara la medición contra el audio y aplica el resultado cuando llega. */
  alinearAlAudio(): Promise<void>;
  /**
   * refresh — recalcula el cue con la base de tiempo ACTUAL. Necesario cuando esa base
   * cambia sin que el `<video>` emita ningún evento: en `/t/`, la recarga del MPD pausa
   * el video y mueve `tpipelineOffset` en el mismo paso, así que sin esto el subtítulo
   * se queda con la línea de la posición anterior.
   */
  refresh(): void;
  /** Limpia cues/listeners — llamar al cerrar el reproductor. */
  clear(): void;
  /**
   * Cues parseados (con offset aplicado). Reactivo. Lo consume `VideoPlayer`
   * SOLO en móvil para construir un TextTrack nativo que iOS muestra en el
   * fullscreen nativo del <video> (el overlay DOM no es visible ahí).
   */
  cues: Ref<SubtitleCue[]>;
}

export function useSubtitles(opts: UseSubtitlesOptions): UseSubtitlesReturn {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const activeCueText = ref('');
  const status = ref('');
  const enabled = ref(true);
  const offsetMs = ref(0);

  const cues = shallowRef<SubtitleCue[]>([]);
  const srtRaw = ref<string | null>(null);
  let subImdbId: string | null = null;
  let subFileId: number | null = null;
  let subInfoHash: string | null = null;
  let subRdId: string | null = null;
  // Cancela los fetch de subtítulo en vuelo (OpenSubtitles/subhash/offset/descarga)
  // si se cierra el player o se cambia de película antes de que terminen.
  let activeAbort: AbortController | null = null;

  // ── Render reactivo del cue activo (reemplaza `_subTimeUpdate` + innerHTML manual) ──
  function renderAtCurrentTime() {
    const video = opts.videoRef.value;
    if (!video || !enabled.value) {
      activeCueText.value = '';
      return;
    }
    const ov = opts.timeOverride?.();
    const tMs = (ov != null ? ov : video.currentTime) * 1000;
    const cue = findActiveCue(cues.value, tMs);
    // ⚠️ SEGURIDAD: el original convertía '\n' → '<br>' y volcaba el resultado
    // con `innerHTML` (luego replicado aquí como `v-html`). El texto del cue
    // viene de archivos .srt DESCARGADOS DE OPENSUBTITLES — contenido de red
    // no confiable. `parseSrt` ya limpia tags con una regex (`<[^>]+>`), pero
    // el sanitizado de HTML por regex es un anti-patrón conocido (bypasses de
    // "mutation XSS"/parsers diferenciales — ver OWASP). Para eliminar esa
    // superficie por completo, NO se inyecta HTML: se deja el '\n' tal cual y
    // <SubtitleOverlay> lo renderiza con interpolación de texto plano +
    // `white-space: pre-line` (CSS puro, sin parseo de markup).
    activeCueText.value = cue ? cue.text : '';
  }

  let timeUpdateHandler: (() => void) | null = null;
  let seekingHandler: (() => void) | null = null;

  function attachVideoListeners() {
    const video = opts.videoRef.value;
    if (!video) return;
    detachVideoListeners();
    timeUpdateHandler = renderAtCurrentTime;
    seekingHandler = () => {
      activeCueText.value = '';
    };
    video.addEventListener('timeupdate', timeUpdateHandler);
    video.addEventListener('seeked', timeUpdateHandler);
    video.addEventListener('seeking', seekingHandler);
    // `pause`/`play` (2026-09-04): con el video detenido NO hay `timeupdate`, así que el
    // cue en pantalla se queda con el último calculado. Normalmente da igual —el cuadro
    // también está congelado—, pero en `/t/` la recarga del MPD PAUSA el video y cambia
    // `tpipelineOffset` en el mismo paso (usePlayer, "video.pause(); tpipelineOffset =
    // t"), o sea que la base de tiempo se mueve mientras no llega ningún evento: el
    // subtítulo quedaba mostrando la línea de la posición ANTERIOR sobre el cuadro nuevo.
    // Recalcular al pausar y al reanudar cierra esa ventana. Es la misma función pura de
    // siempre: no cambia qué se muestra en ningún caso donde ya estaba bien.
    video.addEventListener('pause', timeUpdateHandler);
    video.addEventListener('play', timeUpdateHandler);
  }

  function detachVideoListeners() {
    const video = opts.videoRef.value;
    if (!video) return;
    if (timeUpdateHandler) {
      video.removeEventListener('timeupdate', timeUpdateHandler);
      video.removeEventListener('seeked', timeUpdateHandler);
      video.removeEventListener('pause', timeUpdateHandler);
      video.removeEventListener('play', timeUpdateHandler);
    }
    if (seekingHandler) video.removeEventListener('seeking', seekingHandler);
    timeUpdateHandler = null;
    seekingHandler = null;
  }

  // ── Inyección — reemplaza `_injectSubtitle` (líneas ~5117-5190) ──────────
  // En el original esto creaba/movía un <div id="subOverlay"> según
  // fullscreen. En Vue, ese trabajo lo hace `<SubtitleOverlay>` reactivamente
  // (Fase 4) — aquí solo parseamos y dejamos los cues listos.
  function inject(srt: string, offset: number) {
    srtRaw.value = srt;
    offsetMs.value = offset;
    cues.value = parseSrt(srt, offset);
    // Log de diagnóstico — preserva índex.html línea 5123 (1:1).
    console.warn(
      '[SUB] Cues parseados:',
      cues.value.length,
      '| primer cue en:',
      (cues.value[0]?.s != null ? cues.value[0].s / 1000 : NaN).toFixed(1),
      's'
    );
    attachVideoListeners();
    renderAtCurrentTime();
    // ⚠️ PRESERVAR 1:1 — el original SIEMPRE termina `_injectSubtitle` con el
    // literal `_renderSubStatus('✅ ES | offset: 0s')` (índex.html línea 5189),
    // SIN usar el parámetro `offsetMs` recibido — incluso cuando se inyecta con
    // un offset guardado no-cero (p.ej. `fetchAndInjectSubtitle` → línea 5354
    // pasa `_subOffsetMs`). Es un punto ciego cosmético del original (siempre
    // muestra "0s" justo tras inyectar) que NO se debe "arreglar" aquí — solo
    // `_adjustSubOffset` (→ `adjustOffset` abajo) calcula y muestra el label real.
    status.value = '✅ ES | offset: 0s';
  }

  // ── Ajuste de offset — reemplaza `_adjustSubOffset` (líneas ~5192-5212) ──
  /**
   * Tope del ajuste manual, hacia adelante y hacia atrás.
   *
   * En la TV el botón se dispara varias veces por pulsación (el control remoto
   * repite mientras se mantiene apretado). Medido el 17-10-2026 con *Ghostland*:
   * el log registró más de veinte saltos de +5 s seguidos, y el subtítulo terminó
   * dos minutos tarde, guardado así para la próxima vez. Un desfase real nunca
   * llega a un minuto: lo que pasa ese valor es siempre un accidente.
   */
  const TOPE_OFFSET_MS = 60000;
  /** Espera antes de publicar el ajuste al servidor compartido (ver abajo). */
  const ESPERA_GUARDADO_MS = 1500;
  /**
   * Tope de espera por la huella del archivo. Son dos pedidos de 64 KB contra
   * Real-Debrid: si en ese tiempo no volvió, el subtítulo se busca por texto y
   * listo. Nunca se deja al espectador sin subtítulo esperando esto.
   */
  const ESPERA_HUELLA_MS = 7000;
  let guardadoRemotoTimer: ReturnType<typeof setTimeout> | null = null;

  function adjustOffset(deltaMs: number) {
    if (!srtRaw.value) {
      status.value = 'Sin subtítulos cargados';
      return;
    }
    const pedido = offsetMs.value + deltaMs;
    const next = Math.max(-TOPE_OFFSET_MS, Math.min(TOPE_OFFSET_MS, pedido));
    if (next === offsetMs.value) {
      status.value = `✅ ES | offset: ${next >= 0 ? '+' : ''}${(next / 1000).toFixed(1)}s (tope)`;
      return; // ya en el tope: ni reparsear ni volver a guardar
    }
    inject(srtRaw.value, next);
    const sign = next >= 0 ? '+' : '';
    const label = sign + (next / 1000).toFixed(1) + 's';
    status.value = `✅ ES | offset: ${label}`;

    if (subImdbId) {
      const key = 'sub_off_' + (subImdbId.includes('.') ? subImdbId.replace(/\.[^.]+$/, '') : subImdbId);
      safeStorage.setItem(key, String(next));
    }
    // El envío al servidor (que comparte el ajuste con los demás) espera a que el
    // usuario deje de tocar el botón. Sin esto, una pulsación sostenida publicaba
    // una veintena de valores intermedios, todos equivocados menos el último.
    if (subInfoHash && subFileId) {
      if (guardadoRemotoTimer) clearTimeout(guardadoRemotoTimer);
      guardadoRemotoTimer = setTimeout(() => {
        guardadoRemotoTimer = null;
        fetchImpl('/.netlify/functions/offset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ infoHash: subInfoHash, fileId: subFileId, offset: offsetMs.value }),
        }).catch(() => {});
      }, ESPERA_GUARDADO_MS);
    }
  }

  /**
   * pedirHuella — huella OSDb del archivo en reproducción, calculada por la
   * function `moviehash` (el enlace de Real-Debrid no manda cabeceras CORS, así
   * que el navegador no puede leerle bytes; el servidor sí).
   *
   * Nunca hace fallar la búsqueda de subtítulos: si tarda, falla o no hay enlace,
   * devuelve null y se sigue con la búsqueda por texto de siempre.
   */
  async function pedirHuella(
    streamUrl: string | null | undefined,
    rdId: string | null | undefined,
    nombre: string | null | undefined,
    signal: AbortSignal
  ): Promise<string | null> {
    // Cada salida escribe su propia línea. La primera versión solo registraba el
    // caso bueno, así que cuando la huella no salía no quedaba ni rastro y no se
    // podía saber si el problema era el enlace, la function o el tiempo.
    if (!streamUrl) {
      console.warn('[SUB] Huella: no hay enlace directo del archivo (no es reproducción directa)');
      return null;
    }
    const arranque = Date.now();
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), ESPERA_HUELLA_MS);
    const cancelar = () => corte.abort();
    signal.addEventListener('abort', cancelar);
    try {
      const r = await fetchImpl('/.netlify/functions/moviehash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: streamUrl, rdId: rdId || '', nombre: nombre || '' }),
        signal: corte.signal,
      }).then((x) => x.json());
      const tardanza = ((Date.now() - arranque) / 1000).toFixed(1);
      if (typeof r?.hash === 'string' && r.hash.length === 16) {
        console.warn(`[SUB] Huella calculada en ${tardanza}s:`, r.hash);
        return r.hash;
      }
      console.warn(`[SUB] Huella no disponible tras ${tardanza}s | motivo:`, r?.motivo ?? r?.error ?? '?');
      return null;
    } catch (e) {
      const tardanza = ((Date.now() - arranque) / 1000).toFixed(1);
      console.warn(`[SUB] Huella falló tras ${tardanza}s:`, (e as Error)?.name, (e as Error)?.message);
      return null;
    } finally {
      clearTimeout(reloj);
      signal.removeEventListener('abort', cancelar);
    }
  }

  // ── Búsqueda + scoring + descarga — reemplaza `fetchAndInjectSubtitle`
  // (líneas ~5226-5359). Cascada EXACTA preservada: query por release →
  // fallback por IMDB ID → scoring → crowdsourcing offset → descarga con
  // hasta MAX_DOWNLOAD_ATTEMPTS reintentos validando cues >= MIN_VALID_CUES.
  async function fetchAndInject(params: {
    imdbId: string | null;
    type: 'movie' | 'tv';
    season?: number;
    episode?: number;
    streamFilename: string | null;
    infoHash: string | null;
    streamUrl?: string | null;
    rdId?: string | null;
  }) {
    status.value = '🔍 Buscando subtítulos ES...';
    const { imdbId, type, season, episode, streamFilename, infoHash, streamUrl, rdId } = params;

    activeAbort?.abort(); // cancelar una búsqueda anterior en vuelo (cambio de peli)
    const ac = new AbortController();
    activeAbort = ac;
    const signal = ac.signal;

    subImdbId = buildSubImdbId(infoHash, streamFilename, imdbId);
    const offKey = buildOffsetStorageKey(infoHash, streamFilename, imdbId);
    const savedOff = safeStorage.getItem(offKey);
    // BUG real encontrado (2026-07-14, reportado por el usuario: "el subtítulo
    // sale antes de hablar" al reproducir otro archivo): si el archivo NUEVO no
    // tiene offset propio guardado, `offsetMs` nunca se reseteaba a 0 — quedaba
    // arrastrando el ajuste MANUAL de la copia anterior (un archivo distinto)
    // aplicado sobre este archivo, sin relación. Ahora SIEMPRE se resuelve el
    // valor correcto para ESTE archivo: el guardado si existe, o 0 si no.
    offsetMs.value = savedOff !== null ? parseInt(savedOff, 10) || 0 : 0;
    // Log de diagnóstico — preserva índex.html línea 5234 (1:1).
    if (infoHash) console.warn('[SUB] infoHash:', infoHash, '| offset guardado:', offsetMs.value + 'ms');

    try {
      const numId = numericImdbId(imdbId);
      const headers = { 'Api-Key': OS_KEY, 'User-Agent': OS_UA };
      const releaseName = buildReleaseName(streamFilename);
      let data: { data: OpenSubtitle[] } = { data: [] };

      /** Suma candidatos nuevos sin repetir archivos ya listados. */
      const fundir = (nuevos: OpenSubtitle[]) => {
        const idDeArchivo = (x: OpenSubtitle) => x.attributes?.files?.[0]?.file_id;
        const yaEstan = new Set((data.data ?? []).map(idDeArchivo).filter((v) => v != null));
        data = { data: [...(data.data ?? []), ...nuevos.filter((x) => !yaEstan.has(idDeArchivo(x)))] };
      };

      // ── Búsqueda POR ARCHIVO ───────────────────────────────────────────────
      // Primero se pregunta por la huella de la copia que se está reproduciendo.
      // Un resultado con `moviehash_match` fue subido para ESE archivo, así que
      // viene sincronizado; buscar por nombre del release, en cambio, trae lo que
      // "se parece" y cae seguido en otra edición con el intro de distinta
      // duración. Si la huella no sale (el enlace no responde, el archivo es
      // chico, la function falla), no pasa nada: sigue la búsqueda de siempre.
      const huella = await pedirHuella(streamUrl, rdId, streamFilename, signal);
      /**
       * Nombre del release al que pertenece de verdad el archivo, según quien
       * reconoció su huella. Vale aunque el subtítulo que la reconoce esté en
       * otro idioma: el nombre del torrent suele estar renombrado a mano (el de
       * esta copia decía "Incident In A Ghostland - Horror 2018 Eng Rus Subs
       * 720p" cuando el release real era "Ghostland.2018.720p.BluRay.x264-YTS"),
       * y buscar por el nombre equivocado es lo que traía subtítulos de otra
       * edición.
       */
      let releaseExacto: string | null = null;
      if (huella) {
        try {
          // Sin filtro de idioma a propósito: aunque no haya un subtítulo en
          // español para este archivo, el que exista en cualquier idioma nos dice
          // de qué release se trata.
          const qh = `${OS_BASE}?moviehash=${encodeURIComponent(huella)}`;
          const rh = await fetchImpl(qh, { headers, signal }).then((r) => r.json());
          const todos = (rh.data ?? []) as OpenSubtitle[];
          const exactos = todos.filter((x) => x.attributes?.moviehash_match);
          const enEspanol = exactos.filter((x) => /^es/i.test(x.attributes?.language || ''));
          releaseExacto = exactos[0]?.attributes?.release || null;
          console.warn(
            '[SUB] Huella del archivo:',
            huella,
            '|',
            exactos.length,
            'subtítulos para esta copia exacta,',
            enEspanol.length,
            'en español | release real:',
            releaseExacto || 'desconocido'
          );
          if (enEspanol.length) fundir(enEspanol);
        } catch (e) {
          console.warn('[SUB] Búsqueda por huella falló:', (e as Error)?.message);
        }
      }

      // Con el nombre real del release en mano, se busca por ÉSE antes que por el
      // nombre del archivo, que puede venir renombrado.
      if (releaseExacto) {
        try {
          const qr = `${OS_BASE}?languages=es&query=${encodeURIComponent(releaseExacto)}&imdb_id=${numId}`;
          const rr = await fetchImpl(qr, { headers, signal }).then((r) => r.json());
          console.warn('[SUB] Búsqueda por el release real:', rr.total_count ?? 0, 'resultados');
          if (rr.data?.length) fundir(rr.data as OpenSubtitle[]);
        } catch (e) {
          console.warn('[SUB] Búsqueda por el release real falló:', (e as Error)?.message);
        }
      }

      if (releaseName) {
        try {
          const q1 = `${OS_BASE}?languages=es&query=${encodeURIComponent(releaseName)}&imdb_id=${numId}`;
          const r1 = await fetchImpl(q1, { headers, signal }).then((r) => r.json());
          // Log de diagnóstico — preserva índex.html línea 5247 (1:1).
          console.warn('[SUB] Búsqueda por release:', r1.total_count, 'resultados');
          if (r1.data?.length) fundir(r1.data as OpenSubtitle[]);
        } catch (e) {
          // Log de diagnóstico — preserva índex.html línea 5249 (1:1).
          console.warn('[SUB] Búsqueda por release falló:', (e as Error)?.message, '— usando IMDB fallback');
        }
      }
      // Se consulta por IMDB no solo cuando la búsqueda por release vino VACÍA,
      // sino también cuando trajo muy poco. Con uno o dos candidatos la elección
      // es casi forzada, y un .srt de otra edición entra desfasado respecto de la
      // copia que se está reproduciendo. Caso real (Ghostland, 17-10-2026): un
      // único resultado, de un rip distinto, y el subtítulo salía muy atrasado.
      // Los dos listados se funden y decide el puntaje de siempre, así que el
      // candidato que ya estaba nunca se pierde: solo gana competencia.
      const POCOS_CANDIDATOS = 4;
      if (!data.data?.length || data.data.length < POCOS_CANDIDATOS) {
        try {
          const typeQs =
            type === 'tv' ? `&type=episode&season_number=${season}&episode_number=${episode}` : '&type=movie';
          const q2 = `${OS_BASE}?languages=es&imdb_id=${numId}${typeQs}`;
          const r2 = await fetchImpl(q2, { headers, signal }).then((r) => r.json());
          // Log de diagnóstico — preserva índex.html línea 5258 (1:1).
          console.warn('[SUB] Búsqueda por IMDB ID:', r2.total_count, 'resultados');
          fundir((r2.data ?? []) as OpenSubtitle[]);
        } catch (e) {
          // Log de diagnóstico — preserva índex.html línea 5260 (1:1).
          console.warn('[SUB] Búsqueda por IMDB ID falló:', (e as Error)?.message);
        }
      }
      if (!data.data?.length) {
        status.value = '❌ Sin subtítulos ES';
        return;
      }

      // Las pistas (calidad, grupo, origen, corte) salen del nombre REAL del
      // release cuando la huella lo reveló; el nombre del archivo queda de
      // respaldo, porque puede venir renombrado a mano.
      const hints = deriveVideoHints(releaseExacto || streamFilename);
      const vidDuration = opts.videoRef.value?.duration || 0;
      // ADR-009 fix 2: descartar subs de OTRA película (imdb mismatch) y subs no
      // verificables con score bajo, ANTES de elegir. La misma lista filtrada
      // alimenta el pick y el loop de reintentos de descarga (más abajo), así el
      // reintento tampoco puede caer en un sub ajeno. Caso real: Maze Runner
      // score 19 mientras se reproducía otro título.
      const trust = filterTrustworthySubtitles(data.data, numId, hints, vidDuration);
      if (trust.mismatches || trust.lowConfidence) {
        console.warn(
          '[SUB] Filtro de confianza — descartados:',
          trust.mismatches, 'de otra película,',
          trust.lowConfidence, 'sin verificar con score bajo |',
          trust.kept.length, 'candidatos quedan'
        );
      }
      if (!trust.kept.length) {
        status.value = '❌ Sin subtítulos ES';
        return;
      }
      const { best, fileId } = pickBestSubtitle(trust.kept, hints, vidDuration);
      if (!best || !fileId) {
        status.value = '❌ Sin file_id';
        return;
      }
      // Log de diagnóstico — preserva índex.html línea 5312 (1:1).
      console.warn(
        '[SUB] Elegido:',
        best.attributes.release,
        '| score:',
        scoreSubtitle(best, hints, vidDuration),
        '| AI:',
        best.attributes.ai_translated
      );
      subFileId = fileId;
      subInfoHash = infoHash;
      subRdId = rdId || null;

      // ⚠️ SEGURIDAD: `infoHash`/`fileId`/`candidateId` van interpolados en
      // querystrings hacia las Netlify Functions `offset`/`subhash`. En la
      // práctica son de bajo riesgo (`infoHash` ya viene validado por
      // `INFOHASH_RE = /[a-f0-9]{40}/i` en streamSelector.ts; los `file_id`
      // de OpenSubtitles son numéricos), pero se aplica `encodeURIComponent`
      // de forma uniforme — igual que ya hacía `releaseName` en la línea de
      // arriba — para no depender de supuestos sobre el formato upstream y
      // evitar inyección de parámetros (`&otherParam=...`) si esos formatos
      // cambiaran alguna vez.
      if (infoHash && fileId) {
        try {
          const shared = await fetchImpl(
            `/.netlify/functions/offset?infoHash=${encodeURIComponent(infoHash)}&fileId=${encodeURIComponent(fileId)}`,
            { signal }
          ).then((r) => r.json());
          if (shared.offset !== null && shared.offset !== undefined) {
            const compartido = Number(shared.offset);
            // El mismo tope que el ajuste manual, también de este lado: un valor
            // desmedido guardado por accidente (pulsación sostenida en el control
            // remoto) volvería a aplicarse en cada reproducción, incluso después de
            // haberlo puesto en cero acá.
            if (Number.isFinite(compartido) && Math.abs(compartido) <= TOPE_OFFSET_MS) {
              offsetMs.value = compartido;
              // Log de diagnóstico — preserva índex.html línea 5322 (1:1).
              console.warn('[SUB] Offset compartido encontrado:', offsetMs.value + 'ms');
            } else {
              console.warn('[SUB] Offset compartido descartado por desmedido:', shared.offset);
            }
          }
        } catch {
          /* no crítico */
        }
      }

      const dlData = await fetchImpl(`/.netlify/functions/subhash?file_id=${encodeURIComponent(fileId)}`, {
        signal,
      }).then((r) => r.json());
      // Log de diagnóstico — preserva índex.html línea 5329 (1:1).
      console.warn('[SUB] Restantes hoy:', dlData.remaining, '| archivo:', dlData.file_name);
      if (!dlData.link) {
        status.value = '❌ Sin link';
        return;
      }

      const ranked = rankSubtitles(trust.kept, hints, vidDuration);
      let srt: string | null = null;
      // Fallback si NINGÚN candidato calza en duración: mejor un subtítulo
      // posiblemente de otro corte que ninguno (el usuario ya tiene el ajuste
      // manual de sincronización para ese caso puntual).
      let fallback: { raw: string; candidateId: number; release: string; cues: number } | null = null;
      for (let attempt = 0; attempt < Math.min(ranked.length, MAX_DOWNLOAD_ATTEMPTS); attempt++) {
        const candidate = ranked[attempt];
        const candidateId = candidate.attributes.files[0]?.file_id;
        if (!candidateId) continue;
        const dl = await fetchImpl(`/.netlify/functions/subhash?file_id=${encodeURIComponent(candidateId)}`, {
          signal,
        }).then((r) => r.json());
        if (!dl.link) continue;
        const raw = await fetchImpl(dl.link, { signal }).then((r) => r.text());
        const parsedCues = parseSrt(raw, 0);
        if (isSubtitleValid(parsedCues)) {
          // Verificación de DURACIÓN (2026-07-14, caso real "La muerte de Robin
          // Hood"): el subtítulo era de la película correcta (pasó el piso de
          // confianza/IMDB) pero de un CORTE distinto al video (WEB-DL vs rip de
          // cine) → desfasado igual. Si la duración implícita del .srt se aleja
          // demasiado de `video.duration`, es señal de corte distinto — seguir
          // probando el siguiente candidato antes de conformarse con este.
          const subDur = subtitleDurationSec(parsedCues);
          if (durationLooksMismatched(subDur, vidDuration)) {
            console.warn(
              '[SUB] Duración no coincide (posible corte distinto) — sigue buscando:',
              candidate.attributes.release, '| sub:', subDur.toFixed(0) + 's', '| video:', vidDuration.toFixed(0) + 's'
            );
            if (!fallback) fallback = { raw, candidateId, release: candidate.attributes.release, cues: parsedCues.length };
            continue;
          }
          srt = raw;
          // Log de diagnóstico — preserva índex.html línea 5345 (1:1).
          if (attempt > 0)
            console.warn('[SUB] Reintento', attempt, '→', candidate.attributes.release, '| cues:', parsedCues.length);
          subFileId = candidateId;
          break;
        }
        // Log de diagnóstico — preserva índex.html línea 5349 (1:1).
        console.warn('[SUB] Descartado (solo', parsedCues.length, 'cues):', candidate.attributes.release);
      }
      if (!srt && fallback) {
        console.warn('[SUB] Ningún candidato calzó en duración — se usa el mejor disponible igual:', fallback.release);
        srt = fallback.raw;
        subFileId = fallback.candidateId;
      }
      if (!srt) {
        status.value = '❌ Sin subtítulo válido';
        return;
      }

      inject(srt, offsetMs.value);
    } catch (e) {
      // Cancelado al cerrar/cambiar de peli → no es un error real (no loguear ni
      // pisar el status, que ya pertenece a la búsqueda nueva).
      if (signal.aborted || (e as Error)?.name === 'AbortError') return;
      // Log de diagnóstico — preserva índex.html línea 5356 (1:1).
      console.warn('[SUB] Error:', e);
      status.value = '❌ Error cargando subtítulos';
    }
  }

  function clear() {
    activeAbort?.abort(); // cancelar fetches de subtítulo en vuelo
    activeAbort = null;
    detachVideoListeners();
    cues.value = [];
    activeCueText.value = '';
    srtRaw.value = null;
    subImdbId = subFileId = subInfoHash = null;
    offsetMs.value = 0;
  }

  // Re-engancha listeners si el <video> cambia de instancia (nueva fuente).
  watch(opts.videoRef, () => {
    if (cues.value.length) attachVideoListeners();
  });

  onBeforeUnmount(() => {
    detenerConsulta();
    clear();
  });

  const hasSubtitleData = computed(() => srtRaw.value !== null);

  // ── Ajuste automático contra el audio ───────────────────────────────────────
  // El botón "ajustar al audio" del panel. La medición la hace el servidor
  // (`alinear-background`): escucha ocho tramos de la película, ve cuándo se
  // habla y calcula cuánto hay que correr el subtítulo. Tarda alrededor de
  // minuto y medio, así que acá solo se dispara y se pregunta por el resultado.
  const estadoAlineacion = ref<'nada' | 'midiendo' | 'sin_senal' | 'error'>('nada');
  let relojConsulta: ReturnType<typeof setTimeout> | null = null;
  // Ocho minutos: una medición normal tarda poco más de un minuto, pero si la
  // primera pasada queda al borde se hace una segunda con el doble de tramos, y
  // en una película larga las dos juntas pasan los cinco minutos.
  const ESPERA_MAXIMA_MS = 480000;
  const CADA_MS = 4000;

  function detenerConsulta() {
    if (relojConsulta) {
      clearTimeout(relojConsulta);
      relojConsulta = null;
    }
  }

  async function alinearAlAudio() {
    if (estadoAlineacion.value === 'midiendo') return;
    if (!srtRaw.value || !subInfoHash || !subFileId || !subRdId) {
      estadoAlineacion.value = 'error';
      return;
    }
    estadoAlineacion.value = 'midiendo';
    const infoHash = subInfoHash;
    const fileId = subFileId;
    try {
      await fetchImpl('/.netlify/functions/alinear-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rdId: subRdId,
          infoHash,
          fileId,
          duracionSeg: Math.round(opts.videoRef.value?.duration || 0),
          // Se mandan los tiempos, no el texto: es lo único que hace falta para
          // medir y pesa una décima parte.
          cues: cues.value.map((c) => [c.s - offsetMs.value, c.e - offsetMs.value]),
        }),
      });
    } catch {
      estadoAlineacion.value = 'error';
      return;
    }

    const limite = Date.now() + ESPERA_MAXIMA_MS;
    const preguntar = async () => {
      if (Date.now() > limite) {
        estadoAlineacion.value = 'error';
        return;
      }
      try {
        const r = await fetchImpl(
          `/.netlify/functions/alinear-estado?infoHash=${encodeURIComponent(infoHash)}&fileId=${encodeURIComponent(String(fileId))}`
        ).then((x) => x.json());
        if (r?.estado === 'listo' && typeof r.offsetMs === 'number') {
          console.warn('[SUB] Ajuste al audio:', r.offsetMs + 'ms | ventaja:', r.ventaja);
          aplicarOffset(r.offsetMs);
          estadoAlineacion.value = 'nada';
          return;
        }
        if (r?.estado === 'sin_senal' || r?.estado === 'error') {
          console.warn('[SUB] Ajuste al audio sin resultado:', r.estado, r.motivo ?? '');
          estadoAlineacion.value = r.estado;
          return;
        }
      } catch {
        /* una consulta fallida no corta la espera */
      }
      relojConsulta = setTimeout(preguntar, CADA_MS);
    };
    relojConsulta = setTimeout(preguntar, CADA_MS);
  }

  /** Aplica un ajuste absoluto (lo usa el ajuste automático) y lo guarda. */
  function aplicarOffset(ms: number) {
    if (!srtRaw.value) return;
    const limitado = Math.max(-TOPE_OFFSET_MS, Math.min(TOPE_OFFSET_MS, Math.round(ms)));
    inject(srtRaw.value, limitado);
    const sign = limitado >= 0 ? '+' : '';
    status.value = `✅ ES | offset: ${sign}${(limitado / 1000).toFixed(1)}s`;
    if (subImdbId) {
      const key = 'sub_off_' + (subImdbId.includes('.') ? subImdbId.replace(/\.[^.]+$/, '') : subImdbId);
      safeStorage.setItem(key, String(limitado));
    }
    // No se vuelve a publicar al servidor: el valor ya lo guardó la medición.
  }

  return {
    activeCueText,
    status,
    enabled,
    offsetMs,
    hasSubtitleData,
    fetchAndInject,
    adjustOffset,
    clear,
    cues,
    estadoAlineacion,
    alinearAlAudio,
    /**
     * refresh — recalcula el cue con la base de tiempo ACTUAL. Lo usa el reproductor
     * cuando cambia `tpipelineOffset` con el video detenido, momento en el que ningún
     * evento del `<video>` va a llegar para hacerlo solo.
     */
    refresh: renderAtCurrentTime,
  };
}
