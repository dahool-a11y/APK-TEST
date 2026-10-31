/* Fahrtprofil – Offline-Cache (PWA) */
const CACHE = 'fahrtprofil-v27';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=27',
  './car.css?v=27',
  './manifest.webmanifest',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/images/layers.png',
  './vendor/images/layers-2x.png',
  './data/basemap.js?v=27',
  './js/basemap.js?v=27',
  './js/native-bridge.js?v=27',
  './js/simulate.js?v=27',
  './js/data.js?v=27',
  './js/store.js?v=27',
  './js/app.js?v=27',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

async function precache() {
  const cache = await caches.open(CACHE);
  // cache: 'reload' umgeht den HTTP-Cache. Sonst könnte eine veraltete
  // index.html aus dem Browser-Cache in den Offline-Cache wandern.
  await Promise.all(ASSETS.map(async (url) => {
    const res = await fetch(url, { cache: 'reload' });
    if (!res || !res.ok) throw new Error('Precache fehlgeschlagen: ' + url);
    await cache.put(url, res);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Navigationen: erst Netz (mit Revalidierung), offline aus dem Cache.
    // So kommt nach einem Update sofort die neue index.html, ohne dass der
    // heuristische HTTP-Cache eine alte Fassung liefert.
    if (req.mode === 'navigate') {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok && new URL(req.url).origin === self.location.origin) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        return (await cache.match(req)) ||
          (await cache.match('./index.html')) ||
          Response.error();
      }
    }

    // Statische Assets: aus dem Cache, im Hintergrund aktualisieren.
    const cached = await cache.match(req);
    if (cached) {
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            cache.put(req, res.clone());
          }
        })
        .catch(() => {});
      return cached;
    }

    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
