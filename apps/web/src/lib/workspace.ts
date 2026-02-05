"use client";

import { bootstrapIdentity } from "./client";

const BUSINESS_ID_KEY = "kf_business_id";
const TOKEN_KEY = "kf_token";
const BUSINESS_CACHE_KEY = "kf_business_cache";

export interface CachedBusiness {
  id: string;
  name: string;
  businessIntent?: string | null;
  archetype?: string | null;
  industry?: string | null;
  revenueModel?: string | null;
  autopilotEnabled?: boolean;
  autopilotStage?: string | null;
}

let businessCache: CachedBusiness | null = null;

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

export function setStoredBusinessId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUSINESS_ID_KEY, id);
}

export function clearStoredBusinessId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BUSINESS_ID_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
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
    return result.data.business.id;
  }
  return null;
}

// Force refresh businessId from the server (ignores stored value)
export async function refreshWorkspace(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const result = await bootstrapIdentity({});
  if (result.data?.business?.id) {
    setStoredBusinessId(result.data.business.id);
    setCachedBusiness(result.data.business as CachedBusiness);
    return result.data.business.id;
  }
  return null;
}
