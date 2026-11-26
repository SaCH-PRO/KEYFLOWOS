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
 *   Repair round 2 (reviews at 3077594):
 *   BPD-13  RED  SEC MINOR-2: the dialog re-rendered for another business waits for that business's accounts; the
 *                first business's account id is never sent
 *   BPD-14  RED  SEC MINOR-1: Pay is a form submit (Enter); submitting while the accounts failed or are loading
 *                sends nothing (the guard in pay(), not only the disabled button)
 *   BPD-15  pin  COR: a Retry that fails again leaves Pay disabled
 *   Repair round 3 (reviews at c3b9757):
 *   BPD-16  pin  SEC: two submits while the first pay is in flight send one payBill (the inFlight ref, not the
 *                disabled button: both submits land before React re-renders)
 *   BPD-17  RED  COR: re-rendered for another business, the method chosen and an earlier refusal are not carried over
 *   BPD-18  RED  COR: re-rendered for another bill of the same business, Pay reads again and starts from the
 *                defaults; it pays that bill (bill.id in the read's key)
 *   BPD-19  RED  COR: Escape closes Pay, except while a pay is in flight
 *   BPD-20  RED  COR: focus moves into Pay on open, Tab and Shift+Tab stay inside it, and focus returns to Approve
 *                on close
 *   BPD-21  RED  found in round 3: Escape in Pay stays in Pay. The app's Escape shortcut (use-keyboard-shortcuts,
 *                a window keydown listener) goes to the list from a detail page, so without this Escape would also
 *                leave the expense, even while a pay is in flight
 *   Repair round 4 (reviews at 145b140):
 *   BPD-22  RED  while a pay is in flight every control is disabled; Tab and Shift+Tab are still kept in the dialog
 *                (prevented, focus on the dialog), not let out to the page behind the aria-modal dialog
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
import { BillPayDialog } from "../components/bill-pay-dialog";
import type { Expense } from "@/lib/client";

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

  it("BPD-13 re-rendered for another business, Pay waits for that business's accounts; the first one's id is never sent", async () => {
    const OTHER = "biz_hub1_other";
    let releaseOther: (r: Response) => void = () => {};
    const pays: Sent[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && pathname.endsWith(`/finance/businesses/${BUSINESS}/accounts`)) return jsonResponse(200, { items: ACCOUNTS });
      if (method === "GET" && pathname.endsWith(`/finance/businesses/${OTHER}/accounts`)) return new Promise<Response>((r) => { releaseOther = r; });
      if (method === "POST" && /\/bills\/[^/]+\/pay$/.test(pathname)) {
        pays.push({ path: pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return jsonResponse(201, PAID, "Created");
      }
      return jsonResponse(200, {});
    }));
    const props = { bill: BILL as unknown as Expense, onClose: vi.fn(), onPaid: vi.fn() };
    const { rerender } = render(<BillPayDialog businessId={BUSINESS} {...props} />);
    const first = (await screen.findByRole("combobox", { name: /pay from/i })) as HTMLSelectElement;
    expect(first.value).toBe("fa_cash");

    rerender(<BillPayDialog businessId={OTHER} {...props} />);
    const dialog = payDialog();
    expect(within(dialog).queryByRole("combobox", { name: /pay from/i })).toBeNull();
    const pay = within(dialog).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(pay);
    fireEvent.submit(pay.closest("form") ?? dialog);
    await new Promise((r) => setTimeout(r, 20));
    expect(pays).toEqual([]);

    releaseOther(jsonResponse(200, { items: [acct("fb_bank", "Other bank", "BANK", { businessId: OTHER, isDefault: true })] }));
    const second = (await within(payDialog()).findByRole("combobox", { name: /pay from/i })) as HTMLSelectElement;
    expect(Array.from(second.options).map((o) => o.value)).toEqual(["fb_bank"]);
    fireEvent.click(within(payDialog()).getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].path).toContain(`/finance/businesses/${OTHER}/bills/`);
    expect((pays[0].body as { paymentAccountId?: string }).paymentAccountId).toBe("fb_bank");
  });

  it("BPD-14 Pay is a form submit; submitting while the accounts failed or are loading sends nothing", { timeout: 20_000 }, async () => {
    let retried = false;
    let releaseRetry: (r: Response) => void = () => {};
    const pays = stubServer({
      accounts: () => (retried ? (new Promise<Response>((r) => { releaseRetry = r; }) as unknown as Response) : jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error")),
    });
    await mount();
    const dialog = await openPay();
    const pay = within(dialog).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;
    expect(pay.type).toBe("submit");
    const form = pay.closest("form");
    expect(form, "the dialog is a form, so Enter submits it").not.toBeNull();

    fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 20));
    expect(pays).toEqual([]);

    retried = true;
    fireEvent.click(within(dialog).getByRole("button", { name: /^Retry$/ }));
    await waitFor(() => expect(within(payDialog()).getByText(/loading accounts/i)).toBeTruthy());
    fireEvent.submit(form!);
    await new Promise((r) => setTimeout(r, 20));
    expect(pays).toEqual([]);

    releaseRetry(jsonResponse(200, { items: ACCOUNTS }));
    await within(payDialog()).findByRole("combobox", { name: /pay from/i });
    fireEvent.submit(form!);
    await waitFor(() => expect(pays).toHaveLength(1));
  });

  it("BPD-15 a Retry that fails again leaves Pay disabled", { timeout: 30_000 }, async () => {
    let reads = 0;
    const pays = stubServer({
      accounts: () => { reads += 1; return jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error"); },
    });
    await mount();
    const dialog = await openPay();
    const before = reads;
    fireEvent.click(within(dialog).getByRole("button", { name: /^Retry$/ }));
    await waitFor(() => expect(reads).toBeGreaterThan(before));
    await waitFor(() => expect(within(payDialog()).getByRole("button", { name: /^Retry$/ })).toBeTruthy(), { timeout: 8_000 });

    expect(within(payDialog()).getByText(/couldn't load the payment accounts/i)).toBeTruthy();
    expect(within(payDialog()).queryByRole("combobox")).toBeNull();
    const pay = within(payDialog()).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(pay);
    await new Promise((r) => setTimeout(r, 20));
    expect(pays).toEqual([]);
  });

  /** Renders the dialog alone, on a fetch stub whose account reads and pays the test controls. */
  function renderDialog(opts: { accounts?: (biz: string, n: number) => Response | Promise<Response>; pay?: () => Response | Promise<Response> } = {}) {
    const pays: Sent[] = [];
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const acc = /\/finance\/businesses\/([^/]+)\/accounts$/.exec(pathname);
      if (method === "GET" && acc) {
        reads += 1;
        return opts.accounts ? opts.accounts(acc[1], reads) : jsonResponse(200, { items: ACCOUNTS });
      }
      if (method === "POST" && /\/bills\/[^/]+\/pay$/.test(pathname)) {
        pays.push({ path: pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return opts.pay ? opts.pay() : jsonResponse(201, PAID, "Created");
      }
      return jsonResponse(200, {});
    }));
    return pays;
  }

  const BILL2 = { ...BILL, id: "exp_hub1_bill2", vendor: "TSTT", paymentMethod: "card" };

  it("BPD-16 two submits while the first pay is in flight send one payBill", async () => {
    let release: (r: Response) => void = () => {};
    const pays = renderDialog({ pay: () => new Promise<Response>((r) => { release = r; }) });
    const onPaid = vi.fn();
    render(<BillPayDialog businessId={BUSINESS} bill={BILL as unknown as Expense} onClose={vi.fn()} onPaid={onPaid} />);
    await screen.findByRole("combobox", { name: /pay from/i });
    const form = (screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).form!;

    // Both land before React re-renders and disables the button: only pay()'s inFlight ref stands between them.
    form.requestSubmit();
    form.requestSubmit();
    await waitFor(() => expect(pays).toHaveLength(1));
    release(jsonResponse(201, PAID, "Created"));
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
    expect(pays).toHaveLength(1);
  });

  it("BPD-17 re-rendered for another business, the method chosen and an earlier refusal are not carried over", async () => {
    const words = "Payment account fa_bank is archived";
    const OTHER = "biz_hub1_other";
    const pays = renderDialog({
      accounts: (biz) => jsonResponse(200, { items: biz === OTHER ? [acct("fb_bank", "Other bank", "BANK", { businessId: OTHER, isDefault: true })] : ACCOUNTS }),
      pay: () => jsonResponse(400, { statusCode: 400, message: words, error: "Bad Request" }, "Bad Request"),
    });
    const props = { bill: BILL as unknown as Expense, onClose: vi.fn(), onPaid: vi.fn() };
    const { rerender } = render(<BillPayDialog businessId={BUSINESS} {...props} />);
    await screen.findByRole("combobox", { name: /pay from/i });
    fireEvent.change(screen.getByRole("combobox", { name: /payment method/i }), { target: { value: "cheque" } });
    fireEvent.click(screen.getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect(within(payDialog()).getByText(words)).toBeTruthy());

    rerender(<BillPayDialog businessId={OTHER} {...props} />);
    await within(payDialog()).findByRole("combobox", { name: /pay from/i });
    expect(within(payDialog()).queryByText(words)).toBeNull();
    expect((within(payDialog()).getByRole("combobox", { name: /payment method/i }) as HTMLSelectElement).value).toBe("cash");
    expect(pays).toHaveLength(1);
  });

  it("BPD-18 re-rendered for another bill of the same business, Pay reads again, starts from the defaults and pays that bill", async () => {
    let releaseSecond: (r: Response) => void = () => {};
    const pays = renderDialog({
      accounts: (_biz, n) => (n === 1 ? jsonResponse(200, { items: ACCOUNTS }) : new Promise<Response>((r) => { releaseSecond = r; })),
    });
    const props = { businessId: BUSINESS, onClose: vi.fn(), onPaid: vi.fn() };
    const { rerender } = render(<BillPayDialog bill={BILL as unknown as Expense} {...props} />);
    const first = await screen.findByRole("combobox", { name: /pay from/i });
    fireEvent.change(first, { target: { value: "fa_bank" } });
    fireEvent.change(screen.getByRole("combobox", { name: /payment method/i }), { target: { value: "cheque" } });

    rerender(<BillPayDialog bill={BILL2 as unknown as Expense} {...props} />);
    expect(within(payDialog()).queryByRole("combobox", { name: /pay from/i })).toBeNull();
    expect((within(payDialog()).getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true);

    releaseSecond(jsonResponse(200, { items: ACCOUNTS }));
    const second = (await within(payDialog()).findByRole("combobox", { name: /pay from/i })) as HTMLSelectElement;
    expect(second.value).toBe("fa_cash");
    expect((within(payDialog()).getByRole("combobox", { name: /payment method/i }) as HTMLSelectElement).value).toBe("card");
    fireEvent.click(within(payDialog()).getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect(pays).toHaveLength(1));
    expect(pays[0].path).toContain(`/bills/${BILL2.id}/pay`);
    expect(pays[0].body).toEqual({ paymentAccountId: "fa_cash", paymentMethod: "card" });
  });

  it("BPD-19 Escape closes Pay, except while a pay is in flight", async () => {
    let release: (r: Response) => void = () => {};
    renderDialog({ pay: () => new Promise<Response>((r) => { release = r; }) });
    const onClose = vi.fn();
    render(<BillPayDialog businessId={BUSINESS} bill={BILL as unknown as Expense} onClose={onClose} onPaid={vi.fn()} />);
    await screen.findByRole("combobox", { name: /pay from/i });

    fireEvent.click(screen.getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    release(jsonResponse(400, { statusCode: 400, message: "Bill changed status concurrently", error: "Conflict" }, "Conflict"));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("BPD-20 focus moves into Pay on open, Tab stays inside it, and focus returns to Approve on close", async () => {
    stubServer();
    await mount();
    const approve = screen.getByRole("button", { name: /^Approve/ });
    approve.focus();
    fireEvent.click(approve);
    const dialog = await screen.findByRole("dialog", { name: /pay bill/i });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await within(dialog).findByRole("combobox", { name: /pay from/i });

    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("select:not([disabled]), button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBe(within(dialog).getByRole("combobox", { name: /pay from/i }));
    expect(last).toBe(within(dialog).getByRole("button", { name: /^Pay/ }));
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /pay bill/i })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Approve/ }));
  });

  it("BPD-21 Escape in Pay does not reach the app's window shortcut, idle or while a pay is in flight", async () => {
    let release: (r: Response) => void = () => {};
    renderDialog({ pay: () => new Promise<Response>((r) => { release = r; }) });
    const appEscape = vi.fn();
    const onWindowKey = (e: KeyboardEvent) => { if (e.key === "Escape") appEscape(); };
    window.addEventListener("keydown", onWindowKey);
    try {
      const onClose = vi.fn();
      render(<BillPayDialog businessId={BUSINESS} bill={BILL as unknown as Expense} onClose={onClose} onPaid={vi.fn()} />);
      await screen.findByRole("combobox", { name: /pay from/i });

      fireEvent.click(screen.getByRole("button", { name: /^Pay/ }));
      await waitFor(() => expect((screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      expect(appEscape).not.toHaveBeenCalled();

      release(jsonResponse(400, { statusCode: 400, message: "Bill changed status concurrently", error: "Conflict" }, "Conflict"));
      await waitFor(() => expect((screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(appEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("BPD-22 while a pay is in flight (every control disabled), Tab and Shift+Tab keep focus in the dialog", async () => {
    let release: (r: Response) => void = () => {};
    renderDialog({ pay: () => new Promise<Response>((r) => { release = r; }) });
    render(
      <>
        <button type="button">Behind the dialog</button>
        <BillPayDialog businessId={BUSINESS} bill={BILL as unknown as Expense} onClose={vi.fn()} onPaid={vi.fn()} />
      </>,
    );
    await screen.findByRole("combobox", { name: /pay from/i });
    fireEvent.click(screen.getByRole("button", { name: /^Pay/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Pay/ }) as HTMLButtonElement).disabled).toBe(true));
    const dialog = payDialog();
    expect(dialog.querySelectorAll("select:not([disabled]), button:not([disabled])")).toHaveLength(0);

    for (const shiftKey of [false, true]) {
      const from = document.activeElement ?? document.body;
      // fireEvent returns false when the handler called preventDefault (the browser would not move focus).
      const notPrevented = fireEvent.keyDown(from, { key: "Tab", shiftKey });
      expect(notPrevented, `Tab${shiftKey ? " with Shift" : ""} is kept in the dialog`).toBe(false);
      expect(dialog.contains(document.activeElement), "focus is inside the dialog").toBe(true);
    }
    release(jsonResponse(201, PAID, "Created"));
  });
});
