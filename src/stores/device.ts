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
      const result = detectDevice({
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio || 1,
        screenWidth: screen.width,
        screenHeight: screen.height,
        hasTouch:
          'ontouchstart' in window ||
          navigator.maxTouchPoints > 0 ||
          // @ts-expect-error — msMaxTouchPoints es un vendor-prefix legado de IE/Edge viejo
          (navigator.msMaxTouchPoints || 0) > 0,
      });

      this.mode = result.mode;
      this.isTV = result.isTV;
      this.isDesktop = result.isDesktop;
      this.isMobile = !result.isTV && !result.isDesktop;
      this.isAndroid = result.isAndroid;
      this.isIOS = result.isIOS;
      this.detected = true;

      const root = document.documentElement;
      root.classList.add(`${result.mode}-mode`);
      if (result.mode === 'mobile') {
        const style = document.createElement('style');
        style.textContent = MOBILE_OVERRIDE_CSS;
        document.head.appendChild(style);
      }
    },
  },
});
