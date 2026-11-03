/**
 * D-70 (2026-11-03), trial-N repair round 2 APPROVED-STEP-WEB: an approved queued KEY action step
 * is run from a Run action on that queue item in the web control tower, executing exactly the
 * stored step through the bound execute route (V1-31b), with no re-planning.
 *
 * WHY: after a step was queued for approval, the control tower re-planned on every click
 * (runPlannedAction calls POST .../plan first and stores a new plan), so an approval never led to
 * the approved step running. GET actions/businesses/:b/queue now lists such a step as an
 * 'approved_step' item carrying its stored planId and planStepId (only for a member who may run
 * it), and the ApprovedActionsQueue Run action posts exactly those ids to POST .../execute.
 *
 * The component is rendered for real on the real client (lib/client.ts and lib/api.ts); only
 * `fetch` and the toaster are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { ApprovedActionsQueue } from "../approved-actions-queue";
import type { ActionQueueItem } from "@/lib/client";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const BIZ = "biz_d70";

const APPROVED: ActionQueueItem = {
  id: "appr_d70",
  type: "approved_step",
  toolName: "crm_delete_contact",
  title: "Delete the duplicate contact",
  description: "Plan step 1",
  riskTier: 3,
  module: "crm",
  status: "approved",
  createdAt: "2026-11-03T10:00:00.000Z",
  affectedEntities: ["contact:c_1"],
  planId: "plan_d70",
  planStepId: "step_d70",
  approvalId: "appr_d70",
};

const OTHERS: ActionQueueItem[] = [
  { id: "appr_pending", type: "pending_approval", toolName: "crm_add_note", title: "Pending note", description: null, riskTier: 2, module: "crm", status: "pending", createdAt: "2026-11-03T09:00:00.000Z", affectedEntities: [] },
  { id: "log_1", type: "executed", toolName: "create_task", title: "Done task", description: null, riskTier: 1, module: "projects", status: "completed", createdAt: "2026-11-03T08:00:00.000Z", affectedEntities: [] },
];

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

/** Stub the API as the bound execute route answers. Returns every request the browser sent. */
function stubApi(executeAnswer: { status: number; body: unknown } = { status: 201, body: { success: true, tier: 3, result: { ok: true } } }) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });
    if (method === "POST" && pathname.endsWith(`/actions/businesses/${BIZ}/execute`)) {
      return jsonResponse(executeAnswer.status, executeAnswer.body, executeAnswer.status >= 400 ? "Forbidden" : "OK");
    }
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return {
    sent,
    plans: () => sent.filter((r) => r.path.endsWith("/plan")),
    executes: () => sent.filter((r) => r.path.endsWith("/execute")),
  };
}

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

describe("ApprovedActionsQueue runs an approved queued step by its stored ids (D-70)", () => {
  it("D70-01 only an approved step with its stored ids gets a Run action; pending approvals and history do not", () => {
    stubApi();
    render(<ApprovedActionsQueue businessId={BIZ} items={[APPROVED, ...OTHERS, { ...APPROVED, id: "appr_noids", planId: undefined, planStepId: undefined }]} />);
    expect(screen.getAllByRole("button", { name: /^Run / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: `Run ${APPROVED.title}` })).toBeTruthy();
    expect(screen.queryByText("Pending note")).toBeNull();
  });

  it("D70-02 Run posts exactly {planId, planStepId} of that item to the bound execute route, once, with no re-planning; the member is told it ran", async () => {
    const api = stubApi();
    const onRan = vi.fn();
    render(<ApprovedActionsQueue businessId={BIZ} items={[APPROVED, ...OTHERS]} onRan={onRan} />);

    fireEvent.click(screen.getByRole("button", { name: `Run ${APPROVED.title}` }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.plans()).toEqual([]);
    expect(api.executes()).toEqual([
      { method: "POST", path: `/actions/businesses/${BIZ}/execute`, body: { planId: "plan_d70", planStepId: "step_d70" } },
    ]);
    expect(api.sent).toHaveLength(1);
    expect(onRan).toHaveBeenCalledWith(APPROVED);
    await waitFor(() => expect(screen.queryByRole("button", { name: `Run ${APPROVED.title}` })).toBeNull());
  });

  it("D70-03 a refusal from the route (403) is shown as an error, the item stays, and nothing is re-planned", async () => {
    const api = stubApi({ status: 403, body: { statusCode: 403, message: "This plan step is executed only for the member who proposed it or the business owner", error: "Forbidden" } });
    render(<ApprovedActionsQueue businessId={BIZ} items={[APPROVED]} />);

    fireEvent.click(screen.getByRole("button", { name: `Run ${APPROVED.title}` }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.plans()).toEqual([]);
    expect(api.executes()).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `Run ${APPROVED.title}` })).toBeTruthy();
  });

  it("D70-04 a step the boundary still holds (asks for a confirmation) is reported as waiting, not as run", async () => {
    stubApi({ status: 201, body: { success: false, requiresConfirmation: true, confirmationId: "conf_1", reason: "Confirm it" } });
    render(<ApprovedActionsQueue businessId={BIZ} items={[APPROVED]} />);

    fireEvent.click(screen.getByRole("button", { name: `Run ${APPROVED.title}` }));

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
