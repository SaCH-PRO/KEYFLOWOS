"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Receipt } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCurrency } from "@/lib/currency";

interface TaxGroup {
  rate: number;
  invoiceCount: number;
  taxableAmount: number;
  taxCollected: number;
}

interface TaxSummaryPanelProps {
  invoices: { taxRate?: number | null; subtotal?: number | null; taxAmount?: number | null; status: string }[];
  currency: string;
}

export function TaxSummaryPanel({ invoices, currency }: TaxSummaryPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const taxGroups = useMemo(() => {
    const groups: Record<number, TaxGroup> = {};
    let totalTax = 0;

    for (const inv of invoices) {
      if (inv.status === "VOID") continue;
      const rate = Number(inv.taxRate ?? 0);
      const subtotal = Number(inv.subtotal ?? 0);
      const taxAmt = Number(inv.taxAmount ?? 0);

      if (!groups[rate]) {
        groups[rate] = { rate, invoiceCount: 0, taxableAmount: 0, taxCollected: 0 };
      }
      groups[rate].invoiceCount++;
      groups[rate].taxableAmount += subtotal;
      groups[rate].taxCollected += taxAmt;
      totalTax += taxAmt;
    }

    return {
      groups: Object.values(groups).sort((a, b) => b.rate - a.rate),
      totalTax,
    };
  }, [invoices]);

  if (taxGroups.groups.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <Receipt className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Tax Summary
        </span>
        <span className="text-xs font-bold ml-auto mr-2">
          {formatCurrency(taxGroups.totalTax, currency)}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <div className="rounded-lg border border-border/30 overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-white/[0.02] border-b border-border/20">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Rate</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Invoices</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Taxable</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-right">Tax</span>
                </div>
                {taxGroups.groups.map((group) => (
                  <div key={group.rate} className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-border/10 last:border-b-0">
                    <span className="text-xs font-medium">{group.rate}%</span>
                    <span className="text-xs text-muted-foreground">{group.invoiceCount}</span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(group.taxableAmount, currency)}</span>
                    <span className="text-xs font-semibold text-right">{formatCurrency(group.taxCollected, currency)}</span>
                  </div>
                ))}
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-white/[0.02]">
                  <span className="text-[10px] font-bold uppercase col-span-3">Total Tax</span>
                  <span className="text-xs font-bold text-right">{formatCurrency(taxGroups.totalTax, currency)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
