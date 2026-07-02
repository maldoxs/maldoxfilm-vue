import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './style.css';
// Fallbacks de layout SOLO para navegadores viejos (Chromium 38 / LG webOS 3). Todo va
// dentro de @supports not(...), así que el navegador moderno lo ignora por completo.
import './legacy-compat.css';
import App from './App.vue';
import router from './router';
import { useDeviceStore } from './stores/device';
import { createAppServices, APP_SERVICES_KEY } from './services/bootstrap';

/**
 * Bootstrap de la app — reemplaza el script inline del `<head>` (líneas
 * ~30-53) que detectaba el dispositivo y aplicaba clases a `<html>` ANTES de
 * pintar nada, y el armado disperso de clientes de red (`tmdb()`/`rdGetStream`).
 *
 * Orden preservado intencionalmente:
 *   1. Pinia ANTES que nada — los stores (`device`, `player`, `myList`) deben
 *      existir antes de que cualquier composable/componente los use.
 *   2. `deviceStore.detect()` — debe correr ANTES de montar (igual que el
 *      script inline original corría antes del primer paint, para que
 *      `tv-mode`/`mobile-mode`/`desktop-mode` ya estén aplicados al `<html>`
 *      cuando el usuario ve la primera pantalla — evita el "flash" de layout
 *      incorrecto).
 *   3. `createAppServices` — arma TMDB/Torrentio/RD/RdStreamResolver una
 *      sola vez (ver `bootstrap.ts`); es async porque resuelve el RD token
 *      desde el backend, así que se espera antes de montar.
 *   4. Router + montaje.
 */
async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const deviceStore = useDeviceStore(pinia);
  deviceStore.detect();

  const services = await createAppServices({ isTvMode: deviceStore.isTV });
  app.provide(APP_SERVICES_KEY, services);

  app.use(router);
  app.mount('#app');

  // ── Service Worker (PWA) ──
  // Registra el SW solo si está disponible. Falla sin error si el navegador no lo soporta.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .then(() => console.log('[PWA] Service Worker registered'))
      .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
  }
}

bootstrap();
