"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { clearStoredBusinessId, ensureTokenCookieMirror, getStoredToken } from "@/lib/workspace";

type Status = "checking" | "authenticated" | "redirecting";

/**
 * Server-validated auth boundary for everything under `/app/*`.
 *
 * On mount it:
 *   1. Mirrors any localStorage token into the `kf_token` cookie (helps
 *      legacy sessions that pre-date the middleware fast-path).
 *   2. Hits `GET /identity/me` once to confirm the token is still valid.
 *      A 401 response → wipe local state + push to `/auth/login?from=<path>`.
 *   3. Subscribes to the global `kf:unauthorized` event emitted by the
 *      fetch wrappers. Any later 401 anywhere in the app triggers the
 *      same recovery path, so a stale token never leaves the user
 *      stranded on a half-rendered page.
 *
 * Children render only after the `/identity/me` check succeeds, so no
 * authenticated screen flashes for unauthenticated visitors.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("checking");
  const redirectingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const redirectToLogin = (reason: string) => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      clearStoredBusinessId();
      const from = pathname || "/app";
      const target = `/auth/login?from=${encodeURIComponent(from)}`;
      console.warn(`[RequireAuth] ${reason} — redirecting to login`);
      setStatus("redirecting");
      router.replace(target);
    };

    const verify = async () => {
      ensureTokenCookieMirror();
      const token = getStoredToken();
      if (!token) {
        redirectToLogin("no token in storage");
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/identity/me`, {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 401) {
          redirectToLogin("server rejected token (401)");
          return;
        }
        if (!res.ok) {
          // Any non-401 error: don't kick the user out — the API may be
          // briefly unavailable. RequireAuth's job is only to gate auth.
          console.warn(`[RequireAuth] /identity/me returned ${res.status}; allowing through`);
        }
        setStatus("authenticated");
      } catch (err) {
        if (cancelled) return;
        console.warn("[RequireAuth] /identity/me network error; allowing through:", err);
        setStatus("authenticated");
      }
    };

    verify();

    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      redirectToLogin(`global 401 from ${detail?.path ?? "unknown path"}`);
    };
    window.addEventListener("kf:unauthorized", onUnauthorized);

    return () => {
      cancelled = true;
      window.removeEventListener("kf:unauthorized", onUnauthorized);
    };
  }, [router, pathname]);

  if (status !== "authenticated") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Verifying session…</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
