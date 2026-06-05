'use client';

import { useEffect, useState, useCallback } from 'react';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export type PushStatus = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

export function usePushNotifications(businessId?: string | null) {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/push/config`);
      if (res.ok) {
        const data = await res.json();
        setVapidKey(data.publicKey);
      }
    } catch {
      /* ignore */
    }
  }, [businessId]);

  const checkStatus = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    const perm = Notification.permission;
    if (perm === 'denied') {
      setStatus('denied');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setStatus(sub ? 'subscribed' : 'unsubscribed');
  }, []);

  useEffect(() => {
    checkStatus();
    fetchConfig();
  }, [checkStatus, fetchConfig]);

  const subscribe = useCallback(async () => {
    if (!businessId || !vapidKey) return;
    setStatus('loading');
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'current-user',
          subscription: sub.toJSON(),
        }),
      });

      if (!res.ok) throw new Error('Failed to save subscription');
      setStatus('subscribed');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Subscription failed');
      setStatus('unsubscribed');
    }
  }, [businessId, vapidKey]);

  const unsubscribe = useCallback(async () => {
    if (!businessId) return;
    setStatus('loading');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch(`/api/businesses/${encodeURIComponent(businessId)}/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setStatus('unsubscribed');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unsubscribe failed');
      setStatus('subscribed');
    }
  }, [businessId]);

  return { status, error, subscribe, unsubscribe };
}
