// Service worker de Integral Vet
// Cachea el "cascarón" de la app (HTML, íconos, manifest y los scripts de Firebase)
// para que la app abra aunque no haya conexión a internet.
//
// Importante: NO tocamos las llamadas a Firestore/Auth (googleapis.com, firebaseio.com, etc.)
// Esas ya tienen su propio manejo de conexión/sincronización desde el código de la app
// (Firestore con persistencia local activada). Meternos ahí podría romper esa sincronización.
//
// Si en el futuro hacés un cambio grande y notás que el ícono no actualiza, subí este
// archivo con CACHE_VERSION cambiado (ej: 'integral-vet-v5') para forzar una caché nueva.

const CACHE_VERSION = 'integral-vet-v4';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js'
];

function esCacheable(url) {
  // El cascarón propio de la app (mismo dominio)...
  if (url.origin === self.location.origin) return true;
  // ...y los scripts estáticos de Firebase, que casi no cambian.
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) return true;
  // Todo lo demás (datos de Firestore, login, etc.) lo dejamos pasar sin intervenir.
  return false;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      // IMPORTANTE: guardamos cada archivo por separado (no con cache.addAll),
      // porque addAll es todo-o-nada: si UNO solo falla al bajar, no se guarda
      // NINGUNO, y la app queda sin nada para mostrar offline. Así, si el
      // celular tiene un hipo de conexión bajando un solo archivo, el resto
      // igual queda guardado — lo más importante (index.html) casi siempre entra.
      Promise.all(APP_SHELL.map(url =>
        fetch(url)
          .then(res => { if (res && res.ok) return cache.put(url, res); })
          .catch(err => console.warn('No se pudo precachear', url, err))
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!esCacheable(url)) return; // Firestore/Auth siguen su camino normal, sin pasar por acá

  event.respondWith(
    fetch(req)
      .then(res => {
        // Con conexión: siempre servimos lo más nuevo y actualizamos la copia guardada.
        if (res && res.status === 200) {
          const copia = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copia));
        }
        return res;
      })
      .catch(() => {
        // Sin conexión: buscamos la última copia guardada.
        return caches.match(req).then(cached => {
          if (cached) return cached;
          // Si pedían una página y no hay nada guardado, mostramos el cascarón principal.
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
      })
  );
});
