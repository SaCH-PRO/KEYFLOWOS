/**
 * EXPENSES-HUB-3 (SWP-EXPENSE-PAGE-TRUTH; journey H4 "a receipt photo from the camera").
 *
 * "Upload receipts" on the Expenses page is a button with no handler: it does nothing. A receipt is uploaded through
 * the existing presigned upload (hooks/use-upload.ts, the uploads module) and its object path is written to
 * Expense.receiptUrl when the expense is saved. On a phone the receipt control opens the camera (capture). No OCR is
 * run and nothing is migrated.
 *
 * Mounted on the real page and the real sheet; only the client calls, the upload hook's transport, next/navigation,
 * sonner and the cached business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const BUSINESS = "biz_hub3_receipt";
const OBJECT_PATH = `/objects/uploads/${BUSINESS}/obj_receipt_1`;

const client = vi.hoisted(() => ({
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ({ id: "biz_hub3_receipt", name: "Receipt Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
  getStoredBusinessId: () => "biz_hub3_receipt",
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
const photo = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "receipt.jpg", { type: "image/jpeg" });

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  client.createExpense.mockResolvedValue(ok({ id: "exp_new", description: "Flour", amount: 86.4, status: "PAID" }));
  uploadFile.mockReset().mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: OBJECT_PATH, metadata: { name: "receipt.jpg", size: 4, contentType: "image/jpeg" } });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

async function mountPage() {
  const view = render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
  return view;
}

function saveExpense(sheet: HTMLElement, description: string, amount: string) {
  fireEvent.change(within(sheet).getByPlaceholderText(/What was this expense for|description/i), { target: { value: description } });
  fireEvent.change(within(sheet).getByPlaceholderText("0.00"), { target: { value: amount } });
  const buttons = within(sheet).getAllByRole("button", { name: /^(add|save|create)( expense)?$/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("the Expenses page's Upload receipt works", () => {
  it("is a photo control that opens the camera on a phone", async () => {
    await mountPage();
    const input = (await screen.findByLabelText(/^upload receipt$/i)) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("file");
    expect(input.accept).toMatch(/image\//);
    expect(input.getAttribute("capture")).toBe("environment");
  });

  it("uploads the photo through the presigned upload and opens Add expense with it attached; the save writes receiptUrl", async () => {
    await mountPage();
    const file = photo();
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [file] } });

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0][0]).toBe(file);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/receipt attached/i)).toBeTruthy();

    saveExpense(sheet, "Flour", "86.40");
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledTimes(1));
    expect(client.createExpense.mock.calls[0][0]).toBe(BUSINESS);
    expect(client.createExpense.mock.calls[0][1]).toMatchObject({ receiptUrl: `http://api.test${OBJECT_PATH}` });
  });

  it("a failed upload says so and opens no sheet claiming a receipt", async () => {
    uploadFile.mockResolvedValue(null);
    await mountPage();
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(/receipt/i);
    expect(screen.queryByText(/receipt attached/i)).toBeNull();
    expect(client.createExpense).not.toHaveBeenCalled();
  });
});

describe("the Add expense sheet's receipt takes a photo with the camera on a phone", () => {
  function mountSheet() {
    const onSaved = vi.fn();
    render(
      <ExpenseFormSideSheet businessId={BUSINESS} categories={[]} editingExpense={null} onClose={vi.fn()} onSaved={onSaved} />,
    );
    return { onSaved, sheet: screen.getByRole("dialog") };
  }

  it("offers Take photo (camera) beside Upload file (any image or PDF)", () => {
    const { sheet } = mountSheet();
    const camera = within(sheet).getByLabelText(/^take photo$/i) as HTMLInputElement;
    expect(camera.type).toBe("file");
    expect(camera.accept).toMatch(/image\//);
    expect(camera.getAttribute("capture")).toBe("environment");
    const file = within(sheet).getByLabelText(/^upload file$/i) as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.accept).toMatch(/pdf/);
    expect(file.getAttribute("capture")).toBeNull();
  });

  it("a photo taken is uploaded and saved on the expense as its receiptUrl", async () => {
    const { sheet } = mountSheet();
    fireEvent.change(within(sheet).getByLabelText(/^take photo$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(sheet).getByText(/receipt attached/i)).toBeTruthy());
    saveExpense(sheet, "Flour", "86.40");
    await waitFor(() => expect(client.createExpense).toHaveBeenCalledTimes(1));
    expect(client.createExpense.mock.calls[0][1]).toMatchObject({ receiptUrl: `http://api.test${OBJECT_PATH}` });
  });
});
