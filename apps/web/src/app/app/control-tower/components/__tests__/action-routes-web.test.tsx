/**
 * V1-31c-KEY-ACTION-WEB-AND-OPEN-ROUTES: the control-tower surfaces act only on
 * plan steps the server holds (the V1-31b companion, review CR-4).
 *
 * WHY this test exists: V1-31b bound POST /actions/businesses/:businessId/execute
 * (GraphActionsController.executeAction) to a stored AiPlanStep. A body that
 * names a tool and arguments but no stored step is refused 400 ("plan step"),
 * because executing a client tool name reopens SEC-V131-1 (M46,
 * KEY-CONFIRM-BIND-001). Three control-tower callers still sent exactly that
 * body through lib/client.ts executeAction:
 *   - PriorityQueue's action buttons (`executeAction(businessId, action.toolName, action.args)`),
 *   - PriorityQueue's dismiss log (`executeAction(businessId, "create_task", {...})`),
 *   - DailyPlan's block execute (`executeAction(businessId, block.toolName, block.toolArgs)`),
 * so after V1-31b every one of them answered 400 and the screen said "Action
 * failed" (or "logged locally").
 *
 * Required, and pinned here: each surface asks the plan route
 * (POST .../plan, a natural-language request the server plans and stores) and
 * then executes the stored steps it answers BY ID: every execute body is exactly
 * {planId, planStepId}, and no request names a tool or carries tool arguments.
 *
 * The components are rendered for real on the real client (lib/client.ts and
 * lib/api.ts); only `fetch`, the Next router and the toaster are stubbed. The
 * fetch stub answers the way the V1-31b server does: an execute body without a
 * stored step id is 400, one with the stored ids runs the step.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { PriorityQueue } from "../priority-queue";
import { DailyPlan } from "../daily-plan";
import type { EnrichedPriority } from "../use-control-tower-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/control-tower",
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

const BIZ = "biz_v31c";
const PLAN_ID = "plan_v31c";
/** The stored steps the plan route answers (ids the server minted). */
const STEPS = [
  { id: "step_v31c_1", order: 1, toolName: "draft_payment_reminder", module: "revenue", action: "Draft reminders", description: "", riskTier: 1, requiresApproval: false, dependsOn: [], inputPayload: { invoiceIds: ["inv_1"] } },
  { id: "step_v31c_2", order: 2, toolName: "create_task", module: "projects", action: "Create a task", description: "", riskTier: 1, requiresApproval: false, dependsOn: [], inputPayload: { title: "follow up" } },
];
/** Every tool name a surface could have sent from its own data. */
const CLIENT_TOOL_NAMES = ["draft_payment_reminder", "create_task", "draft_followup_message", "content_create_post"];

interface Sent { method: string; path: string; body: unknown }

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body, statusText); },
  } as unknown as Response;
}

interface StubOptions {
  /** What the plan route answers (default: a stored plan with STEPS). */
  plan?: () => unknown;
  /** What executing a stored step answers (default: success). */
  stepResult?: (stepId: string) => { status: number; body: unknown };
  /** The weekly plan DailyPlan reads. */
  weeklyPlan?: unknown;
}

/** Stub the API as the V1-31b server answers it. Returns every request the browser sent. */
function stubApi(options: StubOptions = {}) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });

    if (method === "POST" && pathname.endsWith(`/actions/businesses/${BIZ}/plan`)) {
      return jsonResponse(201, options.plan ? options.plan() : {
        intent: { objective: "x", modules: ["revenue"] },
        plan: { id: PLAN_ID, status: "draft", objective: "x", maxRiskTier: 1, steps: STEPS },
        clarificationNeeded: false,
        riskAssessment: { maxTier: 1, requiresApproval: false, affectedModules: ["revenue"], estimatedImpact: "" },
      });
    }
    if (method === "POST" && pathname.endsWith(`/actions/businesses/${BIZ}/execute`)) {
      const b = (body ?? {}) as Record<string, unknown>;
      // GraphActionsController.executeAction since V1-31b: no stored step, no execution.
      if (typeof b.planId !== "string" || typeof b.planStepId !== "string") {
        return jsonResponse(400, { statusCode: 400, message: "execute takes a stored plan step: planId and planStepId", error: "Bad Request" }, "Bad Request");
      }
      const answer = options.stepResult?.(b.planStepId) ?? { status: 201, body: { success: true, tier: 1, result: { ok: true } } };
      return jsonResponse(answer.status, answer.body);
    }
    if (method === "GET" && pathname.endsWith(`/ai/businesses/${BIZ}/ai/strategic/weekly-plan`)) {
      return jsonResponse(200, options.weeklyPlan ?? {});
    }
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    sent,
    plans: () => sent.filter((r) => r.path.endsWith("/plan")),
    executes: () => sent.filter((r) => r.path.endsWith("/execute")),
  };
}

/** No request body names a tool or carries tool arguments, at any depth of its top level. */
function expectNoClientTool(sent: Sent[]) {
  for (const r of sent) {
    if (r.body === undefined) continue;
    const b = r.body as Record<string, unknown>;
    expect(Object.keys(b), `${r.method} ${r.path}`).not.toContain("toolName");
    expect(Object.keys(b), `${r.method} ${r.path}`).not.toContain("args");
    expect(Object.keys(b), `${r.method} ${r.path}`).not.toContain("toolArgs");
    const text = JSON.stringify(b);
    for (const tool of CLIENT_TOOL_NAMES) expect(text, `${r.method} ${r.path} names ${tool}`).not.toContain(tool);
  }
}

/** Every execute body is exactly the stored ids, in the order the plan answered them. */
function expectStoredStepExecutes(executes: Sent[], stepIds = STEPS.map((s) => s.id)) {
  expect(executes.map((r) => r.body)).toEqual(stepIds.map((planStepId) => ({ planId: PLAN_ID, planStepId })));
}

const PRIORITY: EnrichedPriority = {
  id: "prio_v31c",
  type: "risk",
  severity: "critical",
  title: "3 invoices overdue",
  description: "TTD 1,200 outstanding past 30 days",
  module: "revenue",
  urgency: 95,
  actions: [
    { key: "send_reminder", toolName: "draft_payment_reminder", label: "Send Reminders", args: {}, tier: 2, variant: "primary" },
    {
      key: "delegate_ai",
      toolName: "create_task",
      label: "Delegate to AI",
      args: { title: "[AI] 3 invoices overdue", description: "x", priority: "high", module: "revenue" },
      tier: 2,
      variant: "ai",
    },
  ],
};

function todayName(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

const WEEKLY_PLAN = {
  summary: "v31c week",
  days: [
    {
      day: todayName(),
      blocks: [
        {
          timeSlot: "9AM",
          focus: "Chase overdue invoices",
          description: "Send reminders for the three overdue invoices",
          category: "revenue",
          toolName: "draft_payment_reminder",
          toolArgs: { invoiceIds: ["inv_1", "inv_2"] },
        },
      ],
    },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
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

describe("PriorityQueue acts on stored plan steps, never a client tool (V1-31b review CR-4)", () => {
  it("WEB-01 an action button plans the request in words, then executes each stored step by id: no tool name or arguments are sent", async () => {
    const api = stubApi();
    render(<PriorityQueue priorities={[PRIORITY]} businessId={BIZ} />);

    fireEvent.click(screen.getByTitle("Send Reminders"));

    await waitFor(() => expect(api.executes()).toHaveLength(STEPS.length));
    expect(api.plans()).toHaveLength(1);
    const planBody = api.plans()[0].body as Record<string, unknown>;
    expect(Object.keys(planBody)).toEqual(["input"]);
    expect(typeof planBody.input).toBe("string");
    expect(planBody.input as string).toContain("3 invoices overdue");
    expectStoredStepExecutes(api.executes());
    expectNoClientTool(api.sent);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("WEB-02 the dismiss log is planned and executed by stored step id too, and is reported as logged", async () => {
    const api = stubApi();
    render(<PriorityQueue priorities={[PRIORITY]} businessId={BIZ} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(await screen.findByText("Dismiss"));
    fireEvent.click(await screen.findByText("Already handled"));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.plans()).toHaveLength(1);
    const input = (api.plans()[0].body as Record<string, unknown>).input as string;
    expect(input).toContain("3 invoices overdue");
    expect(input).toContain("Already handled");
    expectStoredStepExecutes(api.executes());
    expectNoClientTool(api.sent);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe("Dismissed: Already handled");
  });

  it("WEB-03 a step the server queues for approval stops the run: later steps are not executed and the member is told it is queued", async () => {
    const api = stubApi({
      stepResult: (stepId) => stepId === STEPS[0].id
        ? { status: 201, body: { success: false, requiresApproval: true, approvalId: "appr_v31c", tier: 3 } }
        : { status: 201, body: { success: true, tier: 1 } },
    });
    render(<PriorityQueue priorities={[PRIORITY]} businessId={BIZ} />);

    fireEvent.click(screen.getByTitle("Send Reminders"));

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expectStoredStepExecutes(api.executes(), [STEPS[0].id]);
    expectNoClientTool(api.sent);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("WEB-04 a request the planner needs clarified executes nothing", async () => {
    const api = stubApi({ plan: () => ({ intent: { objective: "x" }, plan: null, clarificationNeeded: true }) });
    render(<PriorityQueue priorities={[PRIORITY]} businessId={BIZ} />);

    fireEvent.click(screen.getByTitle("Send Reminders"));

    await waitFor(() => expect(api.plans()).toHaveLength(1));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(api.executes()).toEqual([]);
    expectNoClientTool(api.sent);
  });
});

describe("DailyPlan executes a block through stored plan steps, never the block's toolName/toolArgs (V1-31b review CR-4)", () => {
  it("WEB-05 Execute plans the block in words, then executes each stored step by id", async () => {
    const api = stubApi({ weeklyPlan: WEEKLY_PLAN });
    render(<DailyPlan businessId={BIZ} />);

    fireEvent.click(await screen.findByTitle("Execute with AI"));

    await waitFor(() => expect(api.executes()).toHaveLength(STEPS.length));
    expect(api.plans()).toHaveLength(1);
    const planBody = api.plans()[0].body as Record<string, unknown>;
    expect(Object.keys(planBody)).toEqual(["input"]);
    expect(planBody.input as string).toContain("Chase overdue invoices");
    expectStoredStepExecutes(api.executes());
    expectNoClientTool(api.sent);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
