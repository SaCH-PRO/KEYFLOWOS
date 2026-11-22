/**
 * V1-66 SWP-FIN-LEDGER (BUG-029, BUG-134): the General Ledger page, and the Accounts link.
 *
 * WHY this test exists: the page asked the server for `limit=25`, a parameter the general-ledger route does not
 * read (it reads `pageSize`), so the server answered its default 100 lines while the page counted pages of 25.
 * It printed each line's date as the raw ISO string, each amount as a bare number ("1,250.5", no currency), and
 * filtered accounts through a free-text "Account ID" box that only a database id satisfies. A refused read
 * showed an empty table. /app/finance/accounts redirected to "/app/finance/settings#accounts", which opened
 * Finance settings on General.
 *
 *   LPF-01  RED-BEFORE  the request carries pageSize=25 and no `limit`
 *   LPF-02  RED-BEFORE  money reads "TTD 1,250.50": debit, credit and balance, each line in its own currency
 *   LPF-03  RED-BEFORE  the date reads "Mar 10, 2026", never the ISO string
 *   LPF-04  RED-BEFORE  accounts are picked by name from the chart of accounts; the request carries the picked
 *                       account's id; there is no "Account ID" text box
 *   LPF-05  RED-BEFORE  the date boxes are labelled From and To (they had no name), and the end date is sent as
 *                       the date-only value the server reads as the whole day
 *   LPF-06  RED-BEFORE  a refused read says so; it is not an empty ledger
 *   LPF-07  RED-BEFORE  paging follows the server's total at 25 a page, and Next asks for page 2 with pageSize=25
 *   ACC-01  RED-BEFORE  /app/finance/accounts redirects to /app/finance/settings?tab=accounts
 *   ACC-02  control     Finance settings opened with ?tab=accounts shows Accounts
 *   ACC-03  control     Finance settings opened with #accounts shows Accounts
 *
 * Mounted on the real pages, the real DataTable and the real api client (lib/api.ts, lib/api/finance.ts,
 * lib/client.ts); only `fetch`, the toast, next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/ledger",
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

import { redirect } from "next/navigation";
import GeneralLedgerPage from "../page";
import AccountsRedirectPage from "../../accounts/page";
import FinanceSettingsPage from "../../settings/page";

const FIN = "/finance/businesses/biz_1";
const LEDGER = `${FIN}/general-ledger`;
const REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

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

type Call = { method: string; pathname: string; query: URLSearchParams };
function stubServer(route: (pathname: string, query: URLSearchParams) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname, searchParams } = new URL(url, "http://localhost");
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), pathname, query: searchParams });
    return route(pathname, searchParams) ?? jsonResponse(200, {});
  }));
  return calls;
}

const ACCOUNTS = [
  { id: "coa_cash", name: "Cash", code: "1000", type: "ASSET", subtype: null, systemKey: "CASH", isActive: true },
  { id: "coa_rev", name: "Revenue", code: "4000", type: "INCOME", subtype: null, systemKey: "REVENUE", isActive: true },
  { id: "coa_misc", name: "Owner Drawings", code: null, type: "EQUITY", subtype: null, systemKey: "OWNER_DRAWINGS", isActive: true },
];

const line = (over: Record<string, unknown>) => ({
  entryId: "le_1",
  transactionId: "tx_1",
  // Midday UTC: 10 March on a machine in any zone from UTC-11 to UTC+11 (review F3).
  date: "2026-03-10T12:00:00.000Z",
  accountId: "coa_cash",
  accountName: "Cash",
  accountCode: "1000",
  accountType: "ASSET",
  currency: "TTD",
  debit: "0",
  credit: "0",
  runningBalance: "0",
  memo: null,
  description: "Payment received",
  reference: "INV-0001",
  sourceType: "Payment",
  sourceId: "pay_1",
  ...over,
});

const ROWS = [
  line({ entryId: "le_1", debit: "1250.5", runningBalance: "1250.5" }),
  line({ entryId: "le_2", accountId: "coa_rev", accountName: "Revenue", accountCode: "4000", accountType: "INCOME", credit: "1250.5", runningBalance: "-1250.5" }),
  line({ entryId: "le_3", currency: "USD", debit: "99", runningBalance: "99", date: "2026-03-10T12:30:00.000Z" }),
];

function ledgerServer(opts: { total?: number; ledger?: () => Response } = {}) {
  return stubServer((pathname) => {
    if (pathname === LEDGER) return opts.ledger ? opts.ledger() : jsonResponse(200, { rows: ROWS, total: opts.total ?? ROWS.length, page: 1, pageSize: 25 });
    if (pathname === `${FIN}/chart-of-accounts`) return jsonResponse(200, { items: ACCOUNTS });
    return undefined;
  });
}

const ledgerCalls = (calls: Call[]) => calls.filter((c) => c.pathname === LEDGER);
const lastLedgerCall = (calls: Call[]) => ledgerCalls(calls).at(-1)!;

beforeEach(() => {
  window.history.replaceState({}, "", "/app/finance/ledger");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("General Ledger page (V1-66 SWP-FIN-LEDGER)", () => {
  it("LPF-01: asks the server for pageSize=25, the parameter it reads, and never `limit`", async () => {
    const calls = ledgerServer();
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    const { query } = lastLedgerCall(calls);
    expect(query.get("pageSize")).toBe("25");
    expect(query.get("page")).toBe("1");
    expect(query.has("limit")).toBe(false);
  });

  it("LPF-02: money reads with its currency and two decimals, each line in its own currency", async () => {
    ledgerServer();
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    const rows = screen.getAllByRole("row").filter((r) => r.querySelector("td"));
    expect(rows).toHaveLength(3);
    const [cashDebit, revenueCredit, usdDebit] = rows;
    // The debit of 1250.5 and the balance after it.
    expect(within(cashDebit).getAllByText("TTD 1,250.50")).toHaveLength(2);
    // The credit, and a negative balance.
    expect(within(revenueCredit).getByText("TTD 1,250.50")).toBeInTheDocument();
    expect(within(revenueCredit).getByText("TTD -1,250.50")).toBeInTheDocument();
    // A USD line says USD.
    expect(within(usdDebit).getAllByText("USD 99.00")).toHaveLength(2);
    // The bare numbers the page printed are gone.
    expect(screen.queryByText("1,250.5")).toBeNull();
    expect(screen.queryByText("99")).toBeNull();
  });

  it("LPF-03: the date reads as a date, never the ISO string", async () => {
    ledgerServer();
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    // The day is the machine's own (review C-3: Auckland reads these instants as 11 March): the words are pinned,
    // the day is whichever of the two the machine's zone makes it.
    const shown = new Date(ROWS[0].date as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    expect(shown).toMatch(/^Mar 1[01], 2026$/);
    expect(screen.getAllByText(shown)).toHaveLength(3);
    expect(document.body.textContent).not.toContain("2026-03-10T");
  });

  it("LPF-04: accounts are picked by name; the request carries the picked account's id", async () => {
    const calls = ledgerServer();
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    expect(screen.queryByPlaceholderText("Account ID")).toBeNull();

    const picker = (await screen.findByLabelText("Account")) as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    await waitFor(() => expect(within(picker).getAllByRole("option")).toHaveLength(4));
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All accounts",
      "1000 — Cash",
      "4000 — Revenue",
      "Owner Drawings",
    ]);
    // Nothing picked: no account filter is sent.
    expect(lastLedgerCall(calls).query.has("accountId")).toBe(false);

    fireEvent.change(picker, { target: { value: "coa_rev" } });
    await waitFor(() => expect(lastLedgerCall(calls).query.get("accountId")).toBe("coa_rev"));
    expect(lastLedgerCall(calls).query.get("page")).toBe("1");

    fireEvent.change(picker, { target: { value: "" } });
    await waitFor(() => expect(lastLedgerCall(calls).query.has("accountId")).toBe(false));
  });

  it("LPF-05: the dates are sent date-only, as picked", async () => {
    const calls = ledgerServer();
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-10" } });
    await waitFor(() => expect(lastLedgerCall(calls).query.get("to")).toBe("2026-03-10"));
    expect(lastLedgerCall(calls).query.get("from")).toBe("2026-03-10");
    expect(lastLedgerCall(calls).query.get("pageSize")).toBe("25");
  });

  it("LPF-06: a refused read says so, it is not an empty ledger", async () => {
    ledgerServer({
      ledger: () => jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: REFUSAL, error: "Forbidden", path: LEDGER }, "Forbidden"),
    });
    render(<GeneralLedgerPage />);
    expect(await screen.findByText(new RegExp(REFUSAL.replace(/[()]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.queryByText("No ledger entries found.")).toBeNull();
  });

  it("LPF-07: paging follows the server's total at 25 a page", async () => {
    const calls = ledgerServer({ total: 60 });
    render(<GeneralLedgerPage />);
    await screen.findAllByText("INV-0001");
    expect(screen.getByText(/60 entries — Page 1 of 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastLedgerCall(calls).query.get("page")).toBe("2"));
    expect(lastLedgerCall(calls).query.get("pageSize")).toBe("25");
    expect(lastLedgerCall(calls).query.has("limit")).toBe(false);
  });
});

describe("Accounts opens its tab (V1-66 SWP-FIN-LEDGER)", () => {
  const settingsServer = () =>
    stubServer((pathname) => {
      if (pathname === `${FIN}/settings`) return jsonResponse(200, { accountingBasis: "CASH", fiscalYearStartMonth: 1, defaultTaxRate: 0, currency: "TTD", accountantEmail: null });
      if (pathname === `${FIN}/accounts`) return jsonResponse(200, { items: [] });
      if (pathname === `${FIN}/chart-of-accounts`) return jsonResponse(200, { items: [] });
      if (pathname === `${FIN}/tax-rates`) return jsonResponse(200, { items: [] });
      return undefined;
    });

  it("ACC-01: /app/finance/accounts redirects to the Accounts tab by query, not by fragment", () => {
    AccountsRedirectPage();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/app/finance/settings?tab=accounts");
  });

  it("ACC-02: Finance settings opened with ?tab=accounts shows Accounts", async () => {
    settingsServer();
    window.history.replaceState({}, "", "/app/finance/settings?tab=accounts");
    render(<FinanceSettingsPage />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });

  it("ACC-03: Finance settings opened with #accounts shows Accounts", async () => {
    settingsServer();
    window.history.replaceState({}, "", "/app/finance/settings#accounts");
    render(<FinanceSettingsPage />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
  });
});
