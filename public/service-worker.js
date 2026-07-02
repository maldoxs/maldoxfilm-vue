/**
 * Service Worker para MaldoxFilm PWA
 *
 * ESTRATEGIA: "Network-first, cache as fallback"
 * - Precachea assets base (index.html, JS/CSS principales, manifest)
 * - TODO lo demás: intenta red primero, fallback a caché si está offline
 * - NO cachea streams RD (son efímeros + copyright)
 * - NO intenta offline-streaming (requiere internet SIEMPRE)
 */

const CACHE_NAME = 'maldoxfilm-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── INSTALL: precachea assets base ──
self.addEventListener('install', (event) => {
  console.log('[SW] Installing MaldoxFilm Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching essential assets');
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache error (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpia caches viejos ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// ── FETCH: network-first, cache fallback ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // NO cachear streams RD (efímeros)
  if (url.hostname.includes('real-debrid') || url.hostname.includes('cdn')) {
    event.respondWith(fetch(request).catch(() => networkOfflineResponse()));
    return;
  }

  // NO cachear APIs externas
  if (url.hostname.includes('api.themoviedb.org') || url.hostname.includes('opensubtitles')) {
    event.respondWith(fetch(request).catch(() => cacheOrOfflineResponse(request)));
    return;
  }

  // Network-first
  event.respondWith(networkFirst(request));
});

// ── Strategy: Network-first ──
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok || response.status === 304) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    const cached = await caches.match(request);
    return cached || response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.destination === 'document') {
      return new Response('Offline — no hay conexión', { status: 503 });
    }
    return new Response(null, { status: 503 });
  }
}

// ── Helper: caché o offline ──
async function cacheOrOfflineResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return new Response('Offline — no hay datos cacheados', { status: 503 });
}

// ── Helper: offline genérico ──
function networkOfflineResponse() {
  return new Response('Offline — no hay conexión', { status: 503 });
}

console.log('[SW] Service Worker script loaded');
