import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Coverage for in-flight request coalescing in `apiGet`.
 *
 * WHY this test exists: two components mounting together used to issue two
 * identical network requests, and 42 endpoints in this app are fetched from
 * more than one file — so it was the common case on every screen. `apiGet` now
 * shares a single in-flight request between concurrent callers.
 *
 * The properties that make that safe are the ones asserted here: the entry is
 * dropped as soon as the request settles (so nothing is ever served stale), a
 * different auth identity never joins, an abortable caller never joins, callers
 * do not share one object graph, and a failure does not poison the map.
 */

const refreshAccessToken = vi.fn();

vi.mock("@/lib/workspace", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

/** A deferred so a test can hold a request open while a second caller arrives. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("apiGet in-flight coalescing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Resets the module-level in-flight map between tests.
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    refreshAccessToken.mockReset();
    refreshAccessToken.mockResolvedValue(false);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("issues ONE request for two concurrent callers of the same path", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const a = apiGet<{ n: number }>("/crm/contacts");
    const b = apiGet<{ n: number }>("/crm/contacts");

    gate.resolve(jsonResponse(200, { n: 1 }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra.data).toEqual({ n: 1 });
    expect(rb.data).toEqual({ n: 1 });
  });

  it("gives each caller its OWN object, so one cannot mutate the other's data", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const a = apiGet<{ items: number[] }>("/crm/contacts");
    const b = apiGet<{ items: number[] }>("/crm/contacts");

    gate.resolve(jsonResponse(200, { items: [1] }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra.data).toEqual(rb.data);
    // Structurally equal, but NOT the same reference.
    expect(ra.data).not.toBe(rb.data);

    ra.data!.items.push(999);
    expect(rb.data!.items).toEqual([1]);
  });

  it("does NOT serve a settled response to a later caller (no stale cache)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { v: "first" }))
      .mockResolvedValueOnce(jsonResponse(200, { v: "second" }));

    const { apiGet } = await import("@/lib/api");
    const first = await apiGet<{ v: string }>("/crm/contacts");
    const second = await apiGet<{ v: string }>("/crm/contacts");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.data).toEqual({ v: "first" });
    expect(second.data).toEqual({ v: "second" });
  });

  it("does not share a request across different auth identities", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const a = apiGet("/crm/contacts");
    window.localStorage.setItem("kf_token", "token-b");
    const b = apiGet("/crm/contacts");

    gate.resolve(jsonResponse(200, { ok: true }));
    await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share a request across different paths", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const a = apiGet("/crm/contacts");
    const b = apiGet("/crm/companies");

    gate.resolve(jsonResponse(200, { ok: true }));
    await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an abortable caller never joins a shared request", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const shared = apiGet("/crm/contacts");
    const owned = apiGet("/crm/contacts", { signal: new AbortController().signal });

    gate.resolve(jsonResponse(200, { ok: true }));
    await Promise.all([shared, owned]);

    // Aborting `owned` must not be able to cancel `shared`, so they cannot
    // be the same request.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed request does not poison later callers", async () => {
    // "boom" is deliberately not a retryable message (see isRetryableError in
    // fetch-with-retry), so this rejects once rather than backing off 3 times.
    fetchMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(jsonResponse(200, { recovered: true }));

    const { apiGet } = await import("@/lib/api");
    const failed = await apiGet("/crm/contacts");
    expect(failed.error).toBe("boom");
    expect(failed.data).toBeNull();

    const recovered = await apiGet<{ recovered: boolean }>("/crm/contacts");
    expect(recovered.error).toBeNull();
    expect(recovered.data).toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("both concurrent callers observe a shared failure", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));

    const { apiGet } = await import("@/lib/api");
    const [a, b] = await Promise.all([apiGet("/crm/contacts"), apiGet("/crm/contacts")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.error).toBe("boom");
    expect(b.error).toBe("boom");
  });

  it("no longer appends a _t cache-buster to the URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const { apiGet } = await import("@/lib/api");
    await apiGet("/crm/contacts");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toMatch(/[?&]_t=/);
    expect(url).toContain("/crm/contacts");
    // A stable URL is what lets the service worker's offline fallback match.
    expect(url.endsWith("/crm/contacts")).toBe(true);
  });

  it("still surfaces HTTP errors and keeps them per-caller", async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

    const { apiGet } = await import("@/lib/api");
    const a = apiGet("/crm/contacts");
    const b = apiGet("/crm/contacts");

    gate.resolve(jsonResponse(500, { message: "server exploded" }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra.error).toBe("server exploded");
    expect(rb.error).toBe("server exploded");
    expect(ra.data).toBeNull();
  });
});
