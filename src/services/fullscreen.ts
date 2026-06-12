/**
 * fullscreen — la lógica de DECISIÓN (pura) detrás del fullscreen custom del
 * reproductor: estilos a aplicar, íconos SVG, y el cálculo de "¿debo
 * bloquear la orientación?".
 *
 * Extraído de `enterPlayerFullscreen`/`exitPlayerFullscreen`/
 * `togglePlayerFullscreen` (líneas ~8619-8693 de assets/index.html).
 *
 * Todo lo que toca `document`/`screen.orientation`/`AndroidKeyboard` queda en
 * el composable `useFullscreen.ts` (capa de orquestación) — aquí solo viven
 * los DATOS y CÁLCULOS que ese composable debe aplicar, para poder testear
 * "qué se debería hacer" sin un browser real.
 */

/**
 * FULLSCREEN_ICON_PATHS — los paths SVG exactos que se intercambian al
 * entrar/salir de fullscreen. Preservados de las líneas ~8633 y ~8668.
 */
export const FULLSCREEN_ICON_PATHS = {
  enter: '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>',
  exit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
} as const;

/**
 * FULLSCREEN_PATH_D — los MISMOS paths de {@link FULLSCREEN_ICON_PATHS}, pero
 * solo el atributo `d` (sin el wrapper `<path>`). Se usan para bindear `:d`
 * reactivamente en el `<svg>` que renderiza Vue, en vez de pisar el `innerHTML`
 * del icono de forma imperativa (lo que destruía el `<svg>` que Vue controla y
 * hacía DESAPARECER el icono al pulsarlo). `enter` = flechas hacia adentro
 * (estado EN fullscreen → "encoger"); `exit` = flechas hacia afuera (estado
 * NO-fullscreen → "expandir", el default del template).
 */
export const FULLSCREEN_PATH_D = {
  enter: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3',
  exit: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
} as const;

/**
 * FULLSCREEN_PAGE_STYLES / EXIT_PAGE_STYLES — los estilos inline que se
 * aplican/restauran sobre `#playerPage`. Preservados de las líneas
 * ~8627-8630 (entrar) y ~8662-8665 (salir, vacíos = "restaurar al valor de
 * la hoja de estilos").
 */
export const FULLSCREEN_PAGE_STYLES: Record<'position' | 'inset' | 'zIndex' | 'background', string> = {
  position: 'fixed',
  inset: '0',
  zIndex: '9999',
  background: '#000',
};

export const EXIT_PAGE_STYLES: Record<'position' | 'inset' | 'zIndex' | 'background', string> = {
  position: '',
  inset: '',
  zIndex: '',
  background: '',
};

/**
 * shouldLockOrientation — decide si corresponde forzar landscape al entrar
 * en fullscreen. Preservado EXACTO de las líneas ~8636-8637 (y su espejo en
 * ~8671-8672 para la salida):
 *   isMobile = (touch || maxTouchPoints>0) && !tv-mode
 *
 * Nota: en el original esto se llama "isMobile" pero en realidad es
 * "tiene touch y no es TV" — un tablet de escritorio con touchscreen también
 * entraría aquí. Se preserva el cálculo EXACTO sin "corregir" el nombre ni
 * la condición.
 */
export function shouldLockOrientation(hasTouch: boolean, isTvMode: boolean): boolean {
  return hasTouch && !isTvMode;
}

/**
 * isFullscreenTarget — replica la condición de `setupFullscreenFix` (línea
 * ~8704) para decidir si un elemento que pidió `requestFullscreen` debe
 * redirigirse a nuestro fullscreen custom (en vez del nativo del browser):
 *   el propio iframe, o un <video>, o un nodo dentro del documento del iframe
 *
 * Se separa el chequeo "soy el frame o soy un video" (síncrono, fácil de
 * testear) del chequeo "estoy dentro del iframe" (requiere acceso a
 * `contentDocument`, cross-origin — se delega al composable vía el parámetro
 * `isInsideFrameDocument`).
 */
export function isFullscreenTarget(
  el: { tagName?: string },
  frame: { tagName?: string } | null,
  isInsideFrameDocument: boolean
): boolean {
  if (!el) return false;
  if (frame && el === (frame as unknown)) return true;
  if (el.tagName === 'VIDEO') return true;
  return isInsideFrameDocument;
}
