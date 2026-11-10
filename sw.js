/* MGEO Campo — service worker: app offline + cache de imagens de satélite */
const SHELL = 'mgeo-shell-v4';
const TILES = 'mgeo-tiles';
const FILES = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/geotiff.js',
  'fonts/archivo.woff2', 'assets/logo.png', 'assets/mark.png',
  'assets/icon-192.png', 'assets/icon-512.png', 'data/talhoes.geojson'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(FILES.map(f => fetch(f, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(f, r); throw new Error(f); }))))
      .then(() => self.skipWaiting())
  );
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

  // Arquivos do app: SEMPRE tenta a rede primeiro (ignorando o cache do navegador), para nunca
  // ficar preso em versão antiga. Sem sinal, ou se a rede demorar mais de 4 s, usa a cópia guardada.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const net = fetch(req.url, { cache: 'no-cache' }).then(res => {
        if (res.ok) cache.put(req.url, res.clone());
        return res;
      });
      net.catch(() => {});
      const slow = new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 4000));
      try {
        const res = await Promise.race([net, slow]);
        if (res.ok) return res;
        throw new Error('http ' + res.status);
      } catch (err) {
        const hit = await cache.match(req.url, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
        if (hit) return hit;
        return net.catch(() => new Response('Sem conexão', { status: 503 }));
      }
    })());
  }
  // Rotas (OSRM) e Sentinel-2 passam direto para a rede.
});
