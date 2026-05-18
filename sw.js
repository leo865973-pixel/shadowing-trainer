// sw.js
const CACHE_NAME = 'shadow-pro-v8';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(response => {
      // Use cache if offline, otherwise fetch and return
      return response || fetch(e.request);
    }).catch(() => {
      // Fallback behavior if fully offline
    })
  );
});