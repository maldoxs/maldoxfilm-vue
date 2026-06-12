import { describe, test, expect } from 'vitest';
import { ref, effectScope } from 'vue';
import { formatNfTime, useNetflixControls, SPEEDS } from '../src/composables/useNetflixControls';

/**
 * Monta `useNetflixControls` fuera de un componente — usando `effectScope`
 * para que `onBeforeUnmount` no truene (igual que el resto de composables que
 * "tocan DOM/video", esto se prueba a nivel de orquestación pura, no del ciclo
 * de vida de Vue, que ya cubren los tests de integración del reproductor).
 */
function setupControls() {
  const video = document.createElement('video');
  Object.defineProperty(video, 'duration', { value: 100, configurable: true });
  const videoRef = ref<HTMLVideoElement | null>(video);
  const seekBarRef = ref<HTMLElement | null>(document.createElement('div'));
  const scope = effectScope();
  const controls = scope.run(() => useNetflixControls({ videoRef, seekBarRef }))!;
  return { video, controls, scope };
}

describe('formatNfTime — formato de tiempo "m:ss" / "h:mm:ss" (preservado de _nfFmt línea ~4119)', () => {
  test('segundos puros → "m:ss"', () => {
    expect(formatNfTime(0)).toBe('0:00');
    expect(formatNfTime(5)).toBe('0:05');
    expect(formatNfTime(65)).toBe('1:05');
    expect(formatNfTime(599)).toBe('9:59');
  });

  test('una hora o más → "h:mm:ss"', () => {
    expect(formatNfTime(3600)).toBe('1:00:00');
    expect(formatNfTime(3661)).toBe('1:01:01');
    expect(formatNfTime(7325)).toBe('2:02:05');
  });

  test('trunca decimales y nunca devuelve negativos', () => {
    expect(formatNfTime(65.9)).toBe('1:05');
    expect(formatNfTime(-10)).toBe('0:00');
  });
});

describe('SPEEDS — valores EXACTOS del selector de velocidad Netflix (preservado de `spSetSpeed`/`.nf-speed-dot`, líneas ~3658-3670/4429-4441)', () => {
  test('son los 5 valores del original, en orden', () => {
    expect(SPEEDS).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
  });
});

describe('useNetflixControls — velocidad de reproducción (preserva `spSetSpeed`, línea ~4429-4441)', () => {
  test('arranca en 1x', () => {
    const { controls, scope } = setupControls();
    expect(controls.speed.value).toBe(1);
    scope.stop();
  });

  test('setSpeed aplica `video.playbackRate` y actualiza `speed` reactivo', () => {
    const { video, controls, scope } = setupControls();
    controls.setSpeed(1.5);
    expect(video.playbackRate).toBe(1.5);
    expect(controls.speed.value).toBe(1.5);
    controls.setSpeed(0.5);
    expect(video.playbackRate).toBe(0.5);
    expect(controls.speed.value).toBe(0.5);
    scope.stop();
  });

  test('attach() resetea la velocidad a 1x en silencio al (re)conectar una fuente nueva (preserva `spSetSpeed(1, true)` antes de `_spShowForRD(true)`, línea ~4269)', () => {
    const { video, controls, scope } = setupControls();
    controls.setSpeed(1.25);
    expect(controls.speed.value).toBe(1.25);
    controls.attach();
    expect(controls.speed.value).toBe(1);
    expect(video.playbackRate).toBe(1);
    scope.stop();
  });

  test('setSpeed dispara `onInteraction` (resetea el auto-hide de controles, igual que el resto de interacciones)', () => {
    let interactions = 0;
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { value: 100, configurable: true });
    const videoRef = ref<HTMLVideoElement | null>(video);
    const seekBarRef = ref<HTMLElement | null>(document.createElement('div'));
    const scope = effectScope();
    const controls = scope.run(() =>
      useNetflixControls({ videoRef, seekBarRef, onInteraction: () => { interactions++; } })
    )!;
    controls.setSpeed(0.75);
    expect(interactions).toBe(1);
    scope.stop();
  });
});
