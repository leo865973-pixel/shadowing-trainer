// sw.js
const CACHE_NAME = 'shadow-pro-v15';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

// 安裝時：下載新檔案，並「強制」立刻接管，不要等待
self.addEventListener('install', (e) => {
  self.skipWaiting(); 
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// 啟動時：把舊版本的快取垃圾全部刪除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache');
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // 立刻控制所有開啟的網頁
  );
});

// 攔截請求：優先使用快取，沒有再找網路
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(response => {
      return response || fetch(e.request);
    }).catch(() => {})
  );
});