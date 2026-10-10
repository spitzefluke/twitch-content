// Service Worker für die Handy-App (PWA). Grundsatz: immer frisch aus dem Netz – der Cache ist nur
// der Notfall, wenn das Netz weg ist. Dateien mit ?v=<Hash> ändern sich nie und kommen direkt aus
// dem Cache. Supabase, Twitch & Co. (andere Adressen) fasst der Worker nicht an; das OBS-Overlay
// (overlay.html) auch nicht – OBS soll nie eine alte Fassung zeigen.
const CACHE = 'streamhelp-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './assets/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/\/(overlay|record|admin)\.html$/.test(url.pathname)) return;
  // Versionierte Dateien: Cache zuerst (der Hash im Namen garantiert den Inhalt)
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => keep(req, res))));
    return;
  }
  // Alles andere: Netz zuerst, Cache nur ohne Netz
  e.respondWith(fetch(req).then((res) => keep(req, res)).catch(() =>
    caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then((hit) => hit ?? (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

function keep(req, res) {
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}
