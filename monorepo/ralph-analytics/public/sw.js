const CACHE = 'ralph-v1';
const OFFLINE_URLS = ['/', '/client', '/admin'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  return self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // API calls: network first
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({error:'offline'}),{headers:{'Content-Type':'application/json'}})));
    return;
  }
  // Pages: stale-while-revalidate
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(r => { if(r.ok) cache.put(e.request, r.clone()); return r; });
      return cached || fresh;
    })
  ));
});
