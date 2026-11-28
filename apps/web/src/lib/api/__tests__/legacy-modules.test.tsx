/**
 * WEDGE-HIDE-STORE (P225; D-263 'wedge'; orchestrator decision option (A) part 1, #273 7207944212): the web reads the
 * per-business legacy answer (NAV-B-LEGACY-SERVER, GET /identity/businesses/:businessId/legacy-modules) through ONE
 * helper, lib/api/legacy-modules.ts. A hidden module is offered only when the server has answered, for the business on
 * screen, a list naming it. Fail closed: no answer yet, a refusal, a 5xx, a network failure or a malformed body is
 * "not legacy" (hidden). The answer is kept with its business; after a switch the old business's answer is never used,
 * and a late reply for it is dropped.
 *
 * The real helper and the real client (lib/api.ts) are mounted; only `fetch` is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { clearStoredBusinessId, selectBusiness } from "@/lib/workspace";

const BIZ = "biz_whs_x";
const BIZ_Y = "biz_whs_y";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 403 ? "Forbidden" : "Internal Server Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

type Answer = { status: number; body: unknown } | "network";

/** Answers GET .../legacy-modules per business; `hold` keeps a business's reply until `release(biz)`. */
function serve(answers: Record<string, Answer>, hold: string[] = []) {
  const held = new Map<string, () => void>();
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    paths.push(pathname);
    const match = pathname.match(/\/identity\/businesses\/([^/]+)\/legacy-modules$/);
    if (!match) return jsonResponse(500, { message: "unexpected" });
    const biz = decodeURIComponent(match[1]);
    if (hold.includes(biz)) await new Promise<void>((resolve) => held.set(biz, resolve));
    const answer = answers[biz] ?? { status: 500, body: { message: "Internal server error" } };
    if (answer === "network") throw new TypeError("Failed to fetch");
    return jsonResponse(answer.status, answer.body);
  }));
  return {
    paths,
    release: (biz: string) => { held.get(biz)?.(); held.delete(biz); },
    releaseAll: () => { for (const r of held.values()) r(); held.clear(); },
  };
}

async function mountProbe(key = "store") {
  const { useLegacyModule } = await import("@/lib/api/legacy-modules");
  function Probe() {
    const { has, known } = useLegacyModule(key);
    return <p data-testid="probe">{known ? (has ? "legacy" : "not-legacy") : "unknown"}</p>;
  }
  render(<Probe />);
}

const probe = () => screen.getByTestId("probe").textContent;

beforeEach(async () => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const mod = await import("@/lib/api/legacy-modules");
  mod.resetLegacyModulesForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("WEDGE-HIDE-STORE: the legacy-modules helper (fail closed, per business)", () => {
  it("[WHS-W01] RED-BEFORE: a business whose answer names the store is legacy for `store`, after the answer and not before", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["payroll", "store"] } }, [BIZ]);
    try {
      await mountProbe();
      expect(probe()).toBe("unknown");
      api.release(BIZ);
      await waitFor(() => expect(probe()).toBe("legacy"));
      expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
    } finally {
      api.releaseAll();
    }
  });

  it("[WHS-W02] RED-BEFORE: an answer that does not name the store is not legacy", async () => {
    serve({ [BIZ]: { status: 200, body: ["payroll"] } });
    await mountProbe();
    await waitFor(() => expect(probe()).toBe("not-legacy"));
  });

  for (const [label, answer] of [
    ["a refusal (403)", { status: 403, body: { statusCode: 403, message: "No access to this business" } }],
    ["a 500", { status: 500, body: { statusCode: 500, message: "Internal server error" } }],
    ["a network failure", "network"],
    ["a body that is not a list", { status: 200, body: { store: true } }],
    ["a list with a non-string", { status: 200, body: ["store", 7] }],
  ] as Array<[string, Answer]>) {
    it(`[WHS-W03] RED-BEFORE: fail closed on ${label}: not legacy, never legacy`, async () => {
      serve({ [BIZ]: answer });
      await mountProbe();
      await waitFor(() => expect(probe()).toBe("not-legacy"), { timeout: 10_000 });
    });
  }

  it("[WHS-W04] RED-BEFORE: kept with its business: after a switch, X's 'store' is not used while Y's answer is in flight, and Y's own answer decides", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] }, [BIZ_Y]: { status: 200, body: [] } }, [BIZ_Y]);
    try {
      await mountProbe();
      await waitFor(() => expect(probe()).toBe("legacy"));
      act(() => selectBusiness(BIZ_Y));
      await waitFor(() => expect(api.paths).toContain(`/identity/businesses/${BIZ_Y}/legacy-modules`));
      expect(probe()).toBe("unknown");
      api.release(BIZ_Y);
      await waitFor(() => expect(probe()).toBe("not-legacy"));
    } finally {
      api.releaseAll();
    }
  });

  it("[WHS-W05] RED-BEFORE: a late reply for the old business is dropped: X's held 'store' landing after the switch to Y never makes Y legacy", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] }, [BIZ_Y]: { status: 200, body: [] } }, [BIZ]);
    try {
      await mountProbe();
      await waitFor(() => expect(api.paths).toContain(`/identity/businesses/${BIZ}/legacy-modules`));
      act(() => selectBusiness(BIZ_Y));
      await waitFor(() => expect(probe()).toBe("not-legacy"));
      api.release(BIZ);
      await new Promise((r) => setTimeout(r, 100));
      expect(probe()).toBe("not-legacy");
    } finally {
      api.releaseAll();
    }
  });

  it("[WHS-W06] RED-BEFORE: with no business selected, nothing is read and nothing is legacy", async () => {
    window.localStorage.clear();
    const api = serve({});
    await mountProbe();
    await new Promise((r) => setTimeout(r, 50));
    expect(probe()).toBe("not-legacy");
    expect(api.paths).toEqual([]);
  });
});

/** A session token whose payload names `sub` (lib/business-settings.ts actingMember reads the claim). */
function tokenFor(sub: string): string {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64({ sub })}.sig`;
}

/** Mounts the probe and hands back a way to render it again (a render with no announcement, as any parent update is). */
async function mountRerenderable(key = "store") {
  const { useLegacyModule } = await import("@/lib/api/legacy-modules");
  function Probe() {
    const { has, known } = useLegacyModule(key);
    return <p data-testid="probe">{known ? (has ? "legacy" : "not-legacy") : "unknown"}</p>;
  }
  const view = render(<Probe />);
  return { again: () => view.rerender(<Probe />) };
}

describe("WEDGE-HIDE-STORE repair round 1 (acceptance reviews at d781c4e9): the helper follows the business and the member while mounted", () => {
  beforeEach(() => {
    window.localStorage.setItem("kf_token", tokenFor("user_a"));
  });

  it("[WHS-W07] RED-BEFORE: a stored business changed with no announcement (refreshWorkspace's correction, a first business bootstrapped) is picked up on the next render: X's 'store' is not kept for Y", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] }, [BIZ_Y]: { status: 200, body: [] } });
    const view = await mountRerenderable();
    await waitFor(() => expect(probe()).toBe("legacy"));
    window.localStorage.setItem("kf_business_id", BIZ_Y);
    view.again();
    expect(probe()).not.toBe("legacy");
    await waitFor(() => expect(probe()).toBe("not-legacy"));
    expect(api.paths).toContain(`/identity/businesses/${BIZ_Y}/legacy-modules`);
  });

  it("[WHS-W08] RED-BEFORE: another tab's switch arrives as a storage event: the hook reads Y and X's 'store' is not kept", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] }, [BIZ_Y]: { status: 200, body: [] } });
    await mountRerenderable();
    await waitFor(() => expect(probe()).toBe("legacy"));
    act(() => {
      window.localStorage.setItem("kf_business_id", BIZ_Y);
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", newValue: BIZ_Y }));
    });
    expect(probe()).not.toBe("legacy");
    await waitFor(() => expect(probe()).toBe("not-legacy"));
    expect(api.paths).toContain(`/identity/businesses/${BIZ_Y}/legacy-modules`);
  });

  it("[WHS-W09] RED-BEFORE: sign-out while mounted (clearStoredBusinessId) leaves nothing legacy", async () => {
    serve({ [BIZ]: { status: 200, body: ["store"] } });
    const view = await mountRerenderable();
    await waitFor(() => expect(probe()).toBe("legacy"));
    act(() => clearStoredBusinessId());
    view.again();
    expect(probe()).toBe("not-legacy");
  });

  it("[WHS-W10] RED-BEFORE: a different user signing in on the same tab, to the same business, is not given the previous user's answer: it is read again, and a refusal is not legacy", async () => {
    let refuse = false;
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } });
    const answering = globalThis.fetch;
    const sent: Array<{ path: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push({ path: new URL(url, "http://localhost").pathname, authorization: new Headers(init?.headers).get("authorization") });
      return refuse ? jsonResponse(403, { statusCode: 403, message: "No access to this business" }) : answering(input, init);
    }));
    const view = await mountRerenderable();
    await waitFor(() => expect(probe()).toBe("legacy"));
    // Sign-out, then user B signs in on this tab and lands on the same business id.
    act(() => clearStoredBusinessId());
    refuse = true;
    window.localStorage.setItem("kf_token", tokenFor("user_b"));
    window.localStorage.setItem("kf_business_id", BIZ);
    view.again();
    expect(probe()).not.toBe("legacy");
    await waitFor(() => expect(probe()).toBe("not-legacy"));
    // Repair round 2: the second member's own request, under their own token, and exactly one of it.
    expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
    expect(sent.map((r) => r.path)).toEqual([`/identity/businesses/${BIZ}/legacy-modules`, `/identity/businesses/${BIZ}/legacy-modules`]);
    expect(sent[0].authorization).toBe(`Bearer ${tokenFor("user_a")}`);
    expect(sent[1].authorization).toBe(`Bearer ${tokenFor("user_b")}`);
  });

  it("[WHS-W11] RED-BEFORE (MINOR 1): a business that appears after mount (none stored at first) is read, and its 'store' is honoured", async () => {
    window.localStorage.removeItem("kf_business_id");
    window.localStorage.removeItem("activeBusinessId");
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } });
    const view = await mountRerenderable();
    expect(probe()).toBe("not-legacy");
    expect(api.paths).toEqual([]);
    window.localStorage.setItem("kf_business_id", BIZ);
    view.again();
    await waitFor(() => expect(probe()).toBe("legacy"));
  });
});

describe("WEDGE-HIDE-STORE repair round 2 (confirmation reviews at 1899e532)", () => {
  beforeEach(() => {
    window.localStorage.setItem("kf_token", tokenFor("user_a"));
  });

  it("[WHS-W12] RED-BEFORE: while hydrating, the hook never reports a known 'not legacy': a consumer acting on `known && !has` must not act on a hard load", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } }, [BIZ]);
    const { useLegacyModule } = await import("@/lib/api/legacy-modules");
    const seen: string[] = [];
    function Probe() {
      const { has, known } = useLegacyModule("store");
      const state = known ? (has ? "legacy" : "not-legacy") : "unknown";
      seen.push(state);
      return <p data-testid="probe">{state}</p>;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Probe />);
    const serverRendered = [...seen];
    seen.length = 0;
    let root: ReturnType<typeof hydrateRoot> | null = null;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Probe />);
      });
      // The server render and every render of the hydrating commit: unknown, never a known answer.
      expect(serverRendered).toEqual(["unknown"]);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen).not.toContain("not-legacy");
      expect(seen).not.toContain("legacy");
      api.release(BIZ);
      await waitFor(() => expect(container.textContent).toBe("legacy"));
      // The hydrating selection starts no read of its own: the one request is the selected business's.
      expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
    } finally {
      api.releaseAll();
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("[WHS-W13] a failed read is not kept: after a 500, the next mount reads again and the answer then decides", async () => {
    let fail = true;
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } });
    const answering = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      fail ? jsonResponse(500, { statusCode: 500, message: "Internal server error" }) : answering(input, init)));
    await mountProbe();
    await waitFor(() => expect(probe()).toBe("not-legacy"));
    expect(api.paths).toEqual([]);
    cleanup();
    fail = false;
    await mountProbe();
    await waitFor(() => expect(probe()).toBe("legacy"));
    expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
  });

  it("[WHS-W14] two readers of the same business make one request", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } });
    const { useLegacyModule } = await import("@/lib/api/legacy-modules");
    function Two() {
      const a = useLegacyModule("store");
      const b = useLegacyModule("payroll");
      return <p data-testid="two">{`${a.known}:${a.has}|${b.known}:${b.has}`}</p>;
    }
    render(<Two />);
    await waitFor(() => expect(screen.getByTestId("two").textContent).toBe("true:true|true:false"));
    expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
  });

  it("[WHS-W15] an answer already read in this tab is not fetched again, and is known at once on the next mount", async () => {
    const api = serve({ [BIZ]: { status: 200, body: ["store"] } });
    await mountProbe();
    await waitFor(() => expect(probe()).toBe("legacy"));
    cleanup();
    await mountProbe();
    expect(probe()).toBe("legacy");
    await new Promise((r) => setTimeout(r, 50));
    expect(api.paths).toEqual([`/identity/businesses/${BIZ}/legacy-modules`]);
  });
});
