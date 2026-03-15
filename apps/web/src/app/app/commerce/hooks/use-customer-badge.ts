"use client";

import { useMemo } from "react";
import type { Invoice, Quote } from "@/lib/client";

export type CustomerBadgeType = "healthy" | "slow_payer" | "high_value" | "at_risk" | "new_client";

export interface CustomerBadge {
  type: CustomerBadgeType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}

const BADGE_CONFIG: Record<CustomerBadgeType, Omit<CustomerBadge, "description">> = {
  healthy: { type: "healthy", label: "Healthy", color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/25" },
  slow_payer: { type: "slow_payer", label: "Slow Payer", color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/25" },
  high_value: { type: "high_value", label: "High Value", color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/25" },
  at_risk: { type: "at_risk", label: "At Risk", color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/25" },
  new_client: { type: "new_client", label: "New Client", color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/25" },
};

function computeBadge(
  contactId: string | null | undefined,
  invoices: Invoice[],
  _quotes: Quote[],
): CustomerBadge | null {
  if (!contactId) return null;

  const contactInvoices = invoices.filter((inv) => inv.contactId === contactId);
  if (contactInvoices.length === 0) {
    return { ...BADGE_CONFIG.new_client, description: "No invoice history yet" };
  }

  if (contactInvoices.length <= 2) {
    return { ...BADGE_CONFIG.new_client, description: `${contactInvoices.length} invoice${contactInvoices.length > 1 ? "s" : ""} so far` };
  }

  const paidInvoices = contactInvoices.filter((inv) => inv.status === "PAID");
  const overdueInvoices = contactInvoices.filter((inv) => inv.status === "OVERDUE");
  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
  const payRate = contactInvoices.length > 0 ? paidInvoices.length / contactInvoices.length : 0;

  if (overdueInvoices.length >= 2 || overdueAmount > totalRevenue * 0.5) {
    return { ...BADGE_CONFIG.at_risk, description: `${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? "s" : ""}` };
  }

  if (payRate < 0.5 && contactInvoices.length > 3) {
    return { ...BADGE_CONFIG.slow_payer, description: `${Math.round(payRate * 100)}% payment rate` };
  }

  if (totalRevenue > 10000 || paidInvoices.length >= 10) {
    return { ...BADGE_CONFIG.high_value, description: `${paidInvoices.length} paid invoices` };
  }

  if (payRate >= 0.7) {
    return { ...BADGE_CONFIG.healthy, description: `${Math.round(payRate * 100)}% on-time` };
  }

  if (overdueInvoices.length >= 1) {
    return { ...BADGE_CONFIG.slow_payer, description: `${overdueInvoices.length} overdue` };
  }

  return { ...BADGE_CONFIG.healthy, description: "Good payment history" };
}

export function useCustomerBadge(
  contactId: string | null | undefined,
  invoices: Invoice[],
  quotes: Quote[],
): CustomerBadge | null {
  return useMemo(
    () => computeBadge(contactId, invoices, quotes),
    [contactId, invoices, quotes],
  );
}

export function useCustomerBadgeMap(
  invoices: Invoice[],
  quotes: Quote[],
): Map<string, CustomerBadge> {
  return useMemo(() => {
    const contactIds = new Set<string>();
    for (const inv of invoices) {
      if (inv.contactId) contactIds.add(inv.contactId);
    }
    for (const q of quotes) {
      if (q.contactId) contactIds.add(q.contactId);
    }
    const map = new Map<string, CustomerBadge>();
    for (const cid of contactIds) {
      const badge = computeBadge(cid, invoices, quotes);
      if (badge) map.set(cid, badge);
    }
    return map;
  }, [invoices, quotes]);
}
