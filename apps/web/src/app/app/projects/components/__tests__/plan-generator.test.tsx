/**
 * PR196-PROJECTS-WEB (F10b, D-85; WPD-12, WPD-14, WPD-15, WPD-16): the saved
 * project plans list in the Plans tab.
 *
 * WHY: PR #196 listed the business's plans under the generator with an Approve
 * button on every plan that was not materialized or rejected and a Delete on
 * every plan, materialized ones included, with no pending state, no
 * confirmation and every error swallowed (`void approve(...)`). A double click
 * made two Projects; a delete of a materialized plan dropped its provenance.
 * The budget was printed with a hard-coded '$', a zero duration rendered "0",
 * and "N events" counted a list the server caps at 3.
 *
 * The server now holds the rules (PR196-PROJECTS-SERVER, D-85): approve is a
 * compare-and-set from any status but approved/materialized while the plan has
 * no project (409 after); delete is for a draft plan with no project (409
 * otherwise); both need the OWNER, an ADMIN or projects:write (403 otherwise).
 *
 * Required here: Approve shows only where the server can approve and Delete
 * only on a draft without a project; Approve sends one request however often
 * it is clicked; Delete asks for confirmation; a 409 says why and reloads the
 * list; a 403 says who may and withdraws both actions; the budget is in the
 * business currency; no event count from the capped list.
 *
 * Rendered for real on lib/project-plans-api.ts and lib/api.ts; only `fetch`
 * and the router are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { PlanGenerator } from "../plan-generator";
import { setCachedBusiness } from "@/lib/workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/projects",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const BIZ = "biz_wpd12";

function plan(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    userIdea: `Idea ${id}`,
    strategySummary: `Summary ${id}`,
    estimatedTotalHours: 20,
    estimatedBudget: 2500,
    estimatedPeople: 2,
    estimatedDurationDays: 14,
    riskAnalysis: null,
    swotAnalysis: null,
    goalId: null,
    goal: null,
    projectId: null,
    project: null,
    timelineEvents: [
      { id: `${id}_e1`, sortOrder: 0 },
      { id: `${id}_e2`, sortOrder: 1 },
      { id: `${id}_e3`, sortOrder: 2 },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

const DRAFT = plan("pl_draft", "draft");
const REVIEWING = plan("pl_review", "reviewing");
const MATERIALIZED = plan("pl_done", "materialized", { projectId: "proj_1", project: { id: "proj_1", name: "Done", status: "ACTIVE" } });
const APPROVED = plan("pl_held", "approved");
const PLANS = [DRAFT, REVIEWING, MATERIALIZED, APPROVED];

interface Sent { method: string; path: string }

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
  plans?: () => unknown[];
  approve?: (planId: string) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
  remove?: (planId: string) => { status: number; body: unknown };
}

function stubApi(options: StubOptions = {}) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push({ method, path: pathname });
    if (method === "GET" && pathname === `/projects/businesses/${BIZ}/plans`) return jsonResponse(200, options.plans ? options.plans() : PLANS);
    const approve = pathname.match(new RegExp(`^/projects/businesses/${BIZ}/plans/([^/]+)/approve$`));
    if (method === "POST" && approve) {
      const answer = options.approve ? await options.approve(approve[1]) : { status: 201, body: { id: "proj_new", name: "New project" } };
      return jsonResponse(answer.status, answer.body, answer.status >= 400 ? "Error" : "Created");
    }
    const remove = pathname.match(new RegExp(`^/projects/businesses/${BIZ}/plans/([^/]+)$`));
    if (method === "DELETE" && remove) {
      const answer = options.remove ? options.remove(remove[1]) : { status: 200, body: { deleted: true } };
      return jsonResponse(answer.status, answer.body, answer.status >= 400 ? "Error" : "OK");
    }
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    sent,
    approves: () => sent.filter((r) => r.method === "POST" && r.path.endsWith("/approve")),
    deletes: () => sent.filter((r) => r.method === "DELETE"),
    listReads: () => sent.filter((r) => r.method === "GET" && r.path.endsWith("/plans")),
  };
}

/** The card of a saved plan, found by its idea. */
async function card(id: string): Promise<HTMLElement> {
  const title = await screen.findByText(`Idea ${id}`);
  const el = title.closest("[data-plan-id]") as HTMLElement | null;
  if (!el) throw new Error(`no card for ${id}`);
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", "tok_wpd12");
  window.localStorage.setItem("kf_business_id", BIZ);
  setCachedBusiness({ id: BIZ, name: "WPD Ltd", currency: "TTD" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the saved plans list shows Approve and Delete only where the server allows them (D-85)", () => {
  it("lists the business's saved plans", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    for (const p of PLANS) expect(await screen.findByText(`Idea ${p.id}`)).toBeInTheDocument();
  });

  it("Approve on a draft and a reviewing plan; not on a materialized plan or one an approve holds", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    expect(within(await card("pl_draft")).getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(within(await card("pl_review")).getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(within(await card("pl_done")).queryByRole("button", { name: /approve/i })).toBeNull();
    expect(within(await card("pl_held")).queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("Delete only on a draft without a project (WPD-14)", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    expect(within(await card("pl_draft")).getByRole("button", { name: /delete/i })).toBeInTheDocument();
    for (const id of ["pl_review", "pl_done", "pl_held"]) {
      expect(within(await card(id)).queryByRole("button", { name: /delete/i }), id).toBeNull();
    }
  });

  it("each plan opens its own detail page", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const open = within(await card("pl_draft")).getByRole("link", { name: /open/i });
    expect(open.getAttribute("href")).toBe("/app/projects/plans/pl_draft");
  });
});

describe("Approve (WPD-12)", () => {
  it("sends one request however often it is clicked while pending", async () => {
    let release: (v: { status: number; body: unknown }) => void = () => {};
    const api = stubApi({ approve: () => new Promise((r) => { release = r; }) });
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const button = within(await card("pl_draft")).getByRole("button", { name: /approve/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.approves()).toHaveLength(1));
    expect(button).toBeDisabled();
    await act(async () => { release({ status: 201, body: { id: "proj_new", name: "New project" } }); });
    await waitFor(() => expect(within(screen.getByText("Idea pl_draft").closest("[data-plan-id]") as HTMLElement).queryByRole("button", { name: /approve/i })).toBeNull());
    expect(api.approves()).toHaveLength(1);
  });

  it("an approved plan tells the page a project was created", async () => {
    stubApi();
    const onPlanApproved = vi.fn();
    render(<PlanGenerator businessId={BIZ} goals={[]} onPlanApproved={onPlanApproved} />);
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(onPlanApproved).toHaveBeenCalledTimes(1));
  });

  it("a 409 says the plan was already approved and reloads the list", async () => {
    const api = stubApi({ approve: () => ({ status: 409, body: { statusCode: 409, message: "This plan has already been approved; a plan is approved once" } }) });
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const reviewing = await card("pl_review");
    const before = api.listReads().length;
    fireEvent.click(within(reviewing).getByRole("button", { name: /approve/i }));
    expect(await within(await card("pl_review")).findByRole("alert")).toHaveTextContent(/already been approved/);
    await waitFor(() => expect(api.listReads().length).toBeGreaterThan(before));
  });

  it("a 403 says who may approve and withdraws Approve and Delete", async () => {
    stubApi({
      approve: () => ({ status: 403, body: { statusCode: 403, message: "Insufficient permissions: approving or deleting a project plan needs the owner, an admin or projects write access (you have read)" } }),
    });
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /approve/i }));
    expect(await within(await card("pl_draft")).findByRole("alert")).toHaveTextContent(/owner, an admin or projects write access/);
    expect(screen.queryAllByRole("button", { name: /approve/i })).toEqual([]);
    expect(screen.queryAllByRole("button", { name: /delete/i })).toEqual([]);
  });
});

describe("Delete (WPD-14)", () => {
  it("asks for confirmation, then deletes", async () => {
    const api = stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /delete/i }));
    expect(api.deletes()).toHaveLength(0);
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(api.deletes()).toEqual([{ method: "DELETE", path: `/projects/businesses/${BIZ}/plans/pl_draft` }]));
    await waitFor(() => expect(screen.queryByText("Idea pl_draft")).toBeNull());
  });

  it("a 409 keeps the plan and says why", async () => {
    stubApi({ remove: () => ({ status: 409, body: { statusCode: 409, message: "Only a draft plan can be deleted; this plan is reviewing" } }) });
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /delete/i }));
    fireEvent.click(within(await card("pl_draft")).getByRole("button", { name: /confirm delete/i }));
    expect(await within(await card("pl_draft")).findByRole("alert")).toHaveTextContent(/Only a draft plan can be deleted/);
    expect(screen.getByText("Idea pl_draft")).toBeInTheDocument();
  });
});

describe("plan facts (WPD-15, WPD-16)", () => {
  it("the budget is in the business currency, not '$'", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const draft = await card("pl_draft");
    expect(draft.textContent).toContain("TTD 2,500.00");
    expect(draft.textContent).not.toContain("$");
  });

  it("a zero duration does not render a stray '0'", async () => {
    stubApi({ plans: () => [plan("pl_zero", "draft", { estimatedDurationDays: 0, estimatedBudget: null })] });
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const zero = await card("pl_zero");
    expect(zero.textContent).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it("no event count is taken from the list, which carries at most 3 events per plan", async () => {
    stubApi();
    render(<PlanGenerator businessId={BIZ} goals={[]} />);
    const draft = await card("pl_draft");
    expect(draft.textContent).not.toMatch(/\d+ events?/);
  });
});
