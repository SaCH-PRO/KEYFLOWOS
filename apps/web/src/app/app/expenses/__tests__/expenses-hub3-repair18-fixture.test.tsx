/**
 * EXPENSES-HUB-3 repair round 18 (R17 reviews at 1eee70b): the e2e fixture for the modal's receipt upload stores its
 * business, so the modal (which writes only for the stored business, R17) saves there. The real workspace module.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const createExpense = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({ createExpense, updateExpense: vi.fn(), createRecurringExpense: vi.fn(), extractReceipt: vi.fn(), PAYMENT_METHODS: [] }));

import FixturePage, { TEST_BUSINESS_ID } from "../../../e2e-fixtures/expense-receipt-upload/page";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the expense receipt e2e fixture", () => {
  it("stores its business, so the modal's save is sent for it", async () => {
    window.localStorage.clear();
    createExpense.mockResolvedValue({ data: { id: "exp_fx" }, error: null });
    render(<FixturePage />);
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "Fixture" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(createExpense).toHaveBeenCalledWith(TEST_BUSINESS_ID, expect.anything()));
  });
});
