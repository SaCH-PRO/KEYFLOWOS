"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Tab, InvoiceLineItem, generateItemId } from "../components/commerce-types";
import type { Invoice } from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";

export function useCommerceOverview(invoices: Invoice[], businessCurrency: string) {
  const [tab, setTab] = useState<Tab>("overview");

  const handleTabChange = useCallback((t: string) => setTab(t as Tab), []);

  const revenuePulse = useMemo(() => {
    const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    return formatCurrencyCompact(totalRevenue, businessCurrency);
  }, [invoices, businessCurrency]);

  return {
    tab,
    setTab,
    handleTabChange,
    revenuePulse,
  };
}

export type UseCommerceOverviewReturn = ReturnType<typeof useCommerceOverview>;
