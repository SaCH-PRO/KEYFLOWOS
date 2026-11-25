/**
 * V1-65 (SWP-FIN-OVERVIEW-TRUTH, web half; owner rulings D-144, D-156, D-100): the payroll reserve line on
 * Money > Overview (/app/financial-flow), with Discard.
 *
 * DRAFT and APPROVED payroll runs are reserved in safe-to-spend (D-144; SafeToSpendService), and the Payroll page is
 * hidden in v1 (D-156), so a run reserved by mistake held the money back with no way out. The Overview says so with
 * the amount, lists each reserving run, and offers Discard where TOF-PAYROLL-DISCARD's route
 * (POST /payroll/businesses/:b/runs/:r/discard, operations write; PayrollService.discardRun) would accept it: an
 * unposted DRAFT run, or an unposted DRAFT/APPROVED run in a currency other than the business's. It answers 409 for a
 * PAID, VOID or posted run and for an APPROVED run in the business currency.
 *
 *   PRD-01  RED-BEFORE  a DRAFT run that safe-to-spend reserves is said with the reserved amount, in the business
 *                       currency, and offers Discard to a member with operations write
 *   PRD-02  RED-BEFORE  Discard asks for a reason and a confirm; Cancel sends nothing; confirming POSTs the reason to
 *                       the discard route, then safe-to-spend and the runs are read again: the run is gone and Safe to
 *                       Spend rises by its amount
 *   PRD-03  RED-BEFORE  the reason is required: the confirm cannot be pressed without one
 *   PRD-04  RED-BEFORE  the server's 409 is said in its own words; the run stays, nothing claims it was discarded
 *   PRD-05  RED-BEFORE  only DRAFT and APPROVED runs are read; a PAID run is never offered Discard; an APPROVED run
 *                       in the business currency is listed without Discard (the server refuses it, 409); an APPROVED
 *                       run in another currency is listed apart, not counted in Safe to Spend, with Discard
 *   PRD-06  RED-BEFORE  a member with operations read (no write) sees the line and the run, without Discard
 *   PRD-07  control     a member the server refuses revenue read sees no reserve line and no run amount (D-100)
 *   PRD-08  RED-BEFORE  my-access unknown (the read failed): the line shows, and the destructive Discard is not offered
 *   PRD-09  control     no DRAFT or APPROVED run and nothing reserved: no line
 *
 * Mounted on the real page and the real api client (lib/api.ts, lib/api/payroll.ts, lib/api/finance.ts); only
 * `fetch`, next/navigation and the stored business are stubbed. The stub is a small stateful server: safe-to-spend
 * reserves the DRAFT and APPROVED runs in the business currency, as SafeToSpendService does.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/financial-flow",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => "biz_prd",
}));

import FinancialFlowPage from "../page";

const BIZ = "biz_prd";
const FIN = `/finance/businesses/${BIZ}`;
const PAY = `/payroll/businesses/${BIZ}`;

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

interface Run { id: string; periodStart: string; periodEnd: string; status: string; totalGross: number; currency: string; itemCount: number }

const run = (id: string, status: string, totalGross: number, currency = "TTD", start = "2026-11-01", end = "2026-11-15"): Run => ({
  id, status, totalGross, currency, itemCount: 2, periodStart: `${start}T00:00:00.000Z`, periodEnd: `${end}T00:00:00.000Z`,
});

const DRAFT = run("run_draft", "DRAFT", 1_250.5);
const PAID = run("run_paid", "PAID", 900, "TTD", "2026-10-01", "2026-10-15");
const APPROVED_TTD = run("run_appr", "APPROVED", 2_000, "TTD", "2026-10-16", "2026-10-31");
const APPROVED_USD = run("run_usd", "APPROVED", 300, "USD", "2026-09-01", "2026-09-15");

const FORECAST = { days: 90, expected: 1, conservative: 1, optimistic: 1, dangerDate: null, recommendations: [] };
const OVERVIEW = { cashBalance: 10_000, outstandingInvoices: 0, overdueInvoices: 0, billsDue: 0, taxReserved: 0, netProfitThisMonth: 0, currency: "TTD" };
const REVENUE_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

interface Opts {
  runs: Run[];
  /** my-access modules; null answers 503 (unknown). */
  modules?: Record<string, string> | null;
  /** safe-to-spend refused with ModuleScopeGuard's revenue refusal (a member without revenue read). */
  revenueRefused?: boolean;
  /** The discard route's answer; by default the server's rule (PayrollService.discardRun). */
  discard?: (r: Run | undefined) => Response;
}

function stubServer(opts: Opts) {
  const runs = opts.runs.map((r) => ({ ...r }));
  const calls: { method: string; pathname: string; search: string; body?: unknown }[] = [];
  const safe = () => {
    const committed = runs.filter((r) => r.status === "DRAFT" || r.status === "APPROVED");
    const payrollReserved = committed.filter((r) => r.currency === "TTD").reduce((s, r) => s + r.totalGross, 0);
    const otherCurrencyPayroll = committed.filter((r) => r.currency !== "TTD").map((r) => ({ currency: r.currency, amount: r.totalGross }));
    return {
      safeToSpend: Math.round((5_000 - payrollReserved) * 100) / 100,
      cashBalance: 10_000, cashBasis: "ledger", otherCurrencyCash: [], otherCurrencyPayroll,
      taxReserved: 0, billsDueNext30Days: 0, payrollReserved, debtPaymentsDue: 0, operatingBuffer: 5_000, otherReserves: 0,
      currency: "TTD", explanation: [],
    };
  };
  const serverDiscard = (r: Run | undefined): Response => {
    if (!r) return jsonResponse(404, { statusCode: 404, message: "Payroll run not found", error: "Not Found" }, "Not Found");
    if (r.status === "PAID") return jsonResponse(409, { statusCode: 409, message: `Paid payroll run ${r.id} cannot be discarded`, error: "Conflict" }, "Conflict");
    if (r.status === "APPROVED" && r.currency === "TTD") {
      return jsonResponse(409, { statusCode: 409, message: `Payroll run ${r.id} is APPROVED in TTD; only DRAFT runs or unposted runs in a non-business currency can be discarded (D-144)`, error: "Conflict" }, "Conflict");
    }
    r.status = "VOID";
    return jsonResponse(201, { ...r, discardReason: "x" }, "Created");
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname, search, searchParams } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname, search, body });
    if (method === "GET" && pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) {
      return opts.modules === null
        ? jsonResponse(503, { statusCode: 503, message: "Service Unavailable" }, "Service Unavailable")
        : jsonResponse(200, { modules: opts.modules ?? { revenue: "admin", operations: "admin", expenses: "admin" } });
    }
    if (method === "GET" && pathname.endsWith(`${PAY}/runs`)) {
      const status = searchParams.get("status");
      return jsonResponse(200, runs.filter((r) => !status || r.status === status));
    }
    const discard = new RegExp(`${PAY}/runs/([^/]+)/discard$`).exec(pathname);
    if (method === "POST" && discard) {
      const target = runs.find((r) => r.id === discard[1]);
      return (opts.discard ?? serverDiscard)(target);
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/safe-to-spend`)) {
      return opts.revenueRefused
        ? jsonResponse(403, { statusCode: 403, message: REVENUE_REFUSAL, error: "Forbidden" }, "Forbidden")
        : jsonResponse(200, safe());
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/overview`)) {
      return opts.revenueRefused
        ? jsonResponse(403, { statusCode: 403, message: REVENUE_REFUSAL, error: "Forbidden" }, "Forbidden")
        : jsonResponse(200, OVERVIEW);
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/cashflow-forecast`)) return jsonResponse(200, FORECAST);
    if (method === "GET" && pathname.endsWith(`${FIN}/reserves`)) return jsonResponse(200, { items: [] });
    return jsonResponse(200, { items: [] });
  }));
  return {
    calls,
    discards: () => calls.filter((c) => c.method === "POST" && c.pathname.includes("/discard")),
    reads: (suffix: string) => calls.filter((c) => c.method === "GET" && c.pathname.endsWith(suffix)).length,
  };
}

/** The Safe to Spend metric card's text (the page's headline figure). */
function safeMetric(): string {
  const card = [...document.querySelectorAll(".kf-card-metric")].find((el) => /Safe to Spend/.test(el.textContent ?? ""));
  return (card?.textContent ?? "").replace(/\s+/g, " ");
}

const reserveLine = () => screen.findByRole("region", { name: /payroll reserve/i });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("V1-65 Money > Overview: the payroll reserve line with Discard (D-144)", () => {
  it("PRD-01 RED-BEFORE: a reserving DRAFT run is said with the reserved amount and offers Discard", async () => {
    stubServer({ runs: [DRAFT] });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    // The reserved amount, in the business currency, as safe-to-spend states it.
    expect(within(line).getByText(/TTD 1,250\.50/, { selector: "strong" })).toBeInTheDocument();
    const item = within(line).getByRole("listitem");
    expect(item).toHaveTextContent(/draft/i);
    expect(item).toHaveTextContent("2026-11-01 to 2026-11-15");
    expect(item).toHaveTextContent("TTD 1,250.50");
    await waitFor(() => expect(within(item).getByRole("button", { name: /discard/i })).toBeInTheDocument());
  });

  it("PRD-02 RED-BEFORE: Discard asks a reason and a confirm, posts it, and Safe to Spend rises by the run's amount", async () => {
    const server = stubServer({ runs: [DRAFT] });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 3,749\.5\b/));

    // Cancel sends nothing.
    fireEvent.click(await within(line).findByRole("button", { name: /discard/i }));
    let dialog = await screen.findByRole("dialog", { name: /discard payroll run/i });
    expect(dialog).toHaveTextContent("2026-11-01 to 2026-11-15");
    expect(dialog).toHaveTextContent("TTD 1,250.50");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /discard payroll run/i })).not.toBeInTheDocument());
    expect(server.discards()).toHaveLength(0);

    const safeReadsBefore = server.reads(`${FIN}/safe-to-spend`);
    const runReadsBefore = server.reads(`${PAY}/runs`);
    fireEvent.click(within(line).getByRole("button", { name: /discard/i }));
    dialog = await screen.findByRole("dialog", { name: /discard payroll run/i });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /reason/i }), { target: { value: "Created by mistake" } });
    expect(server.discards()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: /^discard run$/i }));

    await waitFor(() => expect(server.discards()).toHaveLength(1));
    expect(server.discards()[0].pathname).toMatch(new RegExp(`${PAY}/runs/run_draft/discard$`));
    expect(server.discards()[0].body).toEqual({ reason: "Created by mistake" });

    // Read again after the discard: the run is no longer reserved and Safe to Spend rises by 1,250.50 (3,749.50 -> 5,000).
    await waitFor(() => expect(server.reads(`${FIN}/safe-to-spend`)).toBeGreaterThan(safeReadsBefore));
    await waitFor(() => expect(server.reads(`${PAY}/runs`)).toBeGreaterThan(runReadsBefore));
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 5,000\b/));
    await waitFor(() => expect(screen.queryByRole("region", { name: /payroll reserve/i })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: /discard payroll run/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/discarded/i);
  });

  it("PRD-03 RED-BEFORE: the reason is required before the discard can be confirmed", async () => {
    const server = stubServer({ runs: [DRAFT] });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    fireEvent.click(await within(line).findByRole("button", { name: /discard/i }));
    const dialog = await screen.findByRole("dialog", { name: /discard payroll run/i });
    const confirm = within(dialog).getByRole("button", { name: /^discard run$/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /reason/i }), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(server.discards()).toHaveLength(0);
  });

  it("PRD-04 RED-BEFORE: the server's 409 is said in its own words, and the run stays reserved", async () => {
    const POSTED = "Posted payroll run run_draft cannot be discarded";
    const server = stubServer({
      runs: [DRAFT],
      discard: () => jsonResponse(409, { statusCode: 409, message: POSTED, error: "Conflict" }, "Conflict"),
    });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    fireEvent.click(await within(line).findByRole("button", { name: /discard/i }));
    const dialog = await screen.findByRole("dialog", { name: /discard payroll run/i });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /reason/i }), { target: { value: "Duplicate" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^discard run$/i }));

    await waitFor(() => expect(server.discards()).toHaveLength(1));
    expect(await screen.findByText(new RegExp(POSTED))).toBeInTheDocument();
    expect(screen.queryByText(/discarded\.|was discarded|has been discarded/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const still = await reserveLine();
    expect(within(still).getByRole("listitem")).toHaveTextContent("TTD 1,250.50");
    expect(safeMetric()).toMatch(/TTD 3,749\.5\b/);
  });

  it("PRD-05 RED-BEFORE: only DRAFT and APPROVED runs are read; PAID never gets Discard; APPROVED in the business currency has none", async () => {
    const server = stubServer({ runs: [DRAFT, PAID, APPROVED_TTD, APPROVED_USD] });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    await waitFor(() => expect(within(line).getAllByRole("listitem")).toHaveLength(3));
    // Reserved in TTD: the DRAFT and the APPROVED TTD run, 3,250.50.
    expect(within(line).getByText(/TTD 3,250\.50/, { selector: "strong" })).toBeInTheDocument();

    const runReads = server.calls.filter((c) => c.method === "GET" && c.pathname.endsWith(`${PAY}/runs`));
    expect(runReads.length).toBeGreaterThan(0);
    for (const c of runReads) expect(new URLSearchParams(c.search).get("status")).toMatch(/^(DRAFT|APPROVED)$/);

    // The PAID run is not listed and offers nothing.
    expect(line).not.toHaveTextContent("2026-10-01 to 2026-10-15");
    expect(screen.queryByRole("button", { name: /2026-10-01 to 2026-10-15/ })).not.toBeInTheDocument();

    const items = within(line).getAllByRole("listitem");
    const approvedTtd = items.find((li) => li.textContent?.includes("2026-10-16 to 2026-10-31"))!;
    const approvedUsd = items.find((li) => li.textContent?.includes("2026-09-01 to 2026-09-15"))!;
    const draft = items.find((li) => li.textContent?.includes("2026-11-01 to 2026-11-15"))!;
    await waitFor(() => expect(within(draft).getByRole("button", { name: /discard/i })).toBeInTheDocument());
    expect(approvedTtd).toHaveTextContent(/approved/i);
    expect(within(approvedTtd).queryByRole("button", { name: /discard/i })).not.toBeInTheDocument();
    expect(approvedUsd).toHaveTextContent("USD 300.00");
    expect(approvedUsd).toHaveTextContent(/not counted in safe to spend/i);
    expect(within(approvedUsd).getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("PRD-06 RED-BEFORE: a member with operations read (no write) sees the line and the run without Discard", async () => {
    stubServer({ runs: [DRAFT], modules: { revenue: "read", operations: "read" } });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    expect(within(line).getByRole("listitem")).toHaveTextContent("TTD 1,250.50");
    // Give my-access time to land, then: no Discard anywhere.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("PRD-07 control: a member refused revenue read sees no reserve line and no run amount (D-100)", async () => {
    stubServer({ runs: [DRAFT], modules: { revenue: "none", operations: "admin" }, revenueRefused: true });
    render(<FinancialFlowPage />);
    await screen.findByText(/Some data failed to load/);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: /payroll reserve/i })).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/1,250\.5/);
    expect(screen.queryByRole("button", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("PRD-08 RED-BEFORE: when the member's access cannot be read, the line shows without Discard", async () => {
    stubServer({ runs: [DRAFT], modules: null });
    render(<FinancialFlowPage />);
    const line = await reserveLine();
    expect(within(line).getByRole("listitem")).toHaveTextContent("TTD 1,250.50");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("PRD-09 control: with no DRAFT or APPROVED run, no reserve line", async () => {
    stubServer({ runs: [PAID] });
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 5,000\b/));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: /payroll reserve/i })).not.toBeInTheDocument();
  });
});
