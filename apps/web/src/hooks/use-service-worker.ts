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

    const isDev = process.env.NODE_ENV === 'development';

    /* In dev, unregister any existing SW to avoid stale interceptors */
    if (isDev) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          reg.unregister().then(() => {
            console.log('[SW] Unregistered in dev mode');
          });
        });
      });
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
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
