"use client";

import { useEffect, useState, useCallback } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchFinanceOverview,
  fetchInvoices,
  listQuotes,
  fetchExpenses,
  fetchExpenseSummary,
  fetchRecurringInvoices,
  fetchRevenueOverview,
  fetchCommerceStats,
  type FinanceOverview,
  type Invoice,
  type Quote,
  type Expense,
  type ExpenseSummary,
  type RecurringInvoice,
  type RevenueOverview,
  type CommerceStats,
} from "@/lib/client";

export interface MoneyHubData {
  overview: FinanceOverview | null;
  invoices: Invoice[];
  quotes: Quote[];
  expenses: Expense[];
  expenseSummary: ExpenseSummary | null;
  recurring: RecurringInvoice[];
  revenueOverview: RevenueOverview | null;
  commerceStats: CommerceStats | null;
}

export function useMoneyHub() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [data, setData] = useState<MoneyHubData>({
    overview: null,
    invoices: [],
    quotes: [],
    expenses: [],
    expenseSummary: null,
    recurring: [],
    revenueOverview: null,
    commerceStats: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    try {
      const [overviewRes, invoicesRes, quotesRes, expensesRes, summaryRes, recurringRes, revenueRes, commerceRes] =
        await Promise.all([
          fetchFinanceOverview(businessId),
          fetchInvoices(businessId),
          listQuotes(businessId),
          fetchExpenses(businessId, { period: "30d", limit: 5 }),
          fetchExpenseSummary(businessId, "30d"),
          fetchRecurringInvoices(businessId),
          fetchRevenueOverview(businessId),
          fetchCommerceStats(businessId),
        ]);

      const allInvoices = invoicesRes.data ?? [];
      const allQuotes = quotesRes.data ?? [];

      setData({
        overview: overviewRes.data ?? null,
        invoices: allInvoices.slice(0, 5),
        quotes: allQuotes.slice(0, 5),
        expenses: expensesRes.data?.data ?? [],
        expenseSummary: summaryRes.data ?? null,
        recurring: recurringRes.data ?? [],
        revenueOverview: revenueRes.data ?? null,
        commerceStats: commerceRes.data ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load money data");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) load();
  }, [businessId, load]);

  return { data, loading, error, reload: load, businessId };
}
