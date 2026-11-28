/**
 * EXPENSES-HUB-3 (BUG-027 remainder, orchestrator-approved): the metrics row and the tax estimator still wrote a
 * literal "TTD". Both use the business currency (expense-utils businessCurrency), so a USD business reads USD.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/workspace", () => ({
  getCachedBusiness: () => ({ id: "biz_hub3_usd", name: "Dollar Co", currency: "USD", timezone: "America/New_York" }),
  getStoredBusinessId: () => "biz_hub3_usd",
}));

import { ExpenseMetricsRow } from "../components/expense-metrics-row";
import { ExpenseTaxCalc } from "../components/expense-tax-calc";
import type { ExpenseSummary } from "@/lib/client";

afterEach(() => cleanup());

const text = () => document.body.textContent ?? "";

describe("the expense metrics row and tax estimator use the business currency, never a literal TTD", () => {
  it("the metrics row's amounts are in the business currency when none is passed", () => {
    render(<ExpenseMetricsRow expenses={[]} summary={{ total: 1234.5 } as ExpenseSummary} />);
    expect(text()).not.toMatch(/TTD|TT\$/);
    expect(text()).toMatch(/\$1,234\.50|USD\s?1,234\.50/);
  });

  it("the tax estimator asks the annual income in the business currency", () => {
    render(<ExpenseTaxCalc summary={{ total: 100 } as ExpenseSummary} />);
    fireEvent.click(screen.getByRole("button", { name: /tax estimator/i }));
    expect(screen.getByText(/annual income/i).textContent).toMatch(/\(USD\)/);
    expect(text()).not.toMatch(/\(TTD\)/);
  });
});
