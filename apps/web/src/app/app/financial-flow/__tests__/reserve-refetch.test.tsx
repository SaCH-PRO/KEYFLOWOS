/**
 * V1-65 (SWP-FIN-OVERVIEW-TRUTH, web half; journeys H, I): Safe to Spend refreshes after a reserve change.
 *
 * Safe to Spend subtracts the active reserve buckets (SafeToSpendService: otherReserves). The Financial Flow page
 * created or deleted a bucket and changed only its own bucket list: the Safe to Spend figure (the metric card and the
 * breakdown) kept the figure read before the change until a reload. A delete the server refused still dropped the
 * bucket from the list, and a refused create said nothing.
 *
 *   RR-01  RED-BEFORE  adding a bucket reads safe-to-spend again and shows the server's new figure
 *   RR-02  RED-BEFORE  deleting a bucket reads safe-to-spend again and shows the server's new figure
 *   RR-03  RED-BEFORE  a refused delete keeps the bucket, says the server's words, and claims no new figure
 *   RR-04  RED-BEFORE  a refused create says the server's words
 *
 * Repair round 1 (review COR-FO-1, COR-FO-4), RED at cfa1d960:
 *   RACE-01  two quick deletes: the second re-read is a fresh read, not one joined to the first re-read still in
 *            flight (lib/api coalesces identical GETs), so Safe to Spend ends at the server's 1,000, not 900
 *   RACE-02  a bucket added while the page's first load is in flight: the figure and the list are the server's after
 *            the add, not the load's older answers
 *   RACE-03  a re-read that fails while the load is still running: the load's own errors are merged with it, not
 *            written over it, and Safe to Spend shows no figure (not the old one, not TTD 0)
 *
 * Mounted on the real page and the real api client (lib/api.ts, lib/api/finance.ts); only `fetch`,
 * next/navigation and the stored business are stubbed. The stub is a small stateful server: safe-to-spend is
 * 1,000 less the active buckets, as SafeToSpendService computes it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
  getStoredBusinessId: () => "biz_rr",
}));

import FinancialFlowPage from "../page";

const FIN = "/finance/businesses/biz_rr";

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

const OVERVIEW = { cashBalance: 1_000, outstandingInvoices: 0, overdueInvoices: 0, billsDue: 0, taxReserved: 0, netProfitThisMonth: 0, currency: "TTD" };
const FORECAST = { days: 90, expected: 1_000, conservative: 900, optimistic: 1_100, dangerDate: null, recommendations: [] };

interface Bucket { id: string; name: string; purpose: string; targetAmount: number | null; currentAmount: number; currency: string; status: string; createdAt: string }

/** A stateful server: the buckets, and safe-to-spend computed from them on every read. */
const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface StubOpts {
  buckets?: Bucket[];
  deleteAnswer?: () => Response;
  createAnswer?: () => Response;
  /** Each safe-to-spend and reserves GET is answered with the state at the moment it is read, this many ms later. */
  readDelayMs?: number;
  /** A DELETE of this bucket commits after commitMs and answers after returnMs. */
  deleteTiming?: Record<string, { commitMs: number; returnMs: number }>;
  /** The cashflow forecast answers this status after this many ms. */
  forecast?: { delayMs: number; status: number };
  /** Safe-to-spend reads after the first `n` answer 500. */
  safeFailsAfter?: number;
}

function stubServer(opts: StubOpts = {}) {
  const buckets: Bucket[] = (opts.buckets ?? []).map((b) => ({ ...b }));
  const calls: { method: string; pathname: string; body?: unknown }[] = [];
  /** The figure each safe-to-spend read was answered with, as read. */
  const safeAnswers: number[] = [];
  const safe = () => {
    const otherReserves = buckets.filter((b) => b.status === "ACTIVE").reduce((s, b) => s + b.currentAmount, 0);
    return { safeToSpend: 1_000 - otherReserves, cashBalance: 1_000, taxReserved: 0, billsDueNext30Days: 0, payrollReserved: 0, operatingBuffer: 0, otherReserves, currency: "TTD" };
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname, body });
    if (method === "GET" && pathname.endsWith(`${FIN}/reserves`)) {
      const items = buckets.filter((b) => b.status === "ACTIVE").map((b) => ({ ...b }));
      if (opts.readDelayMs) await later(opts.readDelayMs);
      return jsonResponse(200, { items });
    }
    if (method === "POST" && pathname.endsWith(`${FIN}/reserves`)) {
      if (opts.createAnswer) return opts.createAnswer();
      const b = body as { name: string; purpose: string; targetAmount?: number; currentAmount?: number };
      const created: Bucket = { id: `rb_${buckets.length + 1}`, name: b.name, purpose: b.purpose, targetAmount: b.targetAmount ?? null, currentAmount: b.currentAmount ?? 0, currency: "TTD", status: "ACTIVE", createdAt: "2026-11-25T00:00:00.000Z" };
      buckets.push(created);
      return jsonResponse(201, created, "Created");
    }
    const del = /\/reserves\/([^/]+)$/.exec(pathname);
    if (method === "DELETE" && del) {
      if (opts.deleteAnswer) return opts.deleteAnswer();
      const timing = opts.deleteTiming?.[del[1]];
      if (timing) await later(timing.commitMs);
      const b = buckets.find((x) => x.id === del[1]);
      if (b) b.status = "ARCHIVED";
      if (timing) await later(timing.returnMs - timing.commitMs);
      return jsonResponse(200, undefined);
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/overview`)) return jsonResponse(200, OVERVIEW);
    if (method === "GET" && pathname.endsWith(`${FIN}/safe-to-spend`)) {
      const n = calls.filter((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/safe-to-spend`)).length;
      const answer = safe();
      safeAnswers.push(answer.safeToSpend);
      if (opts.readDelayMs) await later(opts.readDelayMs);
      // 500, which lib/fetch-with-retry does not retry (a 503 is retried three times with backoff).
      if (opts.safeFailsAfter !== undefined && n > opts.safeFailsAfter) return jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error");
      return jsonResponse(200, answer);
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/cashflow-forecast`)) {
      if (opts.forecast) {
        await later(opts.forecast.delayMs);
        if (opts.forecast.status !== 200) return jsonResponse(opts.forecast.status, { statusCode: opts.forecast.status, message: "Internal server error" }, "Error");
      }
      return jsonResponse(200, FORECAST);
    }
    return jsonResponse(200, { items: [] });
  }));
  const safeReads = () => calls.filter((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/safe-to-spend`)).length;
  return { calls, safeReads, safeAnswers };
}

/** The Safe to Spend metric card's text (the page's headline figure). */
function safeMetric(): string {
  const card = [...document.querySelectorAll(".kf-card-metric")].find((el) => /Safe to Spend/.test(el.textContent ?? ""));
  return (card?.textContent ?? "").replace(/\s+/g, " ");
}

/** The bucket card's delete button, found structurally (it has no name at the base). */
function deleteButtonOf(name: string): HTMLButtonElement {
  return (screen.getByText(name).closest(".kf-card") as HTMLElement).querySelector("button") as HTMLButtonElement;
}

const RENT: Bucket = { id: "rb_rent", name: "Rent reserve", purpose: "Rent", targetAmount: null, currentAmount: 400, currency: "TTD", status: "ACTIVE", createdAt: "2026-11-01T00:00:00.000Z" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("V1-65 Financial Flow: Safe to Spend refreshes after a reserve change", () => {
  it("RR-01 RED-BEFORE: adding a reserve bucket reads safe-to-spend again and shows the new figure", async () => {
    const server = stubServer();
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 1,000\b/));
    const readsBefore = server.safeReads();

    fireEvent.click(screen.getAllByRole("button", { name: /add bucket/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Bucket name/), { target: { value: "Tax reserve" } });
    fireEvent.change(screen.getByPlaceholderText("Current amount"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    expect(await screen.findByText("Tax reserve")).toBeInTheDocument();
    // The server now answers 700 (1,000 less the 300 bucket): the page must have asked again and show it.
    await waitFor(() => expect(server.safeReads()).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 700\b/));
    expect(safeMetric()).not.toMatch(/TTD 1,000\b/);
  });

  it("RR-02 RED-BEFORE: deleting a reserve bucket reads safe-to-spend again and shows the new figure", async () => {
    const server = stubServer({ buckets: [RENT] });
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 600\b/));
    const readsBefore = server.safeReads();

    const card = (await screen.findByText("Rent reserve")).closest(".kf-card") as HTMLElement;
    fireEvent.click(card.querySelector("button") as HTMLButtonElement);

    await waitFor(() => expect(screen.queryByText("Rent reserve")).not.toBeInTheDocument());
    await waitFor(() => expect(server.safeReads()).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 1,000\b/));
  });

  it("RR-03 RED-BEFORE: a refused delete keeps the bucket and says the server's words", async () => {
    const REFUSAL = "Not a member of this business";
    stubServer({
      buckets: [RENT],
      deleteAnswer: () => jsonResponse(403, { statusCode: 403, message: REFUSAL, error: "Forbidden" }, "Forbidden"),
    });
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 600\b/));

    const card = (await screen.findByText("Rent reserve")).closest(".kf-card") as HTMLElement;
    fireEvent.click(card.querySelector("button") as HTMLButtonElement);

    expect(await screen.findByText(new RegExp(REFUSAL))).toBeInTheDocument();
    // The server kept it: so does the page, and the figure is the server's (600), not one the page made up.
    expect(screen.getByText("Rent reserve")).toBeInTheDocument();
    expect(safeMetric()).toMatch(/TTD 600\b/);
  });

  it("RR-04 RED-BEFORE: a refused create says the server's words and adds nothing", async () => {
    const REFUSAL = "name must be 100 characters or fewer";
    stubServer({ createAnswer: () => jsonResponse(400, { statusCode: 400, message: REFUSAL, error: "Bad Request" }, "Bad Request") });
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 1,000\b/));

    fireEvent.click(screen.getAllByRole("button", { name: /add bucket/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Bucket name/), { target: { value: "Tax reserve" } });
    fireEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    expect(await screen.findByText(new RegExp(REFUSAL))).toBeInTheDocument();
    expect(safeMetric()).toMatch(/TTD 1,000\b/);
  });

  it("RACE-01 RED-BEFORE: two quick deletes end on the server's figure, not on a re-read joined to the first", async () => {
    const A: Bucket = { ...RENT, id: "rb_a", name: "Bucket A", currentAmount: 400 };
    const B: Bucket = { ...RENT, id: "rb_b", name: "Bucket B", currentAmount: 100 };
    // Every read answers 150 ms after it reads; deleting B commits at 30 ms and answers at 40 ms, so B's re-read
    // starts while A's re-read (which read B still active: 900) is still in flight.
    const server = stubServer({ buckets: [A, B], readDelayMs: 150, deleteTiming: { rb_b: { commitMs: 30, returnMs: 40 } } });
    render(<FinancialFlowPage />);
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 500\b/), { timeout: 2_000 });

    fireEvent.click(deleteButtonOf("Bucket A"));
    await waitFor(() => expect(screen.queryByText("Bucket A")).not.toBeInTheDocument(), { interval: 5 });
    fireEvent.click(deleteButtonOf("Bucket B"));
    await waitFor(() => expect(screen.queryByText("Bucket B")).not.toBeInTheDocument(), { interval: 5 });

    // Both buckets are gone on the server: 1,000 is the figure, and the page must end on it.
    await waitFor(() => expect(server.safeAnswers).toContain(1_000), { timeout: 2_000 });
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 1,000\b/), { timeout: 2_000 });
    await later(400);
    expect(safeMetric()).toMatch(/TTD 1,000\b/);
  });

  it("RACE-02 RED-BEFORE: a bucket added while the first load is in flight: the figure and the list are the server's after the add", async () => {
    const server = stubServer({ readDelayMs: 300 });
    render(<FinancialFlowPage />);
    // The load's reads are in flight (they read 1,000 and no bucket); add a bucket of 300 now.
    fireEvent.click(screen.getAllByRole("button", { name: /add bucket/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Bucket name/), { target: { value: "Tax reserve" } });
    fireEvent.change(screen.getByPlaceholderText("Current amount"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    await waitFor(() => expect(server.safeAnswers).toContain(700), { timeout: 2_000 });
    await waitFor(() => expect(safeMetric()).toMatch(/TTD 700\b/), { timeout: 2_000 });
    await later(500);
    expect(safeMetric()).toMatch(/TTD 700\b/);
    expect(screen.getByText("Tax reserve")).toBeInTheDocument();
  });

  it("RACE-03 RED-BEFORE: a failed re-read during the load is merged with the load's errors, and no figure is shown for it", async () => {
    // The load's safe-to-spend read answers at once (1,000); its forecast fails 400 ms later. Every later
    // safe-to-spend read fails.
    stubServer({ forecast: { delayMs: 400, status: 500 }, safeFailsAfter: 1 });
    render(<FinancialFlowPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /add bucket/i })[0]);
    fireEvent.change(screen.getByPlaceholderText(/Bucket name/), { target: { value: "Tax reserve" } });
    fireEvent.change(screen.getByPlaceholderText("Current amount"), { target: { value: "300" } });
    await later(50);
    fireEvent.click(screen.getByRole("button", { name: /create bucket/i }));

    const banner = await screen.findByText(/Some data failed to load/, undefined, { timeout: 2_000 });
    await later(600);
    expect(banner.textContent).toMatch(/Forecast/);
    expect(banner.textContent).toMatch(/Safe-to-spend/);
    // The figure before the add is not current, and none is invented.
    expect(safeMetric()).not.toMatch(/TTD 1,000\b/);
    expect(safeMetric()).not.toMatch(/TTD 0\b/);
  });
});
