import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The service worker must never store a credentialed API response.
 *
 * Cache Storage in sw.js is keyed by URL with no auth dimension — nothing sets
 * or honours Vary — and the cached copy is served after a 5s network timeout.
 * Neither cache wipe runs in production: app/layout.tsx returns early unless the
 * hostname is localhost/127.0.0.1, and use-service-worker.ts has no callers. So
 * a stored authenticated GET can be handed to the next person to use the
 * browser.
 *
 * `cache: "no-store"` on the client fetch does not prevent this. That flag
 * governs the HTTP cache; `cache.put()` in the worker is an explicit Cache
 * Storage write on a different layer and runs regardless.
 *
 * This was masked for a long time on one client path by a `_t=${Date.now()}`
 * cache-buster that made every URL unique, so `cache.match()` never hit. It was
 * never protection — 62 authenticated call sites (fetchWithAuthRetry and raw
 * fetch) never carried it — and relying on unique URLs is not a mechanism. The
 * test drives the real public/sw.js rather than a copy of its logic.
 *
 * IF YOU EDIT THE SYNTHETIC GLOBAL: self.location.origin is load-bearing.
 * sw.js returns early on `url.origin !== self.location.origin`, so omitting
 * it makes every request bail at that line and every assertion below pass
 * without reaching the code it exists to test. That is what happened on the
 * first version of this file, and it was only visible because two OTHER
 * cases failed against a written-down prediction.
 */

const SW_SOURCE = readFileSync(
  resolve(__dirname, "../../../public/sw.js"),
  "utf8",
);

const ORIGIN = "https://app.keyflow.example";

type FetchListener = (event: {
  request: Request;
  respondWith: (r: unknown) => void;
}) => void;

/** Boots public/sw.js against a synthetic worker global and returns its hooks. */
function bootServiceWorker() {
  const listeners = new Map<string, FetchListener>();
  const cachePut = vi.fn();
  const cacheMatch = vi.fn().mockResolvedValue(undefined);
  const openedCaches: string[] = [];

  const self = {
    // `origin` is load-bearing, not decoration: sw.js returns early on
    // `url.origin !== self.location.origin`. Omitting it made every request
    // bail at that line, so the credentialed-cache assertions below passed
    // without ever reaching the check they exist to test.
    location: { hostname: "app.keyflow.example", origin: ORIGIN },
    addEventListener: (name: string, fn: FetchListener) => listeners.set(name, fn),
    registration: { unregister: vi.fn(), sync: { register: vi.fn() } },
    clients: { claim: vi.fn(), matchAll: vi.fn() },
    skipWaiting: vi.fn(),
  };

  const caches = {
    open: vi.fn(async (name: string) => {
      openedCaches.push(name);
      return { match: cacheMatch, put: cachePut, addAll: vi.fn() };
    }),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    match: vi.fn(),
  };

  const fetchMock = vi.fn().mockResolvedValue({ status: 200, clone: () => ({}) });

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    "self",
    "caches",
    "fetch",
    "indexedDB",
    "console",
    SW_SOURCE,
  )(self, caches, fetchMock, { open: vi.fn() }, { error: vi.fn(), log: vi.fn() });

  return { listeners, cachePut, cacheMatch, caches, fetchMock, openedCaches };
}

function fireFetch(
  sw: ReturnType<typeof bootServiceWorker>,
  url: string,
  headers: Record<string, string> = {},
) {
  const handler = sw.listeners.get("fetch");
  if (!handler) throw new Error("sw.js registered no fetch listener");
  let responded: unknown;
  let didRespond = false;
  handler({
    request: {
      url,
      method: "GET",
      headers: new Headers(headers),
      mode: url.includes("/app/") ? "navigate" : "cors",
      clone: () => ({}),
    } as unknown as Request,
    respondWith: (r: unknown) => {
      didRespond = true;
      responded = r;
    },
  });
  return { didRespond, responded };
}

describe("service worker never caches credentialed API responses", () => {
  let sw: ReturnType<typeof bootServiceWorker>;

  beforeEach(() => {
    sw = bootServiceWorker();
  });

  it("registers a fetch listener at all", () => {
    expect(sw.listeners.has("fetch")).toBe(true);
  });

  it("passes an AUTHENTICATED API GET straight through, never storing it", async () => {
    const { didRespond } = fireFetch(sw, `${ORIGIN}/__api/crm/contacts`, {
      authorization: "Bearer user-a-token",
    });

    // Not calling respondWith means the browser handles it natively: the worker
    // never sees the body and cannot put it in a cache.
    expect(
      didRespond,
      "the worker intercepted an authenticated API GET, so its response can be " +
        "written to a URL-keyed cache with no auth dimension and later served " +
        "to a different user of this browser",
    ).toBe(false);

    await new Promise((r) => setTimeout(r, 0));
    expect(sw.cachePut).not.toHaveBeenCalled();
  });

  it("treats the /api/ prefix the same as /__api/", () => {
    const { didRespond } = fireFetch(sw, `${ORIGIN}/api/feature-flags`, {
      authorization: "Bearer user-a-token",
    });
    expect(didRespond).toBe(false);
  });

  it("is case-insensitive about the Authorization header", () => {
    const { didRespond } = fireFetch(sw, `${ORIGIN}/__api/crm/contacts`, {
      Authorization: "Bearer user-a-token",
    });
    expect(didRespond).toBe(false);
  });

  it("STILL caches an UNAUTHENTICATED API GET (offline fallback must survive)", () => {
    // The public storefront endpoints carry no credentials and are the reason
    // the API cache exists at all. Removing that would be over-correction.
    const { didRespond } = fireFetch(sw, `${ORIGIN}/__api/site/storefront/public/abc`);
    expect(
      didRespond,
      "the offline fallback for public API reads was lost",
    ).toBe(true);
  });

  it("still handles navigations and static assets", () => {
    expect(fireFetch(sw, `${ORIGIN}/app/command-center`).didRespond).toBe(true);
    expect(fireFetch(sw, `${ORIGIN}/icons/icon-192x192.png`).didRespond).toBe(true);
  });

  it("uses a fresh API cache name so previously poisoned entries are purged", () => {
    // The activate handler deletes every cache not named here, so bumping the
    // name is what evicts responses stored before this check existed.
    expect(SW_SOURCE).toContain("kf-api-v4");
    expect(SW_SOURCE).not.toContain("'kf-api-v3'");
  });
});
