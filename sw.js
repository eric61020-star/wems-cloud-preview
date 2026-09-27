// 7.17: retain offline photos and cache versions.
// 7.16: preserve existing offline caches and queued photos.
// Build 7.15: atomic serial reimport and right-aligned work status; retain caches.
// Build 7.14: serial-first identity and prominent pending status; retain caches.
// Build 7.13: responsive light card layout; retain caches.
// Build 7.12: transactional work item transfer; retain caches.
// Build 7.9: contextual photo help and completion check; retain caches.
// Build 7.8: photo coverage and per-device queue status; retain existing caches.
// Build 2026-09-10: photo queue recovery and local photo export. Keep existing offline caches.
const CACHE_PREFIX = 'wems-pages-719-';
const VERSION = `${CACHE_PREFIX}v1`;
const BASE_URL = new URL('./', self.location.href);
const scopedUrl = (path) => new URL(path, BASE_URL).href;
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const PHOTO_CACHE = `${VERSION}-photos`;
const APP_SHELL = ['', 'index.html', 'manifest.webmanifest'].map(scopedUrl);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      for (const url of APP_SHELL) {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (error) {
          console.warn('App shell cache failed:', url, error);
        }
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, RUNTIME_CACHE, PHOTO_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'WARM_CACHE' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        for (const url of event.data.urls) {
          try {
            const request = new Request(url, { cache: 'reload', credentials: 'same-origin' });
            const response = await fetch(request);
            if (response.ok) await cache.put(request, response.clone());
          } catch (error) {
            console.warn('Warm cache failed:', url, error);
          }
        }
      }),
    );
  }
});

async function networkFirst(request, cacheName, fallbackRequest) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (
      (await cache.match(request)) ||
      (fallbackRequest ? await caches.match(fallbackRequest) : undefined) ||
      Response.error()
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 地圖圖磚數量很大，不存進 WEMS 照片快取，避免占用手機空間。
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE, scopedUrl('index.html')));
    return;
  }

  if (url.origin === self.location.origin) {
    const isDevelopmentModule =
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/@vite/') ||
      url.pathname.startsWith('/@react-refresh') ||
      url.pathname.startsWith('/node_modules/');

    // Vite 開發模式的模組永遠讀取目前檔案，避免舊 Service Worker
    // 把上一版 main.jsx 留在快取中。正式版資源則採網路優先、離線回快取。
    if (isDevelopmentModule) {
      event.respondWith(fetch(request));
      return;
    }

    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  const isPhoto = request.destination === 'image' || /\/storage\/v1\/object\//.test(url.pathname);
  if (isPhoto) {
    event.respondWith(networkFirst(request, PHOTO_CACHE));
  }
});
