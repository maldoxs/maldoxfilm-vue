import { describe, test, expect } from 'vitest';
// @ts-expect-error — function de Netlify en JS puro, sin tipos
import { calcularHuella, sumarBloque, hostPermitido } from '../netlify/functions/moviehash.js';

/** Bloque de 64 KB con palabras de 64 bits puestas a mano. */
function bloque(palabras: bigint[]): Uint8Array {
  const b = new Uint8Array(65536);
  const v = new DataView(b.buffer);
  palabras.forEach((p, i) => v.setBigUint64(i * 8, p, true));
  return b;
}

describe('moviehash — huella OSDb del archivo', () => {
  test('suma las palabras de 64 bits en little-endian', () => {
    expect(sumarBloque(bloque([1n, 2n, 3n]))).toBe(6n);
  });

  test('la huella es tamaño + primeros 64 KB + últimos 64 KB', () => {
    const h = calcularHuella(1000, bloque([1n]), bloque([0n]));
    expect(h).toBe((1001).toString(16).padStart(16, '0'));
  });

  test('la suma da la vuelta a los 64 bits en vez de desbordar', () => {
    // 2^64-1 más 1 vuelve a cero: si se calculara con números comunes, el
    // resultado perdería precisión y la huella no coincidiría con ninguna.
    const h = calcularHuella(0, bloque([(1n << 64n) - 1n, 1n]), bloque([]));
    expect(h).toBe('0000000000000000');
  });

  test('la huella sale siempre de 16 dígitos', () => {
    expect(calcularHuella(1, bloque([]), bloque([])).length).toBe(16);
  });

  test('solo acepta enlaces https de Real-Debrid y de quien los resuelve', () => {
    expect(hostPermitido('https://scl1-4.download.real-debrid.com/d/XXX/peli.mp4')).toBe(true);
    expect(hostPermitido('https://torrentio.strem.fun/resolve/realdebrid/x/y/z/peli.mp4')).toBe(true);
    // Sin esto, la function serviría para que cualquiera leyera bytes de
    // servidores ajenos usando nuestra cuenta como intermediaria.
    expect(hostPermitido('https://evil.example.com/peli.mp4')).toBe(false);
    expect(hostPermitido('http://real-debrid.com/peli.mp4')).toBe(false);
    expect(hostPermitido('https://real-debrid.com.evil.example/peli.mp4')).toBe(false);
    expect(hostPermitido('no es una url')).toBe(false);
  });
});
