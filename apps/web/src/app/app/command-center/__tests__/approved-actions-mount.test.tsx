/**
 * KEY-R3c-APPROVED-QUEUE-MOUNT, owner ruling D-72 (2026-11-03): the approved-action queue with its
 * Run action (D-70) is mounted on the Command Center page.
 *
 * WHY (D70-MOUNT): D-70 put the Run action for an approved queued KEY step in the control-tower
 * ApprovedActionsQueue, but no live page mounted it: /app/control-tower redirects to
 * /app/keyflow-command, which redirects to /app/command-center. So an approval still never led to
 * the approved step running from the web.
 *
 * Contract pinned here, on the real page and the real client (lib/client.ts, lib/api.ts); only
 * `fetch`, the router and the toaster are stubbed:
 *   CC-AQ-01  the Command Center page reads GET /actions/businesses/:b/queue for the current
 *             business and shows each approved step with a Run action; a pending approval or a
 *             history row gets none
 *   CC-AQ-02  Run posts exactly {planId, planStepId} to POST /actions/businesses/:b/execute, once,
 *             never re-plans, and then refreshes the queue (the step that ran is gone)
 *   CC-AQ-03  a 403 from the bound route shows the access message and removes the action
 *   CC-AQ-04  when nothing is approved the panel says so (empty state), with no Run action
 *   CC-AQ-05  a queue that could not be read says so; it is never shown as "nothing approved"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { GenomeProvider } from "@/contexts/genome-context";

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

const BIZ = "biz_d72_cc";
const NOW = "2026-11-03T10:00:00.000Z";

/** An 'approved_step' item exactly as GET actions/businesses/:b/queue lists it (D-70). */
const APPROVED = {
  id: "appr_d72",
  type: "approved_step",
  toolName: "crm_delete_contact",
  title: "Delete the duplicate contact",
  description: "Plan step 1",
  riskTier: 3,
  module: "crm",
  status: "approved",
  createdAt: NOW,
  affectedEntities: ["contact:c_1"],
  planId: "plan_d72",
  planStepId: "step_d72",
  approvalId: "appr_d72",
};

const PENDING = { id: "appr_pending", type: "pending_approval", toolName: "crm_add_note", title: "Pending note", description: null, riskTier: 2, module: "crm", status: "pending", createdAt: NOW, affectedEntities: [] };
const EXECUTED = { id: "log_1", type: "executed", toolName: "create_task", title: "Done task", description: null, riskTier: 1, module: "projects", status: "completed", createdAt: NOW, affectedEntities: [] };

function queueBody(items: unknown[]) {
  return { items, counts: { pending: 0, approved: 0, scheduled: 0, active: 0, completed: 0, failed: 0 }, plans: [] };
}

/** The V1-47 snapshot shape (business-command-center.types.ts), minimal and healthy. */
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

interface Sent { method: string; path: string; body: unknown }
type Answer = { status: number; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  const statusText = status === 200 || status === 201 ? "OK" : status === 403 ? "Forbidden" : status === 500 ? "Internal Server Error" : "Service Unavailable";
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

/**
 * Serve the cockpit snapshot, the action queue (`queue` answers each GET in turn; the last answer
 * repeats) and the bound execute route. Every other read the cockpit's side panels make answers
 * 503: those panels are not under test here and each has its own unavailable state.
 */
function serve({ queue, execute = { status: 201, body: { success: true, tier: 3, result: { ok: true } } } }: { queue: Answer[]; execute?: Answer }) {
  const sent: Sent[] = [];
  let queueReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });
    if (method === "GET" && pathname.endsWith(`/business-command-center/businesses/${BIZ}/snapshot`)) {
      return jsonResponse(200, cockpitSnapshot());
    }
    if (method === "GET" && pathname.endsWith(`/actions/businesses/${BIZ}/queue`)) {
      const answer = queue[Math.min(queueReads, queue.length - 1)];
      queueReads += 1;
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "POST" && pathname.endsWith(`/actions/businesses/${BIZ}/execute`)) {
      return jsonResponse(execute.status, execute.body);
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return {
    sent,
    queueReads: () => sent.filter((r) => r.method === "GET" && r.path.endsWith("/queue")),
    plans: () => sent.filter((r) => r.path.endsWith("/plan")),
    executes: () => sent.filter((r) => r.path.endsWith("/execute")),
  };
}

async function renderCommandCenter() {
  const { default: Page } = await import("@/app/app/command-center/page");
  render(
    <GenomeProvider>
      <Page />
    </GenomeProvider>,
  );
  return screen.findByTestId("approved-actions-panel", {}, { timeout: 10_000 });
}

const runButton = (panel: HTMLElement) => within(panel).queryByRole("button", { name: `Run ${APPROVED.title}` });

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe("D-72: the Command Center page mounts the approved-action queue with its Run action", () => {
  it("CC-AQ-01 reads the current business's action queue and shows each approved step with a Run action; pending approvals and history get none", async () => {
    const api = serve({ queue: [{ status: 200, body: queueBody([APPROVED, PENDING, EXECUTED]) }] });
    const panel = await renderCommandCenter();

    await waitFor(() => expect(runButton(panel)).toBeTruthy(), { timeout: 10_000 });
    expect(within(panel).getAllByRole("button", { name: /^Run / })).toHaveLength(1);
    expect(within(panel).getByText(APPROVED.title)).toBeTruthy();
    expect(within(panel).queryByText("Pending note")).toBeNull();
    expect(within(panel).queryByText("Done task")).toBeNull();
    expect(api.queueReads().length).toBeGreaterThan(0);
    for (const read of api.queueReads()) expect(read.path).toBe(`/actions/businesses/${BIZ}/queue`);
  }, 30_000);

  it("CC-AQ-02 Run posts exactly {planId, planStepId} to the bound execute route, once, with no re-planning, and refreshes the queue", async () => {
    const api = serve({
      queue: [
        { status: 200, body: queueBody([APPROVED, PENDING]) },
        { status: 200, body: queueBody([PENDING]) },
      ],
    });
    const panel = await renderCommandCenter();
    await waitFor(() => expect(runButton(panel)).toBeTruthy(), { timeout: 10_000 });
    const readsBefore = api.queueReads().length;

    fireEvent.click(runButton(panel)!);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.executes()).toEqual([
      { method: "POST", path: `/actions/businesses/${BIZ}/execute`, body: { planId: APPROVED.planId, planStepId: APPROVED.planStepId } },
    ]);
    expect(api.plans()).toEqual([]);
    await waitFor(() => expect(api.queueReads().length).toBe(readsBefore + 1));
    await waitFor(() => expect(runButton(panel)).toBeNull());
    await waitFor(() => expect(within(panel).getByTestId("approved-actions-empty")).toBeTruthy());
    expect(api.executes()).toHaveLength(1);
  }, 30_000);

  it("CC-AQ-03 a 403 from the bound route shows the access message and removes the action; nothing is re-planned and nothing reads as run", async () => {
    const refusal = "This plan step is executed only for the member who proposed it or the business owner";
    const api = serve({
      queue: [{ status: 200, body: queueBody([APPROVED]) }],
      execute: { status: 403, body: { statusCode: 403, message: refusal, error: "Forbidden" } },
    });
    const panel = await renderCommandCenter();
    await waitFor(() => expect(runButton(panel)).toBeTruthy(), { timeout: 10_000 });

    fireEvent.click(runButton(panel)!);

    await waitFor(() => expect(within(panel).getByText(refusal)).toBeTruthy());
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(runButton(panel)).toBeNull();
    expect(api.executes()).toHaveLength(1);
    expect(api.plans()).toEqual([]);
  }, 30_000);

  it("CC-AQ-04 nothing approved: the panel shows its empty state and no Run action", async () => {
    serve({ queue: [{ status: 200, body: queueBody([PENDING, EXECUTED]) }] });
    const panel = await renderCommandCenter();

    await waitFor(() => expect(within(panel).getByTestId("approved-actions-empty")).toBeTruthy(), { timeout: 10_000 });
    expect(within(panel).queryAllByRole("button", { name: /^Run / })).toHaveLength(0);
    expect(within(panel).queryByText("Pending note")).toBeNull();
  }, 30_000);

  it("CC-AQ-05 a queue that could not be read says so and is never shown as nothing approved", async () => {
    // A 500, not a 503: fetch-with-retry retries a 503 with backoff before answering.
    serve({ queue: [{ status: 500, body: { statusCode: 500, message: "Internal server error" } }] });
    const panel = await renderCommandCenter();

    await waitFor(() => expect(within(panel).getByTestId("approved-actions-unavailable")).toBeTruthy(), { timeout: 10_000 });
    expect(within(panel).queryByTestId("approved-actions-empty")).toBeNull();
    expect(within(panel).queryAllByRole("button", { name: /^Run / })).toHaveLength(0);
  }, 30_000);
});
