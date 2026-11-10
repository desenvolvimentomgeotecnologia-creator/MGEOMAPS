/* MGEO Campo — service worker: app offline + cache de imagens de satélite */
const SHELL = 'mgeo-shell-v1';
const TILES = 'mgeo-tiles';
const FILES = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/geotiff.js',
  'fonts/archivo.woff2', 'assets/logo.png', 'assets/mark.png',
  'assets/icon-192.png', 'assets/icon-512.png', 'data/talhoes.geojson'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Imagens de satélite: primeiro o que já está guardado, depois a rede (e guarda).
  if (url.hostname === 'server.arcgisonline.com') {
    e.respondWith(
      caches.open(TILES).then(async cache => {
        const hit = await cache.match(req.url);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req.url, res.clone());
          return res;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'offline' });
        }
      })
    );
    return;
  }

  // Arquivos do app: responde do cache na hora e atualiza por trás.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(SHELL).then(async cache => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const net = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return hit || (await net) || new Response('Sem conexão', { status: 503 });
      })
    );
  }
  // Rotas (OSRM) e Sentinel-2 passam direto para a rede.
});
