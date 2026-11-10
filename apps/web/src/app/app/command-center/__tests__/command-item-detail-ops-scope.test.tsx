/**
 * W7-WEB-OPS-SCOPE review repair SEC-WOS-3 (FOLLOW8, Release 0 exit; owner rulings D-40 and D-96):
 * the command item's detail page (/app/command-center/:id, reached from every queue card's
 * Details link) follows the member's operations level like the queue does.
 *
 * WHY: every command-item action (complete, dismiss, snooze, approve, execute, assign, reopen)
 * needs operations write (R0-13g, D-40). The detail page offered them to a read-only member, and
 * its handler toasted "<Action> successful" when the server answered 403: apiPost returns
 * {error, status} rather than throwing, so the refusal was shown as a success. A member without
 * operations was told the item was "not found".
 *
 * The level is read from the server's answers, as the queue reads it (lib/module-access.ts):
 * ModuleScopeGuard's 403 names the level the member holds ("operations requires write access
 * (you have read)"). A refused action is shown as refused, and every action is then disabled with
 * the reason; a refused item read says the item needs operations access.
 *
 * Mounted on the real page with the real client (lib/api/command.ts, lib/api.ts); only `fetch`,
 * the router and the toaster are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { GenomeProvider } from "@/contexts/genome-context";
import type { CommandItem } from "@/lib/api/command";

const BIZ = "biz_w7wos_detail";
const ITEM_ID = "ci_w7wos_detail_1";
const NOW = "2026-11-10T10:00:00.000Z";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/command-center/ci_w7wos_detail_1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "ci_w7wos_detail_1" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

/** An open item that requires approval and KEY can execute: every action the page has is on offer. */
const ITEM: CommandItem = {
  id: ITEM_ID, businessId: BIZ, sourceModule: "finance", sourceType: null, sourceId: null,
  title: "Chase the overdue invoice", description: null, category: "MONEY", actionType: "REVIEW", status: "OPEN",
  priority: 50, urgency: 50, impactScore: 50, expectedValue: null, currency: null,
  riskTier: 1, requiresApproval: true, executableByKey: true, executionTool: null, executionPayload: null,
  recommendedBy: null, ownerType: null, ownerId: null, dueAt: null, snoozedUntil: null,
  completedAt: null, dismissedAt: null, createdAt: NOW, updatedAt: NOW,
};

const ACTIONS = ["Complete", "Dismiss", "Snooze 24h", "Approve", "Execute", "Assign"];

type Answer = { status: number; body: unknown };
interface Sent { method: string; path: string }

/** ModuleScopeGuard's refusal, as GlobalHttpExceptionFilter answers it. */
function forbidden(path: string, required: "read" | "write", have: string): Answer {
  return {
    status: 403,
    body: {
      statusCode: 403,
      message: `Insufficient permissions: operations requires ${required} access (you have ${have})`,
      error: "Forbidden",
      timestamp: NOW,
      path,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  const statusText = status === 200 || status === 201 ? "OK" : status === 403 ? "Forbidden" : "Service Unavailable";
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

const ITEM_ACTION = new RegExp(`/command/businesses/${BIZ}/items/${ITEM_ID}/(complete|approve|dismiss|execute|assign|snooze|reopen)$`);

/** Serve the item read (GET items/:id) and its actions; every other request answers 503. */
function serve({ read, action }: { read: (path: string) => Answer; action: (path: string) => Answer }) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push({ method, path: pathname });
    if (method === "GET" && pathname.endsWith(`/command/businesses/${BIZ}/items/${ITEM_ID}`)) {
      const answer = read(pathname);
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "POST" && ITEM_ACTION.test(pathname)) {
      const answer = action(pathname);
      return jsonResponse(answer.status, answer.body);
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return { actions: () => sent.filter((r) => r.method === "POST" && ITEM_ACTION.test(r.path)) };
}

async function renderDetail() {
  const { default: Page } = await import("@/app/app/command-center/[id]/page");
  render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("W7-WEB-OPS-SCOPE review repairs (D-40, D-96): the command item's detail page follows the member's operations level", () => {
  it("[WOS-D01] SEC-WOS-3: a member with operations read: a refused Complete (403, you have read) is shown as refused, never as successful; every action is then disabled with the reason and a further click sends nothing", async () => {
    const api = serve({
      read: () => ({ status: 200, body: ITEM }),
      action: (path) => forbidden(path, "write", "read"),
    });
    await renderDetail();
    await screen.findByRole("heading", { name: ITEM.title }, { timeout: 10_000 });
    for (const name of ACTIONS) expect(button(name).disabled, name).toBe(false);

    fireEvent.click(button("Complete"));
    await waitFor(() => expect(api.actions()).toHaveLength(1));

    const reason = await screen.findByTestId("command-actions-withheld");
    expect(reason.textContent).toMatch(/write access/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/you have read/));
    for (const name of ACTIONS) {
      expect(button(name).disabled, name).toBe(true);
      expect(button(name).getAttribute("title"), name).toBe(reason.textContent);
    }

    fireEvent.click(button("Dismiss"));
    fireEvent.click(button("Approve"));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.actions()).toHaveLength(1);
  }, 30_000);

  it("[WOS-D02] SEC-WOS-3: a member without operations (item read 403, you have none) is told the item needs operations access, not that it was not found, and is offered no action", async () => {
    const api = serve({
      read: (path) => forbidden(path, "read", "none"),
      action: () => ({ status: 500, body: { message: "unexpected" } }),
    });
    await renderDetail();

    const reason = await screen.findByTestId("command-actions-withheld", {}, { timeout: 10_000 });
    expect(reason.textContent).toMatch(/operations access/i);
    expect(screen.queryByText("Command item not found")).toBeNull();
    for (const name of [...ACTIONS, "Reopen"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(api.actions()).toHaveLength(0);
  }, 30_000);

  it("[WOS-D03] a member with operations write: Complete is sent once and reported successful, and the actions stay enabled with no reason shown", async () => {
    let current: CommandItem = ITEM;
    const api = serve({
      read: () => ({ status: 200, body: current }),
      action: () => {
        current = { ...ITEM, status: "COMPLETED", completedAt: NOW };
        return { status: 201, body: current };
      },
    });
    await renderDetail();
    await screen.findByRole("heading", { name: ITEM.title }, { timeout: 10_000 });

    fireEvent.click(button("Complete"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Complete successful"));
    expect(api.actions()).toEqual([{ method: "POST", path: `/command/businesses/${BIZ}/items/${ITEM_ID}/complete` }]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("command-actions-withheld")).toBeNull();
    // Completed: Reopen is the action on offer, and it is enabled.
    await waitFor(() => expect(button("Reopen").disabled).toBe(false));
  }, 30_000);
});
