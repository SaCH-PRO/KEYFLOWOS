/**
 * W7-WEB-OPS-SCOPE (FOLLOW8, Release 0 exit; owner rulings D-40 and D-96): the
 * Command Center queue disables the command-item actions (Done, Approve,
 * Dismiss, and the rest) for a member below operations write, and says why.
 *
 * WHY: R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT (D-40) put every command-item route
 * behind the existing 'operations' module scope: read for a GET, write for every
 * mutation (complete, approve, dismiss, execute, assign, snooze, reopen). STAFF
 * hold operations read by role default; a member whose explicit map has no
 * operations key holds none. The queue still offered every action to every
 * member, and the page ignored each action's answer, so a refused click ended
 * with nothing on screen; a member refused the queue read itself was told "Your
 * queue is clear" (OPS-T02 in
 * apps/server/test/ops-scope-command-procurement.integration.test.ts).
 *
 * The web cannot read a STAFF member's own scope map, so it reads the level the
 * way the other module gates do, from the server's answers: ModuleScopeGuard's
 * 403 names the level the member holds ("operations requires write access (you
 * have read)"). A refused queue read is none; a refused action is the level it
 * names (D-85's pattern: learn from the 403, then withdraw the actions rather
 * than offer what will be refused). The cockpit itself stays open to every
 * member, each tile filtered by the member's own permissions (D-96): only the
 * queue's actions change.
 *
 * WOS-C01..C03 mount the real page with the real client (lib/api/command.ts,
 * lib/api.ts); only `fetch`, the router and the toaster are stubbed, and every
 * read the cockpit's side panels make answers 503 (not under test). WOS-C04
 * mounts the queue component on items already on screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup, fireEvent } from "@testing-library/react";
import { GenomeProvider } from "@/contexts/genome-context";
import { CommandQueueV2 } from "@/components/command/command-queue-v2";
import type { CommandItem, DueObligation } from "@/lib/api/command";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
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

const BIZ = "biz_w7wos_cc";
const NOW = "2026-11-10T10:00:00.000Z";
/** The full cockpit mounts a dozen panels; the first mount in a file also compiles the page. */
const PAGE_CASE_MS = 30_000;

function commandItem(id: string, title: string, requiresApproval: boolean): CommandItem {
  return {
    id, businessId: BIZ, sourceModule: "finance", sourceType: null, sourceId: null,
    title, description: null, category: "MONEY", actionType: "REVIEW", status: "OPEN",
    priority: 50, urgency: 50, impactScore: 50, expectedValue: null, currency: null,
    riskTier: 1, requiresApproval, executableByKey: false, executionTool: null, executionPayload: null,
    recommendedBy: null, ownerType: null, ownerId: null, dueAt: null, snoozedUntil: null,
    completedAt: null, dismissedAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

const CHASE = commandItem("ci_w7wos_1", "Chase the overdue invoice", true);
const RESTOCK = commandItem("ci_w7wos_2", "Reorder low stock", false);
const ITEMS = [CHASE, RESTOCK];

/** The V1-47 snapshot shape (business-command-center.types.ts), minimal and healthy (D-96: open to every member). */
function cockpitSnapshot() {
  const ok = (label: string) => ({ label, status: "OK", fetchedAt: NOW });
  return {
    businessId: BIZ,
    generatedAt: NOW,
    health: {
      genomeIntegrity: 0, executiveReadinessScore: 0, genomeStage: "SEED", criticalCount: 0, highPriorityCount: 0,
      pendingApprovalCount: 0, approvedAwaitingExecutionCount: 0, urgentTemporalCount: 0, pendingGenomeProposalCount: 0,
      assetRiskCount: 0, constitutionStale: false, keyGenomeOverall: 0, keyGenomeReadiness: 0, keyGenomeConfidence: 0,
      blockedModuleCount: 0, lowReadinessModuleCount: 0, missingBlockingFactCount: 0,
    },
    summary: "Cockpit summary.",
    pulse: { overallScore: 0, dimensions: [] },
    briefing: { headline: "No urgent actions today.", bullets: [], warnings: [] },
    governance: { autoReady: 0, needsApproval: 0, dueToday: 0, urgentRisks: 0 },
    topPriorities: [], pendingApprovals: [], approvedAwaitingExecution: [], urgentItems: [], risks: [], opportunities: [],
    genome: { integrity: 0, readiness: 0, stage: "SEED", pendingProposals: [], weakestSections: [] },
    keyGenome: { overall: 0, integrity: 0, readiness: 0, confidence: 0, computedAt: NOW, sections: [], weakestSections: [] },
    moduleReadiness: [],
    constitution: { latestVersion: null, stale: false, reason: null, href: "/app/profile?tab=business-genome&section=constitution" },
    executiveModes: [],
    recommendedActions: [],
    degraded: false,
    sources: { pendingApprovals: ok("pendingApprovals"), contacts: ok("contacts"), openInvoices: ok("openInvoices"), payments: ok("payments") },
    results: {
      contacts: { label: "Contacts", count: 1, status: "OK", href: "/app/crm/contacts" },
      openInvoices: { label: "Open invoices", count: 0, status: "OK", href: "/app/commerce/invoices" },
      payments: { label: "Payments", count: 2, status: "OK", href: "/app/payments" },
    },
  };
}

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

const ITEM_ACTION = new RegExp(`/command/businesses/${BIZ}/items/([^/]+)/(complete|approve|dismiss|execute|assign|snooze|reopen)$`);

/** POST items/:id/discharge: an obligation recorded as met (operations write, like every item action). */
const DISCHARGE = new RegExp(`/command/businesses/${BIZ}/items/([^/]+)/discharge$`);

/**
 * Serve the cockpit snapshot, the queue read (GET command items) and the item actions. `action`
 * answers every item action; `due` answers the due-obligations read (GET items/due) and
 * `discharge` its Done (both 503 when not given); every other request (the side panels) answers 503.
 */
function serve({ items, action, due, discharge }: {
  items: (path: string) => Answer;
  action: (path: string) => Answer;
  due?: () => Answer;
  discharge?: (path: string) => Answer;
}) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push({ method, path: pathname });
    if (method === "GET" && pathname.endsWith(`/business-command-center/businesses/${BIZ}/snapshot`)) {
      return jsonResponse(200, cockpitSnapshot());
    }
    if (method === "GET" && pathname.endsWith(`/command/businesses/${BIZ}/items`)) {
      const answer = items(pathname);
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "POST" && ITEM_ACTION.test(pathname)) {
      const answer = action(pathname);
      return jsonResponse(answer.status, answer.body);
    }
    if (due && method === "GET" && pathname.endsWith(`/command/businesses/${BIZ}/items/due`)) {
      const answer = due();
      return jsonResponse(answer.status, answer.body);
    }
    if (discharge && method === "POST" && DISCHARGE.test(pathname)) {
      const answer = discharge(pathname);
      return jsonResponse(answer.status, answer.body);
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return {
    sent,
    queueReads: () => sent.filter((r) => r.method === "GET" && r.path.endsWith(`/command/businesses/${BIZ}/items`)),
    actions: () => sent.filter((r) => r.method === "POST" && ITEM_ACTION.test(r.path)),
    discharges: () => sent.filter((r) => r.method === "POST" && DISCHARGE.test(r.path)),
  };
}

const listed = (items: CommandItem[]): Answer => ({ status: 200, body: { items, total: items.length } });

async function renderCommandCenter() {
  const { default: Page } = await import("@/app/app/command-center/page");
  render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
  return screen.findByText(/^Command Queue \(/, {}, { timeout: 10_000 });
}

/** The card that shows `title`: the nearest ancestor that also holds the item's Dismiss button. */
function card(title: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(title);
  while (node && !within(node).queryByRole("button", { name: "Dismiss" })) node = node.parentElement;
  if (!node) throw new Error(`no card for ${title}`);
  return node;
}

/** Done, Approve (only an item that requires approval) and Dismiss on one card. */
function actionButtons(title: string): HTMLButtonElement[] {
  const root = card(title);
  return [
    within(root).getByRole("button", { name: "Done" }),
    ...within(root).queryAllByRole("button", { name: "Approve" }),
    within(root).getByRole("button", { name: "Dismiss" }),
  ] as HTMLButtonElement[];
}

/** Every action button a card offers (Done, Approve, Execute, Assign, Snooze, Dismiss, Reopen). */
function allCardButtons(title: string): HTMLButtonElement[] {
  const root = card(title);
  return within(root)
    .getAllByRole("button")
    .filter((b) => b.textContent !== CHASE.title && b.textContent !== RESTOCK.title && !/Details/.test(b.textContent ?? "")) as HTMLButtonElement[];
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("W7-WEB-OPS-SCOPE (D-40, D-96): the command queue's actions follow the member's operations level", () => {
  it("[WOS-C01] RED-BEFORE: a member without operations (queue read 403, you have none) is told the queue needs operations access, is offered no command action, and is never told the queue is clear; the cockpit still renders (D-96)", async () => {
    const api = serve({
      items: (path) => forbidden(path, "read", "none"),
      action: () => ({ status: 500, body: { message: "unexpected" } }),
    });
    await renderCommandCenter();
    await waitFor(() => expect(api.queueReads().length).toBeGreaterThan(0));

    const reason = await screen.findByTestId("command-actions-withheld", {}, { timeout: 10_000 });
    expect(reason.textContent).toMatch(/operations access/i);
    expect(screen.queryByText("Your queue is clear. Great work!")).toBeNull();
    for (const name of ["Done", "Approve", "Dismiss"]) {
      expect(screen.queryAllByRole("button", { name }).filter((b) => !(b as HTMLButtonElement).disabled)).toHaveLength(0);
    }
    expect(api.actions()).toHaveLength(0);
    // D-96: the cockpit itself is every member's, its briefing still shown.
    expect(screen.getByText("No urgent actions today.")).toBeTruthy();
  }, PAGE_CASE_MS);

  it("[WOS-C02] RED-BEFORE: a member with operations read: once the server refuses an action (403, you have read), every item's Done, Approve and Dismiss are disabled with the reason, and a further click sends nothing", async () => {
    const api = serve({
      items: () => listed(ITEMS),
      action: (path) => forbidden(path, "write", "read"),
    });
    await renderCommandCenter();
    await screen.findByText(CHASE.title, {}, { timeout: 10_000 });
    // A read member's queue read succeeds; the read answer cannot tell read from write, so the actions are offered until the server says otherwise.
    for (const button of actionButtons(CHASE.title)) expect(button.disabled).toBe(false);

    fireEvent.click(within(card(CHASE.title)).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(api.actions()).toHaveLength(1));

    const reason = await screen.findByTestId("command-actions-withheld");
    expect(reason.textContent).toMatch(/write access/i);
    await waitFor(() => {
      for (const title of [CHASE.title, RESTOCK.title]) {
        for (const button of allCardButtons(title)) expect(button.disabled, `${title}: ${button.getAttribute("aria-label") ?? button.textContent}`).toBe(true);
      }
    });
    // The disabled buttons carry the short reason.
    expect(within(card(CHASE.title)).getByRole("button", { name: "Approve" }).getAttribute("title")).toBe(reason.textContent);

    fireEvent.click(within(card(RESTOCK.title)).getByRole("button", { name: "Dismiss" }));
    fireEvent.click(within(card(CHASE.title)).getByRole("button", { name: "Approve" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.actions()).toHaveLength(1);
  }, PAGE_CASE_MS);

  it("[WOS-C03] a member with operations write: Done, Approve and Dismiss are enabled, Done is sent once, and they stay enabled with no reason shown", async () => {
    let remaining = ITEMS;
    const api = serve({
      items: () => listed(remaining),
      action: () => {
        remaining = [RESTOCK];
        return { status: 201, body: { ...CHASE, status: "COMPLETED", completedAt: NOW } };
      },
    });
    await renderCommandCenter();
    await screen.findByText(CHASE.title, {}, { timeout: 10_000 });
    for (const title of [CHASE.title, RESTOCK.title]) {
      for (const button of actionButtons(title)) expect(button.disabled).toBe(false);
    }

    fireEvent.click(within(card(CHASE.title)).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(api.actions()).toEqual([{ method: "POST", path: `/command/businesses/${BIZ}/items/${CHASE.id}/complete` }]));
    await waitFor(() => expect(screen.queryByText(CHASE.title)).toBeNull());

    for (const button of actionButtons(RESTOCK.title)) expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("command-actions-withheld")).toBeNull();
  }, PAGE_CASE_MS);

  it("[WOS-C04] RED-BEFORE: items already on screen for a member without operations show Done, Approve and Dismiss disabled with the reason; for a member with write they are enabled", () => {
    const handler = vi.fn(async () => {});
    const { rerender } = render(
      <CommandQueueV2 items={ITEMS} total={2} operationsLevel="none" onComplete={handler} onApprove={handler} onDismiss={handler} />,
    );
    const reason = screen.getByTestId("command-actions-withheld");
    expect(reason.textContent).toMatch(/operations access/i);
    for (const title of [CHASE.title, RESTOCK.title]) {
      for (const button of actionButtons(title)) {
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("title")).toBe(reason.textContent);
      }
    }
    fireEvent.click(within(card(CHASE.title)).getByRole("button", { name: "Done" }));
    expect(handler).not.toHaveBeenCalled();

    rerender(<CommandQueueV2 items={ITEMS} total={2} operationsLevel="write" onComplete={handler} onApprove={handler} onDismiss={handler} />);
    expect(screen.queryByTestId("command-actions-withheld")).toBeNull();
    for (const title of [CHASE.title, RESTOCK.title]) {
      for (const button of actionButtons(title)) expect(button.disabled).toBe(false);
    }
  });
});

/** An obligation due this week (the "Due this week" panel above the queue reads it from GET items/due). */
const RETURN_DUE: DueObligation = {
  ...commandItem("ci_w7wos_ob1", "File the quarterly return", false),
  kind: "OBLIGATION",
  owedToType: null,
  owedToId: null,
  owedToLabel: "Tax office",
  seriesId: null,
  dischargedAt: null,
  dischargeRef: null,
  overdue: false,
  daysUntilDue: 2,
};

const dueThisWeek = (items: DueObligation[]): Answer => ({
  status: 200,
  body: { window: { from: NOW, to: NOW, days: 7 }, total: items.length, overdueCount: 0, items },
});

/** The obligation's Done: the button in the row that shows `title`. */
function obligationDone(title: string): HTMLButtonElement {
  let node: HTMLElement | null = screen.getByText(title);
  while (node && !within(node).queryByRole("button", { name: "Done" })) node = node.parentElement;
  if (!node) throw new Error(`no obligation row for ${title}`);
  return within(node).getByRole("button", { name: "Done" }) as HTMLButtonElement;
}

describe("W7-WEB-OPS-SCOPE review repairs (D-40, D-96): an obligation's Done (POST items/:id/discharge, operations write) follows the same level as the queue's actions", () => {
  it("[WOS-C05] SEC-WOS-2: once the queue has learned the member holds operations read, the due obligation's Done is disabled with the reason and a click sends no discharge", async () => {
    const api = serve({
      items: () => listed(ITEMS),
      action: (path) => forbidden(path, "write", "read"),
      due: () => dueThisWeek([RETURN_DUE]),
      discharge: (path) => forbidden(path, "write", "read"),
    });
    await renderCommandCenter();
    await screen.findByText(RETURN_DUE.title, {}, { timeout: 10_000 });
    await screen.findByText(CHASE.title, {}, { timeout: 10_000 });
    expect(obligationDone(RETURN_DUE.title).disabled).toBe(false);

    fireEvent.click(within(card(CHASE.title)).getByRole("button", { name: "Done" }));
    const reason = await screen.findByTestId("command-actions-withheld");
    expect(reason.textContent).toMatch(/write access/i);

    await waitFor(() => expect(obligationDone(RETURN_DUE.title).disabled).toBe(true));
    expect(obligationDone(RETURN_DUE.title).getAttribute("title")).toBe(reason.textContent);
    fireEvent.click(obligationDone(RETURN_DUE.title));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.discharges()).toHaveLength(0);
  }, PAGE_CASE_MS);

  it("[WOS-C06] SEC-WOS-2: a refused discharge (403, you have read) is read like a refused queue action: the reason is shown, the obligation's Done and every queue action are disabled, and a further click sends nothing", async () => {
    const api = serve({
      items: () => listed(ITEMS),
      action: (path) => forbidden(path, "write", "read"),
      due: () => dueThisWeek([RETURN_DUE]),
      discharge: (path) => forbidden(path, "write", "read"),
    });
    await renderCommandCenter();
    await screen.findByText(RETURN_DUE.title, {}, { timeout: 10_000 });
    await screen.findByText(CHASE.title, {}, { timeout: 10_000 });

    fireEvent.click(obligationDone(RETURN_DUE.title));
    await waitFor(() => expect(api.discharges()).toHaveLength(1));

    const reason = await screen.findByTestId("command-actions-withheld");
    expect(reason.textContent).toMatch(/write access/i);
    await waitFor(() => expect(obligationDone(RETURN_DUE.title).disabled).toBe(true));
    for (const button of actionButtons(CHASE.title)) expect(button.disabled).toBe(true);

    fireEvent.click(obligationDone(RETURN_DUE.title));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.discharges()).toHaveLength(1);
    expect(api.actions()).toHaveLength(0);
  }, PAGE_CASE_MS);

  it("[WOS-C07] a member with operations write: the obligation's Done is enabled, the discharge is sent once, and no reason is shown", async () => {
    let due = [RETURN_DUE];
    const api = serve({
      items: () => listed(ITEMS),
      action: () => ({ status: 500, body: { message: "unexpected" } }),
      due: () => dueThisWeek(due),
      discharge: () => {
        due = [];
        return { status: 201, body: { ...RETURN_DUE, status: "COMPLETED", dischargedAt: NOW } };
      },
    });
    await renderCommandCenter();
    await screen.findByText(RETURN_DUE.title, {}, { timeout: 10_000 });
    expect(obligationDone(RETURN_DUE.title).disabled).toBe(false);

    fireEvent.click(obligationDone(RETURN_DUE.title));
    await waitFor(() => expect(api.discharges()).toEqual([{ method: "POST", path: `/command/businesses/${BIZ}/items/${RETURN_DUE.id}/discharge` }]));
    await waitFor(() => expect(screen.queryByText(RETURN_DUE.title)).toBeNull());
    expect(screen.queryByTestId("command-actions-withheld")).toBeNull();
    for (const button of actionButtons(CHASE.title)) expect(button.disabled).toBe(false);
  }, PAGE_CASE_MS);
});
