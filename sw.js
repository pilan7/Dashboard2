/* Service Worker – דשבורד פרז
 * אסטרטגיה: Stale-While-Revalidate לקבצי האפליקציה.
 *  - תמיד מגיש מיד מהמטמון (טעינה מיידית + אופליין מלא).
 *  - ברקע מושך גרסה עדכנית מהשרת; אם הקוד השתנה – שומר ומודיע לדף לרענן.
 * => אין צורך להעלות מספר גרסה בכל שינוי קוד, ואין צורך לנקות מטמון ידנית.
 * שנה את CACHE_VERSION רק אם משנים את הלוגיקה של ה-Service Worker עצמו
 * או רוצים לאלץ ניקוי מלא של המטמון.
 */
const CACHE_VERSION = 'v2';
const CACHE = 'perez-dashboard-' + CACHE_VERSION;
const SHELL = [
  './',
  'index.html',
  'search-drive.html',
  'manifest.webmanifest',
  'logo.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('perez-dashboard-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTextual = (res) => /text|json|javascript|xml/i.test(res.headers.get('content-type') || '');

async function notifyClients() {
  const all = await self.clients.matchAll({ type: 'window' });
  all.forEach((c) => c.postMessage({ type: 'shell-updated' }));
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  let cached = await cache.match(req, { ignoreSearch: true });
  if (!cached && req.mode === 'navigate') {
    cached = await cache.match(new URL('index.html', self.registration.scope).href);
  }

  const isPage = req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname);

  const refresh = fetch(req, { cache: 'no-cache' })
    .then(async (res) => {
      if (res && res.ok) {
        let changed = false;
        if (cached && isPage && isTextual(res)) {
          const [a, b] = await Promise.all([cached.clone().text(), res.clone().text()]);
          changed = a !== b;
        }
        await cache.put(req, res.clone());
        if (changed) notifyClients();
      }
      return res;
    })
    .catch(() => null);

  event.waitUntil(refresh);

  if (cached) return cached;
  const fresh = await refresh;
  return fresh || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // בקשות ל-Google Sheets וכו' – ישירות לרשת
  if (url.searchParams.has('sw-bypass')) return;       // בדיקת גרסה מול השרת – תמיד ישירות לרשת
  event.respondWith(staleWhileRevalidate(event));
});
