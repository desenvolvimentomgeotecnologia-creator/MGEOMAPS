/* MGEO PDF – service worker: app 100% offline */
const VERSION = 'mgeo-pdf-v5';
const SHELL_CACHE = VERSION + '-app';
const TILE_CACHE = 'mgeo-tiles-v1';
const SHELL = [
  './', './index.html', './manifest.json',
  './lib/leaflet.js', './lib/leaflet.css',
  './lib/pdf.min.js', './lib/pdf.worker.min.js', './lib/pdf-lib.min.js', './lib/supabase.js',
  './config.js', './tiles.js', './downloads.js', './auth.js', './extra.css', './privacidade.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTile = u => /(^|\.)google\.com$/.test(u.hostname) && u.pathname.startsWith('/vt');

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // downloads do botão "Baixar fundo" (cors) vão direto: o app guarda no IndexedDB
  if (isTile(url)) { if (req.mode !== 'cors') e.respondWith(tile(req)); return; }
  if (url.origin === self.location.origin) e.respondWith(app(req, e));
});

// Blocos do Google: o app guarda no IndexedDB (botão "Baixar fundo para offline").
// Aqui só servimos blocos que um download antigo tenha deixado no cache; nada é gravado automaticamente
// (respostas "opacas" ocupam muito espaço no Chrome e poderiam lotar o celular).
async function tile(req) {
  const hit = await caches.match(req, { cacheName: TILE_CACHE }).catch(() => null);
  if (hit) return hit;
  try { return await fetch(req); } catch (err) { return new Response('', { status: 504 }); }
}

async function app(req, e) {
  const c = await caches.open(SHELL_CACHE);
  let hit = await c.match(req, { ignoreSearch: true });
  if (!hit && req.mode === 'navigate') hit = await c.match('./index.html');
  const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || new Response('Offline', { status: 503 });
}
