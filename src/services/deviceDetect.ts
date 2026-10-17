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
  /**
   * Modo que este MISMO equipo ya se había detectado en una visita anterior
   * (lo guarda el store en `localStorage`). Solo se usa el valor `'tv'`: ver
   * la nota de `esTelevisorRecordado` más abajo.
   */
  modoRecordado?: 'tv' | null;
}

export interface DeviceDetectResult {
  isAndroid: boolean;
  isIOS: boolean;
  isMobileUA: boolean;
  isTV: boolean;
  isDesktop: boolean;
  mode: 'tv' | 'desktop' | 'mobile';
}

// `web0s` (con CERO, no con "o") no es un error de tipeo: es como se identifica el
// navegador de los televisores LG desde webOS 4 — `Mozilla/5.0 (Web0S; Linux/SmartTV)`.
// Sin esa variante, la TV del usuario nunca calzaba por marca y quedaba dependiendo
// SOLO de la heurística de tamaño/táctil de abajo, que es la que a veces falla y la
// hace pasar por móvil (barra inferior "Inicio / Buscar / Mi Netflix" y layout roto).
const TV_UA_RE =
  /smart-tv|smarttv|smart_tv|googletv|appletv|hbbtv|webos|web0s|tizen|netcast|viera|bravia|roku|lgtv/;

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

  // Un equipo que YA se identificó como televisor no se degrada a móvil en una
  // carga posterior. La heurística de abajo depende de `hasTouch`, `screen.*` y
  // `devicePixelRatio`, y en webOS esos tres valores no siempre son los mismos en
  // cada carga (el puntero del Magic Remote llega a reportar soporte táctil, y en
  // pantalla completa el navegador devuelve medidas degeneradas). Cuando eso pasa
  // la misma TV se detecta como móvil: aparece la barra inferior de teléfono y el
  // CSS de móvil descuadra la grilla. El recuerdo solo se honra si el navegador no
  // dice ser un teléfono, así que no puede "pegarse" en un equipo que sí lo es.
  const esTelevisorRecordado =
    input.modoRecordado === 'tv' && !isAndroid && !isIOS && !/mobile|tablet/.test(ua);

  const isTV =
    TV_UA_RE.test(ua) ||
    esTelevisorRecordado ||
    (!hasTouch && !isAndroid && w >= 1280 && w / h > 1.6 && dpr <= 1.5);
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
