/**
 * FU-IDENTITY-FINANCE-COLUMNS (V1-71; review SEC-V71-2; owner rulings D-205, D-221): GET /identity/businesses and
 * GET /identity/businesses/:businessId (and POST /identity/bootstrap) stop answering Business.accountantEmail and the
 * four default ledger account ids (cash, AR, AP, tax) to a member without revenue read on the business. The server
 * proof is apps/server/test/identity-finance-columns.integration.test.ts (v71f_).
 *
 * Every web screen that shows those values reads them from GET /finance/businesses/:id/settings (fetchFinanceSettings),
 * the read their gate (revenue read) already holds, never from a business read: the finance settings page (the
 * accountant address and the default accounts), and the accountant box on the Reports and Tax pages (its prefilled
 * address). The business reads' other readers (the business settings form, the payments tab, the app shell, the
 * workspace list) read none of the five; they keep currency and the default tax rate, which the server still answers to
 * every member. These cases mount each screen that shows the five with the business read answered exactly as the
 * server now answers it to a member without revenue read (none of the five), and GET settings answering them: each
 * screen still shows the values, from GET settings. They pass before and after the server change (no screen changed):
 * they pin that the identity projection takes nothing a screen reads.
 *
 *   IFC-01  control  Finance settings: the accountant address and the four default accounts are GET settings' values
 *   IFC-02  control  Reports accountant box: the saved address prefills the box from GET settings
 *   IFC-03  control  Tax accountant box: the same
 *
 * Mounted on the real pages and the real api client (lib/api.ts, lib/client.ts); only `fetch`, the toast,
 * next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

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
  refreshWorkspace: async () => null,
}));

import FinanceSettingsPage from "../settings/page";
import ReportsPage from "../../reports/page";
import TaxPage from "../tax/page";

const FIN = "/finance/businesses/biz_1";
const ADDRESS = "books@firm.test";
const ACCOUNTS = { cash: "acct_cash", ar: "acct_ar", ap: "acct_ap", tax: "acct_tax" };

/** GET settings, as the server answers a revenue reader who may change everything here. */
const SETTINGS = {
  accountingBasis: "CASH",
  fiscalYearStartMonth: 1,
  defaultTaxRate: 12.5,
  currency: "TTD",
  accountantEmail: ADDRESS,
  defaultCashAccountId: ACCOUNTS.cash,
  defaultArAccountId: ACCOUNTS.ar,
  defaultApAccountId: ACCOUNTS.ap,
  defaultTaxAccountId: ACCOUNTS.tax,
  mayChangeAccountantEmail: true,
  mayChangeBooksSettings: true,
  mayChangeTaxRate: true,
};

/** GET /identity/businesses/biz_1 as the server now answers a member without revenue read: none of the five. */
const BUSINESS_READ = {
  id: "biz_1",
  name: "Biz One",
  currency: "TTD",
  defaultTaxRate: 12.5,
  accountingBasis: "CASH",
  fiscalYearStartMonth: 1,
  timezone: "America/Port_of_Spain",
  metaData: {},
};

const ACCOUNT_ROWS = Object.values(ACCOUNTS).map((id) => ({
  id, businessId: "biz_1", chartOfAccountId: "coa_1", name: `${id}-name`, type: "BANK", subtype: null, currency: "TTD",
  openingBalance: 0, currentBalance: 0, institution: null, isActive: true,
}));

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    blob: async () => new Blob([text]),
    clone() { return this; },
  } as unknown as Response;
}

/** The server: GET settings answers the five, the business read answers none of them; anything else is an empty 200. */
function stubServer(extra?: (method: string, pathname: string) => Response | undefined) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
    if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return jsonResponse(200, { items: ACCOUNT_ROWS });
    if (method === "GET" && pathname.endsWith("/identity/businesses/biz_1")) return jsonResponse(200, BUSINESS_READ);
    if (method === "GET" && pathname.endsWith("/identity/businesses")) return jsonResponse(200, [BUSINESS_READ]);
    return extra?.(method, pathname) ?? jsonResponse(200, {});
  }));
}

/** Opens the accountant box from `trigger` and returns it. */
async function openBox(trigger: HTMLElement) {
  fireEvent.click(trigger);
  const title = await screen.findByText("Send accountant export");
  return title.closest("div.relative") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("FU-IDENTITY-FINANCE-COLUMNS: the screens that show the five read them from GET settings", () => {
  it("IFC-01 control: Finance settings shows the accountant address and the four default accounts GET settings answers", async () => {
    stubServer();
    render(<FinanceSettingsPage />);
    const email = (await screen.findByPlaceholderText("accountant@firm.com")) as HTMLInputElement;
    expect(email.value).toBe(ADDRESS);
    await waitFor(() => expect((screen.getByLabelText(/^Cash \/ Bank/) as HTMLSelectElement).value).toBe(ACCOUNTS.cash));
    expect((screen.getByLabelText(/^Accounts Receivable/) as HTMLSelectElement).value).toBe(ACCOUNTS.ar);
    expect((screen.getByLabelText(/^Accounts Payable/) as HTMLSelectElement).value).toBe(ACCOUNTS.ap);
    expect((screen.getByLabelText(/^Tax Payable/) as HTMLSelectElement).value).toBe(ACCOUNTS.tax);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("IFC-02 control: the Reports accountant box prefills the saved address from GET settings", async () => {
    stubServer((method, pathname) => {
      // The page's own report read is not under test: unavailable here, so the page shows its error state.
      if (method === "GET" && pathname.endsWith("/reports/generate")) return jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error");
      return undefined;
    });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await openBox(trigger);
    await waitFor(() => expect((within(box).getByPlaceholderText("accountant@firm.com") as HTMLInputElement).value).toBe(ADDRESS));
  });

  it("IFC-03 control: the Tax accountant box prefills the saved address from GET settings", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && /\/tax-liabilities$|\/tax\/liabilities$/.test(pathname)) return jsonResponse(200, { items: [] });
      return undefined;
    });
    render(<TaxPage />);
    const [trigger] = await screen.findAllByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await openBox(trigger);
    await waitFor(() => expect((within(box).getByPlaceholderText("accountant@firm.com") as HTMLInputElement).value).toBe(ADDRESS));
  });
});
