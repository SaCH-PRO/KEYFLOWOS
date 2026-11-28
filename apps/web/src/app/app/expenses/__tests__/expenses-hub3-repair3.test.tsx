/**
 * EXPENSES-HUB-3 repair round 3 (round-2 security and correctness confirmations at a35034b).
 *
 *   S-M1  receiptKind: a business id that is a prefix of another (biz_A, biz_A1) never makes the other's upload
 *         "stored", on the detail page and in the sheet
 *   S-M2  one helper, isOwnUploadPath, decides an own upload; the sheet's and the page's upload checks refuse another
 *         business's path and a prefix-colliding one, and write no receiptUrl
 *   S-m1  "stored" only for this business's upload path, relative or on the API's own origin, with safe segments: no
 *         other host, no "//host", no backslash, no percent-encoding
 *   S-m2  "link" only for http(s): javascript:, data: and a mixed-case /OBJECTS/ path are never an href or an img src
 *   S-m3  the sheet's own upload refuses when the stored business is not the sheet's (no presign is sent)
 *   C-m2  the attention queue's receipt line is the server's all-status count, said so
 *   C-m3  A → B → A: the first A read's late reply is dropped (the generation guard, not only the business check)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));

const client = vi.hoisted(() => ({
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchRecurringCandidates: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_r3" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";
import ExpenseDetailPage from "../[id]/page";
import * as sheetModule from "../components/expense-form-sidesheet";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";
const STORED_NOTE = /receipt stored — viewing isn't available yet/i;
const receiptKind = (url: string, bid: string) => sheetModule.receiptKind(url, bid);
const isOwnUploadPath = (path: string, bid: string) =>
  (sheetModule as unknown as { isOwnUploadPath: (p: string, b: string) => boolean }).isOwnUploadPath(path, bid);

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_r3",
    description: "Alpha rent",
    amount: 4321,
    currency: "TTD",
    date: "2026-11-20T00:00:00.000Z",
    vendor: "Alpha Landlord",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    ...over,
  } as Expense;
}

function summary(total: number, extra: Record<string, unknown> = {}) {
  return { total, count: 1, byCategory: [], missingReceiptCount: 0, comparison: { prevTotal: 0, prevCount: 0, changePercent: 0, direction: "flat" }, ...extra };
}

const photo = () => new File([new Uint8Array([1])], "r.jpg", { type: "image/jpeg" });

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok(summary(0)));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  client.fetchFinanceAccounts.mockResolvedValue(ok([]));
  client.createExpense.mockResolvedValue(ok({ id: "exp_new", description: "x", amount: 1, status: "PAID" }));
  uploadFile.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

describe("S-M2 / S-m1: isOwnUploadPath is the one test of an own upload", () => {
  it.each([
    ["/objects/uploads/biz_A/obj1", true],
    ["/objects/uploads/biz_A/obj-1_x.y", true],
    ["/objects/uploads/biz_A1/obj1", false],
    ["/objects/uploads/biz_A", false],
    ["/objects/uploads/biz_A/", false],
    ["/objects/uploads/biz_A/obj1/extra", false],
    ["/objects/uploads/biz_A/..", false],
    ["/objects/uploads/biz_A/obj%31", false],
    ["/objects/uploads/biz_A/a\\b", false],
    ["//evil.test/objects/uploads/biz_A/obj1", false],
    ["http://api.test/objects/uploads/biz_A/obj1", false],
    ["/OBJECTS/uploads/biz_A/obj1", false],
    ["objects/uploads/biz_A/obj1", false],
  ])("%s → %s", (path, expected) => {
    expect(isOwnUploadPath(path, "biz_A")).toBe(expected);
  });
});

describe("S-M1 / S-m1 / S-m2: receiptKind", () => {
  it.each([
    ["http://api.test/objects/uploads/biz_A/obj1", "stored"],
    ["/objects/uploads/biz_A/obj1", "stored"],
    ["http://api.test/objects/uploads/biz_A1/obj1", "unavailable"],
    ["/objects/uploads/biz_A1/obj1", "unavailable"],
    ["http://evil.test/objects/uploads/biz_A/obj1", "unavailable"],
    ["http://evil.test/OBJECTS/uploads/biz_A/obj1", "unavailable"],
    ["https://evil.test/Objects/uploads/biz_OTHER/x.png", "unavailable"],
    ["//evil.test/objects/uploads/biz_A/obj1", "unavailable"],
    ["http://api.test/objects/uploads/biz_A/obj%2e", "unavailable"],
    ["http://api.test/objects/uploads/biz_A/a\\b", "unavailable"],
    ["http://api.test/OBJECTS/uploads/biz_OTHER/obj1", "unavailable"],
    ["http://api.test/objects/exports/biz_A/x.zip", "unavailable"],
    ["javascript:alert(1)", "unavailable"],
    ["JavaScript:alert(1)", "unavailable"],
    ["data:image/png;base64,iVBORw0KGgo=", "unavailable"],
    ["ftp://files.test/r.jpg", "unavailable"],
    ["https://drive.google.com/file/d/abc/view", "link"],
    ["http://receipts.test/r.jpg", "link"],
    ["", "none"],
  ])("%s → %s", (url, kind) => {
    expect(receiptKind(url, "biz_A")).toBe(kind);
  });
});

describe("S-M1 / S-m2: the detail page", () => {
  async function mountDetail(receiptUrl: string) {
    client.getExpense.mockResolvedValue(ok(expense({ receiptUrl })));
    render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Alpha Landlord" });
  }
  const hrefs = () => Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
  const srcs = () => Array.from(document.querySelectorAll("img[src]")).map((i) => i.getAttribute("src"));

  it("a prefix-colliding business's upload (biz_A1 seen from biz_A) is neither linked nor said to be stored", async () => {
    const url = "http://api.test/objects/uploads/biz_A1/obj1";
    await mountDetail(url);
    expect(text()).not.toMatch(STORED_NOTE);
    expect(hrefs()).not.toContain(url);
  });

  for (const url of ["javascript:alert(1)", "data:image/png;base64,iVBORw0KGgo=", "http://api.test/OBJECTS/uploads/biz_OTHER/obj1.png"]) {
    it(`${url.slice(0, 30)}… is never an href or an img src`, async () => {
      await mountDetail(url);
      expect(hrefs()).not.toContain(url);
      expect(srcs()).not.toContain(url);
      expect(text()).not.toMatch(STORED_NOTE);
    });
  }

  it("an http(s) receipt elsewhere keeps its link", async () => {
    const url = "https://receipts.test/r.png";
    await mountDetail(url);
    expect(hrefs()).toContain(url);
  });
});

describe("S-M1: the sheet", () => {
  it("a prefix-colliding business's upload (biz_A1 seen from biz_A) is not said to be stored", () => {
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={expense({ receiptUrl: "http://api.test/objects/uploads/biz_A1/obj1" })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).queryByText(STORED_NOTE)).toBeNull();
  });
});

describe("S-M2 / S-m3: the sheet's own upload", () => {
  function mountSheet() {
    render(<ExpenseFormSideSheet businessId="biz_A" categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    return screen.getByRole("dialog");
  }
  async function saveAndPayload(sheet: HTMLElement) {
    fireEvent.change(within(sheet).getByPlaceholderText(/What was this expense for|description/i), { target: { value: "Flour" } });
    fireEvent.change(within(sheet).getByPlaceholderText("0.00"), { target: { value: "10" } });
    const buttons = within(sheet).getAllByRole("button", { name: /^(add|save|create)( expense)?$/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledTimes(1));
    return client.createExpense.mock.calls[0][1] as Record<string, unknown>;
  }

  for (const [what, path] of [
    ["another business's", "/objects/uploads/biz_OTHER/obj1"],
    ["a prefix-colliding business's", "/objects/uploads/biz_A1/obj1"],
  ] as const) {
    it(`${what} upload path is refused and no receiptUrl is written`, async () => {
      uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: path, metadata: {} });
      const sheet = mountSheet();
      fireEvent.change(within(sheet).getByLabelText(/^take photo$/i), { target: { files: [photo()] } });
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(within(sheet).queryByText(/receipt attached/i)).toBeNull();
      const payload = await saveAndPayload(sheet);
      expect(payload.receiptUrl).toBeUndefined();
    });
  }

  it("refuses before the presign when the stored business is not the sheet's", async () => {
    ws.bid = "biz_B";
    const sheet = mountSheet();
    fireEvent.change(within(sheet).getByLabelText(/^take photo$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe("S-M2: the page's upload check", () => {
  it("a prefix-colliding business's upload path is refused; no sheet opens with it", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A1/obj1", metadata: {} });
    render(<ExpensesInboxPage />);
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an upload path that is not an own upload at all is refused too", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: "https://evil.test/x.jpg", metadata: {} });
    render(<ExpensesInboxPage />);
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("C-m2: the attention queue's receipt line says what the server counted", () => {
  it("it names all statuses and the period, not 'need a reminder before close'", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense()], total: 1, page: 1, limit: 20 }));
    client.fetchExpenseSummary.mockResolvedValue(ok(summary(300, { missingReceiptCount: 3 })));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    const queue = screen.getByRole("heading", { name: /attention queue/i }).parentElement!;
    expect(queue.textContent).not.toMatch(/reminder before close/i);
    expect(queue.textContent).toMatch(/3 expenses without a receipt/i);
    expect(queue.textContent).toMatch(/all statuses/i);
  });
});

describe("C-m3: A → B → A drops the first A read's late reply", () => {
  it("the stale A answer never replaces the fresh A answer", async () => {
    let firstA: (v: unknown) => void = () => {};
    let aCalls = 0;
    client.fetchExpenses.mockImplementation((b: string) => {
      if (b === "biz_A") {
        aCalls += 1;
        if (aCalls === 1) return new Promise((r) => { firstA = r; });
        return Promise.resolve(ok({ data: [expense({ id: "exp_a2", description: "Alpha fresh" })], total: 1, page: 1, limit: 20 }));
      }
      return Promise.resolve(ok({ data: [expense({ id: "exp_b1", description: "Beta fuel" })], total: 1, page: 1, limit: 20 }));
    });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(aCalls).toBe(1));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(text()).toMatch(/beta fuel/i));
    ws.bid = "biz_A";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_A" } })); });
    await waitFor(() => expect(text()).toMatch(/alpha fresh/i));
    await act(async () => { firstA(ok({ data: [expense({ id: "exp_a_stale", description: "Alpha stale" })], total: 1, page: 1, limit: 20 })); });
    expect(text()).not.toMatch(/alpha stale/i);
    expect(text()).toMatch(/alpha fresh/i);
  });
});
