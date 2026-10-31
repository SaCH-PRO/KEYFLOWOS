import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * R0-07b-WEB-503-PASSTHROUGH: fetchWithRetry and the optional-service 503.
 *
 * WHY this test exists: R0-07 made the server answer an optional service that
 * is not set up (Gmail not connected, no AI provider key) with a structured 503:
 *
 *   { statusCode: 503, code: 'provider_not_configured', message, details: { service: 'gmail' | 'ai' } }
 *
 * and, for AI whose every configured provider is circuit-open, the same shape
 * with code 'provider_unavailable'. fetchWithRetry treated every GET 503 as a
 * transient gateway failure: it retried three times (four requests against the
 * caller's rate limit) and then threw `HTTP 503: <statusText>`, dropping the
 * body and with it the code (COST-LEDGER-001 section 7 item 6; R0-07 review
 * ST-4 / R07-CR-1). Retrying cannot change "not configured", so that answer is
 * handed back on the first response with its body intact. A plain 503 (gateway
 * down, an HTML error page, a JSON body without one of those codes) is still
 * transient and keeps today's retry.
 */

function providerResponse(code: string, service: string, message: string): Response {
  return new Response(
    JSON.stringify({ statusCode: 503, code, message, error: "Service Unavailable", details: { service } }),
    { status: 503, statusText: "Service Unavailable", headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function htmlGateway503(): Response {
  return new Response("<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "text/html" },
  });
}

/** Settle either way, so a test can assert on the request count before the outcome. */
async function settle(p: Promise<Response>): Promise<{ res: Response | null; thrown: string | null }> {
  try {
    return { res: await p, thrown: null };
  } catch (err) {
    return { res: null, thrown: err instanceof Error ? err.message : String(err) };
  }
}

describe("fetchWithRetry hands an optional-service 503 to its caller (R0-07b)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a GET 503 {code: provider_not_configured, details.service: gmail} is requested once and returned with its body intact", async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse("provider_not_configured", "gmail", "Google OAuth not configured"),
    );

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(
      fetchWithRetry("http://api.test/commerce/businesses/b1/gmail/auth-url", { method: "GET" }, { baseDelayMs: 0 }),
    );

    // Before the fix: { requests: 4, thrown: "HTTP 503: Service Unavailable" }.
    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({ requests: 1, thrown: null });
    expect(outcome.res?.status).toBe(503);
    const body = (await outcome.res!.json()) as { code: string; details: { service: string }; message: string };
    expect(body.code).toBe("provider_not_configured");
    expect(body.details.service).toBe("gmail");
    expect(body.message).toBe("Google OAuth not configured");
  });

  it("a GET 503 {code: provider_unavailable, details.service: ai} is requested once and returned with its body intact", async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse(
        "provider_unavailable",
        "ai",
        "No AI providers available: every configured AI provider is temporarily unavailable",
      ),
    );

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(
      fetchWithRetry("http://api.test/ai/businesses/b1/weekly-plan", undefined, { baseDelayMs: 0 }),
    );

    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({ requests: 1, thrown: null });
    expect(outcome.res?.status).toBe(503);
    const body = (await outcome.res!.json()) as { code: string; details: { service: string } };
    expect(body.code).toBe("provider_unavailable");
    expect(body.details.service).toBe("ai");
  });

  it("the timeout path (as api.ts calls it) also returns the provider 503 on the first response", async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse("provider_not_configured", "ai", "No AI providers available: no AI provider is configured"),
    );

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(
      fetchWithRetry("http://api.test/ai/x", { method: "GET" }, { timeoutMs: 30_000, retries: 3, baseDelayMs: 0 }),
    );

    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({ requests: 1, thrown: null });
    const body = (await outcome.res!.json()) as { code: string };
    expect(body.code).toBe("provider_not_configured");
  });

  it("a plain 503 with an HTML body (gateway down) keeps today's retry: four requests, then HTTP 503", async () => {
    fetchMock.mockImplementation(async () => htmlGateway503());

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(fetchWithRetry("http://api.test/crm/contacts", { method: "GET" }, { baseDelayMs: 0 }));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(outcome.thrown).toBe("HTTP 503: Service Unavailable");
  });

  it("a 503 with an empty body, or a JSON body without a provider code, keeps today's retry", async () => {
    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");

    fetchMock.mockImplementation(async () => new Response(null, { status: 503, statusText: "Service Unavailable" }));
    const empty = await settle(fetchWithRetry("http://api.test/a", undefined, { baseDelayMs: 0 }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(empty.thrown).toBe("HTTP 503: Service Unavailable");

    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ statusCode: 503, code: "SERVICE_UNAVAILABLE", message: "maintenance" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json" },
        }),
    );
    const otherCode = await settle(fetchWithRetry("http://api.test/b", undefined, { baseDelayMs: 0 }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(otherCode.thrown).toBe("HTTP 503: Service Unavailable");
  });

  it("a transient 503 followed by a provider 503 stops at the provider answer", async () => {
    fetchMock
      .mockImplementationOnce(async () => htmlGateway503())
      .mockImplementation(async () => providerResponse("provider_not_configured", "gmail", "Gmail not connected"));

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(fetchWithRetry("http://api.test/c", undefined, { baseDelayMs: 0 }));

    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({ requests: 2, thrown: null });
    expect(((await outcome.res!.json()) as { code: string }).code).toBe("provider_not_configured");
  });
});

/**
 * R0-07b review ST-1: the 503 body check must be bounded.
 *
 * The check reads a clone of the 503 body. The first cut read it whole, after
 * the per-attempt timer had been cleared, so a 503 whose body never finished
 * hung fetchWithRetry forever (one request, never settles), where before the
 * check the same response was retried and rejected after four requests. The
 * read is now capped in time (never past the attempt's timeout, at most 5 s
 * without one) and in size, and a body that misses either bound is a plain
 * 503: retried, as before, with the stalled response's body cancelled.
 */

/** A JSON 503 whose body sends `head` and then never closes. */
function stalled503(head: string, onCancel: () => void): Response {
  const bytes = new TextEncoder().encode(head);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "application/json" },
  });
}

/** A JSON 503 whose (complete) body arrives in several chunks. */
function chunked503(json: string, pieces: number): Response {
  const bytes = new TextEncoder().encode(json);
  const size = Math.ceil(bytes.byteLength / pieces);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.byteLength; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "content-type": "application/json" },
  });
}

const HUNG = Symbol("hung");

/** Resolves with HUNG if `p` has not settled within `ms` of real time. */
async function settleWithin(p: Promise<Response>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => resolve(HUNG), ms);
  });
  try {
    return await Promise.race([settle(p), hung]);
  } finally {
    clearTimeout(timer);
  }
}

describe("fetchWithRetry bounds the 503 body check (R0-07b review ST-1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("timeout path: a 503 whose JSON body stalls is retried to four requests and rejects HTTP 503, as before the check", async () => {
    let cancelled = 0;
    fetchMock.mockImplementation(async () =>
      stalled503('{"statusCode":503,"code":"prov', () => {
        cancelled += 1;
      }),
    );

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settleWithin(
      fetchWithRetry("http://api.test/commerce/x", { method: "GET" }, { timeoutMs: 200, retries: 3, baseDelayMs: 0 }),
      3_000,
    );

    // Before the repair: HUNG after one request.
    expect(outcome).not.toBe(HUNG);
    expect({ requests: fetchMock.mock.calls.length, thrown: outcome === HUNG ? null : outcome.thrown }).toEqual({
      requests: 4,
      thrown: "HTTP 503: Service Unavailable",
    });
    // Each stalled response is let go: its body is cancelled and its attempt aborted.
    expect(cancelled).toBe(4);
    const signals = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).signal as AbortSignal);
    expect(signals.map((s) => s.aborted)).toEqual([true, true, true, true]);
  });

  it("no-timeout path: a stalled 503 body is given up after 5 s per attempt and the 503 is retried", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => stalled503('{"statusCode":503,"code":"prov', () => undefined));

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const pending = settle(fetchWithRetry("http://api.test/a", undefined, { retries: 3, baseDelayMs: 0 }));

    await vi.advanceTimersByTimeAsync(4_900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 5_000 + 1_000);

    const outcome = await pending;
    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({
      requests: 4,
      thrown: "HTTP 503: Service Unavailable",
    });
  });

  it("a stalled 503 on the first attempt does not block the retry that succeeds", async () => {
    fetchMock
      .mockImplementationOnce(async () => stalled503('{"statusCode":503', () => undefined))
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settleWithin(
      fetchWithRetry("http://api.test/b", undefined, { timeoutMs: 200, baseDelayMs: 0 }),
      3_000,
    );

    expect(outcome).not.toBe(HUNG);
    if (outcome === HUNG) return;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.res?.status).toBe(200);
    expect(await outcome.res!.json()).toEqual({ ok: true });
  });

  it("a provider 503 whose body arrives in several chunks is still handed back on the first response", async () => {
    const json = JSON.stringify({
      statusCode: 503,
      code: "provider_not_configured",
      message: "Gmail not connected",
      details: { service: "gmail" },
    });
    fetchMock.mockImplementation(async () => chunked503(json, 5));

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const outcome = await settle(fetchWithRetry("http://api.test/c", undefined, { timeoutMs: 1_000, baseDelayMs: 0 }));

    expect({ requests: fetchMock.mock.calls.length, thrown: outcome.thrown }).toEqual({ requests: 1, thrown: null });
    expect(await outcome.res!.json()).toEqual(JSON.parse(json));
  });

  it("the attempt timer is cleared when a provider 503 is handed back, so the caller's own body read is not cut off", async () => {
    fetchMock.mockImplementation(async () => providerResponse("provider_not_configured", "gmail", "Gmail not connected"));

    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");
    const res = await fetchWithRetry("http://api.test/d", undefined, { timeoutMs: 50, baseDelayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(((await res.json()) as { code: string }).code).toBe("provider_not_configured");
  });

  it("a 503 JSON body over the size bound is a plain 503 and keeps the retry, even with a provider code", async () => {
    const padded = JSON.stringify({
      statusCode: 503,
      code: "provider_not_configured",
      message: "x".repeat(20 * 1024),
      details: { service: "gmail" },
    });
    const { fetchWithRetry } = await import("@/lib/fetch-with-retry");

    // Streamed, no Content-Length: stopped at the bound while reading.
    fetchMock.mockImplementation(async () => chunked503(padded, 8));
    const streamed = await settle(fetchWithRetry("http://api.test/e", undefined, { baseDelayMs: 0 }));
    expect({ requests: fetchMock.mock.calls.length, thrown: streamed.thrown }).toEqual({
      requests: 4,
      thrown: "HTTP 503: Service Unavailable",
    });

    // Declared too large by Content-Length: not read at all.
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(padded, {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json", "content-length": String(padded.length) },
        }),
    );
    const declared = await settle(fetchWithRetry("http://api.test/f", undefined, { baseDelayMs: 0 }));
    expect({ requests: fetchMock.mock.calls.length, thrown: declared.thrown }).toEqual({
      requests: 4,
      thrown: "HTTP 503: Service Unavailable",
    });
  });
});
