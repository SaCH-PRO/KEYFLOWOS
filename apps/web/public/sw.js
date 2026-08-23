/* If running on localhost, install a no-op SW — Turbopack chunks change on every
 * restart and caching them causes ChunkLoadError / 404 for dynamically imported pages. */
const IS_LOCALHOST =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1';

if (IS_LOCALHOST) {
  self.addEventListener('install', (_event) => {
    self.skipWaiting();
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.clients.claim().then(function() {
        // Unregister ourselves immediately so we never intercept requests
        return self.registration.unregister();
      })
    );
  });
  // No fetch listener — we want the browser to handle everything normally
} else {
  /* ========== PRODUCTION SERVICE WORKER ========== */

  const SHELL_CACHE = 'kf-shell-v3';
  const STATIC_CACHE = 'kf-static-v3';
  // Bumped v3 -> v4 so the activate handler below deletes the previous cache,
  // which may already hold authenticated responses stored before the
  // credentialed-request check above existed.
  const API_CACHE = 'kf-api-v4';

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

function isNextInternal(url) {
  /* Next.js internal assets — never cache. In dev (Turbopack) chunk hashes
   * change on every restart; caching them causes ChunkLoadError / 404. */
  return url.pathname.startsWith('/_next/static/chunks/') ||
    url.pathname.startsWith('/_next/static/css/') ||
    url.pathname.startsWith('/_next/static/media/') ||
    url.pathname.startsWith('/_next/static/webpack/') ||
    url.searchParams.has('_rsc');
}

function isDevOrigin(url) {
  return url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.local');
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/__api/');
}

function isAuthPage(url) {
  return url.pathname.startsWith('/auth/');
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

  /* API GET → network-first with cache fallback.
   *
   * A CREDENTIALED RESPONSE IS NEVER STORED. Cache Storage here is keyed by URL
   * with no auth dimension (nothing sets or honours Vary), the fallback is
   * served after a 5s network timeout, and nothing purges kf-api-* on logout in
   * production — both wipes (app/layout.tsx and hooks/use-service-worker.ts)
   * are gated to localhost. Storing an authenticated GET therefore means the
   * next person to use this browser can be handed the previous user's data.
   *
   * `cache: "no-store"` on the client fetch does NOT prevent this. That flag
   * governs the HTTP cache; cache.put() below is an explicit Cache Storage
   * write on a different layer, and runs regardless.
   *
   * This was masked on one client path by a `_t=${Date.now()}` cache-buster,
   * which made every URL unique so cache.match() could never hit. That was
   * never protection: 62 authenticated call sites (fetchWithAuthRetry and raw
   * fetch) never carried it and were always cacheable. Removing the buster
   * widened an existing hole rather than opening one, and the hole belongs
   * closed here rather than papered over with unique URLs.
   */
  if (isApiRequest(url)) {
    if (request.headers.get('authorization')) {
      return; /* untouched: straight to the network, never stored */
    }
    event.respondWith(networkFirstWithTimeout(request, API_CACHE, 5000));
    return;
  }

  /* Next.js internal (chunks, RSC, etc.) → always fetch fresh */
  if (isNextInternal(url)) {
    return;
  }

  /* Static assets → cache-first (skip in dev to avoid stale Turbopack chunks) */
  if (isStaticAsset(url) && !isDevOrigin(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  /* Navigation / app shell */
  if (request.mode === 'navigate') {
    /* Never cache auth pages — always fetch fresh to avoid stale login forms */
    if (isAuthPage(url)) {
      event.respondWith(
        fetch(request).catch(() =>
          caches.match(request).then((r) => r || new Response('Offline', { status: 503 }))
        )
      );
      return;
    }

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return (
            caches.match(request) ||
            caches.match('/app') ||
            caches.match('/') ||
            new Response('Offline', { status: 503 })
          );
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

/* ---------- Push Notifications ---------- */

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Notification', body: event.data.text() };
  }

  const title = payload.title || 'KEYFLOWOS';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: payload.tag || payload.id || 'default',
    requireInteraction: false,
    data: { url: payload.url || '/app' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});

} /* end production else block */
