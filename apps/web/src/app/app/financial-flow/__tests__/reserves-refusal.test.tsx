/**
 * PR195-KEY-GATES review repair (review finding CRR-P195KG-1; owner rulings D-57, D-146).
 *
 * GET finance reserves needs revenue read since SEC-P195BW-4. The Financial Flow page mapped any answer to
 * `data: r.data?.items ?? []`, so a refusal reached neither the page's load-error banner nor the reserves card,
 * and the card said "No reserve buckets yet. Add one…" to a member the server had refused.
 *
 *   FFR-01  RED-BEFORE  a refused reserves read is said as a refusal naming revenue access, not "No reserve buckets yet"
 *   FFR-02  control     an allowed, empty reserves read still says "No reserve buckets yet"
 *
 * Mounted on the real page and the real api client (lib/api.ts, lib/api/finance.ts); only `fetch`,
 * next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
  getStoredBusinessId: () => "biz_1",
}));

import FinancialFlowPage from "../page";

const FIN = "/finance/businesses/biz_1";
const READ_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

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

const OVERVIEW = { cashBalance: 100, outstandingInvoices: 0, overdueInvoices: 0, billsDue: 0, taxReserved: 0, netProfitThisMonth: 0, currency: "TTD" };
const SAFE = { safeToSpend: 50, cashBalance: 100, taxReserved: 0, billsDueNext30Days: 0, operatingBuffer: 50, currency: "TTD" };
const FORECAST = { days: 90, expected: 100, conservative: 90, optimistic: 110, dangerDate: null, recommendations: [] };

function stubServer(reserves: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && pathname.endsWith(`${FIN}/reserves`)) return reserves();
    if (method === "GET" && pathname.endsWith(`${FIN}/overview`)) return jsonResponse(200, OVERVIEW);
    if (method === "GET" && pathname.endsWith(`${FIN}/safe-to-spend`)) return jsonResponse(200, SAFE);
    if (method === "GET" && pathname.endsWith(`${FIN}/cashflow-forecast`)) return jsonResponse(200, FORECAST);
    return jsonResponse(200, { items: [] });
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Financial Flow reserves (CRR-P195KG-1)", () => {
  it("FFR-01 RED-BEFORE: a refused reserves read is a refusal naming revenue access, not \"No reserve buckets yet\"", async () => {
    stubServer(() =>
      jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: READ_REFUSAL, error: "Forbidden", timestamp: "2026-11-13T00:00:00.000Z", path: `${FIN}/reserves` }, "Forbidden"),
    );
    render(<FinancialFlowPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No reserve buckets yet/)).not.toBeInTheDocument();
  });

  it("FFR-02 control: an allowed, empty reserves read still says \"No reserve buckets yet\"", async () => {
    stubServer(() => jsonResponse(200, { items: [] }));
    render(<FinancialFlowPage />);
    expect(await screen.findByText(/No reserve buckets yet/)).toBeInTheDocument();
    expect(screen.queryByText(/revenue requires read access/)).not.toBeInTheDocument();
  });
});
