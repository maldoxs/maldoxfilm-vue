import { describe, test, expect } from 'vitest';
// @ts-expect-error — código de servidor en JS puro, sin tipos
import { marcarVoz, mejorCorrimiento, desacuerdoInicioFinSeg } from '../netlify/lib/alinear.js';

/** Arma una ventana con voz en los tramos indicados (en segundos). */
function ventana(desdeSeg: number, largoSeg: number, tramos: [number, number][]) {
  const voz = new Uint8Array(largoSeg * 10); // un cuadro cada 100 ms
  for (const [a, b] of tramos) {
    for (let k = Math.round((a - desdeSeg) * 10); k < Math.round((b - desdeSeg) * 10); k++) {
      if (k >= 0 && k < voz.length) voz[k] = 1;
    }
  }
  return { desdeMs: desdeSeg * 1000, voz };
}

describe('alinear — desfase del subtítulo contra el audio', () => {
  test('marcarVoz separa los tramos fuertes del fondo', () => {
    const rms = Float64Array.from([0.001, 0.001, 0.2, 0.3, 0.001, 0.001, 0.25]);
    expect(Array.from(marcarVoz(rms))).toEqual([0, 0, 1, 1, 0, 0, 1]);
  });

  test('encuentra el corrimiento exacto cuando el subtítulo está corrido', () => {
    // Voz entre 100-104 y 110-115 segundos; el subtítulo dice 115-119 y 125-130,
    // o sea quince segundos tarde. Tiene que salir -15.
    const v = [ventana(90, 60, [[100, 104], [110, 115], [120, 123], [130, 134]])];
    const cues: [number, number][] = [
      [115000, 119000],
      [125000, 130000],
      [135000, 138000],
      [145000, 149000],
    ];
    const r = mejorCorrimiento(v, cues);
    expect(r.offsetMs).toBe(-15000);
    expect(r.confiable).toBe(true);
  });

  test('un subtítulo ya sincronizado da cero', () => {
    const v = [ventana(90, 60, [[100, 104], [110, 115], [120, 123], [130, 134]])];
    const cues: [number, number][] = [
      [100000, 104000],
      [110000, 115000],
      [120000, 123000],
      [130000, 134000],
    ];
    expect(mejorCorrimiento(v, cues).offsetMs).toBe(0);
  });

  test('no le cree a un subtítulo que no corresponde a la película', () => {
    // Líneas al azar contra voz al azar: siempre va a existir un corrimiento que
    // puntúe algo mejor que el resto, pero por casualidad. Si eso se aplicara, se
    // rompería una película que estaba bien.
    let semilla = 7;
    const rnd = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648), semilla / 2147483648);
    const ventanas = [];
    for (let w = 0; w < 8; w++) {
      const voz = new Uint8Array(600);
      for (let k = 0; k < 600; k++) voz[k] = rnd() < 0.35 ? 1 : 0;
      ventanas.push({ desdeMs: (600 + w * 600) * 1000, voz });
    }
    const cues: [number, number][] = [];
    for (let t = 600000; t < 6000000; t += rnd() * 8000 + 2000) {
      const d = 1500 + rnd() * 2500;
      cues.push([t, t + d]);
      t += d;
    }
    expect(mejorCorrimiento(ventanas, cues).confiable).toBe(false);
  });
});

// ── Principio contra final (2026-11-15, caso "Cat's Eye") ───────────────────────
// La película entera medía +45,1 s y la primera mitad sola, -15,1 s: un minuto de
// diferencia. El subtítulo entraba corrido. El control que había comparaba tramos
// ALTERNADOS, repartidos los dos por toda la película, así que no podía ver esto:
// dio 1,4 s mientras la medición estaba equivocada por un minuto.
describe('alinear — desacuerdo entre el principio y el final', () => {
  // Subtítulo con cuatro grupos de líneas repartidos por la película.
  const cues: [number, number][] = [
    [115000, 119000], [125000, 130000], [135000, 138000], [145000, 149000],
    [415000, 419000], [425000, 430000], [435000, 438000], [445000, 449000],
    [715000, 719000], [725000, 730000], [735000, 738000], [745000, 749000],
    [1015000, 1019000], [1025000, 1030000], [1035000, 1038000], [1045000, 1049000],
  ];
  // Los cuatro tramos piden lo mismo: la voz va quince segundos antes del texto.
  const coherentes = [
    ventana(90, 60, [[100, 104], [110, 115], [120, 123], [130, 134]]),
    ventana(390, 60, [[400, 404], [410, 415], [420, 423], [430, 434]]),
    ventana(690, 60, [[700, 704], [710, 715], [720, 723], [730, 734]]),
    ventana(990, 60, [[1000, 1004], [1010, 1015], [1020, 1023], [1030, 1034]]),
  ];

  test('si las dos mitades piden lo mismo, el desacuerdo es chico', () => {
    expect(desacuerdoInicioFinSeg(coherentes, cues)).toBeLessThan(30);
  });

  test('si el final pide un corrimiento muy distinto, lo detecta', () => {
    // Las dos primeras piden -15 s; en las dos últimas la voz va DESPUÉS del
    // texto, piden +30. Son 45 s de desacuerdo: ningún número único sirve.
    const discordantes = [
      coherentes[0],
      coherentes[1],
      ventana(735, 60, [[745, 749], [755, 760], [765, 768], [775, 779]]),
      ventana(1035, 60, [[1045, 1049], [1055, 1060], [1065, 1068], [1075, 1079]]),
    ];
    expect(desacuerdoInicioFinSeg(discordantes, cues)).toBeGreaterThanOrEqual(30);
  });

  test('con menos de cuatro tramos no rechaza: devuelve 0 por falta de datos', () => {
    expect(desacuerdoInicioFinSeg(coherentes.slice(0, 3), cues)).toBe(0);
    expect(desacuerdoInicioFinSeg([], cues)).toBe(0);
  });
});
