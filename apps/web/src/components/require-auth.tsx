"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { clearStoredBusinessId, ensureTokenCookieMirror, getStoredToken, refreshAccessToken } from "@/lib/workspace";

type Status = "checking" | "authenticated" | "redirecting" | "error";

const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

/** The localStorage keys a session lives in: the user token, and the admin bearer getAuthHeaders sends ahead of it. */
const SESSION_STORAGE_KEYS = new Set(["kf_token", "kf_admin_token"]);

/**
 * The stored session as GET /identity/me is asked about it: the user token (none means signed out) and the bearer
 * getAuthHeaders sends (the admin token when one is stored). Null when there is no user token.
 */
function storedSession(): string | null {
  const token = getStoredToken();
  if (!token) return null;
  return `${token}\n${getAuthHeaders().Authorization ?? ""}`;
}

type IdentityAnswer =
  | { kind: "stale" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "ok"; session: string | null };

/**
 * GET /identity/me for the stored session, retrying a few times on transient non-401 errors and once after a token
 * refresh on a 401. An "ok" answer names the session the successful request was sent with.
 */
async function askIdentity(stale: () => boolean): Promise<IdentityAnswer> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let asked = storedSession();
      let res = await fetch(`${API_BASE}/identity/me`, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      if (stale()) return { kind: "stale" };

      if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (stale()) return { kind: "stale" };
        if (refreshed) {
          asked = storedSession();
          res = await fetch(`${API_BASE}/identity/me`, {
            headers: getAuthHeaders(),
            cache: "no-store",
          });
        }
      }
      if (stale()) return { kind: "stale" };

      if (res.status === 401) return { kind: "unauthorized" };
      if (res.ok) return { kind: "ok", session: asked };

      const message = `Server returned ${res.status}`;
      if (attempt < MAX_RETRIES) {
        console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
        if (stale()) return { kind: "stale" };
        continue;
      }
      return { kind: "error", message };
    } catch (err) {
      if (stale()) return { kind: "stale" };
      const message = err instanceof Error ? err.message : "Network error";
      if (attempt < MAX_RETRIES) {
        console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
        if (stale()) return { kind: "stale" };
        continue;
      }
      return { kind: "error", message };
    }
  }
  return { kind: "error", message: "Unable to verify your session" };
}

/**
 * Server-validated auth boundary for everything under `/app/*` (app/app/layout.tsx mounts it around the whole shell).
 *
 * When the shell mounts it:
 *   1. Mirrors any localStorage token into the `kf_token` cookie (helps
 *      legacy sessions that pre-date the middleware fast-path).
 *   2. Hits `GET /identity/me` to confirm the token is still valid, retrying
 *      a few times on transient non-401 errors.
 *   3. Redirects to `/auth/login?from=<path>` on a definitive 401.
 *   4. Renders an explicit error state if the API cannot be reached.
 *
 * FU-REQUIRE-AUTH-REMOUNT (owner ruling D-281): the session is verified once, and again only when the stored session
 * changes, never because the page changed. A client navigation keeps the shell mounted (no spinner, no second
 * /identity/me, no second mount of the destination page, so a one-shot ?contactId survives a router.push). The
 * stored session is compared with the verified one when another tab changes it (the storage event: a sign-in, a
 * sign-out, an admin sign-in) and on each navigation (a token rotated in this tab, which raises no storage event).
 * A changed session is verified before the shell is shown again: the shell is only ever shown for the session that
 * was verified, and a session with no token is sent to sign-in at once.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Read by the callbacks below, which must not change when the page changes (they would re-run the mount effect).
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  /** The session the shell is shown for: set only when /identity/me accepted it. */
  const verifiedSessionRef = useRef<string | null>(null);
  /** The session the verification in flight is asking about. */
  const askingSessionRef = useRef<string | null>(null);
  /** The current verification; a newer one, a redirect or the unmount makes an older one stale. */
  const runRef = useRef(0);
  const verifyingRef = useRef(false);
  const redirectingRef = useRef(false);

  useEffect(() => {
    routerRef.current = router;
    pathnameRef.current = pathname;
  }, [router, pathname]);

  const redirectToLogin = useCallback((reason: string) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    runRef.current += 1;
    verifyingRef.current = false;
    verifiedSessionRef.current = null;
    clearStoredBusinessId();
    const from = pathnameRef.current || "/app";
    const target = `/auth/login?from=${encodeURIComponent(from)}`;
    console.warn(`[RequireAuth] ${reason} — redirecting to login`);
    setStatus("redirecting");
    routerRef.current.replace(target);
  }, []);

  const verify = useCallback(async () => {
    const run = ++runRef.current;
    const stale = () => run !== runRef.current;
    verifyingRef.current = true;
    redirectingRef.current = false;
    verifiedSessionRef.current = null;
    setErrorMessage(null);
    setStatus("checking");

    // A session that changes while /identity/me answers is verified again: the shell is shown only for the session
    // that was accepted.
    for (;;) {
      ensureTokenCookieMirror();
      askingSessionRef.current = storedSession();
      if (askingSessionRef.current === null) {
        redirectToLogin("no token in storage");
        return;
      }

      const answer = await askIdentity(stale);
      if (answer.kind === "stale") return;
      if (answer.kind === "unauthorized") {
        redirectToLogin("server rejected token (401)");
        return;
      }
      if (answer.kind === "error") {
        verifyingRef.current = false;
        setErrorMessage(`${answer.message}. Please check your connection and try again.`);
        setStatus("error");
        return;
      }
      if (answer.session === null || answer.session !== storedSession()) continue;

      verifyingRef.current = false;
      verifiedSessionRef.current = answer.session;
      setErrorMessage(null);
      setStatus("authenticated");
      return;
    }
  }, [redirectToLogin]);

  /** Verify again only when the stored session is not the one verified (or being verified). */
  const recheck = useCallback(() => {
    if (redirectingRef.current) return;
    const session = storedSession();
    const current = verifyingRef.current ? askingSessionRef.current : verifiedSessionRef.current;
    if (session !== null && session === current) return;
    void verify();
  }, [verify]);

  // Once per mounted shell, never per page.
  useEffect(() => {
    void verify();

    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      redirectToLogin(`global 401 from ${detail?.path ?? "unknown path"}`);
    };
    // Another tab signed in, signed out or changed the admin bearer.
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.key !== null && !SESSION_STORAGE_KEYS.has(e.key)) return;
      recheck();
    };
    window.addEventListener("kf:unauthorized", onUnauthorized);
    window.addEventListener("storage", onStorage);

    return () => {
      runRef.current += 1;
      verifyingRef.current = false;
      window.removeEventListener("kf:unauthorized", onUnauthorized);
      window.removeEventListener("storage", onStorage);
    };
  }, [verify, recheck, redirectToLogin]);

  // A page change only compares the stored session with the verified one (a token rotated in this tab raises no
  // storage event); it never verifies an unchanged session again.
  useEffect(() => {
    recheck();
  }, [pathname, recheck]);

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
