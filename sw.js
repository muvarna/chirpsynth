
const CACHE_NAME = 'chirpsynth-v1.7';
const ASSETS = [
  './',
  './index.html',
  './index.tsx',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // MIME PROXY: Force correct Content-Type for TSX/TS files to satisfy strict browser checks
  if (url.origin === location.origin && (url.pathname.endsWith('.tsx') || url.pathname.endsWith('.ts'))) {
    event.respondWith(
      fetch(event.request).then(response => {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Content-Type', 'application/javascript');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
