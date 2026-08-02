import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression coverage for the 401 -> refresh -> retry path in `@/lib/api`.
 *
 * WHY this test exists: `buildHeaders()` lets caller-supplied headers overwrite
 * the freshly minted `Authorization`. Every apiGet/apiPost/... already passes a
 * `Headers` object built from the *current* token into `fetchWithRefresh`, so on
 * retry the stale `Authorization` from `init.headers` was copied back over the
 * newly refreshed one. The refresh happened and was then thrown away, meaning a
 * session hard-401'd the instant the Supabase access token expired.
 */

const refreshAccessToken = vi.fn();

vi.mock("@/lib/workspace", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : "OK",
    json: async () => body,
  } as unknown as Response;
}

function authOf(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("authorization");
}

describe("api 401 refresh + retry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "expired-token");
    refreshAccessToken.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("retries with the refreshed token, not the expired one (apiGet)", async () => {
    refreshAccessToken.mockImplementation(async () => {
      // Mirrors workspace.refreshAccessToken: it persists the new access token.
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "jwt expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const { apiGet } = await import("@/lib/api");
    const res = await apiGet<{ ok: boolean }>("/crm/contacts");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer expired-token");
    expect(authOf(fetchMock.mock.calls[1])).toBe("Bearer fresh-token");
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: true });
  });

  it("retries with the refreshed token on apiPost while keeping caller headers", async () => {
    refreshAccessToken.mockImplementation(async () => {
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "jwt expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "1" }));

    const { apiPost } = await import("@/lib/api");
    const res = await apiPost<{ id: string }>({
      path: "/crm/contacts",
      body: { name: "Ada" },
      init: { headers: { "X-Idempotency-Key": "abc-123" } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[1])).toBe("Bearer fresh-token");
    // Non-auth caller headers must survive the retry.
    const retryHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(retryHeaders.get("x-idempotency-key")).toBe("abc-123");
    expect(res.data).toEqual({ id: "1" });
  });

  it("does not retry when the refresh fails", async () => {
    refreshAccessToken.mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "jwt expired" }));

    const { apiGet } = await import("@/lib/api");
    const res = await apiGet("/crm/contacts");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.error).toBe("jwt expired");
  });
});
