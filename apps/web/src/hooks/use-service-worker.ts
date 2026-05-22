'use client';

import { useEffect, useState, useCallback } from 'react';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export function useServiceWorker() {
  const [isRegistered, setIsRegistered] = useState(false);
  const [isOffline, setIsOffline] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !navigator.onLine;
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');

  const triggerBackgroundSync = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    setSyncStatus('syncing');
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('sync' in reg) {
        await (
          reg as unknown as {
            sync: { register(tag: string): Promise<void> };
          }
        ).sync.register('kf-sync');
      } else {
        /* Fallback for browsers without Background Sync API */
        reg.active?.postMessage({ type: 'TRIGGER_SYNC' });
      }
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  }, []);

  /* Online / offline listeners */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onOffline = () => setIsOffline(true);
    const onOnline = () => {
      setIsOffline(false);
      triggerBackgroundSync();
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [triggerBackgroundSync]);

  /* Register on mount */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local');

    /* In dev or localhost, unregister any existing SW to avoid stale interceptors
     * and wipe caches so Turbopack chunks never get stuck. */
    if (isLocalhost) {
      navigator.serviceWorker.getRegistrations().then(async (regs) => {
        for (const reg of regs) {
          await reg.unregister();
          console.log('[SW] Unregistered in dev/localhost mode');
        }
        /* Wipe all caches so old chunk references don't survive */
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
            console.log('[SW] Cleared cache:', key);
          }
        }
        /* Also wipe IndexedDB used by the old SW */
        if ('indexedDB' in window) {
          const dbs = await indexedDB.databases?.().catch(() => []);
          for (const db of dbs) {
            if (db.name && db.name.startsWith('kf-')) {
              await new Promise((res, rej) => {
                const req = indexedDB.deleteDatabase(db.name!);
                req.onsuccess = res;
                req.onerror = rej;
              });
              console.log('[SW] Cleared IndexedDB:', db.name);
            }
          }
        }
      });
      return;
    }

    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        setIsRegistered(true);
        console.log('[SW] Registered:', reg.scope);
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
        setIsRegistered(false);
      });
  }, []);

  return { isRegistered, isOffline, syncStatus, triggerBackgroundSync };
}
