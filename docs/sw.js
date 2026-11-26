// Service worker for the standalone build: the app must open and work with no signal on site.
// build.sh replaces the VERSION placeholder with a hash of index.html (every deploy installs a fresh cache) and the FONT_FILES placeholder with
// the self-hosted font files in docs/fonts/ (if any).
const V = 'tk-c63c28b219';
const PAGES = 'tk-pages'; // other pages on the same site (sales pages /en/, /bs/): network first, last copy offline
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the HTTP cache, so a new version never installs a stale index.html from it
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))));
  // no skipWaiting here: the open app shows "Nova verzija" and the user decides when to reload (message below)
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'skip') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V && k !== PAGES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return;
  const rel = url.pathname.slice(base.length);
  const isApp = rel === '' || rel === 'index.html';
  const inCore = isApp || CORE.includes('./' + rel);
  if (inCore) {
    // the app shell: cache first, so it opens instantly in the field; a new version arrives as a new service worker
    e.respondWith(caches.open(V).then(async c => (await c.match(isApp ? './index.html' : req, { ignoreSearch: true })) || fetch(req)));
    return;
  }
  // everything else (sales pages, their assets): network first, the last copy when offline
  e.respondWith(fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(PAGES).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.open(PAGES).then(c => c.match(req)).then(hit => hit || new Response('Nema mreže. / No connection.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
});
