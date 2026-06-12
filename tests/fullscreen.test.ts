import { describe, test, expect } from 'vitest';
import {
  FULLSCREEN_ICON_PATHS,
  FULLSCREEN_PAGE_STYLES,
  EXIT_PAGE_STYLES,
  shouldLockOrientation,
  isFullscreenTarget,
} from '../src/services/fullscreen';

describe('Íconos y estilos del fullscreen custom', () => {
  test('FULLSCREEN_ICON_PATHS trae los paths SVG exactos para entrar/salir', () => {
    expect(FULLSCREEN_ICON_PATHS.enter).toContain('<path');
    expect(FULLSCREEN_ICON_PATHS.exit).toContain('<path');
    expect(FULLSCREEN_ICON_PATHS.enter).not.toBe(FULLSCREEN_ICON_PATHS.exit);
  });

  test('FULLSCREEN_PAGE_STYLES cubre toda la pantalla en negro sobre todo lo demás', () => {
    expect(FULLSCREEN_PAGE_STYLES).toEqual({
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      background: '#000',
    });
  });

  test('EXIT_PAGE_STYLES restaura todos los estilos a vacío (vuelve a la hoja de estilos)', () => {
    expect(Object.values(EXIT_PAGE_STYLES).every((v) => v === '')).toBe(true);
  });
});

describe('shouldLockOrientation — ¿forzar landscape al entrar en fullscreen?', () => {
  test('sí, si tiene touch y NO está en modo TV', () => {
    expect(shouldLockOrientation(true, false)).toBe(true);
  });
  test('no, si está en modo TV (aunque tenga touch — ej. TV con touch raro)', () => {
    expect(shouldLockOrientation(true, true)).toBe(false);
  });
  test('no, si no tiene touch (desktop)', () => {
    expect(shouldLockOrientation(false, false)).toBe(false);
  });
});

describe('isFullscreenTarget — ¿redirigir requestFullscreen al fullscreen custom?', () => {
  const frame = { tagName: 'IFRAME' };

  test('true si el elemento ES el iframe del player', () => {
    expect(isFullscreenTarget(frame, frame, false)).toBe(true);
  });

  test('true si el elemento es un <video>', () => {
    expect(isFullscreenTarget({ tagName: 'VIDEO' }, frame, false)).toBe(true);
  });

  test('true si está dentro del documento del iframe (delegado por el composable)', () => {
    expect(isFullscreenTarget({ tagName: 'DIV' }, frame, true)).toBe(true);
  });

  test('false si no es ninguno de los anteriores', () => {
    expect(isFullscreenTarget({ tagName: 'DIV' }, frame, false)).toBe(false);
  });

  test('false si el elemento es nulo/falsy', () => {
    // @ts-expect-error — probar guard de entrada inválida
    expect(isFullscreenTarget(null, frame, true)).toBe(false);
  });
});
