/**
 * useFullscreen — orquestación del fullscreen custom del reproductor.
 *
 * Capa de ORQUESTACIÓN sobre `services/fullscreen.ts` (lógica pura, ya
 * testeada). Reemplaza `enterPlayerFullscreen`/`exitPlayerFullscreen`/
 * `togglePlayerFullscreen`/`setupFullscreenFix` (líneas ~8619-8730 de
 * assets/index.html).
 *
 * ⚠️ Esta capa SÍ toca DOM/`screen.orientation`/`AndroidKeyboard`/eventos del
 * documento — no es testeable con Vitest puro (requiere un browser real con
 * soporte de fullscreen + orientación + WebView bridge). Por eso TODA la
 * lógica de "qué hacer" se extrajo a funciones puras ya cubiertas por tests;
 * aquí solo se aplican esos resultados sobre el DOM, preservando el flujo
 * EXACTO del original (mismo orden de pasos, mismos try/catch silenciosos).
 */

import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';

/**
 * Safari/iOS viejo expone fullscreen vendor-prefixed (`webkitFullscreenElement`/
 * `webkitExitFullscreen`/`webkitRequestFullscreen`) que NO están en `lib.dom.d.ts`
 * actuales — preserva el fallback del original (línea ~8649/~8682) sin recurrir
 * a `@ts-expect-error` (que `vue-tsc -b` reporta como "unused" porque el resto
 * del acceso SÍ tipa bien vía narrowing de intersección).
 */
type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};
import {
  FULLSCREEN_PAGE_STYLES,
  EXIT_PAGE_STYLES,
  shouldLockOrientation,
  isFullscreenTarget,
} from '../services/fullscreen';

// Bridge opcional inyectado por el WebView de Android (preservado de la
// línea ~8639: `AndroidKeyboard.lockLandscape()` / `unlockOrientation()`).
declare global {
  interface Window {
    AndroidKeyboard?: {
      lockLandscape?: () => void;
      unlockOrientation?: () => void;
    };
  }
}

export interface UseFullscreenOptions {
  /** Ref al contenedor `#playerPage`. */
  playerPageRef: Ref<HTMLElement | null | undefined>;
  /** Ref al ícono SVG del botón de fullscreen (`#iconFullscreen`). */
  iconRef: Ref<HTMLElement | null | undefined>;
  /** Ref al iframe del reproductor (`#playerFrame`), si aplica (fuentes RD usan <video>, no iframe). */
  frameRef?: Ref<HTMLElement | null | undefined>;
  /** ¿Estamos en modo TV? (de `useDeviceStore`) — afecta el lock de orientación. */
  isTvMode: () => boolean;
}

export interface UseFullscreenReturn {
  isFullscreen: Ref<boolean>;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

const hasTouchNow = (): boolean =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0;

function applyStyles(el: HTMLElement, styles: Record<string, string>) {
  for (const [prop, value] of Object.entries(styles)) {
    // `position`/`zIndex`/`background` son props de CSSStyleDeclaration válidas
    (el.style as unknown as Record<string, string>)[prop] = value;
  }
}

function lockOrientationLandscape() {
  try {
    window.AndroidKeyboard?.lockLandscape?.();
  } catch {
    try {
      // screen.orientation.lock SÍ tipa en el lib.dom de este proyecto — ya no
      // hace falta `@ts-expect-error` (preserva el try/catch silencioso del original).
      screen.orientation?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      /* silenciar — igual que el original */
    }
  }
}

function unlockOrientation() {
  try {
    window.AndroidKeyboard?.unlockOrientation?.();
  } catch {
    try {
      // screen.orientation.unlock SÍ tipa en el lib.dom de este proyecto — ya no
      // hace falta `@ts-expect-error` (preserva el try/catch silencioso del original).
      screen.orientation?.unlock?.();
    } catch {
      /* silenciar — igual que el original */
    }
  }
}

export function useFullscreen(opts: UseFullscreenOptions): UseFullscreenReturn {
  const isFullscreen = ref(false);

  function enter() {
    if (isFullscreen.value) return;
    isFullscreen.value = true;

    const page = opts.playerPageRef.value;
    if (page) applyStyles(page, FULLSCREEN_PAGE_STYLES);
    // El icono ya NO se pisa vía `innerHTML` (eso destruía el <svg> de Vue y lo
    // hacía desaparecer): cada componente bindea `:d` a `FULLSCREEN_PATH_D`
    // según `isFullscreen` reactivamente.

    if (shouldLockOrientation(hasTouchNow(), opts.isTvMode())) {
      lockOrientationLandscape();
    }

    // Intentar fullscreen nativo también (por si el WebView lo soporta) — línea ~8649
    try {
      const wkPage = page as WebkitFullscreenElement | null;
      if (wkPage?.requestFullscreen) wkPage.requestFullscreen();
      else if (wkPage?.webkitRequestFullscreen) wkPage.webkitRequestFullscreen();
    } catch {
      /* silenciar */
    }
  }

  function exit() {
    if (!isFullscreen.value) return;
    isFullscreen.value = false;

    const page = opts.playerPageRef.value;
    if (page) applyStyles(page, EXIT_PAGE_STYLES);
    // (icono manejado reactivamente vía `:d` — ver nota en `enter()`)

    if (shouldLockOrientation(hasTouchNow(), opts.isTvMode())) {
      unlockOrientation();
    }

    // Salir de fullscreen nativo si estaba activo — línea ~8682
    try {
      const wkDoc = document as WebkitFullscreenDocument;
      const fsEl = wkDoc.fullscreenElement || wkDoc.webkitFullscreenElement;
      if (fsEl) {
        if (wkDoc.exitFullscreen) wkDoc.exitFullscreen();
        else if (wkDoc.webkitExitFullscreen) wkDoc.webkitExitFullscreen();
      }
    } catch {
      /* silenciar */
    }
  }

  function toggle() {
    if (isFullscreen.value) exit();
    else enter();
  }

  // ── setupFullscreenFix (líneas ~8695-8730): interceptar requestFullscreen
  // del iframe/video para redirigirlo a nuestro fullscreen custom, y escuchar
  // fullscreenchange por si el browser lo dispara nativamente (Chrome desktop).
  let restoreReqFs: (() => void) | null = null;
  let restoreWkReqFs: (() => void) | null = null;

  function isInsideFrameDocument(el: Element): boolean {
    const frame = opts.frameRef?.value as HTMLIFrameElement | null | undefined;
    try {
      return !!(frame?.contentDocument?.contains && frame.contentDocument.contains(el));
    } catch {
      return false; // cross-origin → no se puede inspeccionar, igual que el original
    }
  }

  function onFullscreenChange() {
    const wkDoc = document as WebkitFullscreenDocument;
    const fsEl = wkDoc.fullscreenElement || wkDoc.webkitFullscreenElement;
    if (fsEl) enter();
    else exit();
  }

  onMounted(() => {
    const frame = opts.frameRef?.value;
    if (!opts.playerPageRef.value || !frame) return;

    const origReqFs = HTMLElement.prototype.requestFullscreen;
    if (origReqFs) {
      HTMLElement.prototype.requestFullscreen = function (this: HTMLElement, fsOpts?: FullscreenOptions) {
        if (isFullscreenTarget(this, frame, isInsideFrameDocument(this))) {
          enter();
          return Promise.resolve();
        }
        return origReqFs.call(this, fsOpts);
      };
      restoreReqFs = () => {
        HTMLElement.prototype.requestFullscreen = origReqFs;
      };
    }

    // @ts-expect-error — webkitRequestFullscreen es vendor-prefix legado
    const origWkReqFs = HTMLElement.prototype.webkitRequestFullscreen;
    if (origWkReqFs) {
      // @ts-expect-error — idem
      HTMLElement.prototype.webkitRequestFullscreen = function (this: HTMLElement, fsOpts?: unknown) {
        if (isFullscreenTarget(this, frame, isInsideFrameDocument(this))) {
          enter();
          return;
        }
        return origWkReqFs.call(this, fsOpts);
      };
      restoreWkReqFs = () => {
        // @ts-expect-error — idem
        HTMLElement.prototype.webkitRequestFullscreen = origWkReqFs;
      };
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  });

  onBeforeUnmount(() => {
    restoreReqFs?.();
    restoreWkReqFs?.();
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    if (isFullscreen.value) exit();
  });

  return { isFullscreen, enter, exit, toggle };
}
