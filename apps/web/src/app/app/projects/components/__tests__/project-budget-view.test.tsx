/**
 * PR196-PROJECTS-WEB (WPD-03, WPD-04): the project budget view reads the budget
 * through the API client and shows it in the business currency.
 *
 * WHY: ProjectBudgetView called fetch(`/api/projects/businesses/.../budget`), a
 * URL relative to the web app. The web has no /api/projects route and no
 * rewrite for it, and no Authorization header was sent; the API lives at the
 * absolute NEXT_PUBLIC_API_BASE_URL (lib/api.ts). So the call got Next's HTML
 * 404, r.json() threw, and every project read "No budget set for this
 * project", including projects that have one. Amounts were printed with a
 * hard-coded '$' whatever the business currency (D-13: one currency per
 * business, TTD or USD). PR #196 mounted it in the Revenue tab as it was.
 *
 * Required: GET {API base}/projects/businesses/:bid/projects/:pid/budget with
 * the member's token; amounts in the business currency; a failed read is an
 * error state, not "No budget set"; the Revenue tab shows the view.
 *
 * Only `fetch` is stubbed: the component runs on the real lib/api transport.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ProjectBudgetView } from "../project-budget-view";
import { RevenueTab } from "../project-detail-tabs/revenue-tab";
import { setCachedBusiness } from "@/lib/workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/projects",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_wpd03";
const PROJECT = "proj_wpd03";
const TOKEN = "tok_wpd03";
const BUDGET_PATH = `/projects/businesses/${BIZ}/projects/${PROJECT}/budget`;

const BUDGET = {
  projectId: PROJECT,
  budgetAmount: 5000,
  budgetHours: 40,
  totalCost: 1250.5,
  timeCost: 1000.5,
  expenseCost: 250,
  trackedHours: 10,
  remainingBudget: 3749.5,
  percentUsed: 25,
  percentHoursUsed: 25,
  status: "HEALTHY",
};

interface Sent { url: string; method: string; auth: string | null }

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

function stubApi(budget: () => Response, expenses: () => Response = () => jsonResponse(200, { expenses: [] })) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    sent.push({ url, method: (init?.method ?? "GET").toUpperCase(), auth: headers.get("Authorization") });
    if (!/^https?:\/\//.test(url)) {
      // What Next answers for a path it has no route for: an HTML 404.
      return { ok: false, status: 404, statusText: "Not Found", headers: new Headers({ "content-type": "text/html" }), json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<!DOCTYPE html>" } as unknown as Response;
    }
    const { pathname } = new URL(url);
    if (pathname === BUDGET_PATH) return budget();
    if (pathname.endsWith(`/expenses`) || pathname.includes("/expenses")) return expenses();
    return jsonResponse(200, []);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, budgetCalls: () => sent.filter((s) => s.url.includes("/budget")) };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", TOKEN);
  window.localStorage.setItem("kf_business_id", BIZ);
  setCachedBusiness({ id: BIZ, name: "WPD Ltd", currency: "TTD" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProjectBudgetView reads the budget through the API client (WPD-03)", () => {
  it("GETs the API's budget route (absolute API base, the member's token), not a web-relative /api path", async () => {
    const api = stubApi(() => jsonResponse(200, BUDGET));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    await waitFor(() => expect(api.budgetCalls().length).toBeGreaterThan(0));
    const call = api.budgetCalls()[0];
    expect(call.url, "a web-relative URL reaches no API").toMatch(/^https?:\/\//);
    expect(new URL(call.url).pathname).toBe(BUDGET_PATH);
    expect(call.method).toBe("GET");
    expect(call.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("a project with a budget shows it, not 'No budget set'", async () => {
    stubApi(() => jsonResponse(200, BUDGET));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByText("TTD 5,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/No budget set/i)).toBeNull();
  });
});

describe("amounts are in the business currency (WPD-04, D-13)", () => {
  it("budget, spent, remaining and the cost totals carry the business currency and no '$'", async () => {
    stubApi(() => jsonResponse(200, BUDGET));
    const { container } = render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByText("TTD 5,000.00")).toBeInTheDocument();
    expect(screen.getByText("TTD 1,250.50")).toBeInTheDocument();
    expect(screen.getByText("TTD 3,749.50")).toBeInTheDocument();
    expect(screen.getByText("TTD 1,000.50")).toBeInTheDocument();
    expect(screen.getByText("TTD 250.00")).toBeInTheDocument();
    expect(container.textContent).not.toContain("$");
  });

  it("a USD business sees USD", async () => {
    setCachedBusiness({ id: BIZ, name: "WPD Ltd", currency: "USD" });
    stubApi(() => jsonResponse(200, BUDGET));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByText("USD 5,000.00")).toBeInTheDocument();
  });
});

describe("states", () => {
  it("a project without a budget says so", async () => {
    stubApi(() => jsonResponse(200, { ...BUDGET, budgetAmount: 0, remainingBudget: 0, percentUsed: 0 }));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByText(/No budget set/i)).toBeInTheDocument();
  });

  it("a refused read is an error, distinct from 'No budget set'", async () => {
    stubApi(() => jsonResponse(404, { statusCode: 404, message: "Project not found" }, "Not Found"));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load|couldn.t load/i);
    expect(screen.queryByText(/No budget set/i)).toBeNull();
  });
});

describe("the Revenue tab shows the project's budget (F7b)", () => {
  it("RevenueTab mounts the budget view for its project", async () => {
    const api = stubApi(() => jsonResponse(200, BUDGET));
    render(<RevenueTab businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByText("TTD 5,000.00")).toBeInTheDocument();
    expect(api.budgetCalls().map((c) => new URL(c.url).pathname)).toContain(BUDGET_PATH);
  });
});

/**
 * Review SEC-W196-2: GET .../projects/:pid/budget has only AuthGuard and BusinessGuard and returns
 * expenseCost, timeCost and totalCost, while the same tab's expense list (GET .../by-project)
 * needs expenses:read. A member with expenses:none was refused the list but shown the totals in
 * the budget card this packet mounts. The web half: a refused budget read (403) is a denial state,
 * and the Revenue tab shows the budget card's money only to a member the project's expense list
 * answers; one it refuses (403) sees the denial and the budget is not requested. The server half
 * (gating the route's cost fields on expenses read) landed with W9-PROJECTS-SERVER: see the pointer
 * at the end of this block.
 */
describe("a member refused the project's costs is not shown them (SEC-W196-2)", () => {
  it("a 403 on the budget read is a denial state with no amounts, distinct from 'No budget set'", async () => {
    stubApi(() => jsonResponse(403, { statusCode: 403, message: "Forbidden resource" }, "Forbidden"));
    render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/don.t have access/i);
    expect(screen.queryByText(/No budget set/i)).toBeNull();
    expect(screen.queryByText(/TTD/)).toBeNull();
  });

  it("the Revenue tab does not read or show the budget's costs to a member the expense list refuses (403)", async () => {
    const api = stubApi(
      () => jsonResponse(200, { ...BUDGET, expenseCost: 777, totalCost: 777, timeCost: 0, remainingBudget: 4223 }),
      () => jsonResponse(403, { statusCode: 403, message: "Forbidden resource" }, "Forbidden"),
    );
    render(<RevenueTab businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/don.t have access/i);
    expect(api.budgetCalls()).toEqual([]);
    expect(screen.queryByText(/777/)).toBeNull();
  });

  // The server half (was it.todo here) is proved by W9-PROJECTS-SERVER in
  // apps/server/test/projects-budget-assignee-scope.integration.test.ts ("SEC-W196-2 (was it.todo): ..."):
  // GET /projects/businesses/:bid/projects/:pid/budget serves expenseCost, timeCost and totalCost (and
  // remainingBudget, percentUsed, status) as null to a member without expenses read, the member the
  // project's expense list refuses, so the Revenue tab above never requests the budget for them.
});

/**
 * W9-PROJECTS-SERVER repair (review CR-W9PS-1; D-100's withholding rule): the budget route answers 200
 * with the costs withheld (null) to a member who does not read expenses. The view read
 * `data.status.replace(...)` and crashed ("Cannot read properties of null"), unmounting the whole
 * Revenue tab, which requests the budget whenever the expense list was not refused with a 403 (a 5xx
 * or a network failure on that list included). A withheld budget is the denial state.
 */
describe("a budget served with its costs withheld is the denial state, not a crash (CR-W9PS-1, D-100)", () => {
  const WITHHELD = {
    projectId: PROJECT,
    budgetAmount: 5000,
    budgetHours: 40,
    totalCost: null,
    timeCost: null,
    expenseCost: null,
    trackedHours: 10,
    remainingBudget: null,
    percentUsed: null,
    percentHoursUsed: 25,
    status: null,
  };

  it("CR-W9PS-1: ProjectBudgetView given the withheld budget shows the denial state and no amount", async () => {
    stubApi(() => jsonResponse(200, WITHHELD));
    const { container } = render(<ProjectBudgetView businessId={BIZ} projectId={PROJECT} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/don.t have access/i);
    expect(container.textContent).not.toMatch(/TTD|NaN|null/);
    expect(screen.queryByText(/No budget set/i)).toBeNull();
  });

  it.each([
    ["a 500 on the expense list", () => jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error")],
    ["a network failure on the expense list", () => { throw new TypeError("Failed to fetch"); }],
  ])("CR-W9PS-1: the Revenue tab stays mounted and shows the denial when %s leads it to request a withheld budget", async (_case, expenses) => {
    const api = stubApi(() => jsonResponse(200, WITHHELD), expenses as () => Response);
    render(<RevenueTab businessId={BIZ} projectId={PROJECT} />);
    // a network failure is retried with backoff (lib/fetch-with-retry) before the tab gives up on the list
    expect(await screen.findByText(/don.t have access/i, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(api.budgetCalls().map((c) => new URL(c.url).pathname)).toContain(BUDGET_PATH);
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(document.body.textContent?.trim().length).toBeGreaterThan(0);
  }, 15_000);
});
