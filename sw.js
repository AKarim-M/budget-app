// Service worker: keeps the whole app on the phone so it opens and works offline.
// Bump VERSION on every release so phones pick up the new files.

const VERSION = '2026.10.15-7';
const PREFIX = 'hb-shell-';
const CACHE = PREFIX + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/cycles.js',
  './js/dates.js',
  './js/demo.js',
  './js/engine.js',
  './js/lww.js',
  './js/money.js',
  './js/pwa.js',
  './js/records.js',
  './js/store.js',
  './js/sync-core.js',
  './js/sync.js',
  './js/ui/actions.js',
  './js/ui/dom.js',
  './js/ui/format.js',
  './js/ui/forms.js',
  './js/ui/glance.js',
  './js/ui/home.js',
  './js/ui/overlay.js',
  './js/ui/plan.js',
  './js/ui/settings.js',
  './js/ui/spending.js',
  './js/ui/sync-panel.js',
  './js/ui/wizard.js',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './vendor/qrcode-generator/qrcode.mjs',
];

self.addEventListener('install', (event) => {
  // 'reload' skips the browser's HTTP cache, so a release never mixes old and new files.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') event.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // e.g. Google Sheet sync: network only
  const scope = new URL(self.registration.scope);
  if (req.mode === 'navigate' && url.pathname.startsWith(scope.pathname)) {
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
