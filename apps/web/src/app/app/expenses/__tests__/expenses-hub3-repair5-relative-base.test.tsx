/**
 * EXPENSES-HUB-3 repair round 5, MAJOR-1: a relative API base (NEXT_PUBLIC_API_BASE_URL="/__api", accepted by
 * lib/env.ts and documented for Vercel, served by next.config's /__api rewrite). The sheets store an upload as
 * API_BASE + objectPath, "/__api/objects/uploads/<biz>/<id>": that is "stored" for its own business, "unavailable"
 * for another, and an https receipt elsewhere is still a link. Absolute-base cases are in expenses-hub3-repair5.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const getExpense = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ API_BASE: "/__api", getAuthHeaders: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_rel",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_rel" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ({ id: "biz_A", name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
  getStoredBusinessId: () => "biz_A",
}));
vi.mock("@/lib/client", () => ({
  getExpense: (...a: unknown[]) => getExpense(...a),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchExpenseCategories: vi.fn(async () => ({ data: [], error: null })),
  fetchExpenseBudgets: vi.fn(async () => ({ data: [], error: null })),
  fetchFinanceAccounts: vi.fn(async () => ({ data: [], error: null })),
  PAYMENT_METHODS: [],
}));

import { receiptKind } from "../components/expense-form-sidesheet";
import ExpenseDetailPage from "../[id]/page";

afterEach(() => cleanup());

describe("MAJOR-1: receiptKind with API_BASE = '/__api'", () => {
  it.each([
    ["/__api/objects/uploads/biz_A/obj1", "stored"],
    ["/__api/objects/uploads/biz_B/obj1", "unavailable"],
    ["/__api/objects/uploads/biz_A1/obj1", "unavailable"],
    ["/__api/files/x.png", "unavailable"],
    ["/objects/uploads/biz_A/obj1", "stored"],
    ["https://drive.google.com/file/d/abc/view", "link"],
    [`${window.location.origin}/__api/objects/uploads/biz_B/obj1`, "unavailable"],
    [`${window.location.origin}/anything.png`, "unavailable"],
  ])("%s → %s", (url, kind) => {
    expect(receiptKind(url, "biz_A")).toBe(kind);
  });

  it("the detail page says an own upload under /__api is stored, and links nothing at it", async () => {
    getExpense.mockResolvedValue({
      data: {
        id: "exp_rel", description: "Toner", amount: 10, currency: "TTD", date: "2026-11-20T00:00:00.000Z", vendor: "Office Depot",
        paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: null,
        createdAt: "2026-11-20T00:00:00.000Z", updatedAt: "2026-11-20T00:00:00.000Z", receiptUrl: "/__api/objects/uploads/biz_A/obj1",
      } as Expense,
      error: null,
    });
    render(<ExpenseDetailPage />);
    await screen.findByRole("heading", { name: "Office Depot" });
    expect(document.body.textContent).toMatch(/receipt stored — viewing isn't available yet/i);
    expect(Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))).not.toContain("/__api/objects/uploads/biz_A/obj1");
  });
});
