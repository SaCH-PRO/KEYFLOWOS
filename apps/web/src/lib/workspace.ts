"use client";

import { bootstrapIdentity } from "./client";

const BUSINESS_ID_KEY = "kf_business_id";
const TOKEN_KEY = "kf_token";
const BUSINESS_CACHE_KEY = "kf_business_cache";
const USER_CACHE_KEY = "kf_user_cache";

export interface CachedBusiness {
  id: string;
  name: string;
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

export function setStoredBusinessId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUSINESS_ID_KEY, id);
}

export function clearStoredBusinessId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BUSINESS_ID_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_CACHE_KEY);
  window.localStorage.removeItem(BUSINESS_CACHE_KEY);
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
