/**
 * Lightweight, dependency-free first-party analytics SDK shared by every
 * public page (storefront, booking, intake, order, quote, pay).
 *
 * Captures page views, item/product/service views, conversion start/
 * complete, form submissions, WhatsApp clicks, and share clicks.
 * Reads UTM params + referrer on first hit and persists them on the
 * `kf_vid` visitor cookie / localStorage so subsequent contact creates
 * carry the original attribution.
 *
 * Honors the browser DNT / Sec-GPC signals — when set, the SDK
 * intentionally short-circuits all event sends.
 */

const VISITOR_KEY = 'kf_vid';
const SESSION_KEY = 'kf_sid';
const FIRST_TOUCH_KEY = 'kf_first_touch';
const REFERRAL_KEY = 'kf_ref';
const SESSION_MAX_MS = 30 * 60 * 1000;

type PresenceEventType =
  | 'page_view'
  | 'view'
  | 'product_view'
  | 'service_view'
  | 'booking_start'
  | 'booking_complete'
  | 'checkout_start'
  | 'checkout_complete'
  | 'form_submit'
  | 'whatsapp_click'
  | 'share_click';

type PresenceEvent = {
  // May be empty when the client doesn't yet know the businessId — the
  // server resolves it from the Referer in that case.
  businessId: string;
  type: PresenceEventType;
  path?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  payload?: Record<string, unknown>;
  ts?: number;
};

type FirstTouch = {
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
  path?: string;
  capturedAt: number;
};

const queue: PresenceEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let apiBase = '';

function isDoNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false;
  // @ts-expect-error legacy & vendor signals
  const dnt = navigator.doNotTrack || window?.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || dnt === true) return true;
  // @ts-expect-error global privacy control (Sec-GPC)
  if (navigator.globalPrivacyControl) return true;
  return false;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of (document.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('=').trim()) || null;
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSec: number) {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

function getOrCreateVisitorId(): string {
  const fromCookie = readCookie(VISITOR_KEY);
  if (fromCookie) return fromCookie;
  const ls = safeStorage();
  const fromLs = ls?.getItem(VISITOR_KEY) || null;
  if (fromLs) {
    writeCookie(VISITOR_KEY, fromLs, 365 * 86400);
    return fromLs;
  }
  // Server will mint a permanent ID; we send empty and adopt response.
  return '';
}

function getOrCreateSessionId(): string {
  const fromCookie = readCookie(SESSION_KEY);
  if (fromCookie) return fromCookie;
  const ls = safeStorage();
  if (ls) {
    const stored = ls.getItem(SESSION_KEY);
    const ts = parseInt(ls.getItem(`${SESSION_KEY}_ts`) || '0', 10);
    if (stored && Date.now() - ts < SESSION_MAX_MS) {
      writeCookie(SESSION_KEY, stored, 30 * 60);
      return stored;
    }
  }
  return '';
}

function persistVisitorId(id: string | null | undefined) {
  if (!id) return;
  const ls = safeStorage();
  try { ls?.setItem(VISITOR_KEY, id); } catch { /* ignore */ }
  writeCookie(VISITOR_KEY, id, 365 * 86400);
}

function persistSessionId(id: string | null | undefined) {
  if (!id) return;
  const ls = safeStorage();
  try {
    ls?.setItem(SESSION_KEY, id);
    ls?.setItem(`${SESSION_KEY}_ts`, String(Date.now()));
  } catch { /* ignore */ }
  writeCookie(SESSION_KEY, id, 30 * 60);
}

function captureFirstTouch(): FirstTouch | null {
  const ls = safeStorage();
  if (typeof window === 'undefined') return null;
  const existing = ls?.getItem(FIRST_TOUCH_KEY);
  if (existing) {
    try { return JSON.parse(existing) as FirstTouch; } catch { /* re-derive below */ }
  }

  let params: URLSearchParams | null = null;
  try { params = new URLSearchParams(window.location.search); } catch { params = null; }

  let referrerHost: string | undefined;
  if (document.referrer) {
    try { referrerHost = new URL(document.referrer).host || undefined; } catch { /* ignore */ }
  }

  const source = params?.get('utm_source') || referrerHost || undefined;
  const ft: FirstTouch = {
    source: source || undefined,
    medium: params?.get('utm_medium') || (referrerHost ? 'referral' : undefined),
    campaign: params?.get('utm_campaign') || undefined,
    referrer: document.referrer || undefined,
    path: window.location.pathname,
    capturedAt: Date.now(),
  };
  try { ls?.setItem(FIRST_TOUCH_KEY, JSON.stringify(ft)); } catch { /* ignore */ }

  const ref = params?.get('ref') || params?.get('referral');
  if (ref) {
    try { ls?.setItem(REFERRAL_KEY, ref); } catch { /* ignore */ }
  }

  return ft;
}

function readFirstTouch(): FirstTouch | null {
  const ls = safeStorage();
  const raw = ls?.getItem(FIRST_TOUCH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as FirstTouch; } catch { return null; }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 800);
}

async function flush() {
  if (queue.length === 0) return;
  if (!apiBase) return;
  if (isDoNotTrack()) { queue.length = 0; return; }
  const events = queue.splice(0, queue.length);
  const visitorId = getOrCreateVisitorId();
  const sessionId = getOrCreateSessionId();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (visitorId) headers['X-Visitor-Id'] = visitorId;
    if (sessionId) headers['X-Session-Id'] = sessionId;
    const res = await fetch(`${apiBase}/public/events`, {
      method: 'POST',
      headers,
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({ visitorId, sessionId, events }),
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.visitorId) persistVisitorId(json.visitorId);
      if (json?.sessionId) persistSessionId(json.sessionId);
    }
  } catch {
    // Best-effort. Never block the UX on analytics delivery.
  }
}

/** Initialize the SDK (idempotent). Safe to call from every layout. */
export function initPresence(opts: { apiBase: string }) {
  if (typeof window === 'undefined') return;
  apiBase = opts.apiBase;
  if (initialized) return;
  initialized = true;
  captureFirstTouch();
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { void flush(); }, { capture: true });
    window.addEventListener('pagehide', () => { void flush(); }, { capture: true });
  }
}

/**
 * Record a presence event. Auto-injects path + first-touch attribution.
 *
 * `businessId` may be an empty string when the calling page doesn't
 * yet know it (e.g. the /pay/link/[token] redirect page). The server
 * will resolve it from the Referer URL in that case.
 */
export function trackPresence(
  businessId: string,
  type: PresenceEventType,
  payload?: Record<string, unknown>,
) {
  if (typeof window === 'undefined') return;
  if (isDoNotTrack()) return;
  const ft = readFirstTouch();
  queue.push({
    businessId,
    type,
    path: window.location.pathname,
    source: ft?.source,
    medium: ft?.medium,
    campaign: ft?.campaign,
    referrer: ft?.referrer || document.referrer || undefined,
    payload: payload && Object.keys(payload).length > 0 ? payload : undefined,
    ts: Date.now(),
  });
  scheduleFlush();
}

/** Convenience: record the page view for the current pathname. */
export function trackPageView(businessId: string, payload?: Record<string, unknown>) {
  trackPresence(businessId, 'page_view', payload);
}

/**
 * Type-safe lookup for `businessId` on a loaded resource without using
 * double-cast hacks. Accepts `{ businessId }` or `{ business: { id } }`
 * shapes and returns `undefined` for anything else.
 */
export function pickBusinessId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as { businessId?: unknown; business?: unknown };
  if (typeof obj.businessId === 'string' && obj.businessId) return obj.businessId;
  if (obj.business && typeof obj.business === 'object') {
    const b = obj.business as { id?: unknown };
    if (typeof b.id === 'string' && b.id) return b.id;
  }
  return undefined;
}

export function getStoredVisitorId(): string | null {
  return getOrCreateVisitorId() || null;
}

export function getStoredReferralCode(): string | null {
  const ls = safeStorage();
  return ls?.getItem(REFERRAL_KEY) || null;
}
