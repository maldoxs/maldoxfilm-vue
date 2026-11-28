/**
 * stores/device — el equivalente reactivo a las clases `tv-mode` /
 * `desktop-mode` / `mobile-mode` que el script inline del `<head>` aplicaba
 * a `document.documentElement` (líneas ~30-53 de assets/index.html).
 *
 * Toda la lógica de DETECCIÓN está en `services/deviceDetect.ts` (pura,
 * testeada). Este store solo la ejecuta una vez al montar la app y expone
 * el resultado de forma reactiva — cualquier componente puede usar
 * `deviceStore.isTV` / `deviceStore.mode` sin tocar el DOM directamente.
 */

import { defineStore } from 'pinia';
import { detectDevice, MOBILE_OVERRIDE_CSS } from '../services/deviceDetect';
import type { DeviceMode } from '../types';

export interface DeviceStateShape {
  mode: DeviceMode;
  isTV: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  detected: boolean;
}

/** Clave de `localStorage` donde queda anotado que este equipo es un televisor. */
const CLAVE_MODO = 'mf-modo-dispositivo';

/**
 * capacidadesDelEquipo — que dice el navegador que puede reproducir, para el log. Solo
 * informa: no cambia ninguna decision. Se pregunta de las dos formas porque no coinciden:
 * la TV niega el AC3 por MediaSource y lo reproduce por `<video src>`.
 */
function capacidadesDelEquipo(): string {
  const v = document.createElement('video');
  const cpt = (t: string) => {
    try {
      return v.canPlayType(t) || 'no';
    } catch {
      return 'error';
    }
  };
  const w = window as unknown as {
    MediaSource?: { isTypeSupported(t: string): boolean };
    ManagedMediaSource?: { isTypeSupported(t: string): boolean };
  };
  const mse = w.MediaSource || w.ManagedMediaSource;
  const mseHevc = (() => {
    try {
      return mse?.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"') ? 'si' : 'no';
    } catch {
      return 'error';
    }
  })();
  return [
    `hevc:${cpt('video/mp4; codecs="hvc1.1.6.L120.90"')}`,
    `h264:${cpt('video/mp4; codecs="avc1.640028"')}`,
    `ac3:${cpt('video/mp4; codecs="avc1.640028, ac-3"')}`,
    `eac3:${cpt('video/mp4; codecs="avc1.640028, ec-3"')}`,
    `av1:${cpt('video/mp4; codecs="av01.0.08M.08"')}`,
    `mkv:${cpt('video/x-matroska')}`,
    `hls:${cpt('application/vnd.apple.mpegurl')}`,
    `MediaSource:${w.MediaSource ? 'si' : 'no'}`,
    `ManagedMediaSource:${w.ManagedMediaSource ? 'si' : 'no'}`,
    `hevcPorMediaSource:${mseHevc}`,
  ].join(' ');
}

function leerModoRecordado(): 'tv' | null {
  try {
    return localStorage.getItem(CLAVE_MODO) === 'tv' ? 'tv' : null;
  } catch {
    return null; // almacenamiento bloqueado: se sigue con la detección normal
  }
}

function recordarModoTv() {
  try {
    localStorage.setItem(CLAVE_MODO, 'tv');
  } catch {
    /* almacenamiento bloqueado: no es motivo para fallar el arranque */
  }
}

export const useDeviceStore = defineStore('device', {
  state: (): DeviceStateShape => ({
    mode: 'desktop',
    isTV: false,
    isDesktop: true,
    isMobile: false,
    isAndroid: false,
    isIOS: false,
    detected: false,
  }),
  actions: {
    /**
     * detect — corre la heurística una sola vez (idealmente al arrancar la
     * app, antes de montar el router) y aplica las clases/estilos al
     * documento — preserva el efecto secundario original de "agregar clase
     * a <html>" e "inyectar <style> de overrides en mobile".
     */
    detect() {
      if (this.detected) return;
      const hasTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        // @ts-expect-error — msMaxTouchPoints es un vendor-prefix legado de IE/Edge viejo
        (navigator.msMaxTouchPoints || 0) > 0;
      const result = detectDevice({
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio || 1,
        screenWidth: screen.width,
        screenHeight: screen.height,
        hasTouch,
        modoRecordado: leerModoRecordado(),
      });
      // Una vez que un equipo se identifica como televisor, queda anotado: las
      // cargas siguientes no vuelven a depender de valores que en webOS cambian
      // entre una carga y otra (ver la nota de `esTelevisorRecordado`).
      if (result.mode === 'tv') recordarModoTv();

      this.mode = result.mode;
      this.isTV = result.isTV;
      this.isDesktop = result.isDesktop;
      this.isMobile = !result.isTV && !result.isDesktop;
      this.isAndroid = result.isAndroid;
      this.isIOS = result.isIOS;
      this.detected = true;

      const root = document.documentElement;
      root.classList.add(`${result.mode}-mode`);

      // FIX webOS (TV): en fullscreen, webOS deja el viewport de layout en un ancho
      // degenerado (~0). Como todos los contenedores de la app son bloques de ancho
      // automático, colapsan con él y el texto se parte una palabra por línea — se ve
      // sobre todo en "Mi Lista" vacía, la única pantalla sin nada que le imponga un
      // ancho mínimo (las grillas lo disimulan con su `minmax(...)`).
      // `screen.width` NO se degrada con ese estado, y para cualquier equipo detectado
      // como TV el `dpr <= 1.5` de `detectDevice` garantiza que ya viene en píxeles CSS.
      // Se expone como variable para que el piso de ancho lo aplique el CSS (ver
      // `html.tv-mode #app-shell` en style.css) en vez de un hack de JS.
      if (result.mode === 'tv' && screen.width >= 1280) {
        root.style.setProperty('--tv-screen-w', `${screen.width}px`);
      }

      // En TV no hay consola accesible, asi que los logs del reproductor se espejan a
      // una function para poder leerlos. Ver `services/tvLog.ts`.
      //
      // Se engancha tambien cuando el identificador del navegador PARECE de un televisor
      // aunque la deteccion no haya dado 'tv'. Sin eso, el unico caso que de verdad hay
      // que diagnosticar se quedaba mudo: el usuario reporta que a veces, en su TV,
      // aparecen los iconos de la barra inferior de movil. Si eso ocurre, la app creyo
      // ser un celular y antes dejaba de enviar logs justo en esa corrida.
      const pareceTv = /netcast|smarttv|smart-tv|webos|web0s|tizen|viera|bravia|lgtv/i.test(
        navigator.userAgent
      );
      const esTvParaElLog = result.mode === 'tv' || pareceTv || leerModoRecordado() === 'tv';
      // Desde el 2026-11-28 el log se envia desde todos los equipos, para medir que puede
      // reproducir directo cada uno (iPhone, tablet, computador) en vez de suponerlo.
      const ua = navigator.userAgent;
      const esIpad = /ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
      const equipo = esTvParaElLog
        ? 'tv'
        : esIpad
          ? 'ipad'
          : /iphone|ipod/i.test(ua)
            ? 'iphone'
            : /android/i.test(ua)
              ? 'android'
              : 'pc';
      {
        void import('../services/tvLog')
          .then((m) => {
            m.engancharLogsDeTv(fetch, equipo);
            // Cómo llegó la página: "reload" significa que el navegador volvió a
            // cargar la app por su cuenta (en la TV pasa cuando se queda sin memoria
            // con el reproductor abierto). Eso reinicia el reproductor desde RD y es
            // lo que se ve como "cambia de RD a UnlimPlay y vuelve a RD".
            const nav = performance.getEntriesByType?.('navigation')?.[0] as
              | PerformanceNavigationTiming
              | undefined;
            console.warn(
              `[RD] Arranque → carga:${nav?.type ?? '?'} modo:${result.mode} ` +
                `touch:${hasTouch ? 'si' : 'no'}/${navigator.maxTouchPoints} ` +
                `pantalla:${screen.width}x${screen.height} dpr:${window.devicePixelRatio} ` +
                `ruta:${location.pathname} ua:${navigator.userAgent}`
            );
            if (esTvParaElLog && result.mode !== 'tv') {
              console.warn(`[RD] ATENCION: parece un televisor pero se detecto modo "${result.mode}"`);
            }
            console.warn(`[RD] Capacidades → ${capacidadesDelEquipo()}`);
          })
          .catch(() => {});
      }
      if (result.mode === 'mobile') {
        const style = document.createElement('style');
        style.textContent = MOBILE_OVERRIDE_CSS;
        document.head.appendChild(style);
      }
    },
  },
});
