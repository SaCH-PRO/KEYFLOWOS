/**
 * FU-CONTACT-SEND-QUOTE-DOOR round 4 (from the confirmation reviews of 0d4b9795):
 *
 *   COR-SQD-5  useOffersQuote follows the business it is asked for: an answer for another business is never applied.
 *     OQ-01 pin  business A answers revenue read (hidden); the hook is then asked for business B, whose answer is slow:
 *                until B answers it is unknown (offered), never A's stale "read"; B's own answer then applies.
 *     OQ-02 pin  the same, B answering read: hidden only once B says so.
 *   SEC-SQD-4 / COR-SQD-6  the next-action "Send Quote" (the Action Center's and the focus view's queue, all fed by
 *              useContactsPipeline's nextActions) follows the same rule as the card's Send Quote (offersQuote).
 *     NAG-01 RED-BEFORE  revenue read: the screen's next actions hold no send_quote; its other actions stay
 *     NAG-02 control     revenue write: the send_quote action is offered
 *     NAG-03 control     my-access fails (unknown): offered
 *
 * The real hooks on the real lib/api and lib/client; only fetch, the router, sonner and Dexie are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { useOffersQuote } from "../hooks/use-contact-actions";
import { useContactsPipeline } from "../use-contacts-pipeline";
import { setCachedUser } from "@/lib/workspace";

const routerStub = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

/** A Dexie stand-in that stores nothing (the screen's contact cache is not under test here). */
const fakeDexie = vi.hoisted(() => {
  class NoopTable {
    where() { return { equals: () => this.matching() }; }
    matching() { return { toArray: async () => [], count: async () => 0, delete: async () => 0 }; }
    async toArray() { return []; }
    async count() { return 0; }
    async clear() {}
    async bulkPut() {}
  }
  class FakeDexie {
    constructor(readonly name: string) {}
    version() {
      return {
        stores: (schema: Record<string, string>) => {
          for (const table of Object.keys(schema)) (this as unknown as Record<string, NoopTable>)[table] = new NoopTable();
          return this;
        },
      };
    }
    close() {}
    static async delete() {}
    static async exists() { return false; }
  }
  return { FakeDexie };
});
vi.mock("dexie", () => ({ default: fakeDexie.FakeDexie, Dexie: fakeDexie.FakeDexie }));

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const A = "biz_oq_a";
const B = "biz_oq_b";
const modules = (m: Record<string, string>) => ({ status: 200, body: { modules: m } });
type Answer = { status: number; body: unknown };

/** my-access answered per business; a business in `held` answers only when its release is called. */
function stubAccess(answers: Record<string, Answer>, held: Record<string, Promise<void>> = {}, extra?: (pathname: string, method: string) => Response | null) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const m = pathname.match(/\/identity\/businesses\/([^/]+)\/my-access$/);
    if (m) {
      const biz = decodeURIComponent(m[1]);
      asked.push(biz);
      if (biz in held) await held[biz];
      const a = answers[biz] ?? { status: 404, body: { message: "Not stubbed" } };
      return jsonResponse(a.status, a.body);
    }
    return extra?.(pathname, method) ?? jsonResponse(404, { message: "Not stubbed" });
  }));
  return asked;
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "token-oq");
  window.localStorage.setItem("kf_business_id", A);
  window.localStorage.setItem("kf_pipeline_view", "focus");
  setCachedUser({ id: "user_oq", email: "oq@example.test" });
  routerStub.push.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await settle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("COR-SQD-5 useOffersQuote never applies another business's answer", () => {
  it("OQ-01 A says read (hidden); asked for B, it is unknown (offered) until B answers, then B's write applies", async () => {
    const slowB = deferred();
    const asked = stubAccess({ [A]: modules({ revenue: "read" }), [B]: modules({ revenue: "write" }) }, { [B]: slowB.promise });
    const { result, rerender } = renderHook(({ biz }: { biz: string }) => useOffersQuote(biz), { initialProps: { biz: A } });
    await waitFor(() => expect(result.current).toBe(false));

    rerender({ biz: B });
    await waitFor(() => expect(asked).toContain(B));
    await settle(50);
    expect(result.current, "A's stale 'read' applied to B").toBe(true);

    await act(async () => { slowB.release(); });
    await settle(50);
    expect(result.current).toBe(true);
  });

  it("OQ-02 B answering read hides it only once B says so", async () => {
    const slowB = deferred();
    stubAccess({ [A]: modules({ revenue: "write" }), [B]: modules({ revenue: "read" }) }, { [B]: slowB.promise });
    const { result, rerender } = renderHook(({ biz }: { biz: string }) => useOffersQuote(biz), { initialProps: { biz: A } });
    await settle(50);
    expect(result.current).toBe(true);

    rerender({ biz: B });
    await settle(50);
    expect(result.current).toBe(true);

    await act(async () => { slowB.release(); });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("SEC-SQD-4 the next-action Send Quote follows the member's revenue level", () => {
  const actions = [
    { id: "sendquote_c1", type: "send_quote", contactId: "c_nag_1", contactName: "Nora Gate", description: "Prospect for 9d with no quote", estimatedTime: 45, priority: "high" },
    { id: "followup_c1", type: "follow_up", contactId: "c_nag_1", contactName: "Nora Gate", description: "No touch in 21d", estimatedTime: 15, priority: "high" },
  ];
  const screenApi = (pathname: string, method: string): Response | null => {
    if (method !== "GET") return null;
    if (pathname.endsWith(`/crm/businesses/${A}/next-actions`)) return jsonResponse(200, actions);
    if (pathname.endsWith(`/crm/businesses/${A}/contacts`)) return jsonResponse(200, { contacts: [], nextCursor: null, hasMore: false });
    if (pathname.endsWith("/contacts/poll")) return jsonResponse(200, { lastUpdatedAt: null, totalCount: 0 });
    if (pathname.endsWith("/contacts/favorites") || pathname.endsWith("/saved-views")) return jsonResponse(200, []);
    return null;
  };

  /** The screen's next actions (what the Action Center, the pipeline queue and the focus view are given). */
  const seen: { types: string[] | null } = { types: null };
  function Screen() {
    const state = useContactsPipeline();
    useEffect(() => {
      seen.types = state.nextActions.map((a) => a.type);
    });
    return null;
  }

  async function nextActionTypes(access: Answer): Promise<{ types: string[]; asked: string[] }> {
    seen.types = null;
    const asked = stubAccess({ [A]: access }, {}, screenApi);
    render(<Screen />);
    await waitFor(() => expect(seen.types?.length ?? 0).toBeGreaterThan(0));
    await settle(300);
    return { types: seen.types ?? [], asked };
  }

  it("NAG-01 RED-BEFORE revenue read: no send_quote among the screen's next actions; the follow-up stays", async () => {
    const { types, asked } = await nextActionTypes(modules({ crm: "write", revenue: "read" }));
    expect(types).toEqual(["follow_up"]);
    expect(asked, "my-access is asked for the screen's own business only").toEqual([A]);
  });

  it("NAG-02 control revenue write: the send_quote action is offered", async () => {
    const { types } = await nextActionTypes(modules({ crm: "write", revenue: "write" }));
    expect(types).toEqual(["send_quote", "follow_up"]);
  });

  it("NAG-03 control my-access fails (unknown): offered", async () => {
    const { types } = await nextActionTypes({ status: 500, body: { message: "boom" } });
    expect(types).toEqual(["send_quote", "follow_up"]);
  });
});
