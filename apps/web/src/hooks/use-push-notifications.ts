'use client';

/**
 * The signed-in member's own push notifications on this device (D-282: turned on and off from My account, by every
 * member; the routes are the member's own: push-notification.controller.ts, BusinessGuard only, subscribeOwn and
 * unsubscribeOwn).
 *
 * FU-PUSH-OPTIN-MY-ACCOUNT: it sends through lib/api (API_BASE and the member's token). It used to fetch
 * `/api/businesses/:id/push/...` relative to the web origin, which has no such route, with no Authorization header:
 * the config read failed, the key stayed null and subscribe returned without a word. Every state is now said:
 * unsupported, blocked, not set up on the server (no VAPID key), a read that failed, on, off, and a failed turn-on or
 * turn-off (`error`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

export type PushStatus =
  /** Reading this device's state. */
  | 'loading'
  /** This browser has no service worker, PushManager or Notification. */
  | 'unsupported'
  /** The member blocked notifications for this site in the browser. */
  | 'denied'
  /** The server has no VAPID key pair, so it cannot send push. */
  | 'unconfigured'
  /** The push config, or this device's subscription, could not be read (see `error`; `retry` reads again). */
  | 'unavailable'
  | 'subscribed'
  | 'unsubscribed';

interface PushConfig {
  publicKey: string | null;
  enabled?: boolean;
}

/** How long to wait for the service worker before saying it did not start. */
const READY_TIMEOUT_MS = 10_000;

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** This device's push subscription, if it has one. Never waits for a service worker that is not registered. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** An active service worker registration to subscribe with (the app's worker, /sw.js, registered if it is not yet). */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the app's background service did not start; reload the page and try again")), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function usePushNotifications(businessId?: string | null) {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    const settle = (next: PushStatus, message: string | null = null) => {
      if (!current) return;
      setStatus(next);
      setError(message);
    };
    void (async () => {
      if (!pushSupported()) return settle('unsupported');
      if (Notification.permission === 'denied') return settle('denied');
      if (!businessId) return settle('unavailable', 'Push settings could not be loaded: no business is selected.');
      settle('loading');
      const { data, error: readError } = await apiGet<PushConfig>(`/api/businesses/${encodeURIComponent(businessId)}/push/config`);
      if (!current) return;
      if (readError || !data) return settle('unavailable', `Push settings could not be loaded (${readError || 'no answer'}).`);
      if (!data.publicKey || data.enabled === false) return settle('unconfigured');
      setPublicKey(data.publicKey);
      try {
        settle((await currentSubscription()) ? 'subscribed' : 'unsubscribed');
      } catch (e) {
        settle('unavailable', `This device's push state could not be read (${messageOf(e, 'unknown error')}).`);
      }
    })();
    return () => {
      current = false;
    };
  }, [businessId, reads]);

  const retry = useCallback(() => setReads((n) => n + 1), []);

  const subscribe = useCallback(async () => {
    if (!businessId || !publicKey || busy) return;
    setBusy(true);
    setError(null);
    const done = (next: PushStatus | null, message: string | null = null) => {
      if (!live.current) return;
      if (next) setStatus(next);
      setError(message);
      setBusy(false);
    };
    let sub: PushSubscription;
    try {
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission === 'denied') return done('denied');
      if (permission !== 'granted') {
        return done('unsubscribed', 'Notifications were not allowed, so push stays off. Choose Allow when your browser asks.');
      }
      const reg = await activeRegistration();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    } catch (e) {
      return done('unsubscribed', `Push could not be turned on for this device (${messageOf(e, 'the browser refused')}).`);
    }
    const { error: saveError } = await apiPost<unknown>({
      path: `/api/businesses/${encodeURIComponent(businessId)}/push/subscribe`,
      body: { subscription: sub.toJSON() },
    });
    if (saveError) {
      // The server does not have this device: take the browser's subscription back, so "off" is true on both sides.
      await sub.unsubscribe().catch(() => undefined);
      return done('unsubscribed', `Push could not be turned on: this device was not saved (${saveError}).`);
    }
    done('subscribed');
  }, [businessId, publicKey, busy]);

  const unsubscribe = useCallback(async () => {
    if (!businessId || busy) return;
    setBusy(true);
    setError(null);
    const done = (next: PushStatus | null, message: string | null = null) => {
      if (!live.current) return;
      if (next) setStatus(next);
      setError(message);
      setBusy(false);
    };
    let sub: PushSubscription | null;
    try {
      sub = await currentSubscription();
    } catch (e) {
      return done(null, `Push could not be turned off (${messageOf(e, 'unknown error')}), so it stays on.`);
    }
    if (!sub) return done('unsubscribed');
    // The server first: if it keeps the device, push stays on here too, and the member is told.
    const { error: removeError } = await apiPost<unknown>({
      path: `/api/businesses/${encodeURIComponent(businessId)}/push/unsubscribe`,
      body: { endpoint: sub.endpoint },
    });
    if (removeError) return done('subscribed', `Push could not be turned off (${removeError}), so it stays on.`);
    try {
      await sub.unsubscribe();
    } catch (e) {
      return done('unsubscribed', `This device was removed, but the browser kept its subscription (${messageOf(e, 'unknown error')}).`);
    }
    done('unsubscribed');
  }, [businessId, busy]);

  return { status, busy, error, subscribe, unsubscribe, retry };
}
