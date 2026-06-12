/**
 * deviceDetect — detección de plataforma (TV / desktop / mobile).
 *
 * Extraído 1:1 del script inline que corre en `<head>` ANTES de renderizar
 * nada (líneas ~30-53 de assets/index.html). Se separó la lógica de
 * DETECCIÓN (pura, testeable con distintos userAgents/pantallas) de la
 * aplicación de clases al DOM (que en Vue será responsabilidad del store
 * `device.ts` al inicializarse).
 */

export interface DeviceDetectInput {
  userAgent: string;
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  hasTouch: boolean;
}

export interface DeviceDetectResult {
  isAndroid: boolean;
  isIOS: boolean;
  isMobileUA: boolean;
  isTV: boolean;
  isDesktop: boolean;
  mode: 'tv' | 'desktop' | 'mobile';
}

const TV_UA_RE = /smart-tv|smarttv|googletv|appletv|hbbtv|webos|tizen|netcast|viera|bravia|roku|lgtv/;

/**
 * detectDevice — replica EXACTAMENTE las condiciones originales (líneas
 * ~37-42):
 *   isAndroid = /android/
 *   isIOS     = /iphone|ipad|ipod/
 *   isMobileUA= /mobile|tablet/
 *   isTV      = <regex de marcas TV> || (sin touch && no-Android && ancho>=1280
 *                && aspect>1.6 && dpr<=1.5)   ← heurística para Smart TVs sin UA reconocible
 *   isDesktop = !touch && !Android && !iOS && !mobileUA && !TV
 *
 * El modo final sigue el orden de prioridad: TV > Desktop > Mobile (default).
 */
export function detectDevice(input: DeviceDetectInput): DeviceDetectResult {
  const ua = input.userAgent.toLowerCase();
  const { devicePixelRatio: dpr, screenWidth: w, screenHeight: h, hasTouch } = input;

  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMobileUA = /mobile|tablet/.test(ua);
  const isTV =
    TV_UA_RE.test(ua) || (!hasTouch && !isAndroid && w >= 1280 && w / h > 1.6 && dpr <= 1.5);
  const isDesktop = !hasTouch && !isAndroid && !isIOS && !isMobileUA && !isTV;

  const mode: DeviceDetectResult['mode'] = isTV ? 'tv' : isDesktop ? 'desktop' : 'mobile';

  return { isAndroid, isIOS, isMobileUA, isTV, isDesktop, mode };
}

/**
 * MOBILE_OVERRIDE_CSS — el `<style>` que se inyecta SOLO en modo mobile
 * (línea ~51) para forzar la bottom-nav y ocultar el nav de desktop.
 * Preservado tal cual — en Vue esto se vuelve CSS scoped condicional, pero
 * se documenta aquí para no perder el comportamiento exacto al portar.
 */
export const MOBILE_OVERRIDE_CSS =
  'nav#mainNav{display:none!important}.bottom-nav{display:flex!important}body{padding-bottom:64px!important}.hero{margin-top:0!important}.detail-page,.channels-page,.anime-page{padding-top:0!important}';
