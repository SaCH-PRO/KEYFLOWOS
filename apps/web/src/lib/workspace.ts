"use client";

import { bootstrapIdentity } from "./client";

const BUSINESS_ID_KEY = "kf_business_id";
const TOKEN_KEY = "kf_token";

export function getStoredBusinessId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BUSINESS_ID_KEY);
}

export function setStoredBusinessId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUSINESS_ID_KEY, id);
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
    return result.data.business.id;
  }
  return null;
}
