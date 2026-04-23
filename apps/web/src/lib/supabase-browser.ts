"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function assertSafeBrowserKey(key: string): void {
  // Browser clients must never be initialized with service-role/secret keys.
  if (key.startsWith("sb_secret_") || key.includes("service_role")) {
    throw new Error(
      "Unsafe Supabase key detected in browser config. Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY only.",
    );
  }
}

export function getSupabaseBrowserConfig():
  | { url: string; key: string }
  | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return null;
  }

  assertSafeBrowserKey(key);
  return { url, key };
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const config = getSupabaseBrowserConfig();
  const url = config?.url;
  const key = config?.key;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return client;
}

