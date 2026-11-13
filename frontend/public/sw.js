// CosmoQuantAI PWA Service Worker
const CACHE_NAME = 'cosmoquant-cache-v4';
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/pwa-192.png',
  '/pwa-512.png',
  '/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return undefined;
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GET requests; never intercept API, WebSockets, or cross-origin exchange traffic
  if (
    req.method !== 'GET' ||
    !req.url.startsWith(self.location.origin) ||
    req.url.includes('/api/') ||
    req.url.includes('/market-depth/') ||
    req.url.includes('/ws')
  ) {
    return;
  }

  const isStaticAsset =
    req.url.includes('/assets/') ||
    req.destination === 'script' ||
    req.destination === 'style' ||
    req.destination === 'image' ||
    req.destination === 'font';

  if (isStaticAsset) {
    // Stale-while-revalidate for static assets to reduce mobile radio wakeups & speed up PWA boot
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const networkPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          })
          .catch(
            () =>
              cached ||
              new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' }
              })
          );
        return cached || networkPromise;
      })
    );
    return;
  }

  // Network-first (bypassing HTTP disk cache) for HTML navigation so deployments always serve fresh UI
  event.respondWith(
    fetch(req, { cache: 'no-store' }).catch(async () => {
      const cachedResponse = await caches.match(req);
      if (cachedResponse) {
        return cachedResponse;
      }
      if (req.mode === 'navigate') {
        const fallbackIndex = (await caches.match('/index.html')) || (await caches.match('/'));
        if (fallbackIndex) {
          return fallbackIndex;
        }
      }
      return new Response('Network error occurred', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
