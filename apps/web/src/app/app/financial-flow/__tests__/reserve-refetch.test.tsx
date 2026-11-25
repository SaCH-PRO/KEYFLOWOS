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
function stubServer(opts: { buckets?: Bucket[]; deleteAnswer?: () => Response; createAnswer?: () => Response } = {}) {
  const buckets: Bucket[] = (opts.buckets ?? []).map((b) => ({ ...b }));
  const calls: { method: string; pathname: string; body?: unknown }[] = [];
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
    if (method === "GET" && pathname.endsWith(`${FIN}/reserves`)) return jsonResponse(200, { items: buckets.filter((b) => b.status === "ACTIVE") });
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
      const b = buckets.find((x) => x.id === del[1]);
      if (b) b.status = "ARCHIVED";
      return jsonResponse(200, undefined);
    }
    if (method === "GET" && pathname.endsWith(`${FIN}/overview`)) return jsonResponse(200, OVERVIEW);
    if (method === "GET" && pathname.endsWith(`${FIN}/safe-to-spend`)) return jsonResponse(200, safe());
    if (method === "GET" && pathname.endsWith(`${FIN}/cashflow-forecast`)) return jsonResponse(200, FORECAST);
    return jsonResponse(200, { items: [] });
  }));
  const safeReads = () => calls.filter((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/safe-to-spend`)).length;
  return { calls, safeReads };
}

/** The Safe to Spend metric card's text (the page's headline figure). */
function safeMetric(): string {
  const card = [...document.querySelectorAll(".kf-card-metric")].find((el) => /Safe to Spend/.test(el.textContent ?? ""));
  return (card?.textContent ?? "").replace(/\s+/g, " ");
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
});
