"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import {
  clearStoredBusinessId,
  dismissSessionToasts,
  ensureTokenCookieMirror,
  getStoredToken,
  refreshAccessToken,
} from "@/lib/workspace";

type Status = "checking" | "authenticated" | "redirecting" | "error";

const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

/** The user token, and the admin bearer getAuthHeaders sends ahead of it (lib/api.ts). */
const ADMIN_TOKEN_KEY = "kf_admin_token";
const SESSION_STORAGE_KEYS = new Set(["kf_token", ADMIN_TOKEN_KEY]);

/**
 * The `sub` claim of a JWT, decoded locally WITHOUT verifying the signature. It only decides whether a changed token
 * still belongs to the user the shell was verified for (the shell then stays while /identity/me confirms it in the
 * background); the server verifies every request. Null for anything that is not a JWT with a string `sub`.
 */
function tokenSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))) as { sub?: unknown } | null;
    return payload && typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The session as it is stored: the user token (none means signed out) and the admin bearer. */
interface StoredSession {
  key: string;
  token: string;
  sub: string | null;
  admin: string | null;
}

function storedSession(): StoredSession | null {
  const token = getStoredToken();
  if (!token) return null;
  let admin: string | null = null;
  try {
    admin = window.localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    admin = null;
  }
  return { key: `${token}\n${admin ?? ""}`, token, sub: tokenSubject(token), admin };
}

/** The session the shell is shown for: accepted by /identity/me, with the user id that answer named. */
interface VerifiedSession {
  key: string;
  sub: string | null;
  admin: string | null;
  userId: string | null;
}

/**
 * A change of the stored session that keeps the shell while it is verified in the background: the user token was
 * rotated for the same `sub` and the admin bearer did not change. Anything else (another `sub`, a token that cannot
 * be decoded, an admin bearer that appeared, changed or went) tears the shell down until it is verified.
 */
function isSameUserRotation(stored: StoredSession, verified: VerifiedSession | null): boolean {
  return !!verified && verified.sub !== null && stored.sub === verified.sub && stored.admin === verified.admin;
}

/** What the pages may be rendered for: a stored session with the verified `sub` (or token) and admin bearer. */
function storedMatchesShown(shown: VerifiedSession | null): boolean {
  if (!shown) return false;
  const stored = storedSession();
  if (!stored || stored.admin !== shown.admin) return false;
  return shown.sub !== null ? stored.sub === shown.sub : stored.key === shown.key;
}

type IdentityAnswer =
  | { kind: "stale" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string; transient: boolean }
  | { kind: "ok"; session: StoredSession | null; userId: string | null };

/**
 * A failure that says nothing about the session: the fetch threw (network), or a 5xx, 408 or 429. A background
 * re-verify keeps a verified same-user shell only for these; any other answer (a 403, or the 404 /identity/me gives
 * once the user row is gone) tears it down.
 */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * GET /identity/me for the stored session, retrying a few times on transient non-401 errors and once after a token
 * refresh on a 401. An "ok" answer names the session the successful request was sent with and the user id it named.
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
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
        if (stale()) return { kind: "stale" };
        return { kind: "ok", session: asked, userId: body && typeof body.id === "string" ? body.id : null };
      }

      const message = `Server returned ${res.status}`;
      if (attempt < MAX_RETRIES) {
        console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
        if (stale()) return { kind: "stale" };
        continue;
      }
      return { kind: "error", message, transient: isTransientStatus(res.status) };
    } catch (err) {
      if (stale()) return { kind: "stale" };
      const message = err instanceof Error ? err.message : "Network error";
      if (attempt < MAX_RETRIES) {
        console.warn(`[RequireAuth] ${message}; retrying ${attempt}/${MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
        if (stale()) return { kind: "stale" };
        continue;
      }
      return { kind: "error", message, transient: true };
    }
  }
  return { kind: "error", message: "Unable to verify your session", transient: true };
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
 * changes, never because the page changed, so a client navigation keeps the shell mounted (no spinner, no second
 * /identity/me, no second mount of the destination page; a one-shot ?contactId survives a router.push). The stored
 * session is compared with the verified one when another tab changes it (the storage event) and on each navigation
 * (a token rotated in this tab raises no storage event):
 *   - no user token: sign-in at once;
 *   - the same user's token rotated (same `sub`, same admin bearer): the shell stays and /identity/me is asked in the
 *     background; a 401 signs out, an answer naming another user id tears the shell down and verifies again, and a
 *     network or server error leaves the verified shell (the pages' own 401s, and the next check, still apply);
 *   - anything else (another `sub`, an undecodable token, an admin bearer that appeared, changed or went): the shell
 *     is torn down and shown again only once /identity/me accepted the session now stored.
 * No render shows the pages for a stored session that is missing or names another `sub` or admin bearer than the
 * one verified: the spinner shows instead, so a destination page never mounts for it.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** The session the pages are rendered for (state, read by the render guard). */
  const [shownFor, setShownFor] = useState<VerifiedSession | null>(null);
  // Read by the callbacks below, which must not change when the page changes (they would re-run the mount effect).
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  const verifiedRef = useRef<VerifiedSession | null>(null);
  /** The stored session the verification in flight is asking about. */
  const askingKeyRef = useRef<string | null>(null);
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
    verifiedRef.current = null;
    setShownFor(null);
    clearStoredBusinessId();
    const from = pathnameRef.current || "/app";
    const target = `/auth/login?from=${encodeURIComponent(from)}`;
    console.warn(`[RequireAuth] ${reason} — redirecting to login`);
    setStatus("redirecting");
    routerRef.current.replace(target);
  }, []);

  /**
   * Verify the stored session. In the background (a same-user rotation) the shell stays mounted; otherwise it is
   * hidden until /identity/me accepts the session now stored.
   */
  const verify = useCallback(
    async (inBackground: boolean) => {
      const run = ++runRef.current;
      const stale = () => run !== runRef.current;
      let background = inBackground;
      const tearDown = () => {
        verifiedRef.current = null;
        setShownFor(null);
        setErrorMessage(null);
        setStatus("checking");
      };
      /**
       * FU-UNDO-TOAST-SIGNOUT (D-283): the shell shown for one session is torn down because the stored session is now
       * another's (another `sub`, an admin bearer that appeared, changed or went, an undecodable token, or another user
       * id in the background answer). The toasts above the shell were that session's: they go with it. Not on the
       * shell's first verification, nor when the same session is kept or ends in the error state.
       */
      const tearDownForAnotherSession = () => {
        if (verifiedRef.current !== null) dismissSessionToasts();
        tearDown();
      };
      verifyingRef.current = true;
      redirectingRef.current = false;
      if (!background) tearDownForAnotherSession();

      for (;;) {
        ensureTokenCookieMirror();
        const asking = storedSession();
        askingKeyRef.current = asking?.key ?? null;
        if (asking === null) {
          redirectToLogin("no token in storage");
          return;
        }
        if (background && !isSameUserRotation(asking, verifiedRef.current)) {
          background = false;
          tearDownForAnotherSession();
        }

        const answer = await askIdentity(stale);
        if (answer.kind === "stale") return;
        if (answer.kind === "unauthorized") {
          redirectToLogin("server rejected token (401)");
          return;
        }
        if (answer.kind === "error" && background && !answer.transient) {
          // A 403, or a 404 (the user row is gone): not a passing failure. Verify again as a first load would, which
          // ends in the error state (or sign-in on a 401).
          background = false;
          tearDown();
          continue;
        }
        if (answer.kind === "error") {
          verifyingRef.current = false;
          if (background) {
            // A verified same-user shell is not torn down for an unreachable API (a network failure, a 5xx, 408 or
            // 429): the pages' own 401s, and the next check, still apply.
            console.warn(`[RequireAuth] ${answer.message}; keeping the verified session`);
            return;
          }
          setErrorMessage(`${answer.message}. Please check your connection and try again.`);
          setStatus("error");
          return;
        }
        // The session changed while /identity/me answered: decide again for the session now stored.
        const now = storedSession();
        if (answer.session === null || now === null || answer.session.key !== now.key) continue;

        if (background) {
          const verified = verifiedRef.current;
          if (!verified || answer.userId === null || answer.userId !== verified.userId) {
            background = false;
            tearDownForAnotherSession();
            continue;
          }
          verifiedRef.current = { ...verified, key: answer.session.key };
          verifyingRef.current = false;
          return;
        }

        const accepted: VerifiedSession = {
          key: answer.session.key,
          sub: answer.session.sub,
          admin: answer.session.admin,
          userId: answer.userId,
        };
        verifiedRef.current = accepted;
        verifyingRef.current = false;
        setShownFor(accepted);
        setErrorMessage(null);
        setStatus("authenticated");
        return;
      }
    },
    [redirectToLogin],
  );

  /** Verify again only when the stored session is not the one verified (or being verified). */
  const recheck = useCallback(() => {
    if (redirectingRef.current) return;
    const stored = storedSession();
    if (stored === null) {
      void verify(false);
      return;
    }
    const current = verifyingRef.current ? askingKeyRef.current : verifiedRef.current?.key;
    if (stored.key === current) return;
    void verify(isSameUserRotation(stored, verifiedRef.current));
  }, [verify]);

  // Once per mounted shell, never per page.
  useEffect(() => {
    void verify(false);

    const onUnauthorized = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      redirectToLogin(`global 401 from ${detail?.path ?? "unknown path"}`);
    };
    // Another tab signed in, signed out, rotated the token, changed the admin bearer or cleared the storage.
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
  // storage event); it never verifies an unchanged session again. From the error state a page change verifies again.
  useEffect(() => {
    recheck();
  }, [pathname, recheck]);

  // Every other render does the same comparison (a navigation that changes only the search parameters re-renders the
  // render guard below without a pathname change), except in the error state, which waits for Retry or a page change.
  useEffect(() => {
    if (status !== "error") recheck();
  });

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
              void verify(false);
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

  // The render guard: the pages are rendered only for the session that was verified (a same-user rotation passes).
  if (status !== "authenticated" || !storedMatchesShown(shownFor)) {
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
