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
import { selectBusiness } from "@/lib/workspace";

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
