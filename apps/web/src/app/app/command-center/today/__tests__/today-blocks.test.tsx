/**
 * TODAY-4BLOCK (v1 step 5; BUG-069, BUG-010, FCP-COR-1; rulings D-150 hubs, D-151 labels, D-157 demo; journeys A,
 * C4, D and I): /app/command-center (label 'Today') is four blocks read from ONE server read,
 * GET /business-command-center/businesses/:b/today (TODAY-AGGREGATE, today.service.ts):
 *
 *   Needs you   claims (Confirm / Not yet), accepted quotes (Convert), staff approval requests (Approve / Reject),
 *               KEY proposals (Approve / Reject, or Run), each action inline
 *   Today       today's bookings, invoices due, accepted quotes, tasks, orders and ready-to-send reminders, each one
 *               tap from its action; a customer named on a row links /app/crm/contacts/<id> (journey C4)
 *   Pulse       the five Money > Overview figures; no block for a member without revenue read
 *   Get set up  each step a link to its real page (TODAY-AGGREGATE's hrefs), the sample as a preview (D-157), and
 *               the install step
 *
 * Removed: the mission-control hero ("Hull Integrity"), the health strip, the genome cards and readiness grid. Day one
 * shows no percentage, no risk count and no "you owe 0". Under KEY_DISABLED (keyDisabled on GET /identity/me) no KEY
 * UI renders here.
 *
 * The real page, the real clients (lib/api/*.ts, lib/api.ts) and the real panels are mounted; only `fetch`, the
 * router and the toaster are stubbed. Every read the test does not name answers 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup, fireEvent } from "@testing-library/react";
import { GenomeProvider } from "@/contexts/genome-context";
import { resetKeySwitchForTests } from "@/hooks/use-key-enabled";
import { selectBusiness } from "@/lib/workspace";

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

const BIZ = "biz_t4b_today";
const NOW = "2026-11-26T14:00:00.000Z";
const CASE_MS = 30_000;

const STEPS = [
  { key: "catalog", label: "Add a product or service", done: false, href: "/app/settings/catalog" },
  { key: "hours", label: "Set your business hours", done: true, href: "/app/profile" },
  { key: "payments", label: "Set up a payment method", done: false, href: "/app/settings/business?tab=payments" },
  { key: "share_link", label: "Share your booking or store link", done: false, href: "/app/store" },
];

/** A business on day one, as TODAY-AGGREGATE answers it: nothing yet, all figures 0. */
function freshToday() {
  return {
    businessId: BIZ,
    generatedAt: NOW,
    timezone: "America/Port_of_Spain",
    needsYou: { items: [] as unknown[], totalCount: 0, hasMore: false },
    today: {
      bookings: [] as unknown[], invoices: [] as unknown[], acceptedQuotes: [] as unknown[], tasks: [] as unknown[],
      orders: [] as unknown[], reminders: [] as unknown[],
      counts: { bookings: 0, invoices: 0, acceptedQuotes: 0, tasks: 0, orders: 0, reminders: 0, total: 0 },
    },
    pulseStatus: "OK" as "OK" | "RESTRICTED",
    pulse: {
      cash: 0, cashBasis: "ledger", cashCurrency: "TTD", otherCurrencyCash: [], owedToYou: 0, owedCount: 0,
      overdueAmount: 0, overdueCount: 0, youOwe: 0, youOweCount: 0, monthRevenue: 0, monthExpenses: 0,
      monthProfit: 0, safeToSpend: 0, currency: "TTD",
    } as Record<string, unknown> | null,
    getSetUp: { complete: false, steps: STEPS.map((s) => ({ ...s })) },
  };
}

const CONTACT = "ct_t4b_gina";

/** A command item KEY could run (CommandItem, lib/api/command.ts), as COLLECT_RECEIVABLE seeds one for an overdue invoice. */
const KEY_ITEM = {
  id: "ci_t4b_key", businessId: BIZ, sourceModule: "finance", sourceType: "invoice", sourceId: "inv_9",
  title: "Collect the overdue INV-0009", description: null, category: "MONEY", actionType: "COLLECT_RECEIVABLE",
  status: "OPEN", priority: 70, urgency: 70, impactScore: 50, expectedValue: null, currency: null, riskTier: 1,
  requiresApproval: false, executableByKey: true, executionTool: "send_reminder", executionPayload: null,
  recommendedBy: null, ownerType: null, ownerId: null, dueAt: null, snoozedUntil: null, completedAt: null,
  dismissedAt: null, createdAt: NOW, updatedAt: NOW,
};

/** A busy day: one of each Needs you kind and one of each Today row. */
function busyToday() {
  const t = freshToday();
  t.needsYou.items = [
    {
      id: "claim:cl_1", kind: "CLAIM", sourceId: "cl_1", title: "Gina Links reported payment for INV-0042",
      summary: "TTD 380.00 via bank transfer", contactId: CONTACT, customerName: "Gina Links", amount: 380, currency: "TTD",
      createdAt: NOW, href: "/app/commerce/invoices/inv_42",
      actions: [
        { label: "Confirm", actionType: "CONFIRM", method: "POST", endpoint: `/commerce/businesses/${BIZ}/claims/cl_1/confirm` },
        { label: "Not yet", actionType: "DISMISS", method: "POST", endpoint: `/commerce/businesses/${BIZ}/claims/cl_1/dismiss` },
      ],
    },
    {
      id: "quote:q_7", kind: "ACCEPTED_QUOTE", sourceId: "q_7", title: "Gina Links accepted Quote QUO-0007: Convert to invoice",
      summary: "TTD 900.00", contactId: CONTACT, customerName: "Gina Links", amount: 900, currency: "TTD", createdAt: NOW,
      href: `/app/commerce?tab=quotes&quoteId=q_7`,
      actions: [{ label: "Convert to invoice", actionType: "CONVERT", method: "POST", endpoint: `/commerce/businesses/${BIZ}/quotes/q_7/convert`, href: `/app/commerce?tab=quotes&quoteId=q_7` }],
    },
    {
      id: "approval:ap_1", kind: "APPROVAL_REQUEST", sourceId: "ap_1", title: "New blender for the salon",
      summary: "TTD 1,200 at Courts", contactId: null, customerName: null, createdAt: NOW, href: "/app/governance-flow",
      actions: [{ label: "Review", actionType: "OPEN", href: "/app/governance-flow" }],
    },
    {
      id: "proposal:pp_1", kind: "KEY_PROPOSAL", sourceId: "pp_1", title: "Chase the overdue wholesale invoice",
      summary: "KEY action awaiting approval", contactId: null, customerName: null, createdAt: NOW, href: "/app/key-autonomy",
      actions: [
        { label: "Approve", actionType: "APPROVE", method: "POST", endpoint: `/key-autonomy/businesses/${BIZ}/actions/proposals/pp_1/approve` },
        { label: "Reject", actionType: "REJECT", method: "POST", endpoint: `/key-autonomy/businesses/${BIZ}/actions/proposals/pp_1/reject` },
      ],
    },
  ];
  t.needsYou.totalCount = 4;
  t.today.bookings = [{ id: "bk_1", startTime: "2026-11-27T03:00:00.000Z", endTime: "2026-11-27T03:30:00.000Z", status: "CONFIRMED", serviceName: "Braiding 30", customerName: "Gina Links", contactId: CONTACT }];
  t.today.invoices = [{ id: "inv_42", invoiceNumber: "INV-0042", status: "SENT", dueDate: "2026-11-26T00:00:00.000Z", remaining: 380, total: 380, currency: "TTD", customerName: "Gina Links", contactId: CONTACT, isOverdue: true }];
  t.today.tasks = [{ id: "tk_1", title: "Call about colour", dueDate: "2026-11-27T00:00:00.000Z", priority: "MEDIUM", contactId: CONTACT, customerName: "Gina Links" }];
  t.today.orders = [{ id: "or_1", orderNumber: "ORD-0099", status: "PENDING", total: 120, currency: "TTD", customerName: "Gina Links", createdAt: NOW }];
  t.today.reminders = [{ kind: "invoice", id: "inv_9", contactId: CONTACT, customerName: "Gina Links", whatsappUrl: "https://wa.me/18687654321?text=Hi%20Gina", messageText: "Hi Gina", dueAt: NOW, reference: "INV-0009", amountDue: 200, currency: "TTD" }];
  t.today.counts = { bookings: 1, invoices: 1, acceptedQuotes: 0, tasks: 1, orders: 1, reminders: 1, total: 5 };
  t.pulse = {
    cash: 400, cashBasis: "ledger", cashCurrency: "TTD", otherCurrencyCash: [], owedToYou: 600, owedCount: 1,
    overdueAmount: 0, overdueCount: 0, youOwe: 250, youOweCount: 1, monthRevenue: 400, monthExpenses: 120,
    monthProfit: 280, safeToSpend: 150, currency: "TTD",
  };
  return t;
}

/** The old cockpit snapshot, still served so the page's former read (if any) answers. */
function cockpitSnapshot() {
  return {
    businessId: BIZ, generatedAt: NOW,
    health: { genomeIntegrity: 0, executiveReadinessScore: 0, genomeStage: "SEED", criticalCount: 0, highPriorityCount: 0, pendingApprovalCount: 0, approvedAwaitingExecutionCount: 0, urgentTemporalCount: 0, pendingGenomeProposalCount: 0, assetRiskCount: 0, constitutionStale: false, keyGenomeOverall: 0, keyGenomeReadiness: 0, keyGenomeConfidence: 0, blockedModuleCount: 0, lowReadinessModuleCount: 0, missingBlockingFactCount: 0 },
    summary: "Cockpit summary.", pulse: { overallScore: 0, dimensions: [] },
    briefing: { headline: "Business is 0% ready. Here is what to do next.", bullets: [], warnings: [] },
    governance: { autoReady: 0, needsApproval: 0, dueToday: 0, urgentRisks: 0 },
    topPriorities: [], pendingApprovals: [], approvedAwaitingExecution: [], urgentItems: [], risks: [], opportunities: [],
    genome: { integrity: 0, readiness: 0, stage: "SEED", pendingProposals: [], weakestSections: [] },
    keyGenome: { overall: 0, integrity: 0, readiness: 0, confidence: 0, computedAt: NOW, sections: [], weakestSections: [] },
    moduleReadiness: [], constitution: { latestVersion: null, stale: false, reason: null, href: "/app/profile" },
    executiveModes: [], recommendedActions: [], degraded: false, sources: {},
  };
}

interface Sent { method: string; path: string; body: unknown }
type Answer = { status: number; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 || status === 201 ? "OK" : status === 403 ? "Forbidden" : "Service Unavailable",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

const TODAY_PATH = `/business-command-center/businesses/${BIZ}/today`;

/**
 * `today` answers each GET .../today in turn (the last answer repeats); `me` answers GET /identity/me; every POST
 * answers 201 {} unless `post` says otherwise; the approved-actions queue answers empty; every other read 503.
 */
function serve({ today, me, post, items }: { today: Answer[]; me?: Answer; post?: (path: string) => Answer; items?: Answer }) {
  const sent: Sent[] = [];
  let todayReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body ?? null; }
    sent.push({ method, path: pathname, body });
    if (method === "GET" && pathname.endsWith(TODAY_PATH)) {
      const answer = today[Math.min(todayReads, today.length - 1)];
      todayReads += 1;
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "GET" && pathname.endsWith("/identity/me")) {
      const answer = me ?? { status: 200, body: { id: "u_owner", email: "owner@t4b.test.local", keyDisabled: false } };
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "GET" && pathname.endsWith(`/business-command-center/businesses/${BIZ}/snapshot`)) {
      return jsonResponse(200, cockpitSnapshot());
    }
    if (method === "GET" && pathname.endsWith(`/actions/businesses/${BIZ}/queue`)) {
      return jsonResponse(200, { items: [], counts: { pending: 0, approved: 0, scheduled: 0, active: 0, completed: 0, failed: 0 }, plans: [] });
    }
    if (method === "GET" && pathname.endsWith(`/command/businesses/${BIZ}/items`)) {
      const answer = items ?? { status: 200, body: { items: [], total: 0 } };
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "POST") {
      const answer = post ? post(pathname) : { status: 201, body: {} };
      return jsonResponse(answer.status, answer.body);
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return {
    sent,
    todayReads: () => sent.filter((r) => r.method === "GET" && r.path.endsWith(TODAY_PATH)),
    posts: () => sent.filter((r) => r.method === "POST"),
  };
}

const ok = (body: unknown): Answer => ({ status: 200, body });

async function renderToday(): Promise<HTMLElement> {
  const { default: Page } = await import("@/app/app/command-center/page");
  const { container } = render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
  await screen.findByRole("heading", { level: 2, name: /^needs you$/i }, { timeout: 10_000 });
  return container;
}

/** A block of Today: the region its level-2 heading names. */
function block(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

/** The row (list item) in `root` that shows `text`. */
function row(root: HTMLElement, text: string | RegExp): HTMLElement {
  const items = within(root).getAllByRole("listitem").filter((li) => (typeof text === "string" ? li.textContent?.includes(text) : text.test(li.textContent ?? "")));
  if (items.length === 0) throw new Error(`no row for ${String(text)}`);
  return items[items.length - 1];
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  window.localStorage.setItem("kf_business_cache", JSON.stringify({ id: BIZ, name: "Gina's Salon" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Repair round 2: Today reads KEY_DISABLED through main's useKeyEnabled, which keeps the answer per tab; each case
  // starts as a new tab would.
  resetKeySwitchForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("TODAY-4BLOCK: Today is four blocks from one server read", () => {
  it("[T4B-01] RED-BEFORE: a fresh business's Today shows exactly the four blocks (Needs you, Today, Pulse, Get set up), no 'Hull Integrity', no metaphor, no percentage, no risk count, no 'you owe 0', from one GET .../today", async () => {
    const api = serve({ today: [ok(freshToday())] });
    const container = await renderToday();
    await screen.findByRole("heading", { level: 2, name: /^get set up$/i });

    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => (h.textContent ?? "").trim());
    expect(h2).toEqual(["Needs you", "Today", "Pulse", "Get set up"]);
    for (const name of [/^needs you$/i, /^today$/i, /^pulse$/i, /^get set up$/i]) expect(block(name)).toBeTruthy();

    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/hull integrity/i);
    for (const re of [/\bgenome\b/i, /\bhull\b/i, /\bcortex\b/i, /\bconstitution\b/i, /\bfuel\b/i, /command center/i, /mission control/i, /risk dna/i, /\bpresence\b/i]) {
      expect(text, re.source).not.toMatch(re);
    }
    expect(text.match(/\b\d{1,3}(?:\.\d+)?\s?%/g) ?? []).toEqual([]);
    expect(text.match(/\b\d+\s+(?:high-priority\s+)?risks?\b|\brisks?\s*:?\s*\d+\b/gi) ?? []).toEqual([]);
    expect(text.match(/you owe\s*(?:TTD|USD|TT\$|US\$|\$)?\s*0(?:\.00)?\b/gi) ?? []).toEqual([]);
    // The business is named on Today (journey A5).
    expect(screen.getAllByText("Gina's Salon").length).toBeGreaterThan(0);

    await waitFor(() => expect(api.todayReads()).toHaveLength(1));
    // The old cockpit read is gone: Today is served by GET .../today alone.
    expect(api.sent.filter((r) => r.path.endsWith("/snapshot"))).toHaveLength(0);
  }, CASE_MS);

  it("[T4B-02] RED-BEFORE: Needs you lists a bank-transfer claim with Confirm and Not yet; Confirm posts its endpoint once and Today is read again", async () => {
    const after = busyToday();
    after.needsYou.items = after.needsYou.items.filter((i) => (i as { kind: string }).kind !== "CLAIM");
    const api = serve({ today: [ok(busyToday()), ok(after)] });
    await renderToday();
    const needs = block(/^needs you$/i);
    const claim = row(needs, "INV-0042");
    expect(within(claim).getByRole("button", { name: /^not yet$/i })).toBeTruthy();
    fireEvent.click(within(claim).getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(api.posts().map((p) => p.path)).toEqual([`/commerce/businesses/${BIZ}/claims/cl_1/confirm`]));
    await waitFor(() => expect(api.todayReads()).toHaveLength(2));
    await waitFor(() => expect(within(block(/^needs you$/i)).queryByText(/INV-0042/)).toBeNull());
  }, CASE_MS);

  it("[T4B-03] RED-BEFORE: a staff approval request in Needs you has inline Approve and Reject; Approve posts POST /businesses/:b/approvals/:id/approve", async () => {
    const api = serve({ today: [ok(busyToday())] });
    await renderToday();
    const request = row(block(/^needs you$/i), "New blender for the salon");
    expect(within(request).getByRole("button", { name: /^reject/i })).toBeTruthy();
    fireEvent.click(within(request).getByRole("button", { name: /^approve/i }));
    await waitFor(() => expect(api.posts().map((p) => p.path)).toEqual([`/businesses/${BIZ}/approvals/ap_1/approve`]));
  }, CASE_MS);

  it("[T4B-04] RED-BEFORE: an accepted quote shows in Needs you with Convert (journey D); Convert posts the quote's convert endpoint", async () => {
    const api = serve({ today: [ok(busyToday())] });
    await renderToday();
    const quote = row(block(/^needs you$/i), "QUO-0007");
    fireEvent.click(within(quote).getByRole("button", { name: /^convert/i }));
    await waitFor(() => expect(api.posts().map((p) => p.path)).toEqual([`/commerce/businesses/${BIZ}/quotes/q_7/convert`]));
  }, CASE_MS);

  it("[T4B-05] RED-BEFORE: a KEY proposal has Approve and Reject; a refused action says so and is not reported as done", async () => {
    const api = serve({
      today: [ok(busyToday())],
      post: (path) => (path.endsWith("/reject") ? { status: 403, body: { statusCode: 403, message: "You may not decide this proposal" } } : { status: 201, body: {} }),
    });
    await renderToday();
    const proposal = row(block(/^needs you$/i), "Chase the overdue wholesale invoice");
    expect(within(proposal).getByRole("button", { name: /^approve/i })).toBeTruthy();
    fireEvent.click(within(proposal).getByRole("button", { name: /^reject/i }));
    await waitFor(() => expect(api.posts().map((p) => p.path)).toEqual([`/key-autonomy/businesses/${BIZ}/actions/proposals/pp_1/reject`]));
    await waitFor(() => expect(within(row(block(/^needs you$/i), "Chase the overdue wholesale invoice")).getByRole("alert").textContent).toMatch(/may not decide/i));
  }, CASE_MS);

  it("[T4B-06] RED-BEFORE (FCP-COR-1, journey C4): the Today block lists today's booking, invoice, task, order and reminder, each one tap from its action; the customer links /app/crm/contacts/<id>; the invoice opens its page; the reminder is one tap from WhatsApp", async () => {
    serve({ today: [ok(busyToday())] });
    await renderToday();
    const today = block(/^today$/i);

    const invoice = row(today, "INV-0042");
    expect(within(invoice).getByRole("link", { name: /Gina Links/ }).getAttribute("href")).toBe(`/app/crm/contacts/${CONTACT}`);
    expect(within(invoice).getByRole("link", { name: /INV-0042/ }).getAttribute("href")).toBe("/app/commerce/invoices/inv_42");
    // Due today in the business's day is not "overdue", even after midnight UTC has passed.
    expect(invoice.textContent).not.toMatch(/overdue/i);

    for (const text of ["Braiding 30", "Call about colour"]) {
      const r = row(today, text);
      expect(within(r).getAllByRole("link").length, text).toBeGreaterThan(0);
      expect(within(r).getByRole("link", { name: /Gina Links/ }).getAttribute("href")).toBe(`/app/crm/contacts/${CONTACT}`);
    }
    // An order row carries no contact id (TodayOrderItem): its own link opens the orders list.
    expect(within(row(today, "ORD-0099")).getByRole("link", { name: /ORD-0099/ })).toBeTruthy();
    const reminder = row(today, "INV-0009");
    expect(within(reminder).getByRole("link", { name: /whatsapp/i }).getAttribute("href")).toBe("https://wa.me/18687654321?text=Hi%20Gina");
  }, CASE_MS);

  it("[T4B-07] RED-BEFORE: Pulse shows the five Money > Overview figures (cash, owed to you, you owe, this month's profit, safe to spend); a member without revenue read gets no Pulse block", async () => {
    serve({ today: [ok(busyToday())] });
    await renderToday();
    const pulse = (block(/^pulse$/i).textContent ?? "").replace(/\s+/g, " ");
    expect(pulse).toMatch(/Cash[^0-9]*400\.00/);
    expect(pulse).toMatch(/Owed to you[^0-9]*600\.00/);
    expect(pulse).toMatch(/You owe[^0-9]*250\.00/);
    expect(pulse).toMatch(/This month's profit[^0-9]*280\.00/);
    expect(pulse).toMatch(/Safe to spend[^0-9]*150\.00/);
    cleanup();

    const restricted = freshToday();
    restricted.pulseStatus = "RESTRICTED";
    restricted.pulse = null;
    serve({ today: [ok(restricted)] });
    await renderToday();
    await screen.findByRole("heading", { level: 2, name: /^get set up$/i });
    expect(screen.queryByRole("heading", { name: /^pulse$/i })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.trim())).toEqual(["Needs you", "Today", "Get set up"]);
  }, CASE_MS);

  it("[T4B-08] RED-BEFORE (BUG-010, D-157): Get set up lists each step as a link to TODAY-AGGREGATE's href, a done step says Done, and the sample is a preview (no link, nothing in the books)", async () => {
    serve({ today: [ok(freshToday())] });
    await renderToday();
    const setup = block(/^get set up$/i);
    for (const s of STEPS) {
      const link = within(setup).getByRole("link", { name: new RegExp(s.label) });
      expect(link.getAttribute("href")).toBe(s.href);
      expect(/\bdone\b/i.test(link.getAttribute("aria-label") ?? "")).toBe(s.done);
    }
    // Every link in the block is a step: the sample preview opens nothing.
    expect(within(setup).getAllByRole("link")).toHaveLength(STEPS.length);
    expect(within(setup).getAllByText(/sample/i).length).toBeGreaterThan(0);
    // The install step renders once it has checked this device (install-app-step.tsx "checking").
    expect(await within(setup).findByText(/install keyflowos on your phone/i)).toBeTruthy();
  }, CASE_MS);

  it("[T4B-09] RED-BEFORE: under KEY_DISABLED (keyDisabled on GET /identity/me) no KEY UI renders on Today: no KEY proposal, no approved KEY actions panel, no 'KEY' anywhere in the blocks", async () => {
    // Repair round 1, COR-1: a queue item KEY could run (COLLECT_RECEIVABLE is seeded executableByKey for an overdue
    // invoice), so the queue's "KEY can handle" badge and Execute action are under test too.
    serve({ today: [ok(busyToday())], me: ok({ id: "u_owner", email: "owner@t4b.test.local", keyDisabled: true }), items: ok({ items: [KEY_ITEM], total: 1 }) });
    const container = await renderToday();
    await waitFor(() => expect(screen.getAllByText(/INV-0042/).length).toBeGreaterThan(0));
    await screen.findByText(KEY_ITEM.title, {}, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /^execute$/i })).toBeNull();
    expect(screen.queryByText("Chase the overdue wholesale invoice")).toBeNull();
    expect(screen.queryByTestId("approved-actions-panel")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/\bKEY\b/);
  }, CASE_MS);

  it("[T4B-10] CONTROL: with KEY on, the KEY proposal and the approved KEY actions panel (D-72) are on Today", async () => {
    serve({ today: [ok(busyToday())], items: ok({ items: [KEY_ITEM], total: 1 }) });
    await renderToday();
    expect(within(block(/^needs you$/i)).getByText("Chase the overdue wholesale invoice")).toBeTruthy();
    expect(await screen.findByTestId("approved-actions-panel")).toBeTruthy();
    await screen.findByText(KEY_ITEM.title, {}, { timeout: 10_000 });
    expect(screen.getByText("KEY can handle")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^execute$/i })).toBeTruthy();
  }, CASE_MS);

  it("[T4B-11] RED-BEFORE: a Today read that fails says so and offers Retry; it never says nothing needs you, never shows a zero Pulse", async () => {
    // A 500: lib/fetch-with-retry.ts retries a GET once on 502/503/504, so a single 503 never reaches the page.
    const api = serve({ today: [{ status: 500, body: { statusCode: 500, message: "Internal server error" } }, ok(freshToday())] });
    const { default: Page } = await import("@/app/app/command-center/page");
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );
    const alert = await screen.findByTestId("today-unavailable", {}, { timeout: 10_000 });
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByText(/nothing needs you/i)).toBeNull();
    expect(screen.queryByText(/0\.00/)).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    await screen.findByRole("heading", { level: 2, name: /^get set up$/i }, { timeout: 10_000 });
    expect(api.todayReads()).toHaveLength(2);
  }, CASE_MS);
  it("[T4B-12] RED-BEFORE (journey I6): a member without revenue read (pulseStatus RESTRICTED) sees no money anywhere on Today, the sample preview included; it is still a sample", async () => {
    const restricted = freshToday();
    restricted.pulseStatus = "RESTRICTED";
    restricted.pulse = null;
    const container = await (async () => {
      serve({ today: [ok(restricted)] });
      return renderToday();
    })();
    await screen.findByRole("heading", { level: 2, name: /^get set up$/i });
    expect(within(block(/^get set up$/i)).getAllByText(/sample/i).length).toBeGreaterThan(0);
    expect((container.textContent ?? "").replace(/\s+/g, " ")).not.toMatch(/(TTD|TT\$|USD)\s?[\d,]+\.\d{2}/);
  }, CASE_MS);
});

describe("TODAY-4BLOCK repair round 1 (acceptance reviews at e9e05754)", () => {
  it("[T4B-13] RED-BEFORE (SEC-T4B-1, COR-5): a KEY_DISABLED read that fails (GET /identity/me 500) is KEY off: no KEY proposal, no approved KEY actions panel, no KEY Chat tile, no Execute", async () => {
    const api = serve({ today: [ok(busyToday())], me: { status: 500, body: { statusCode: 500, message: "Internal server error" } }, items: ok({ items: [KEY_ITEM], total: 1 }) });
    await renderToday();
    await screen.findByText(KEY_ITEM.title, {}, { timeout: 10_000 });
    // Repair round 2 (COR): every check runs only once the KEY read has settled: its final answer, after the client's
    // retries, has reached the page (data-key-read="settled"). So each check alone catches a page that fails open.
    await waitFor(() => expect(document.querySelector("[data-key-read]")?.getAttribute("data-key-read")).toBe("settled"), { timeout: 15_000 });
    expect(api.sent.some((r) => r.path.endsWith("/identity/me"))).toBe(true);
    expect(screen.queryByText("Chase the overdue wholesale invoice")).toBeNull();
    expect(screen.queryByTestId("approved-actions-panel")).toBeNull();
    expect(screen.queryByText("KEY can handle")).toBeNull();
    expect(screen.queryByRole("button", { name: /^execute$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open module launcher" }));
    const pads = await screen.findAllByRole("dialog", { name: /launch pad/i });
    for (const pad of pads) expect(within(pad).queryByRole("link", { name: /key chat/i })).toBeNull();
  }, CASE_MS);

  it("[T4B-14] RED-BEFORE (SEC-T4B-2): a refresh the server refuses (403) clears what was shown: no Pulse, no figure, no customer row under the alert", async () => {
    serve({ today: [ok(busyToday()), { status: 403, body: { statusCode: 403, message: "Forbidden resource" } }] });
    await renderToday();
    await screen.findByRole("heading", { level: 2, name: /^pulse$/i });
    fireEvent.click(screen.getAllByRole("button", { name: /^refresh$/i })[0]);
    const alert = await screen.findByTestId("today-unavailable", {}, { timeout: 10_000 });
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByRole("heading", { name: /^pulse$/i })).toBeNull();
    expect(screen.queryByText(/INV-0042/)).toBeNull();
    expect(screen.queryByText(/Gina Links/)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\d\.\d{2}/);
  }, CASE_MS);

  it("[T4B-15] (SEC-T4B-3, COR-4; D-295) a member without operations (queue read 403) with GET .../today answering 200 sees all four blocks", async () => {
    serve({
      today: [ok(freshToday())],
      items: { status: 403, body: { statusCode: 403, message: "Insufficient permissions: operations requires read access (you have none)", error: "Forbidden" } },
    });
    await renderToday();
    await screen.findByTestId("command-actions-withheld", {}, { timeout: 10_000 });
    await screen.findByRole("heading", { level: 2, name: /^get set up$/i });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.trim())).toEqual(["Needs you", "Today", "Pulse", "Get set up"]);
  }, CASE_MS);

  it("[T4B-16] RED-BEFORE (COR-3): an accepted quote in the Today block opens the quote the way /app/commerce reads it (recordType=quote&recordId=<id>)", async () => {
    const t = busyToday();
    t.today.acceptedQuotes = [{ id: "q_8", quoteNumber: "QUO-0008", total: 500, currency: "TTD", acceptedAt: NOW, customerName: "Gina Links", contactId: CONTACT }];
    serve({ today: [ok(t)] });
    await renderToday();
    const quote = row(block(/^today$/i), "QUO-0008");
    expect(within(quote).getByRole("link", { name: /QUO-0008/ }).getAttribute("href")).toBe("/app/commerce?recordType=quote&recordId=q_8");
  }, CASE_MS);

  it("[T4B-17] RED-BEFORE (COR-6): pulseStatus OK with no pulse fails visibly: the Pulse block says its figures could not be loaded, and shows no zero", async () => {
    const t = freshToday();
    t.pulse = null;
    serve({ today: [ok(t)] });
    await renderToday();
    const pulse = await screen.findByRole("region", { name: /^pulse$/i });
    expect(within(pulse).getByRole("alert").textContent).toMatch(/could not be loaded/i);
    expect(pulse.textContent ?? "").not.toMatch(/\d\.\d{2}/);
  }, CASE_MS);

  it("[T4B-18] RED-BEFORE (COR-7): the sample preview is in the business's currency (USD), not a hard-coded TTD", async () => {
    const t = freshToday();
    t.pulse = { ...(t.pulse as Record<string, unknown>), currency: "USD", cashCurrency: "USD" };
    serve({ today: [ok(t)] });
    await renderToday();
    const sample = await screen.findByRole("figure", { name: /sample invoice preview/i });
    expect(sample.textContent).toMatch(/USD 250\.00/);
    expect(sample.textContent).not.toMatch(/TTD/);
  }, CASE_MS);
});

describe("TODAY-4BLOCK repair round 2 (confirmation reviews at 14934c7c)", () => {
  it("[T4B-19] RED-BEFORE (SEC-T4B-2 narrowed): a refresh that fails with a 5xx keeps the last good figures for the same business under the alert, with Retry", async () => {
    serve({ today: [ok(busyToday()), { status: 503, body: { statusCode: 503, message: "Service Unavailable" } }] });
    await renderToday();
    await screen.findByRole("heading", { level: 2, name: /^pulse$/i });
    fireEvent.click(screen.getAllByRole("button", { name: /^refresh$/i })[0]);
    const alert = await screen.findByTestId("today-unavailable", {}, { timeout: 15_000 });
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /^pulse$/i })).toBeTruthy();
    expect((block(/^pulse$/i).textContent ?? "").replace(/\s+/g, " ")).toMatch(/Cash[^0-9]*400\.00/);
    expect(within(block(/^today$/i)).getAllByText(/INV-0042/).length).toBeGreaterThan(0);
  }, CASE_MS);

  it("[T4B-20] RED-BEFORE (SEC): after a switch to another business, a failed reply for the first business neither clears the second's Today nor raises its alert", async () => {
    const BIZ2 = "biz_t4b_other";
    const other = busyToday();
    other.businessId = BIZ2;
    other.today.invoices = [{ ...(other.today.invoices[0] as Record<string, unknown>), id: "inv_77", invoiceNumber: "INV-0077" }];
    let failFirst: (() => void) | null = null;
    let firstReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/business-command-center/businesses/${BIZ}/today`)) {
        firstReads += 1;
        // The first business's read answers only when the test lets it, and then with a 403 (not retried).
        await new Promise<void>((resolve) => { failFirst = resolve; });
        return jsonResponse(403, { statusCode: 403, message: "Forbidden resource" });
      }
      if (pathname.endsWith(`/business-command-center/businesses/${BIZ2}/today`)) return jsonResponse(200, other);
      if (pathname.endsWith("/identity/me")) return jsonResponse(200, { id: "u_owner", email: "owner@t4b.test.local", keyDisabled: false });
      return jsonResponse(500, { message: "Internal server error" });
    }));
    const { default: Page } = await import("@/app/app/command-center/page");
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );
    await waitFor(() => expect(firstReads).toBe(1), { timeout: 10_000 });
    try {
      selectBusiness(BIZ2);
      expect(await screen.findByText("INV-0077", {}, { timeout: 10_000 })).toBeTruthy();
      failFirst!();
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.getAllByText("INV-0077").length).toBeGreaterThan(0);
      expect(screen.queryByTestId("today-unavailable")).toBeNull();
    } finally {
      // Never leave the first business's read pending: lib/api.ts coalesces identical GETs, so a later case's read of
      // the same URL would wait on it.
      (failFirst as (() => void) | null)?.();
    }
  }, CASE_MS);

  it("[T4B-21] RED-BEFORE: when the KEY read failed, Retry reads it again, so a KEY-on business gets its KEY UI back without a reload", async () => {
    let meFails = true;
    const api = serve({
      today: [{ status: 500, body: { statusCode: 500, message: "Internal server error" } }, ok(busyToday())],
      me: { status: 500, body: { statusCode: 500, message: "Internal server error" } },
    });
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!meFails && new URL(url, "http://localhost").pathname.endsWith("/identity/me")) {
        return jsonResponse(200, { id: "u_owner", email: "owner@t4b.test.local", keyDisabled: false });
      }
      return real(input, init);
    }));
    const { default: Page } = await import("@/app/app/command-center/page");
    render(
      <GenomeProvider>
        <Page />
      </GenomeProvider>,
    );
    const alert = await screen.findByTestId("today-unavailable", {}, { timeout: 15_000 });
    await waitFor(() => expect(document.querySelector("[data-key-read]")?.getAttribute("data-key-read")).toBe("settled"), { timeout: 15_000 });
    meFails = false;
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Chase the overdue wholesale invoice", {}, { timeout: 10_000 })).toBeTruthy();
    expect(await screen.findByTestId("approved-actions-panel")).toBeTruthy();
    expect(api.sent.filter((r) => r.path.endsWith("/identity/me")).length).toBeGreaterThan(0);
  }, CASE_MS);
});
