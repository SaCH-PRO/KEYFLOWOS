import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * fetchWithAuthRetry — the 401 refresh path for hand-rolled fetch calls.
 *
 * The typed apiGet/apiPost wrappers already refreshed on 401. But client.ts had
 * 22 hand-rolled `fetch()` calls that did not: file uploads that need FormData
 * (so they cannot use the JSON wrappers), plus a long tail of one-offs. Every
 * one of them hard-401'd the instant the Supabase access token expired, in the
 * middle of an otherwise working session.
 *
 * The contract that makes substituting this at an existing call site safe: the
 * FIRST attempt must be byte-identical to what plain fetch would have sent.
 * Only the 401 path differs.
 */

const refreshAccessToken = vi.fn();

vi.mock("@/lib/workspace", () => ({
  refreshAccessToken: () => refreshAccessToken(),
}));

function res(status: number): Response {
  return { ok: status < 400, status, json: async () => ({}) } as unknown as Response;
}

const authOf = (call: unknown[]) =>
  new Headers((call[1] as RequestInit | undefined)?.headers).get("authorization");

describe("fetchWithAuthRetry", () => {
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

  it("passes the first attempt through untouched", async () => {
    // The substitution is only safe if attempt 1 is exactly what fetch would
    // have sent — same method, headers and body.
    fetchMock.mockResolvedValueOnce(res(200));
    const { fetchWithAuthRetry } = await import("../api");

    const body = new FormData();
    const init = { method: "POST", headers: { Authorization: "Bearer expired-token" }, body };
    await fetchWithAuthRetry("https://x/y", init);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, sent] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x/y");
    expect((sent as RequestInit).method).toBe("POST");
    expect((sent as RequestInit).body).toBe(body);
  });

  it("does not retry on success", async () => {
    fetchMock.mockResolvedValueOnce(res(200));
    const { fetchWithAuthRetry } = await import("../api");

    await fetchWithAuthRetry("https://x/y", { headers: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("does not retry on a non-401 error", async () => {
    // A 500 is not an auth problem; retrying would double a failed write.
    fetchMock.mockResolvedValueOnce(res(500));
    const { fetchWithAuthRetry } = await import("../api");

    await fetchWithAuthRetry("https://x/y", { headers: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("retries a 401 with the REFRESHED token, not the expired one", async () => {
    // The regression, in one test.
    refreshAccessToken.mockImplementation(async () => {
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const { fetchWithAuthRetry } = await import("../api");

    const out = await fetchWithAuthRetry("https://x/y", {
      headers: { Authorization: "Bearer expired-token" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer expired-token");
    expect(authOf(fetchMock.mock.calls[1])).toBe("Bearer fresh-token");
    expect(out.status).toBe(200);
  });

  it("returns the 401 unchanged when refresh fails", async () => {
    // No token to retry with — replaying the expired one would just 401 again.
    refreshAccessToken.mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(res(401));
    const { fetchWithAuthRetry } = await import("../api");

    const out = await fetchWithAuthRetry("https://x/y", { headers: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(401);
  });

  it("never sets Content-Type, so multipart uploads keep their boundary", async () => {
    // Six of the substituted call sites are FormData uploads. Setting
    // Content-Type on the retry would strip the browser's boundary and corrupt
    // the upload.
    refreshAccessToken.mockImplementation(async () => {
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const { fetchWithAuthRetry } = await import("../api");

    await fetchWithAuthRetry("https://x/y", { method: "POST", body: new FormData() });

    for (const call of fetchMock.mock.calls) {
      const ct = new Headers((call[1] as RequestInit | undefined)?.headers).get("content-type");
      expect(ct).toBeNull();
    }
  });

  it("preserves caller headers other than Authorization on retry", async () => {
    refreshAccessToken.mockImplementation(async () => {
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const { fetchWithAuthRetry } = await import("../api");

    await fetchWithAuthRetry("https://x/y", {
      headers: { "X-Trace": "abc", Authorization: "Bearer expired-token" },
    });

    const retry = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(retry.get("x-trace")).toBe("abc");
    expect(retry.get("authorization")).toBe("Bearer fresh-token");
  });
});
