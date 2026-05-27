// Simple offline-first service worker.
// Strategy:
//   - Same-origin requests:  cache-first, fall back to network, update cache in background.
//   - Cross-origin (CDN — pyodide, marked, hljs): stale-while-revalidate.
// Bump CACHE_VERSION when shipping major changes to force a refresh.

const CACHE_VERSION = 'coae-v3';
const ORIGIN = self.location.origin;

const PRECACHE = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/progress.js',
  'js/pyodide-cell.js',
  'js/practice.js',
  'data/path.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === ORIGIN;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreVary: true });

    if (cached) {
      // Refresh in background
      fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); }).catch(() => {});
      return cached;
    }

    try {
      const r = await fetch(req);
      if (r.ok && (sameOrigin || url.host.includes('cdn.jsdelivr.net') || url.host.includes('pyodide'))) {
        cache.put(req, r.clone()).catch(() => {});
      }
      return r;
    } catch (e) {
      // Offline fallback for navigations
      if (req.mode === 'navigate') {
        const fallback = await cache.match('index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
