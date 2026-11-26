/* ===========================================================================
   SERVICE WORKER DEL GESTIONALE
   Serve a una cosa sola: rendere l'app installabile (Mac, Windows, iPhone) e
   farla aprire anche se la rete manca per un attimo. Non tiene dati: le
   chiamate al database (Supabase) e le librerie dal CDN passano dirette, non
   vengono mai salvate qui.
   La pagina si chiede SEMPRE prima alla rete: cosi' ogni aggiornamento
   pubblicato arriva subito. Solo se la rete non risponde si usa l'ultima
   copia salvata.
   =========================================================================== */
const CACHE = 'scs-gestionale-v1';
const FILE = ['./', './manifest.webmanifest', './icons/icona-192.png', './icons/icona-512.png',
              './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  /* solo i file del sito, solo in lettura: database e CDN non si toccano */
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(risp => {
    if (risp.ok && (r.mode === 'navigate' || FILE.some(f => u.pathname.endsWith(f.slice(1))))) {
      const copia = risp.clone();
      caches.open(CACHE).then(c => c.put(r.mode === 'navigate' ? './' : r, copia));
    }
    return risp;
  }).catch(() => caches.match(r.mode === 'navigate' ? './' : r).then(x => x || caches.match('./'))));
});
