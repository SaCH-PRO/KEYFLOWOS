/**
 * PR195-KEY-GATES review repair (review finding CRR-P195KG-2, minor; owner rulings D-146, D-142).
 *
 * GET finance accounts needs revenue read since SEC-P195BW-4. The payroll page read it with
 * `fetchFinanceAccounts(...).catch(() => null)` and `if (accountsRes?.data?.items)`, so for the operator D-146
 * authorises to pay payroll (operations write and expenses write) but with no revenue access the disbursement picker
 * silently lost its financial accounts: only payment methods were offered, the default fell to a method, and the page
 * never said why the accounts were missing.
 *
 *   PRA-01  RED-BEFORE  a refused account list is said beside Mark paid, naming revenue access
 *   PRA-02  control     an allowed list offers its BANK and CASH accounts and says no refusal
 *
 * Mounted on the real page and the real api client (lib/api.ts, lib/client.ts, lib/api/payroll.ts); only `fetch`,
 * the toast, next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/payroll",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => "biz_1",
}));

import PayrollPage from "../page";

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

const RUN = { id: "run_1", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-31T00:00:00.000Z", status: "APPROVED", totalGross: 900, currency: "TTD", itemCount: 2 };
const ACCOUNT = { id: "fa_bank", name: "Operating bank", type: "BANK", currency: "TTD", isActive: true, isDefault: true, currentBalance: 12345 };

function stubServer(accounts: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && pathname.endsWith("/finance/businesses/biz_1/accounts")) return accounts();
    if (method === "GET" && pathname.endsWith("/payroll/businesses/biz_1/rates")) return jsonResponse(200, []);
    if (method === "GET" && pathname.endsWith("/payroll/businesses/biz_1/runs")) return jsonResponse(200, [RUN]);
    return jsonResponse(200, {});
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Payroll disbursement accounts (CRR-P195KG-2)", () => {
  it("PRA-01 RED-BEFORE: a refused account list is said beside Mark paid, naming revenue access", async () => {
    stubServer(() =>
      jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: READ_REFUSAL, error: "Forbidden", timestamp: "2026-11-13T00:00:00.000Z", path: "/finance/businesses/biz_1/accounts" }, "Forbidden"),
    );
    render(<PayrollPage />);
    expect(await screen.findByRole("button", { name: /Mark paid/ })).toBeInTheDocument();
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
  });

  it("PRA-02 control: an allowed list offers its bank account and says no refusal", async () => {
    stubServer(() => jsonResponse(200, { items: [ACCOUNT] }));
    render(<PayrollPage />);
    expect(await screen.findByRole("option", { name: /Operating bank \(BANK\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/revenue requires read access/)).not.toBeInTheDocument();
  });
});
