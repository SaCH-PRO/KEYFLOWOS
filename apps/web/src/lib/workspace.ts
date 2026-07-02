"use client";

import { bootstrapIdentity } from "./client";

const BUSINESS_ID_KEY = "kf_business_id";
const TOKEN_KEY = "kf_token";
const REFRESH_TOKEN_KEY = "kf_refresh_token";
const BUSINESS_CACHE_KEY = "kf_business_cache";
const USER_CACHE_KEY = "kf_user_cache";

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
  if (!refreshToken || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;

  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.access_token) {
        return false;
      }
      setStoredToken(data.access_token);
      if (data.refresh_token) {
        setStoredRefreshToken(data.refresh_token);
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

export function clearStoredBusinessId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BUSINESS_ID_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(USER_CACHE_KEY);
  window.localStorage.removeItem(BUSINESS_CACHE_KEY);
  window.localStorage.removeItem("kf_auth_mode");
  clearTokenCookie();
  clearBusinessIdCookie();
  userCache = null;
  businessCache = null;
}

export async function ensureWorkspace(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const existing = getStoredBusinessId();
  if (existing) return existing;

  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const result = await bootstrapIdentity({});
  if (result.data?.business?.id) {
    setStoredBusinessId(result.data.business.id);
    setCachedBusiness(result.data.business as CachedBusiness);
    if (result.data.user) {
      setCachedUser(result.data.user as CachedUser);
    }
    return result.data.business.id;
  }
  return null;
}

export async function refreshWorkspace(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const result = await bootstrapIdentity({});
  if (result.data?.business?.id) {
    setStoredBusinessId(result.data.business.id);
    setCachedBusiness(result.data.business as CachedBusiness);
    if (result.data.user) {
      setCachedUser(result.data.user as CachedUser);
    }
    return result.data.business.id;
  }
  return null;
}

export function isSuperAdmin(): boolean {
  const user = getCachedUser();
  return user?.role === "SUPER_ADMIN";
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
