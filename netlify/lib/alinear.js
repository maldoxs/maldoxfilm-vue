/**
 * lib/alinear — cuánto hay que correr un subtítulo para que calce con el audio.
 *
 * El problema: un .srt está hecho para una edición concreta de la película. Si la
 * copia que se reproduce es otra edición, todas las líneas entran corridas por la
 * misma cantidad de segundos, porque la diferencia está en el arranque (el cartel
 * de la distribuidora que una edición trae y la otra no).
 *
 * Cómo se resuelve sin entender lo que se dice: alcanza con saber CUÁNDO se habla.
 * Se mide la energía del audio en la banda de la voz cada 100 ms, se marca como
 * "hay voz" lo que pasa un umbral, y se prueba cada corrimiento posible del
 * subtítulo buscando el que hace caer más líneas sobre tramos con voz.
 *
 * Calibrado contra dos películas de respuesta conocida (18-10-2026):
 *   - Incident in a Ghostland: da -14,8 s; `ffsubsync` da -14,94 s.
 *   - The Dark and the Wicked: da -14,4 s; el usuario, a mano, -15,0 s.
 *
 * Lo que NO funciona, probado y descartado:
 *   - Pocos tramos (tres de un minuto): el pico queda plano, gana el ruido.
 *   - Sin filtrar la banda de voz: la música cuenta como diálogo.
 *   - Castigar las líneas que caen fuera de la voz: empuja el resultado hacia
 *     donde hay menos subtítulo, no hacia donde calza.
 */

import { spawn } from 'node:child_process';

const HZ = 8000;
const MS_POR_CUADRO = 100;
const MUESTRAS_POR_CUADRO = (HZ * MS_POR_CUADRO) / 1000;
/** Tramos de audio a escuchar, repartidos por la película. */
export const TRAMOS = 8;
export const SEG_POR_TRAMO = 60;
/** Se buscan corrimientos de hasta un minuto, el mismo tope que el ajuste manual. */
const RANGO_MS = 60000;
const PASO_MS = 100;
/**
 * Cuánto tiene que sobresalir el ganador sobre los corrimientos lejanos para
 * creerle. Medido el 18-10-2026: tres películas reales dieron 1,41 · 1,47 · 1,52,
 * y un subtítulo que no corresponde a la película da 1,10. El corte va en el
 * medio, más cerca del ruido, para no rechazar mediciones buenas ni aplicar un
 * número inventado.
 */
const VENTAJA_MINIMA = 1.25;

/** Energía (RMS) de cada 100 ms de un tramo, ya filtrado a la banda de la voz. */
function energias(ffmpeg, url, desdeSeg, durSeg) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', String(desdeSeg), '-t', String(durSeg), '-i', url,
      '-vn', '-ac', '1', '-ar', String(HZ),
      // Banda de la voz humana: saca los graves de la música y los agudos de los
      // efectos, que son lo que hacía pasar música por diálogo.
      '-af', 'highpass=f=250,lowpass=f=3200',
      '-f', 's16le', '-',
    ]);
    const trozos = [];
    p.stdout.on('data', (d) => trozos.push(d));
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', () => {
      const buf = Buffer.concat(trozos);
      const total = Math.floor(buf.length / 2 / MUESTRAS_POR_CUADRO);
      const out = new Float64Array(total);
      for (let c = 0; c < total; c++) {
        let suma = 0;
        const base = c * MUESTRAS_POR_CUADRO * 2;
        for (let i = 0; i < MUESTRAS_POR_CUADRO; i++) {
          const v = buf.readInt16LE(base + i * 2) / 32768;
          suma += v * v;
        }
        out[c] = Math.sqrt(suma / MUESTRAS_POR_CUADRO);
      }
      resolve(out);
    });
  });
}

/** Marca con voz los cuadros que pasan el umbral del tramo. */
export function marcarVoz(rms) {
  if (!rms.length) return new Uint8Array(0);
  const orden = Array.from(rms).sort((a, b) => a - b);
  const mediana = orden[Math.floor(orden.length / 2)] || 0;
  const umbral = Math.max(mediana * 1.6, 0.005);
  return Uint8Array.from(rms, (v) => (v > umbral ? 1 : 0));
}

/**
 * mejorCorrimiento — prueba cada corrimiento y devuelve el que más líneas hace
 * caer sobre voz, junto con su ventaja sobre el promedio de los lejanos.
 */
export function mejorCorrimiento(ventanas, cues) {
  // Para cada corrimiento se cuenta cuántos cuadros de subtítulo caen sobre voz.
  // Conteo crudo, a propósito.
  //
  // Se probó normalizar por la cantidad de subtítulo dentro de las ventanas, que
  // en teoría es más prolijo. En la práctica dio PEOR: acertó en una película y
  // en la otra tiró +45 s donde la respuesta era -15. El conteo crudo acertó en
  // las dos. Las ventanas están repartidas por el medio de la película, así que
  // correr el subtítulo un minuto casi no cambia cuánto de él queda adentro, y
  // la supuesta ventaja de normalizar no existe.
  let mejor = 0;
  let mejorPts = -Infinity;
  const puntajes = [];
  for (let off = -RANGO_MS; off <= RANGO_MS; off += PASO_MS) {
    let pts = 0;
    for (const { desdeMs, voz } of ventanas) {
      const n = voz.length;
      const sub = new Uint8Array(n);
      for (const [a, b] of cues) {
        const i = Math.max(0, Math.floor((a + off - desdeMs) / MS_POR_CUADRO));
        const j = Math.min(n, Math.ceil((b + off - desdeMs) / MS_POR_CUADRO));
        for (let k = i; k < j; k++) sub[k] = 1;
      }
      for (let k = 0; k < n; k++) if (sub[k] && voz[k]) pts++;
    }
    puntajes.push([off, pts]);
    if (pts > mejorPts) {
      mejor = off;
      mejorPts = pts;
    }
  }

  // Los corrimientos vecinos siempre puntúan parecido al ganador, así que la
  // comparación válida es contra los lejanos: si el ganador no sobresale de
  // ellos, no hay señal y el número sería inventado.
  // Solo entran los corrimientos que de verdad se evaluaron: los descartados por
  // poca masa valen cero y, si se promediaran, harían parecer bueno a cualquier
  // ganador.
  const lejanos = puntajes.filter(([o]) => Math.abs(o - mejor) > 3000).map(([, p]) => p);
  const promedio = lejanos.reduce((a, b) => a + b, 0) / Math.max(1, lejanos.length);
  const ventaja = promedio > 0 ? mejorPts / promedio : 0;
  return {
    offsetMs: mejor,
    puntaje: mejorPts,
    ventaja,
    confiable: ventaja >= VENTAJA_MINIMA,
  };
}

/** Escucha la película por tramos y devuelve el corrimiento que mejor calza. */
export async function medirDesfase({ ffmpeg, url, cues, duracionSeg, tramos = TRAMOS }) {
  const largo = duracionSeg && duracionSeg > 600 ? duracionSeg : 5400;
  const ventanas = [];
  for (let i = 1; i <= tramos; i++) {
    const desde = Math.round((largo * i) / (tramos + 1));
    const rms = await energias(ffmpeg, url, desde, SEG_POR_TRAMO);
    const voz = marcarVoz(rms);
    if (voz.length) ventanas.push({ desdeMs: desde * 1000, voz });
  }
  if (!ventanas.length) return { error: 'sin audio' };
  return { ...mejorCorrimiento(ventanas, cues), tramos: ventanas.length };
}
