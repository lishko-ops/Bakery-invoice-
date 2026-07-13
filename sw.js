/* Service Worker — מעקב חשבוניות
   מאחסן את מעטפת האפליקציה כדי שתיפתח גם ללא רשת.
   דף האפליקציה (index.html) מוגש ב-network-first: כשיש אינטרנט תמיד
   נטענת הגרסה העדכנית ביותר; ללא אינטרנט — נופלים ל-cache.
   שאר הנכסים (אייקונים/מניפסט) — cache-first.
   בקשות חוץ (Gemini, גופנים) עוברות תמיד לרשת ולא נשמרות ב-cache. */
const CACHE = 'gan-receipts-v124';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* האם זו בקשה לדף האפליקציה עצמו (הניווט/ה-HTML)? */
function isAppDocument(req, url) {
  return req.mode === 'navigate' ||
         url.pathname === '/' ||
         url.pathname.endsWith('/') ||
         url.pathname.endsWith('/index.html') ||
         url.pathname.endsWith('index.html');
}

/* network-first עם timeout ו-fallback ל-cache (לאופליין/רשת תקועה) */
function networkFirst(req) {
  return new Promise(resolve => {
    let settled = false;
    const cacheFallback = () =>
      caches.match(req)
        .then(c => c || caches.match('./index.html'))
        .then(c => c || caches.match('./'));

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cacheFallback().then(c => resolve(c || fetch(req)));
    }, 4000);

    fetch(req).then(res => {
      /* חובה לשכפל סינכרונית — לפני שהדפדפן צורך את res דרך resolve */
      const forCache = res.clone();
      if (!settled) { settled = true; clearTimeout(timer); resolve(res); }
      /* מרעננים את ה-cache — גם תחת המפתחות הקנוניים ('./' ו-index.html)
         כדי שגם אופליין תמיד תוגש הגרסה העדכנית ביותר של דף האפליקציה */
      caches.open(CACHE).then(c => {
        const a = forCache.clone(), b = forCache.clone();
        return Promise.all([
          c.put(req, a),
          c.put('./index.html', b),
          c.put('./', forCache)
        ]);
      }).catch(() => {});
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cacheFallback().then(c => resolve(c || Response.error()));
    });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* בקשות למקורות חיצוניים (למשל Gemini API) — לא מטפלים, הדפדפן ניגש ישירות לרשת */
  if (url.origin !== location.origin) return;

  /* דף האפליקציה — network-first כדי שעדכונים יופיעו מיד */
  if (isAppDocument(req, url)) {
    e.respondWith(networkFirst(req));
    return;
  }

  /* שאר הנכסים המקומיים — cache-first, ומעדכנים ברקע */
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});
