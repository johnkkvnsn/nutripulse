/* ─────────────────────────────────────────
   NutriPulse Service Worker
   Cache-first strategy for offline support + FCM
───────────────────────────────────────── */

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');


// Firebase Cloud Messaging enabled
firebase.initializeApp({
  apiKey: "AIzaSyChxGof0XLuq3d9Zfo1EU9kMS9ThQmYGWA",
  authDomain: "nutripulse-d01e0.firebaseapp.com",
  projectId: "nutripulse-d01e0",
  storageBucket: "nutripulse-d01e0.firebasestorage.app",
  messagingSenderId: "767403174340",
  appId: "1:767403174340:web:1fb5861447ca8aa63f9c91"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received:', payload);
  const title = payload.data?.title || 'NutriPulse';
  const options = {
    body: payload.data?.body || '',
    icon: payload.data?.icon || './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'nutripulse-notification',
    renotify: true,
    data: { url: payload.data?.url || './' },
    actions: [
      { action: 'log', title: '📝 Log Now' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  return self.registration.showNotification(title, options);
});


const CACHE_NAME = 'nutripulse-v2.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// ─── INSTALL ─────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Caching static assets');
      const results = await Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Failed to cache:', url, e)))
      );
      return results;
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH (Cache-First for static, Network-First for API) ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and analytics
  if (url.protocol === 'chrome-extension:') return;

  // Never cache API calls — always go to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ status: 'error', offline: true, message: 'Network unavailable' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Static assets: cache-first with stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Serve from cache, revalidate in background (stale-while-revalidate)
        const fetchPromise = fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }

          return response;
        }).catch(() => null);
        return cached;
      }

      // Not in cache — fetch from network
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;















        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ─── NOTIFICATION CLICK ──────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || './index.html';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});


// ─── BACKGROUND SYNC (for offline log queuing) ──
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-logs') {
    console.log('[SW] Background sync: syncing meal logs');
    // In production: send queued logs to server
  }
});
