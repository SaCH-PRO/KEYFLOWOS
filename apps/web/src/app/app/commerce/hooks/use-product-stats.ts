"use client";

import { useMemo } from "react";

interface ProductStatsInput {
  productId: string | null;
  invoices: Array<{ items?: Array<{ productId?: string | null }>; status?: string }>;
  quotes: Array<{ items?: Array<{ productId?: string | null }> }>;
}

export interface ProductStats {
  invoiceCount: number;
  quoteCount: number;
  totalRevenue: number;
}

export function useProductStats({ productId, invoices, quotes }: ProductStatsInput): ProductStats {
  return useMemo(() => {
    if (!productId) return { invoiceCount: 0, quoteCount: 0, totalRevenue: 0 };
    const pid = productId;
    const invoiceCount = invoices.filter(inv => inv.items?.some(item => item.productId === pid)).length;
    const quoteCount = quotes.filter(q => q.items?.some(item => item.productId === pid)).length;
    const totalRevenue = invoices
      .filter(inv => (inv as any).status === "PAID")
      .reduce((sum, inv) => {
        const matching = inv.items?.filter(item => item.productId === pid) ?? [];
        return sum + matching.reduce((s, item) => s + ((item as any).total ?? (Number((item as any).unitPrice ?? 0) * Number((item as any).quantity ?? 1))), 0);
      }, 0);
    return { invoiceCount, quoteCount, totalRevenue };
  }, [productId, invoices, quotes]);
}
