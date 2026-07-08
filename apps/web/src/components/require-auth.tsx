"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { clearStoredBusinessId, ensureTokenCookieMirror, getStoredToken, refreshAccessToken } from "@/lib/workspace";

type Status = "checking" | "authenticated" | "redirecting" | "error";

const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

/**
 * Server-validated auth boundary for everything under `/app/*`.
 *
 * On mount it:
 *   1. Mirrors any localStorage token into the `kf_token` cookie (helps
 *      legacy sessions that pre-date the middleware fast-path).
 *   2. Hits `GET /identity/me` to confirm the token is still valid, retrying
 *      a few times on transient non-401 errors.
 *   3. Redirects to `/auth/login?from=<path>` on a definitive 401.
 *   4. Renders an explicit error state if the API cannot be reached.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const redirectingRef = useRef(false);
  const cancelledRef = useRef(false);

  const redirectToLogin = useCallback(
    (reason: string) => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      clearStoredBusinessId();
      const from = pathname || "/app";
      const target = `/auth/login?from=${encodeURIComponent(from)}`;
      console.warn(`[RequireAuth] ${reason} — redirecting to login`);
      setStatus("redirecting");
      router.replace(target);
    },
    [router, pathname],
  );

  const verify = useCallback(async () => {
    cancelledRef.current = false;
    redirectingRef.current = false;
    setErrorMessage(null);
    setStatus("checking");

    ensureTokenCookieMirror();
    const token = getStoredToken();
    if (!token) {
      redirectToLogin("no token in storage");
      return;
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        let res = await fetch(`${API_BASE}/identity/me`, {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        if (cancelledRef.current) return;

        if (res.status === 401) {
          const refreshed = await refreshAccessToken();
          if (refreshed && !cancelledRef.current) {
            res = await fetch(`${API_BASE}/identity/me`, {
              headers: getAuthHeaders(),
              cache: "no-store",
            });
          }
        }
        if (cancelledRef.current) return;

        if (res.status === 401) {
          redirectToLogin("server rejected token (401)");
          return;
        }

        if (res.ok) {
          setErrorMessage(null);
          setStatus("authenticated");
          return;
        }

        const message = `Server returned ${res.status}`;
        if (attempt < MAX_RETRIES) {
          console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
          continue;
        }
        setErrorMessage(`${message}. Please check your connection and try again.`);
        setStatus("error");
        return;
      } catch (err) {
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : "Network error";
        if (attempt < MAX_RETRIES) {
          console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
          continue;
        }
        setErrorMessage(`${message}. Please check your connection and try again.`);
        setStatus("error");
        return;
      }
    }
  }, [redirectToLogin]);

  useEffect(() => {
    cancelledRef.current = false;
    void verify();

    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      redirectToLogin(`global 401 from ${detail?.path ?? "unknown path"}`);
    };
    window.addEventListener("kf:unauthorized", onUnauthorized);

    return () => {
      cancelledRef.current = true;
      window.removeEventListener("kf:unauthorized", onUnauthorized);
    };
  }, [verify, redirectToLogin]);

  if (status === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-background gap-4 p-6 text-center">
        <div className="text-sm text-destructive font-medium">
          {errorMessage || "Unable to verify your session."}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setStatus("checking");
              void verify();
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => redirectToLogin("user chose to sign in again")}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-accent"
          >
            Sign in again
          </button>
        </div>
      </div>
    );
  }

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
