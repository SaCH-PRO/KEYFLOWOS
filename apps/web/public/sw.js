const SHELL_CACHE = 'kf-shell-v1';
const STATIC_CACHE = 'kf-static-v1';
const API_CACHE = 'kf-api-v1';

const DB_NAME = 'kf-sync-queue';
const DB_STORE = 'requests';
const DB_VERSION = 1;

const APP_SHELL = [
  '/',
  '/app',
  '/manifest.webmanifest',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

/* ---------- IndexedDB helpers ---------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

async function enqueue(request) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);

  const entry = {
    url: request.url,
    method: request.method,
    headers: Array.from(request.headers.entries()),
    body: null,
    timestamp: Date.now(),
  };

  if (request.body) {
    entry.body = await request.clone().text();
  }

  store.add(entry);

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dequeueAll() {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  const index = store.index('timestamp');

  return new Promise((resolve, reject) => {
    const items = [];
    const cursor = index.openCursor();
    cursor.onsuccess = (event) => {
      const result = event.target.result;
      if (result) {
        items.push(result.value);
        result.continue();
      } else {
        resolve(items);
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

async function removeRequest(id) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  store.delete(id);

  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Lifecycle ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* best-effort: assets may 404 in dev */
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== STATIC_CACHE && n !== API_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

/* ---------- Caching strategies ---------- */

function isStaticAsset(url) {
  return /\.(js|css|png|jpg|jpeg|svg|gif|webp|avif|woff|woff2|ttf|otf|ico)$/i.test(
    url.pathname
  );
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/__api/');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstWithTimeout(request, cacheName, timeout = 4000) {
  const cache = await caches.open(cacheName);
  const network = fetch(request);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Network timeout')), timeout);
  });

  try {
    const response = await Promise.race([network, timeoutPromise]);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error('Network error and no cache');
  }
}

/* ---------- Fetch ---------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;

  /* Skip cross-origin requests (e.g., API calls to localhost:3001) */
  if (url.origin !== self.location.origin) return;

  /* Mutating requests → queue when offline */
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const cloneForQueue = request.clone();

    event.respondWith(
      fetch(request).catch(async () => {
        try {
          await enqueue(cloneForQueue);
        } catch (err) {
          console.error('[SW] enqueue failed:', err);
        }

        if ('sync' in self.registration) {
          try {
            await self.registration.sync.register('kf-sync');
          } catch {
            /* sync registration may fail in some browsers */
          }
        }

        return new Response(
          JSON.stringify({ queued: true, offline: true }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  /* API GET → network-first with cache fallback */
  if (isApiRequest(url)) {
    event.respondWith(networkFirstWithTimeout(request, API_CACHE, 5000));
    return;
  }

  /* Static assets → cache-first */
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  /* Navigation / app shell */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, clone));
            }
            return response;
          })
          .catch(() => {
            return (
              caches.match('/app') ||
              caches.match('/') ||
              new Response('Offline', { status: 503 })
            );
          });
      })
    );
    return;
  }

  /* Default: network then cache */
  event.respondWith(
    fetch(request).catch(() =>
      caches
        .match(request)
        .then((r) => r || new Response('Offline', { status: 503 }))
    )
  );
});

/* ---------- Background Sync ---------- */

async function processQueue() {
  const items = await dequeueAll();

  for (const item of items) {
    try {
      const headers = new Headers(item.headers);
      const response = await fetch(item.url, {
        method: item.method,
        headers,
        body: item.body,
      });

      /* Remove on success or client error (4xx means the request itself is bad) */
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await removeRequest(item.id);
      }
    } catch {
      /* Keep in queue for next retry */
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'kf-sync') {
    event.waitUntil(processQueue());
  }
});

/* Allow clients to manually trigger sync */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'TRIGGER_SYNC') {
    event.waitUntil(processQueue());
  }
});
