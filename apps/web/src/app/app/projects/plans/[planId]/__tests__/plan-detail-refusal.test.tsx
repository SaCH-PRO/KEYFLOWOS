/**
 * SWEEP-P0-SCOPES second review repair (finding CRV-2, minor): the plan detail page never shows a plan
 * write the server refused as done.
 *
 * This packet gated the plan event writes to projects write (reorder, analyze-impact, execute,
 * complete, reject; membership-only at base; approve and delete follow D-85). A member with projects
 * read gets 403 "Insufficient permissions: projects requires write access (you have read)". The api
 * client answers a refusal as { data: null, error } and does not throw, so:
 *   - PlanTimeline put the dragged order on screen first, and the page's onReorder dropped
 *     reorderEvents' error: a refused reorder stayed displayed as applied, with no word;
 *   - execute and complete reloaded the page with no message; Reject and Delete went back to the
 *     plans list as if the plan had been rejected or deleted; Approve did nothing.
 *
 * Required: a refused write shows the server's refusal (toast.error) and leaves the page as the
 * server holds it: a refused reorder puts the events back in their order and asks for no impact
 * analysis; a refused reject or delete stays on the plan.
 *
 * dnd-kit's sensors measure layout, which jsdom does not do, so the drag is driven through
 * DndContext's onDragEnd (as task-kanban.test.tsx does). The network is a fetch stub.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";

const REFUSAL = "Insufficient permissions: projects requires write access (you have read)";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/projects/plans/p1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ planId: "p1" }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/lib/workspace", async (orig) => ({ ...(await orig<object>()), getStoredBusinessId: () => "biz_1" }));

const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => unknown) }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dnd.onDragEnd = (props.onDragEnd as unknown as (event: unknown) => unknown) ?? null;
      return createElement(actual.DndContext, props);
    },
  };
});

function event(id: string, title: string, sortOrder: number, executionContext: "IN_APP" | "OUT_APP") {
  return {
    id, planId: "p1", title, description: null, eventType: "task", executionContext, status: "pending", sortOrder,
    autoExecute: false, estimatedHours: null, estimatedCost: null, requiredRoles: [], dependsOn: [],
  };
}

function plan(status: string) {
  return {
    id: "p1", businessId: "biz_1", userIdea: "Open a second shop", status,
    estimatedTotalHours: 10, estimatedBudget: null, estimatedPeople: null, estimatedDurationDays: null,
    strategySummary: "", riskAnalysis: null, swotAnalysis: null,
    timelineEvents: [event("e1", "First step", 1, "IN_APP"), event("e2", "Second step", 2, "OUT_APP")],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Forbidden" : "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text),
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

function stub(planStatus: string, sent: string[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push(`${method} ${new URL(url, "http://localhost").pathname}`);
    if (method !== "GET") return jsonResponse(403, { statusCode: 403, message: REFUSAL, error: "Forbidden" });
    return jsonResponse(200, plan(planStatus));
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  router.push.mockClear();
  dnd.onDragEnd = null;
});

async function renderPage(planStatus: string, sent: string[]) {
  stub(planStatus, sent);
  const Page = (await import("../page")).default;
  render(<Page />);
  await screen.findByText("First step");
}

const order = () => screen.getAllByText(/^(First|Second) step$/).map((el) => el.textContent);

describe("plan detail: refused plan writes", () => {
  it("[WEB-PLAN-01] RED-BEFORE: a refused reorder shows the server's refusal, puts the events back in their order and asks for no impact analysis", async () => {
    const sent: string[] = [];
    await renderPage("materialized", sent);
    expect(order()).toEqual(["First step", "Second step"]);
    await act(async () => {
      await dnd.onDragEnd!({ active: { id: "e2" }, over: { id: "e1" } });
    });
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans/p1/events/reorder"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(order()).toEqual(["First step", "Second step"]);
    expect(sent.some((s) => s.includes("analyze-impact"))).toBe(false);
  });

  it("[WEB-PLAN-02] RED-BEFORE: a refused execute and a refused mark-complete show the server's refusal", async () => {
    const sent: string[] = [];
    await renderPage("materialized", sent);
    fireEvent.click(screen.getByTitle("Execute now"));
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans/p1/events/e1/execute"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByTitle("Mark complete"));
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans/p1/events/e2/complete"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
  });

  it("[WEB-PLAN-03] RED-BEFORE: a refused Reject or Delete shows the server's refusal and stays on the plan; a refused Approve says why", async () => {
    const sent: string[] = [];
    await renderPage("draft", sent);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans/p1/reject"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(router.push).not.toHaveBeenCalled();
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(sent).toContain("DELETE /projects/businesses/biz_1/plans/p1"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(router.push).not.toHaveBeenCalled();
    vi.mocked(toast.error).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(sent).toContain("POST /projects/businesses/biz_1/plans/p1/approve"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
  });
});
