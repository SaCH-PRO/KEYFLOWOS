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
