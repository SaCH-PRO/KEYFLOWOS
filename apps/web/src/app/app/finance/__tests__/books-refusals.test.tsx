/**
 * PR195-KEY-GATES (review findings CRR-P195BD-1, SEC-P195BW-4; owner rulings D-57, D-146).
 *
 * The Books doors now refuse a member below revenue write with 403 (PR195-BOOKS-DOORS), and their reads a member
 * below revenue read (this packet). The api client answers a refusal as { data: null, error, status: 403 } and does
 * not throw, so a page that only catches never sees it. The review reproduced, on the real pages:
 *   - Bank Rules > Run Rules: "Bank rules applied", no error;
 *   - Bank Rules > delete: the row removed and "Bank rule deleted";
 *   - Fixed Assets > delete: the row removed and "Fixed asset deleted";
 *   - Fixed Assets > Run depreciation, Bank Rules > create and toggle: nothing at all said.
 * Each page now reads every answer: a refusal is said (ModuleScopeGuard's revenue refusal as the access it needs,
 * any other error in the server's words), nothing claims success, no row the server kept leaves the screen, and a
 * refused read is a refusal, not an empty list.
 *
 *   BR-01  RED-BEFORE  Bank Rules: a refused Run Rules, delete, toggle and create each say the refusal; no success
 *   BR-02  RED-BEFORE  Bank Rules: a refused list read is a refusal naming revenue access, not "No bank rules yet"
 *   BR-03  control     Bank Rules: an allowed delete still removes the row and says so
 *   FA-01  RED-BEFORE  Fixed Assets: a refused delete, depreciation and create each say the refusal; the row stays
 *   FA-02  RED-BEFORE  Fixed Assets: a refused list read is a refusal, not "No fixed assets yet"
 *   RC-01  RED-BEFORE  Reconciliation: a refused account list is a refusal, not "No bank accounts yet"
 *   TX-01  RED-BEFORE  Tax: a refused liability list is a refusal, not "No tax periods yet"
 *
 * Mounted on the real pages and the real api client (lib/api.ts, lib/client.ts); only `fetch`, the toast,
 * next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock.toast, Toaster: () => null }));
const { toast } = toastMock;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => "biz_1",
}));

import BankRulesPage from "../bank-rules/page";
import FixedAssetsPage from "../fixed-assets/page";
import FinanceReconciliationPage from "../reconciliation/page";
import FinanceTaxPage from "../tax/page";

const FIN = "/finance/businesses/biz_1";
const WRITE_REFUSAL = "Insufficient permissions: revenue requires write access (you have read)";
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

/** The production filter's body for a ModuleScopeGuard refusal (http-exception.filter.ts). */
function refused(message: string, path: string) {
  return jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message, error: "Forbidden", timestamp: "2026-11-13T00:00:00.000Z", path }, "Forbidden");
}

interface Call { method: string; pathname: string }

function stubServer(route: (method: string, pathname: string) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, pathname });
    return route(method, pathname) ?? jsonResponse(200, {});
  }));
  return calls;
}

const RULE = { id: "br_1", businessId: "biz_1", name: "Coffee shop", pattern: "COFFEE", matchType: "contains", accountId: "coa_1", expenseCategoryId: null, priority: 0, isActive: true };
const ASSET = {
  id: "fa_1", businessId: "biz_1", name: "Delivery van", category: "vehicle", purchaseDate: "2025-01-01T00:00:00.000Z", purchaseCost: 1200,
  salvageValue: 0, usefulLifeMonths: 24, depreciationMethod: "straight_line", accumulatedDepreciation: 0, netBookValue: 1200, status: "ACTIVE",
};

const successSaid = () => (toast.success as ReturnType<typeof vi.fn>).mock.calls.length;
const errorsSaid = () => (toast.error as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (toast.success as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
});

describe("Bank Rules (CRR-P195BD-1)", () => {
  function bankRulesServer(opts: { list?: () => Response; write?: () => Response } = {}) {
    return stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/bank-rules`)) return opts.list ? opts.list() : jsonResponse(200, { items: [RULE] });
      if (method !== "GET" && pathname.includes(`${FIN}/bank-rules`)) return opts.write ? opts.write() : jsonResponse(200, {});
      return undefined;
    });
  }

  it("BR-01 RED-BEFORE: a refused Run Rules says the refusal and claims nothing", async () => {
    bankRulesServer({ write: () => refused(WRITE_REFUSAL, `${FIN}/bank-rules/apply`) });
    render(<BankRulesPage />);
    expect(await screen.findByText("Coffee shop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Run Rules/ }));
    await waitFor(() => expect(errorsSaid().some((m) => m.includes(WRITE_REFUSAL))).toBe(true));
    expect(successSaid()).toBe(0);
  });

  it("BR-01 RED-BEFORE: a refused delete keeps the row and says the refusal; no \"deleted\"", async () => {
    bankRulesServer({ write: () => refused(WRITE_REFUSAL, `${FIN}/bank-rules/br_1`) });
    const { container } = render(<BankRulesPage />);
    expect(await screen.findByText("Coffee shop")).toBeInTheDocument();
    const del = container.querySelector("button.hover\\:bg-red-500\\/10") as HTMLButtonElement;
    fireEvent.click(del);
    await waitFor(() => expect(errorsSaid().some((m) => m.includes(WRITE_REFUSAL))).toBe(true));
    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
    expect(successSaid()).toBe(0);
  });

  it("BR-01 RED-BEFORE: a refused toggle and a refused create each say the refusal; the form is kept", async () => {
    bankRulesServer({ write: () => refused(WRITE_REFUSAL, `${FIN}/bank-rules`) });
    render(<BankRulesPage />);
    expect(await screen.findByText("Coffee shop")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Deactivate"));
    await waitFor(() => expect(errorsSaid().filter((m) => m.includes(WRITE_REFUSAL))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Add Rule/ }));
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "Rent" } });
    fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "RENT" } });
    fireEvent.change(screen.getByLabelText("Chart of account ID"), { target: { value: "coa_2" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Rule/ }));
    await waitFor(() => expect(errorsSaid().filter((m) => m.includes(WRITE_REFUSAL))).toHaveLength(2));
    expect(screen.getByLabelText("Rule name")).toHaveValue("Rent");
    expect(successSaid()).toBe(0);
  });

  it("BR-02 RED-BEFORE: a refused list read is a refusal naming revenue access, not an empty list", async () => {
    bankRulesServer({ list: () => refused(READ_REFUSAL, `${FIN}/bank-rules`) });
    render(<BankRulesPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No bank rules yet/)).not.toBeInTheDocument();
  });

  it("BR-03 control: an allowed delete removes the row and says so", async () => {
    bankRulesServer({ write: () => jsonResponse(200, { success: true }) });
    const { container } = render(<BankRulesPage />);
    expect(await screen.findByText("Coffee shop")).toBeInTheDocument();
    fireEvent.click(container.querySelector("button.hover\\:bg-red-500\\/10") as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText("Coffee shop")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith("Bank rule deleted");
  });
});

describe("Fixed Assets (CRR-P195BD-1)", () => {
  function assetsServer(opts: { list?: () => Response; write?: () => Response } = {}) {
    return stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/fixed-assets`)) return opts.list ? opts.list() : jsonResponse(200, { items: [ASSET] });
      if (method !== "GET" && pathname.includes(`${FIN}/fixed-assets`)) return opts.write ? opts.write() : jsonResponse(200, {});
      return undefined;
    });
  }

  it("FA-01 RED-BEFORE: a refused delete keeps the row and says the refusal; no \"deleted\"", async () => {
    assetsServer({ write: () => refused(WRITE_REFUSAL, `${FIN}/fixed-assets/fa_1`) });
    const { container } = render(<FixedAssetsPage />);
    expect(await screen.findByText("Delivery van")).toBeInTheDocument();
    fireEvent.click(container.querySelector("button.hover\\:bg-red-500\\/10") as HTMLButtonElement);
    await waitFor(() => expect(errorsSaid().some((m) => m.includes(WRITE_REFUSAL))).toBe(true));
    expect(screen.getByText("Delivery van")).toBeInTheDocument();
    expect(successSaid()).toBe(0);
  });

  it("FA-01 RED-BEFORE: a refused depreciation run and a refused create each say the refusal", async () => {
    assetsServer({ write: () => refused(WRITE_REFUSAL, `${FIN}/fixed-assets`) });
    render(<FixedAssetsPage />);
    expect(await screen.findByText("Delivery van")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Run depreciation"));
    await waitFor(() => expect(errorsSaid().filter((m) => m.includes(WRITE_REFUSAL))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Add Asset/ }));
    fireEvent.change(screen.getByLabelText("Asset name"), { target: { value: "Laptop" } });
    fireEvent.change(screen.getByLabelText("Purchase cost"), { target: { value: "900" } });
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Asset/ }));
    await waitFor(() => expect(errorsSaid().filter((m) => m.includes(WRITE_REFUSAL))).toHaveLength(2));
    expect(screen.getByLabelText("Asset name")).toHaveValue("Laptop");
    expect(successSaid()).toBe(0);
  });

  it("FA-02 RED-BEFORE: a refused list read is a refusal naming revenue access, not an empty list", async () => {
    assetsServer({ list: () => refused(READ_REFUSAL, `${FIN}/fixed-assets`) });
    render(<FixedAssetsPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No fixed assets yet/)).not.toBeInTheDocument();
  });
});

describe("Reconciliation and Tax read refusals (SEC-P195BW-4)", () => {
  it("RC-01 RED-BEFORE: a refused account list is a refusal naming revenue access, not \"No bank accounts yet\"", async () => {
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/accounts`) ? refused(READ_REFUSAL, `${FIN}/accounts`) : undefined));
    render(<FinanceReconciliationPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No bank accounts yet/)).not.toBeInTheDocument();
  });

  it("TX-01 RED-BEFORE: a refused liability list is a refusal naming revenue access, not \"No tax periods yet\"", async () => {
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/tax-liabilities`) ? refused(READ_REFUSAL, `${FIN}/tax-liabilities`) : undefined));
    render(<FinanceTaxPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No tax periods yet/)).not.toBeInTheDocument();
  });
});
