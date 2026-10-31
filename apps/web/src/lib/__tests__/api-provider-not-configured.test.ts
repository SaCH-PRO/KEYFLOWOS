import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * R0-07b-WEB-503-PASSTHROUGH: what an api.ts caller sees when an optional
 * service is not set up.
 *
 * WHY this test exists: the server answers a GET that needs Gmail or AI, when
 * that service is not configured, with a structured 503
 * { code: 'provider_not_configured' | 'provider_unavailable', details: { service } }
 * (R0-07). apiGet went through fetchWithRetry, which retried that 503 three
 * times and then threw `HTTP 503: Service Unavailable`; apiGet caught it as a
 * network failure, fired the one-shot "Could not reach API" warning and the
 * kf:api-unreachable event, and returned the bare message with no status and
 * no body. So a screen told to "connect Gmail" instead showed "backend
 * unreachable", after spending four requests of the caller's rate limit
 * (COST-LEDGER-001 section 7 item 6; R0-07 review ST-4 / R07-CR-1).
 *
 * The contract pinned here: one request; the result carries status 503, the
 * server's message, the body's code and details.service; no unreachable
 * warning. A plain 503 (gateway down) keeps today's retry and warning.
 */

const refreshAccessToken = vi.fn();

vi.mock("@/lib/workspace", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

function providerResponse(code: string, service: string, message: string): Response {
  return new Response(
    JSON.stringify({
      statusCode: 503,
      code,
      message,
      error: "Service Unavailable",
      timestamp: "2026-10-31T00:00:00.000Z",
      path: "/x",
      details: { service },
    }),
    { status: 503, statusText: "Service Unavailable", headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

const UNREACHABLE = "[keyflow-api] Could not reach API";

describe("api.ts hands an optional-service 503 to its caller (R0-07b)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let unreachableEvents: number;
  const onUnreachable = () => {
    unreachableEvents += 1;
  };

  const unreachableWarnings = () =>
    warnSpy.mock.calls.filter((args: unknown[]) => String(args[0]).startsWith(UNREACHABLE)).length;

  /** What the caller can see, plus what the request cost, read only through fields that exist before the fix. */
  const observe = (res: { error: string | null; status?: number; rawError?: Record<string, unknown> | null }) => ({
    requests: fetchMock.mock.calls.length,
    error: res.error,
    status: res.status,
    code: res.rawError?.code,
    service: (res.rawError?.details as { service?: unknown } | undefined)?.service,
    unreachableWarnings: unreachableWarnings(),
    unreachableEvents,
  });

  beforeEach(() => {
    // Fresh module state: the in-flight GET map and the once-per-session
    // unreachable flag both live at module level.
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    refreshAccessToken.mockReset();
    refreshAccessToken.mockResolvedValue(false);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    unreachableEvents = 0;
    window.addEventListener("kf:api-unreachable", onUnreachable);
  });

  afterEach(() => {
    window.removeEventListener("kf:api-unreachable", onUnreachable);
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("apiGet: a 503 {code: provider_not_configured, service: gmail} is one request and reaches the caller with status, code and service", async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse("provider_not_configured", "gmail", "Google OAuth not configured"),
    );

    const api = await import("@/lib/api");
    const res = await api.apiGet<{ url: string }>("/commerce/businesses/b1/gmail/auth-url");

    // One observation, so the pre-fix result is recorded whole. Before the fix:
    // { requests: 4, error: "HTTP 503: Service Unavailable", status: undefined,
    //   code: undefined, service: undefined, unreachableWarnings: 1, unreachableEvents: 1 }.
    expect(observe(res)).toEqual({
      requests: 1,
      error: "Google OAuth not configured",
      status: 503,
      code: "provider_not_configured",
      service: "gmail",
      // Not a network failure: no "backend unreachable" warning or event.
      unreachableWarnings: 0,
      unreachableEvents: 0,
    });
    expect(res.data).toBeNull();
    expect(api.providerUnavailableOf(res)).toEqual({ code: "provider_not_configured", service: "gmail" });
  });

  it("apiGet: a 503 {code: provider_unavailable, service: ai} is one request and reaches the caller with status, code and service", async () => {
    fetchMock.mockImplementation(async () =>
      providerResponse(
        "provider_unavailable",
        "ai",
        "No AI providers available: every configured AI provider is temporarily unavailable",
      ),
    );

    const api = await import("@/lib/api");
    const res = await api.apiGet("/ai/businesses/b1/weekly-plan");

    expect(observe(res)).toEqual({
      requests: 1,
      error: "No AI providers available: every configured AI provider is temporarily unavailable",
      status: 503,
      code: "provider_unavailable",
      service: "ai",
      unreachableWarnings: 0,
      unreachableEvents: 0,
    });
    expect(api.providerUnavailableOf(res)).toEqual({ code: "provider_unavailable", service: "ai" });
  });

  it("apiGet: two concurrent callers share the one request and both see provider_not_configured", async () => {
    fetchMock.mockImplementation(async () => providerResponse("provider_not_configured", "gmail", "Gmail not connected"));

    const api = await import("@/lib/api");
    const [a, b] = await Promise.all([
      api.apiGet("/commerce/businesses/b1/gmail/messages"),
      api.apiGet("/commerce/businesses/b1/gmail/messages"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const res of [a, b]) {
      expect(res.status).toBe(503);
      expect(api.providerUnavailableOf(res)).toEqual({ code: "provider_not_configured", service: "gmail" });
    }
  });

  it("apiPost: a refused Gmail send (503 provider_not_configured) reaches the caller with status, code and service", async () => {
    fetchMock.mockImplementation(async () => providerResponse("provider_not_configured", "gmail", "Gmail not connected"));

    const api = await import("@/lib/api");
    const res = await api.apiPost({ path: "/commerce/businesses/b1/invoices/i1/send-email", body: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.error).toBe("Gmail not connected");
    expect(res.status).toBe(503);
    expect(api.providerUnavailableOf(res)).toEqual({ code: "provider_not_configured", service: "gmail" });
    expect(unreachableWarnings()).toBe(0);
  });

  it("an error that is not the provider 503 is not reported as one", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ statusCode: 400, code: "provider_not_configured", message: "odd" }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/json" },
        }),
    );

    const api = await import("@/lib/api");
    const res = await api.apiGet("/crm/contacts");

    expect(res.status).toBe(400);
    expect(api.providerUnavailableOf(res)).toBeNull();
  });

  it(
    "apiGet: a plain 503 with an HTML body keeps today's behaviour: retried to four requests, HTTP 503 message, unreachable warning",
    async () => {
      fetchMock.mockImplementation(
        async () =>
          new Response("<html><body>503 Service Temporarily Unavailable</body></html>", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "content-type": "text/html" },
          }),
      );

      const api = await import("@/lib/api");
      const res = await api.apiGet("/crm/contacts");

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(res.error).toBe("HTTP 503: Service Unavailable");
      expect(res.data).toBeNull();
      expect(res.rawError ?? null).toBeNull();
      expect({ warnings: unreachableWarnings(), events: unreachableEvents }).toEqual({ warnings: 1, events: 1 });
    },
    15_000,
  );
});
