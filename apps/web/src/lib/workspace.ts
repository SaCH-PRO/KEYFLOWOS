"use client";

import { toast } from "sonner";
import { bootstrapIdentity } from "./client";
// ./api-base rather than ./api: api.ts imports refreshAccessToken from THIS
// file, so pulling API_BASE from there would close an import cycle and could
// leave the constant undefined depending on which module initialises first.
import { getApiBase } from "./api-base";
import { isAdminTokenUsable } from "./admin-session";
import {
  dismissRemovedBusinessNotice,
  getRemovedBusinessNotice,
  getRemovedBusinessNoticeUserId,
  raiseRemovedBusinessNotice,
} from "./removed-business-notice";

const BUSINESS_ID_KEY = "kf_business_id";
const TOKEN_KEY = "kf_token";
const REFRESH_TOKEN_KEY = "kf_refresh_token";
const BUSINESS_CACHE_KEY = "kf_business_cache";
const USER_CACHE_KEY = "kf_user_cache";
const ADMIN_USER_CACHE_KEY = "kf_admin_user_cache";
const ADMIN_TOKEN_KEY = "kf_admin_token";
const AUTH_MODE_KEY = "kf_auth_mode";
/**
 * RR-ADMIN-LOGOUT: the keys an admin login writes (localStorage, mirrored into
 * non-HttpOnly cookies by admin/login/page.tsx). getAuthHeaders sends the admin
 * bearer in preference to the user's token on EVERY API call, so these must go
 * on every sign-out and before every user sign-in: on a shared browser a
 * surviving kf_admin_token attributed the next person's actions to the admin.
 */
export const ADMIN_SESSION_KEYS = [ADMIN_TOKEN_KEY, ADMIN_USER_CACHE_KEY, AUTH_MODE_KEY] as const;

const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function isHttps(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}

function writeTokenCookie(token: string) {
  if (typeof document === "undefined") return;
  const secure = isHttps() ? "; Secure" : "";
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; Path=/; Max-Age=${TOKEN_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function clearTokenCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${TOKEN_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readTokenCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_KEY}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Persist the auth token in BOTH localStorage (for fetch headers) and a
 * `kf_token` cookie (so the Next.js edge middleware can fast-path-gate
 * `/app/*` without server round-trip). Always call this from auth flows
 * instead of touching localStorage directly.
 */
export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  writeTokenCookie(token);
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/**
 * Migration helper: if a token exists in localStorage but not in the cookie
 * (e.g. session predates the cookie-sync work), mirror it across so the
 * middleware sees it on the next navigation. Returns true if a mirror happened.
 */
export function ensureTokenCookieMirror(): boolean {
  if (typeof window === "undefined") return false;
  const ls = window.localStorage.getItem(TOKEN_KEY);
  if (!ls) return false;
  if (readTokenCookie()) return false;
  writeTokenCookie(ls);
  return true;
}

export interface CachedBusiness {
  id: string;
  name: string;
  slug?: string | null;
  businessIntent?: string | null;
  archetype?: string | null;
  industry?: string | null;
  revenueModel?: string | null;
  autopilotEnabled?: boolean;
  autopilotStage?: string | null;
  onboardingComplete?: boolean;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  currency?: string | null;
}

export interface CachedUser {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
}

let businessCache: CachedBusiness | null = null;
let userCache: CachedUser | null = null;

export function getStoredBusinessId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BUSINESS_ID_KEY);
}

export function getCachedBusiness(): CachedBusiness | null {
  if (businessCache) return businessCache;
  if (typeof window === "undefined") return null;
  const cached = window.localStorage.getItem(BUSINESS_CACHE_KEY);
  if (cached) {
    try {
      businessCache = JSON.parse(cached);
      return businessCache;
    } catch {
      return null;
    }
  }
  return null;
}

export function setCachedBusiness(business: CachedBusiness) {
  businessCache = business;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUSINESS_CACHE_KEY, JSON.stringify(business));
}

export function getCachedUser(): CachedUser | null {
  if (userCache) return userCache;
  if (typeof window === "undefined") return null;
  const cached = window.localStorage.getItem(USER_CACHE_KEY);
  if (cached) {
    try {
      userCache = JSON.parse(cached);
      return userCache;
    } catch {
      return null;
    }
  }
  return null;
}

export function setCachedUser(user: CachedUser) {
  userCache = user;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}

function writeBusinessIdCookie(id: string) {
  if (typeof document === "undefined") return;
  const secure = isHttps() ? "; Secure" : "";
  document.cookie = `${BUSINESS_ID_KEY}=${encodeURIComponent(id)}; Path=/; Max-Age=${TOKEN_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function clearBusinessIdCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${BUSINESS_ID_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Mirror businessId into BOTH localStorage and a `kf_business_id`
 * cookie. The cookie is what Server Components (e.g. the FIN8
 * server-rendered insight strip) read via next/headers — without it
 * SSR has no way to know which workspace the request belongs to.
 */
export function setStoredBusinessId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUSINESS_ID_KEY, id);
  writeBusinessIdCookie(id);
}

/**
 * Wipe every piece of cached identity state from the browser. Called from:
 *   - Explicit sign-out
 *   - Global 401 interceptor (token rejected by server → force re-auth)
 *   - <RequireAuth> when /identity/me reports no session
 */
export function setStoredRefreshToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearStoredRefreshToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

const TOKEN_EXPIRY_KEY = "kf_token_expires_at";

export function setStoredTokenExpiry(expiresAt: number | string | null | undefined) {
  if (typeof window === "undefined") return;
  if (!expiresAt) {
    window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
    return;
  }
  const ms = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt);
  if (!Number.isNaN(ms)) {
    window.localStorage.setItem(TOKEN_EXPIRY_KEY, String(ms));
  }
}

export function getStoredTokenExpiry(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isNaN(ms) ? null : ms;
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Attempt to refresh the Supabase access token using the stored refresh token.
 * Returns true if successful and the new token is stored. Safe to call multiple
 * times concurrently — only one refresh request will be in flight.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      // Goes through our server rather than straight to Supabase. Refresh was
      // the last auth flow that never crossed the backend, so a failed refresh
      // — an expired, already-spent, or revoked token, which is what a replayed
      // one looks like — was invisible in the audit ledger.
      const res = await fetch(`${getApiBase()}/identity/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.accessToken) {
        return false;
      }
      setStoredToken(data.accessToken);
      // Supabase ROTATES the refresh token on use, and the server passes the
      // new one straight through. Keeping the old value here would leave the
      // client holding a token that has already been spent, and the next
      // refresh would fail looking like an expiry rather than a bug.
      if (data.refreshToken) {
        setStoredRefreshToken(data.refreshToken);
      }
      return true;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * PR196-GENOME (PR #196 review OK-8B-2): the Business Genome interview
 * transcript is kept in memory only and restored from the server
 * (GET /blueprint/businesses/:id/onboarding-history). A build of PR #196 wrote
 * it to localStorage under this prefix, keyed by business only and never
 * removed, so the founder's partners, shares and tax status outlived the
 * session on a shared device. Every copy under the prefix, in either storage,
 * is dropped at sign-out and on a business switch. Never throws.
 */
export const ONBOARDING_TRANSCRIPT_KEY_PREFIX = "kf_blueprint_onboarding_history_";

export function purgeOnboardingTranscripts() {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(ONBOARDING_TRANSCRIPT_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) store.removeItem(key);
    } catch {
      // Storage unavailable (private mode, blocked): nothing was kept there.
    }
  }
}

/**
 * FU-UNDO-TOAST-SIGNOUT (owner ruling D-283): dismiss every toast on screen. The Toaster is app-wide
 * (components/providers.tsx) and sign-out and sign-in navigate in place, so a toast outlived the session that raised
 * it: a bulk-delete Undo toast went on saying "Deleted 3 contacts" to the next person in the tab. Every toast is the
 * session's (each says what this person did or was told), so all of them go when a session ends or another starts:
 * clearAdminSession runs this (every sign-in runs it first, and the sign-out wipe runs it), as do the header's
 * sign-out and RequireAuth when the session it shows becomes another's. Never throws.
 */
export function dismissSessionToasts() {
  try {
    toast.dismiss();
  } catch {
    // No toast layer (a test, a page without the Toaster): nothing is shown.
  }
}

/** Remove the admin session from localStorage and the cookies. Never throws. */
export function clearAdminSession() {
  if (typeof window === "undefined") return;
  // Every sign-in and sign-out runs this first: the previous session's toasts are not the next person's
  // (FU-UNDO-TOAST-SIGNOUT).
  dismissSessionToasts();
  // Every sign-in and sign-out runs this first: a removed-business notice belongs to the session that raised it,
  // never to the next person on the device (SWP-REMOVED-MEMBER-NOTICE, security review MAJOR-1). Silently: the
  // session is ending or starting, so the gate must not react to it (correctness review R-MINOR-1).
  dismissRemovedBusinessNotice({ silent: true });
  for (const key of ADMIN_SESSION_KEYS) {
    window.localStorage.removeItem(key);
    if (typeof document !== "undefined") {
      document.cookie = `${key}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  }
}

/**
 * RR-ADMIN-LOGOUT: the admin sign-out. The session leaves the device FIRST
 * (the bearer is read for the server call, then cleared), then the server is
 * told (POST api/admin/auth/logout revokes the admin's tokens by cutoff) with
 * that bearer. A sign-out that leaves the bearer on the device because the
 * network failed or stalled is the hazard, not the fix, so nothing here waits
 * on the server to clear, and a failed or thrown request is swallowed.
 */
export async function adminSignOut(): Promise<void> {
  if (typeof window === "undefined") return;
  const token = window.localStorage.getItem(ADMIN_TOKEN_KEY);
  clearAdminSession();
  try {
    await fetch(`${getApiBase()}/api/admin/auth/logout`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    // the local clearing above is what matters
  }
}

/** Forget the stored business (its id, cookie and cache) and keep the session: tokens and the cached user stay. */
function forgetStoredBusiness() {
  window.localStorage.removeItem(BUSINESS_ID_KEY);
  window.localStorage.removeItem(BUSINESS_CACHE_KEY);
  clearBusinessIdCookie();
  businessCache = null;
}

// SWP-REMOVED-MEMBER-NOTICE: the notice's storage is its own module; re-exported for callers of this one.
export {
  BUSINESS_REMOVED_EVENT,
  dismissRemovedBusinessNotice,
  getRemovedBusinessNotice,
  type RemovedBusinessNotice,
} from "./removed-business-notice";

/**
 * The authoritative list no longer holds `stored`. Called before the caches are rewritten: the business cache still
 * describes the lost business (its name is taken only when it is that business), and the cached user is compared with
 * the signed-in one, so a stale id left by another account on a shared device never names that account's business.
 */
function noteRemovedBusiness(stored: string, signedIn: CachedUser | null) {
  const before = getCachedUser();
  if (!signedIn || !before || before.id !== signedIn.id) return;
  const cached = getCachedBusiness();
  raiseRemovedBusinessNotice({ id: stored, name: cached?.id === stored && cached.name ? cached.name : null }, signedIn.id);
}

export function clearStoredBusinessId() {
  if (typeof window === "undefined") return;
  dismissRemovedBusinessNotice({ silent: true });
  purgeOnboardingTranscripts();
  // RR-ADMIN-LOGOUT: no sign-out leaves the admin bearer behind.
  clearAdminSession();
  window.localStorage.removeItem(BUSINESS_ID_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(USER_CACHE_KEY);
  window.localStorage.removeItem(BUSINESS_CACHE_KEY);
  clearTokenCookie();
  clearBusinessIdCookie();
  userCache = null;
  businessCache = null;
  // The IndexedDB contacts cache holds customer rows at rest; a shared device
  // must not keep them past sign-out. Loaded lazily so Dexie stays out of every
  // bundle that only needs the session helpers. Never throws.
  void import("./contacts-db").then((m) => m.purgeContactsCache()).catch(() => {});
}

export const BUSINESS_CHANGED_EVENT = "kf:business-changed";

/**
 * Bumped by every selectBusiness(). A resolution that started under an older
 * generation was answering for the previous choice: it writes nothing and
 * hands over to a fresh one, so no caller is told the old business after a
 * switch and the caches are never written back with it.
 */
let selectionGeneration = 0;
let lastSelectedBusinessId: string | null = null;
let resolvePromise: Promise<string | null> | null = null;

/**
 * The one place a user's business choice is written: localStorage and the
 * `kf_business_id` cookie, with the business and user caches dropped (both
 * describe the previous business) and `kf:business-changed` announced so the
 * app shell re-resolves.
 */
export function selectBusiness(id: string) {
  if (typeof window === "undefined") return;
  selectionGeneration += 1;
  lastSelectedBusinessId = id;
  // A resolution already in flight answers for the previous choice; callers
  // from here on get a new one (it hands over on its own when it lands).
  resolvePromise = null;
  setStoredBusinessId(id);
  window.localStorage.removeItem(BUSINESS_CACHE_KEY);
  window.localStorage.removeItem(USER_CACHE_KEY);
  purgeOnboardingTranscripts();
  businessCache = null;
  userCache = null;
  window.dispatchEvent(new CustomEvent(BUSINESS_CHANGED_EVENT, { detail: { businessId: id } }));
}

/**
 * Authenticated GET with the same plain-fetch pattern as refreshAccessToken
 * above (client.ts is not imported for this: it imports this file). One retry
 * after a token refresh on 401. Returns null when the answer is unavailable.
 */
async function getWithSession(path: string): Promise<unknown> {
  const send = () => {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return fetch(`${getApiBase()}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  try {
    let res = await send();
    if (res.status === 401 && (await refreshAccessToken())) res = await send();
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** GET /identity/businesses: every business the caller owns or is a member of. null = unavailable. */
export async function listMyBusinesses(): Promise<CachedBusiness[] | null> {
  if (typeof window === "undefined") return null;
  const data = await getWithSession("/identity/businesses");
  if (!Array.isArray(data)) return null;
  return data.filter(
    (b): b is CachedBusiness => !!b && typeof b === "object" && typeof (b as CachedBusiness).id === "string",
  );
}

async function bootstrapFirstBusiness(
  generation: number,
  stored: string | null,
  onSuperseded: () => Promise<string | null>,
): Promise<string | null> {
  const result = await bootstrapIdentity({});
  if (generation !== selectionGeneration) {
    // bootstrapIdentity (client.ts) has just written its own pick over a
    // choice made while it ran: put that choice back and resolve it instead.
    if (lastSelectedBusinessId) setStoredBusinessId(lastSelectedBusinessId);
    return onSuperseded();
  }
  const business = result.data?.business;
  if (!business?.id) {
    // bootstrapIdentity writes nothing when it gives no business: a stored id that changed while it ran was written
    // by someone else (another tab), so it is resolved afresh, not forgotten.
    if (getStoredBusinessId() !== stored) return onSuperseded();
    // The membership list was authoritative and empty, and bootstrap gave no business (403
    // OWNER_MEMBERSHIP_REQUIRED: recorded as an owner, a member nowhere): a stored id is not the caller's, and every
    // screen would keep addressing a business BusinessGuard refuses. Forget the business only; the session stays
    // (not clearStoredBusinessId, which is the sign-out wipe and removes the tokens).
    forgetStoredBusiness();
    return null;
  }
  setStoredBusinessId(business.id);
  setCachedBusiness(business as CachedBusiness);
  if (result.data?.user) setCachedUser(result.data.user as CachedUser);
  return business.id;
}

/**
 * Membership-first resolution. The first of `preferred` that is one of the
 * caller's memberships wins; otherwise the first listed membership. Bootstrap
 * (which answers with the oldest OWNED business and would overwrite a choice)
 * runs only when the caller has no membership at all. An unavailable list
 * keeps whatever is stored rather than bootstrapping blind.
 *
 * Nothing is written when the choice moved while the lists were in flight (a
 * selectBusiness(), or any other write of the stored id): `onSuperseded`
 * answers instead, from the choice as it now stands.
 */
async function resolveBusinessSelection(
  preferred: (string | null)[],
  onSuperseded: () => Promise<string | null>,
): Promise<string | null> {
  if (!window.localStorage.getItem(TOKEN_KEY)) return null;
  const generation = selectionGeneration;
  const stored = getStoredBusinessId();
  const [businesses, me] = await Promise.all([listMyBusinesses(), getWithSession("/identity/me")]);
  if (generation !== selectionGeneration || getStoredBusinessId() !== stored) return onSuperseded();
  const user = me && typeof me === "object" && typeof (me as CachedUser).id === "string" ? (me as CachedUser) : null;

  // SWP-REMOVED-MEMBER-NOTICE (security review MINOR-1): the stored business and its cache were left by another person
  // (the cached user is not the signed-in one): they are not this person's to keep, to name or to lose. Forget them,
  // and any notice, before anything below reads them or overwrites the cached user.
  let current = stored;
  const before = getCachedUser();
  if (user && before && before.id !== user.id) {
    forgetStoredBusiness();
    dismissRemovedBusinessNotice();
    current = null;
  }
  // A notice is only ever the person's it was raised for (security review MAJOR-1).
  const noticeFor = getRemovedBusinessNoticeUserId();
  if (user && noticeFor && noticeFor !== user.id) dismissRemovedBusinessNotice();

  if (businesses === null) {
    if (user) setCachedUser(user);
    return current;
  }
  // The list is authoritative: a stored business it no longer holds was lost (removed by an owner), not chosen away.
  if (current && !businesses.some((b) => b.id === current)) noteRemovedBusiness(current, user);
  // Access given back (re-invited): the notice no longer holds.
  const pending = getRemovedBusinessNotice();
  if (pending && businesses.some((b) => b.id === pending.id)) dismissRemovedBusinessNotice();
  if (businesses.length === 0) return bootstrapFirstBusiness(generation, current, onSuperseded);

  const chosen =
    preferred.map((id) => businesses.find((b) => b.id === id)).find((b) => b !== undefined) ??
    businesses[0];
  if (chosen.id !== current) setStoredBusinessId(chosen.id);
  setCachedBusiness(chosen);
  if (user) setCachedUser(user);
  return chosen.id;
}

/**
 * Re-validate the stored business against the caller's memberships (see
 * resolveBusinessSelection). Concurrent callers share one round trip, so an
 * empty list bootstraps once however many screens ask at the same moment. A
 * round trip overtaken by a switch is not shared any more, and its own callers
 * are answered by the resolution of the new choice.
 */
export function refreshWorkspace(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (resolvePromise) return resolvePromise;
  const promise: Promise<string | null> = resolveBusinessSelection([getStoredBusinessId()], () => {
    if (resolvePromise === promise) resolvePromise = null;
    return refreshWorkspace();
  }).finally(() => {
    if (resolvePromise === promise) resolvePromise = null;
  });
  resolvePromise = promise;
  return promise;
}

/** The stored business, or a membership-first resolution when nothing is stored. */
export async function ensureWorkspace(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const existing = getStoredBusinessId();
  if (existing) return existing;
  return refreshWorkspace();
}

/**
 * Sign-in flows still bootstrap (it creates or reconciles the User row), and
 * bootstrap writes its own pick. Called right after, with the id held before
 * sign-in, this puts that choice back when it is still one of the caller's
 * memberships; otherwise bootstrap's pick stands.
 */
export async function restoreBusinessChoice(previous: string | null): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const current = getStoredBusinessId();
  if (!previous || previous === current) return current;
  const generation = selectionGeneration;
  // An explicit switch made meanwhile wins over the restore; any other write
  // of the stored id just means trying the restore again against it.
  return resolveBusinessSelection([previous, current], () =>
    generation !== selectionGeneration ? refreshWorkspace() : restoreBusinessChoice(previous),
  );
}

export function getCachedAdminUser(): CachedUser | null {
  if (typeof window === "undefined") return null;
  const cached = window.localStorage.getItem(ADMIN_USER_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CachedUser;
    } catch {
      return null;
    }
  }
  return null;
}

export function isSuperAdmin(): boolean {
  const user = getCachedUser() ?? getCachedAdminUser();
  return user?.role === "SUPER_ADMIN";
}

/**
 * Does this browser hold a local admin session: an unexpired admin-shaped
 * kf_admin_token from the separate admin sign-in (/admin/login)? The edge
 * middleware serves the admin shell only on that (RR-ADMIN-SHELL-SERVER-GATE);
 * owner ruling D-290: a normally signed-in SUPER_ADMIN without it does not get
 * in. Shape only, like the edge check; the API stays the authority.
 */
export function hasAdminSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return isAdminTokenUsable(window.localStorage.getItem(ADMIN_TOKEN_KEY));
  } catch {
    return false;
  }
}

/**
 * May this browser open the Owner Console (owner ruling D-290)? Only on the separate admin sign-in: a local admin
 * session (hasAdminSession) whose OWN user, kf_admin_user_cache as the admin sign-in writes it, is SUPER_ADMIN. The
 * app session's user is never consulted (COR-1): a token without its admin user does not open it. Both the admin
 * layout's guard and the Owner Console link (useAppLayout) use this one predicate, so the link is offered exactly
 * where the shell would open. Shape only; the API stays the authority.
 */
export function canOpenOwnerConsole(): boolean {
  if (!hasAdminSession()) return false;
  return getCachedAdminUser()?.role === "SUPER_ADMIN";
}

export function getUserDisplayName(): string {
  const user = getCachedUser();
  if (!user) return "";
  if (user.name) return user.name;
  if (user.firstName) return user.firstName;
  return user.email?.split("@")[0] || "";
}

export function getUserInitials(): string {
  const user = getCachedUser();
  if (!user) return "KF";
  if (user.name) {
    const parts = user.name.split(" ");
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return user.name.substring(0, 2).toUpperCase();
  }
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  if (user.firstName) return user.firstName.substring(0, 2).toUpperCase();
  return user.email?.substring(0, 2).toUpperCase() || "KF";
}
