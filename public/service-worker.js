/**
 * KILL-SWITCH — Service Worker de autodestrucción.
 *
 * El experimento PWA (revertido) dejó un Service Worker REGISTRADO en los dispositivos
 * que lo visitaron (desktop, tablet, TV). Ese SW sigue activo e intercepta TODAS las
 * requests (incluidos los segmentos del pipeline /t/) → frena la reproducción.
 *
 * Borrar el archivo NO alcanza: cuando el script del SW da 404, el navegador MANTIENE el
 * registro viejo (sirviendo código viejo cacheado → círculo vicioso). La forma correcta de
 * remover un SW es publicar OTRO SW (este) que, al detectarlo el navegador como distinto,
 * se instala y se AUTODESTRUYE: se desregistra, borra los caches y recarga las pestañas
 * para que carguen el código fresco de red. Ya NO usamos PWA.
 *
 * A nadie nuevo se le registra este SW (main.ts ya no registra ninguno). Solo se activa en
 * los dispositivos que TENÍAN el SW huérfano, para matarlo. Después de correr una vez, no
 * queda ningún Service Worker.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch {
        /* noop */
      }
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* noop */
      }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.navigate(c.url));
      } catch {
        /* noop */
      }
    })()
  );
});
