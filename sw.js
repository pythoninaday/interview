// Offline support: keep a copy of the app on the phone; refresh it in the background when online.
const CACHE = 'nip-v1.2.0';
const FILES = ['./','index.html','app.js','interview.js','content-units.js','content-cards.js','content-problems.js','manifest.webmanifest','icon-192.png','icon-512.png',
  'img/reynolds.png','img/aoa.png','img/aspect.png','img/stability.png','img/bestglide.png','img/compos.png','img/hyperbolic.png','img/carbon.png','img/payback.png','img/flight.png','img/wingload.png','img/egg.png','img/glide.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;   // never touch the Google Sheet posts
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, {ignoreSearch:true});
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
