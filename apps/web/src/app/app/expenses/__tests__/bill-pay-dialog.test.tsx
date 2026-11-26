/**
 * EXPENSES-HUB-1 (web half; BUG-025; owner ruling billpay D-168: "The app always asks. A request that names no
 * account keeps today's Cash default") - paying a bill asks which account and method pay it.
 *
 * WHY: the detail page's Approve called payBill(businessId, id) at once, and payBill sent no paymentAccountId, so
 * every bill was paid from Cash without a question. The server half (bills/:id/pay accepts paymentAccountId,
 * apps/server/test/bill-pay-account.integration.test.ts) is on main; this is the door to it.
 *
 *   BPD-01  RED  Approve on a BILL pays nothing at once: it opens Pay, naming the amount, asking account and method
 *   BPD-02  RED  Pay from lists the business's active payment accounts in the bill's currency, and nothing else
 *   BPD-03  RED  Pay sends the account and method chosen (paymentAccountId on the wire), once; the page shows it paid
 *   BPD-04  RED  Cancel pays nothing
 *   BPD-05  RED  a refused pay keeps Pay open with the server's words, and no success
 *   BPD-06  RED  when the accounts cannot be read, Pay says why and sends the method only (the server's default)
 *   BPD-07  RED  a second press while the pay is in flight sends nothing more
 *   BPD-08  RED  while the accounts load, Pay asks nothing yet: account and method are asked together (live
 *                journey H5 at 4fafe8d chose "Bank Account" in the method select, shown alone while the accounts
 *                loaded, and the bill was paid from Cash)
 *   Repair round 1 (acceptance reviews at 35c72cb):
 *   BPD-09  RED  SEC MINOR-2: a read that FAILED (5xx, a BusinessGuard 403, the network), as distinct from a scope
 *                refusal, is said with Retry, and Pay cannot be pressed: it never pays without asking (D-168)
 *   BPD-10  RED  Retry reads the accounts again; once they load, Pay asks and pays from the account chosen
 *   BPD-11  pin  COR M2: an ok answer with no account that fits says "No payment account in TTD" and sends the
 *                method only
 *   BPD-12  pin  COR M2: the default account is listed first and chosen first, whatever order the server answers
 *
 * Mounted on the real ExpenseDetailPage and the real api clients (lib/api.ts, lib/client.ts, lib/api/finance.ts),
 * so the request body is read off the wire; only `fetch`, the toast, next/navigation and the stored business are
 * stubbed (as payroll-accounts-refusal.test.tsx does).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const BUSINESS = "biz_hub1_pay";
const BILL_ID = "exp_hub1_bill";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/app/expenses/${BILL_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: BILL_ID }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => BUSINESS,
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));

import { toast } from "sonner";
import ExpenseDetailPage from "../[id]/page";

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

const BILL = {
  id: BILL_ID,
  description: "Phone bill",
  amount: 320,
  currency: "TTD",
  date: "2026-11-01T00:00:00.000Z",
  dueDate: "2026-11-30T00:00:00.000Z",
  vendor: "Digicel",
  paymentMethod: null,
  tags: [],
  isRecurring: false,
  status: "BILL",
  categoryId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const PAID = { ...BILL, status: "PAID", paidAt: "2026-11-26T12:00:00.000Z", paymentMethod: "bank_transfer" };

const acct = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, name, type, currency: "TTD", isActive: true, isDefault: false, currentBalance: 0, businessId: BUSINESS, chartOfAccountId: `coa_${id}`, ...extra,
});
const ACCOUNTS = [
  acct("fa_cash", "Cash on Hand", "CASH", { isDefault: true }),
  acct("fa_bank", "Bank Account", "BANK"),
  acct("fa_wipay", "WiPay", "PAYMENT_PROCESSOR"),
  acct("fa_card", "Business card", "CREDIT_CARD"),
  acct("fa_old", "Old bank", "BANK", { isActive: false }),
  acct("fa_loan", "Van loan", "LOAN"),
  acct("fa_usd", "USD bank", "BANK", { currency: "USD" }),
];
const READ_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

type Sent = { path: string; body: unknown };

function stubServer(opts: { accounts?: () => Response; pay?: () => Response | Promise<Response> } = {}) {
  const pays: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && pathname.endsWith(`/expenses/businesses/${BUSINESS}/expenses/${BILL_ID}`)) return jsonResponse(200, BILL);
    if (method === "GET" && pathname.endsWith(`/expenses/businesses/${BUSINESS}/expense-categories`)) return jsonResponse(200, []);
    if (method === "GET" && pathname.endsWith(`/expenses/businesses/${BUSINESS}/expense-budgets`)) return jsonResponse(200, []);
    if (method === "GET" && pathname.endsWith(`/finance/businesses/${BUSINESS}/accounts`)) {
      return opts.accounts ? opts.accounts() : jsonResponse(200, { items: ACCOUNTS });
    }
    if (method === "POST" && pathname.endsWith(`/finance/businesses/${BUSINESS}/bills/${BILL_ID}/pay`)) {
      pays.push({ path: pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return opts.pay ? opts.pay() : jsonResponse(201, PAID, "Created");
    }
    return jsonResponse(200, {});
  }));
  return pays;
}

async function mount() {
  render(<ExpenseDetailPage />);
  await screen.findByRole("heading", { name: "Digicel" });
}

function payDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: /pay bill/i });
}

async function openPay() {
  fireEvent.click(screen.getByRole("button", { name: /^Approve/ }));
  const dialog = await screen.findByRole("dialog", { name: /pay bill/i });
  // The account list has arrived (or its refusal has been said).
  // The client retries a failed read itself (lib/fetch-with-retry: 300ms base, doubling), so a failure is answered
  // only after its backoff.
  await waitFor(() => expect(within(dialog).queryByText(/loading accounts/i)).toBeNull(), { timeout: 8_000 });
  return dialog;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EXPENSES-HUB-1: paying a bill asks which account and method (D-168, BUG-025)", () => {
  it("BPD-01 Approve on a BILL pays nothing at once: it opens Pay, naming the amount, asking account and method", async () => {
    const pays = stubServer();
    await mount();
    const dialog = await openPay();

    expect(pays).toEqual([]);
    expect(within(dialog).getByText(/320\.00/)).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: /pay from/i })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: /payment method/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Pay/ })).toBeTruthy();
  });

  it("BPD-02 Pay from lists the active payment accounts in the bill's currency, and nothing else", async () => {
    stubServer();
    await mount();
    const dialog = await openPay();
    const select = within(dialog).getByRole("combobox", { name: /pay from/i }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values.sort()).toEqual(["fa_bank", "fa_card", "fa_cash", "fa_wipay"]);
    expect(within(select).queryByText(/Old bank|Van loan|USD bank/)).toBeNull();
  });

  it("BPD-03 Pay sends the account and method chosen, once; the page shows it paid", async () => {
    const pays = stubServer();
    await mount();
    const dialog = await openPay();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /pay from/i }), { target: { value: "fa_bank" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /payment method/i }), { target: { value: "bank_transfer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay/ }));

    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].body).toEqual({ paymentAccountId: "fa_bank", paymentMethod: "bank_transfer" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /pay bill/i })).toBeNull());
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  it("BPD-04 Cancel pays nothing", async () => {
    const pays = stubServer();
    await mount();
    const dialog = await openPay();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/ }));

    expect(screen.queryByRole("dialog", { name: /pay bill/i })).toBeNull();
    expect(pays).toEqual([]);
    expect(screen.getByRole("button", { name: /^Approve/ })).toBeTruthy();
  });

  it("BPD-05 a refused pay keeps Pay open with the server's words, and no success", async () => {
    const words = "Payment account fa_bank holds USD; the bill is in TTD (one currency, nothing converted: D-13)";
    stubServer({
      pay: () => jsonResponse(400, { statusCode: 400, message: words, error: "Bad Request" }, "Bad Request"),
    });
    await mount();
    const dialog = await openPay();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /pay from/i }), { target: { value: "fa_bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay/ }));

    await waitFor(() => expect(within(payDialog()).getByText(words)).toBeTruthy());
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Approve/ })).toBeTruthy();
  });

  it("BPD-06 when the accounts cannot be read, Pay says why and sends the method only", async () => {
    const pays = stubServer({
      accounts: () =>
        jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: READ_REFUSAL, error: "Forbidden" }, "Forbidden"),
    });
    await mount();
    const dialog = await openPay();

    expect(within(dialog).getByText(/revenue/i)).toBeTruthy();
    expect(within(dialog).queryByRole("combobox", { name: /pay from/i })).toBeNull();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /payment method/i }), { target: { value: "cheque" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay/ }));

    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].body).toEqual({ paymentMethod: "cheque" });
  });

  it("BPD-07 a second press while the pay is in flight sends nothing more", async () => {
    let release: (r: Response) => void = () => {};
    const pays = stubServer({ pay: () => new Promise<Response>((r) => { release = r; }) });
    await mount();
    const dialog = await openPay();
    const pay = within(dialog).getByRole("button", { name: /^Pay/ });
    fireEvent.click(pay);
    fireEvent.click(pay);
    await waitFor(() => expect(pays).toHaveLength(1));
    fireEvent.click(within(payDialog()).getByRole("button", { name: /^Pay/ }));
    release(jsonResponse(201, PAID, "Created"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(pays).toHaveLength(1);
  });

  it("BPD-08 while the accounts load, Pay asks nothing yet: account and method are asked together", async () => {
    let release: (r: Response) => void = () => {};
    const pays = stubServer({ accounts: () => new Promise<Response>((r) => { release = r; }) as unknown as Response });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /^Approve/ }));
    const dialog = await screen.findByRole("dialog", { name: /pay bill/i });

    expect(within(dialog).getByText(/loading accounts/i)).toBeTruthy();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect((within(dialog).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true);

    release(jsonResponse(200, { items: ACCOUNTS }));
    await waitFor(() => expect(within(payDialog()).getByRole("combobox", { name: /pay from/i })).toBeTruthy());
    expect(within(payDialog()).getByRole("combobox", { name: /payment method/i })).toBeTruthy();
    expect(pays).toEqual([]);
  });

  it.each([
    ["a 5xx", () => jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error")],
    ["a BusinessGuard 403", () => jsonResponse(403, { statusCode: 403, message: "Unable to verify business access", error: "Forbidden" }, "Forbidden")],
    ["the network", () => { throw new TypeError("Failed to fetch"); }],
  ])("BPD-09 an accounts read that failed (%s) is said with Retry, and Pay cannot be pressed", { timeout: 15_000 }, async (_what, answer) => {
    const pays = stubServer({ accounts: answer as () => Response });
    await mount();
    const dialog = await openPay();

    expect(within(dialog).getByText(/couldn't load the payment accounts/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Retry$/ })).toBeTruthy();
    expect(within(dialog).queryByRole("combobox", { name: /pay from/i })).toBeNull();
    expect(within(dialog).queryByText(/sends the method only/i)).toBeNull();
    const pay = within(dialog).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(pay);
    await new Promise((r) => setTimeout(r, 20));
    expect(pays).toEqual([]);
  });

  it("BPD-10 Retry reads the accounts again; once they load, Pay asks and pays from the account chosen", { timeout: 20_000 }, async () => {
    // The read fails (through the client's own retries) until the owner presses Retry.
    let retried = false;
    const pays = stubServer({
      accounts: () => (retried ? jsonResponse(200, { items: ACCOUNTS }) : jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error")),
    });
    await mount();
    const dialog = await openPay();
    retried = true;
    fireEvent.click(within(dialog).getByRole("button", { name: /^Retry$/ }));

    const account = await within(payDialog()).findByRole("combobox", { name: /pay from/i }, { timeout: 8_000 });
    expect(within(payDialog()).queryByText(/couldn't load the payment accounts/i)).toBeNull();
    fireEvent.change(account, { target: { value: "fa_bank" } });
    fireEvent.change(within(payDialog()).getByRole("combobox", { name: /payment method/i }), { target: { value: "bank_transfer" } });
    const pay = within(payDialog()).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(false);
    fireEvent.click(pay);
    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].body).toEqual({ paymentAccountId: "fa_bank", paymentMethod: "bank_transfer" });
  });

  it("BPD-11 an ok answer with no account that fits says 'No payment account in TTD' and sends the method only", async () => {
    const pays = stubServer({
      accounts: () => jsonResponse(200, { items: ACCOUNTS.filter((a) => ["fa_old", "fa_loan", "fa_usd"].includes(a.id)) }),
    });
    await mount();
    const dialog = await openPay();

    expect(within(dialog).getByText(/No payment account in TTD\./)).toBeTruthy();
    expect(within(dialog).queryByRole("combobox", { name: /pay from/i })).toBeNull();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /payment method/i }), { target: { value: "cheque" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].body).toEqual({ paymentMethod: "cheque" });
  });

  it("BPD-12 the default account is listed first and chosen first, whatever order the server answers", async () => {
    const byId = (id: string) => ACCOUNTS.find((a) => a.id === id)!;
    const pays = stubServer({ accounts: () => jsonResponse(200, { items: [byId("fa_bank"), byId("fa_wipay"), byId("fa_cash"), byId("fa_card")] }) });
    await mount();
    const dialog = await openPay();
    const select = within(dialog).getByRole("combobox", { name: /pay from/i }) as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.value)[0]).toBe("fa_cash");
    expect(select.value).toBe("fa_cash");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect(pays).toHaveLength(1));
    expect((pays[0].body as { paymentAccountId?: string }).paymentAccountId).toBe("fa_cash");
  });
});
