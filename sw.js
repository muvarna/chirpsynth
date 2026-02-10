
const CACHE_NAME = 'chirpsynth-v1.6';
const ASSETS = [
  './',
  './index.html',
  './index.tsx',
  './App.tsx',
  './types.ts',
  './manifest.json',
  './services/dspService.ts',
  './components/PianoKeyboard.tsx',
  './components/SampleList.tsx'
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

  // MIME PROXY: If requesting a TSX or TS file, manually set header to JS
  if (url.origin === location.origin && (url.pathname.endsWith('.tsx') || url.pathname.endsWith('.ts'))) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Create a copy of the response with the correct Content-Type header
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Content-Type', 'application/javascript');
        
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }).catch(err => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
    );
    return;
  }

  // Standard caching for other assets
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
