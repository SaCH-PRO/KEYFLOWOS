/**
 * FU-CONTACT-SEND-QUOTE-DOOR repair round 1 (orchestrator, from the two reviews at 4d99b534), the Customers screen half:
 *
 *   SEC-SQD-1  a contact's Quick actions offer Send Quote only to a member who may write quotes (revenue write or
 *              admin), as the WhatsApp sheet's New quote does (new-from-whatsapp.tsx, writes(levels.revenue)). An
 *              unknown level (no answer yet, a failed my-access read, an answer that does not name revenue) hides
 *              nothing: the server still refuses.
 *     SQG-01 RED-BEFORE  revenue read: the card's menu has no Send Quote (its other actions stay)
 *     SQG-02 RED-BEFORE  revenue none: no Send Quote
 *     SQG-03 control     revenue write, and admin: Send Quote is offered
 *     SQG-04 control     my-access fails (unknown): Send Quote is offered
 *     SQG-05 control     an answer that does not name revenue: Send Quote is offered
 *   COR-SQD-1  the next-action doors (use-contacts-pipeline.ts handleDoAction) encode the customer's id:
 *     NAE-01 RED-BEFORE  Send Quote pushes /app/commerce?tab=quotes&contactId=<encoded id>
 *     NAE-02 RED-BEFORE  Payment pushes /app/commerce?tab=invoices&contactId=<encoded id>
 *
 * The screen is the real one (useContactsPipeline feeding PipelineTabContent, the real lib/client.ts and lib/api), as
 * in quick-add-contact.test.tsx; only fetch, the router, sonner and Dexie are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PipelineTabContent } from "../pipeline-tab-content";
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

const BUSINESS = "biz_sqg";
const CONTACT = {
  id: "c_sqg_1", businessId: BUSINESS, firstName: "Gina", lastName: "Gate", email: null, phone: null,
  status: "LEAD", tags: [], createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
};

/** my-access's answer: a status and body, or the modules map of a 200. */
type Access = { status: number; body: unknown };
const modules = (m: Record<string, string>): Access => ({ status: 200, body: { modules: m } });

function stubApi(access: Access) {
  const asked = { myAccess: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/identity/businesses/${BUSINESS}/my-access`)) {
      asked.myAccess += 1;
      return jsonResponse(access.status, access.body);
    }
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts`) && method === "GET") {
      return jsonResponse(200, { contacts: [CONTACT], nextCursor: null, hasMore: false });
    }
    if (pathname.endsWith("/contacts/poll")) return jsonResponse(200, { lastUpdatedAt: null, totalCount: 1 });
    if (pathname.endsWith("/contacts/favorites")) return jsonResponse(200, []);
    if (pathname.endsWith("/saved-views")) return jsonResponse(200, []);
    return jsonResponse(404, { message: "Not stubbed" });
  }));
  return asked;
}

/** The screen's state, read by the next-action cases (handleDoAction is what the Action Center's buttons call). */
const screenRef: { current: ReturnType<typeof useContactsPipeline> | null } = { current: null };
function ContactsScreenHarness() {
  const state = useContactsPipeline();
  useEffect(() => {
    screenRef.current = state;
  });
  return <PipelineTabContent state={state} />;
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** The customer's card, its Quick actions menu opened. */
async function openQuickActions(): Promise<HTMLElement> {
  const trigger = await screen.findByTitle("Quick actions", {}, { timeout: 3000 });
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

/** Gives the member's access read time to be answered and the screen time to settle on it. */
async function accessAnswered() {
  await settle(300);
}

/** The menu loses Send Quote (the access answer can land after the menu opened), and the access was asked. */
async function noSendQuote(menu: HTMLElement, asked: { myAccess: number }) {
  await waitFor(() => expect(within(menu).queryByRole("menuitem", { name: /send quote/i })).toBeNull());
  expect(asked.myAccess).toBeGreaterThan(0);
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "token-sqg");
  window.localStorage.setItem("kf_business_id", BUSINESS);
  window.localStorage.setItem("kf_pipeline_view", "list");
  setCachedUser({ id: "user_sqg", email: "sqg@example.test" });
  routerStub.push.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  screenRef.current = null;
});

afterEach(async () => {
  cleanup();
  await settle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SEC-SQD-1 Send Quote is offered only to a member who may write quotes", () => {
  it("SQG-01 RED-BEFORE revenue read: no Send Quote; the card's other actions stay", async () => {
    const asked = stubApi(modules({ crm: "write", revenue: "read", bookings: "write" }));
    render(<ContactsScreenHarness />);
    await accessAnswered();
    const menu = await openQuickActions();
    await noSendQuote(menu, asked);
    expect(within(menu).getByRole("menuitem", { name: /book appointment/i })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /refer/i })).toBeTruthy();
  });

  it("SQG-02 RED-BEFORE revenue none: no Send Quote", async () => {
    const asked = stubApi(modules({ crm: "write", revenue: "none" }));
    render(<ContactsScreenHarness />);
    await accessAnswered();
    const menu = await openQuickActions();
    await noSendQuote(menu, asked);
  });

  it.each([["write"], ["admin"]])("SQG-03 control revenue %s: Send Quote is offered", async (level) => {
    stubApi(modules({ crm: "write", revenue: level }));
    render(<ContactsScreenHarness />);
    await accessAnswered();
    const menu = await openQuickActions();
    expect(within(menu).getByRole("menuitem", { name: /send quote/i })).toBeTruthy();
  });

  it("SQG-04 control my-access fails (unknown): Send Quote is offered", async () => {
    stubApi({ status: 500, body: { message: "boom" } });
    render(<ContactsScreenHarness />);
    await accessAnswered();
    const menu = await openQuickActions();
    expect(within(menu).getByRole("menuitem", { name: /send quote/i })).toBeTruthy();
  });

  it("SQG-05 control an answer that does not name revenue: Send Quote is offered", async () => {
    stubApi(modules({ crm: "write" }));
    render(<ContactsScreenHarness />);
    await accessAnswered();
    const menu = await openQuickActions();
    expect(within(menu).getByRole("menuitem", { name: /send quote/i })).toBeTruthy();
  });
});

describe("COR-SQD-1 the next-action doors encode the customer's id", () => {
  const ID = "c_nae&tab=snapshot#x";
  const action = (type: "send_quote" | "payment_reminder") => ({
    id: `a_${type}`, type, contactId: ID, contactName: "Nia Encode", description: "d", estimatedTime: 10, priority: "high" as const,
  });

  async function screenUp() {
    stubApi(modules({ crm: "write", revenue: "write" }));
    render(<ContactsScreenHarness />);
    await waitFor(() => expect(screenRef.current).not.toBeNull());
  }

  it("NAE-01 RED-BEFORE Send Quote pushes the Quotes door with the id encoded", async () => {
    await screenUp();
    act(() => screenRef.current!.handleDoAction(action("send_quote")));
    expect(routerStub.push).toHaveBeenCalledWith(`/app/commerce?tab=quotes&contactId=${encodeURIComponent(ID)}`);
    const pushed = new URL(routerStub.push.mock.calls[0][0] as string, "http://localhost");
    expect(pushed.searchParams.get("contactId")).toBe(ID);
    expect(pushed.searchParams.get("tab")).toBe("quotes");
  });

  it("NAE-02 RED-BEFORE Payment pushes the invoices door with the id encoded", async () => {
    await screenUp();
    act(() => screenRef.current!.handleDoAction(action("payment_reminder")));
    expect(routerStub.push).toHaveBeenCalledWith(`/app/commerce?tab=invoices&contactId=${encodeURIComponent(ID)}`);
  });
});
