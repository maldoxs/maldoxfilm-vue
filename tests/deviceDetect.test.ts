import { describe, test, expect } from 'vitest';
import { detectDevice, type DeviceDetectInput } from '../src/services/deviceDetect';

const base = (over: Partial<DeviceDetectInput> = {}): DeviceDetectInput => ({
  userAgent: '',
  devicePixelRatio: 1,
  screenWidth: 1920,
  screenHeight: 1080,
  hasTouch: false,
  ...over,
});

describe('detectDevice — heurística de plataforma (TV / Desktop / Mobile)', () => {
  test('reconoce Smart TVs por user-agent (webOS, Tizen, etc.)', () => {
    expect(detectDevice(base({ userAgent: 'Mozilla/5.0 (Web0S; LG SmartTV)' })).mode).toBe('tv');
    expect(detectDevice(base({ userAgent: 'Mozilla/5.0 (SMART-TV; Tizen 6.0)' })).mode).toBe('tv');
    expect(detectDevice(base({ userAgent: 'Roku/DVP-9.10' })).mode).toBe('tv');
  });

  test('detecta TVs sin UA reconocible por heurística de pantalla (sin touch, ancho>=1280, aspect>1.6, dpr<=1.5)', () => {
    const r = detectDevice(base({ userAgent: 'Mozilla/5.0 (X11; Linux)', screenWidth: 1920, screenHeight: 1080, hasTouch: false, devicePixelRatio: 1 }));
    expect(r.isTV).toBe(true);
    expect(r.mode).toBe('tv');
  });

  test('NO marca TV si el dispositivo tiene touch (aunque cumpla el resto)', () => {
    const r = detectDevice(base({ userAgent: 'Mozilla/5.0', screenWidth: 1920, screenHeight: 1080, hasTouch: true }));
    expect(r.isTV).toBe(false);
  });

  test('reconoce Android e iOS', () => {
    expect(detectDevice(base({ userAgent: 'Mozilla/5.0 (Linux; Android 13)', hasTouch: true })).isAndroid).toBe(true);
    expect(detectDevice(base({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', hasTouch: true })).isIOS).toBe(true);
  });

  test('Desktop: sin touch, no Android/iOS/mobile/TV', () => {
    const r = detectDevice(base({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      screenWidth: 1440,
      screenHeight: 900,
      hasTouch: false,
      devicePixelRatio: 2,
    }));
    expect(r.isDesktop).toBe(true);
    expect(r.mode).toBe('desktop');
  });

  test('Mobile: con touch y UA mobile/tablet', () => {
    const r = detectDevice(base({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile)',
      screenWidth: 412,
      screenHeight: 915,
      hasTouch: true,
      devicePixelRatio: 3,
    }));
    expect(r.mode).toBe('mobile');
    expect(r.isDesktop).toBe(false);
    expect(r.isTV).toBe(false);
  });

  test('orden de prioridad: TV gana sobre desktop si cumple la heurística de pantalla', () => {
    // pantalla ancha, sin touch, aspecto >1.6, dpr bajo → TV, no Desktop
    const r = detectDevice(base({ userAgent: 'Mozilla/5.0 (X11)', screenWidth: 1920, screenHeight: 1080, hasTouch: false, devicePixelRatio: 1 }));
    expect(r.mode).toBe('tv');
    expect(r.isDesktop).toBe(false);
  });
});
