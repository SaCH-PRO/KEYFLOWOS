"use client";

import { motion } from "framer-motion";
import { Store } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { VendorAnalytics } from "@/lib/client";
import { formatCurrency, formatDate } from "./expense-utils";

interface ExpenseVendorsTabProps {
  vendors: VendorAnalytics[];
}

export function ExpenseVendorsTab({ vendors }: ExpenseVendorsTabProps) {
  return (
    <motion.div key="vendors" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="kf-card rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border/40"><h3 className="text-sm font-semibold flex items-center gap-2"><Store className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />Vendor Analytics</h3></div>
        {vendors.length === 0 ? (
          <div className="py-4">
            <EmptyState
              icon={Store}
              title="No vendor data yet"
              description="Add vendors to your expenses to see spending breakdowns and payment history."
              actionLabel="Add Expense"
              onAction={() => { window.location.href = "/app/expenses?tab=expenses"; }}
              tip="Track which vendors you spend the most with to negotiate better rates."
            />
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider">
              <span>Vendor</span><span className="text-right">Total</span><span className="text-right">Average</span><span className="text-right">Transactions</span><span className="text-right">Last Payment</span>
            </div>
            {vendors.map((v, i) => (
              <div key={v.name} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-1 md:gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors items-center">
                <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground">{i + 1}</span><span className="text-sm font-medium">{v.name}</span></div>
                <span className="text-sm font-semibold text-right text-red-400">{formatCurrency(v.total)}</span>
                <span className="text-xs text-right text-muted-foreground">{formatCurrency(v.average)}</span>
                <span className="text-xs text-right text-muted-foreground">{v.count} txns</span>
                <span className="text-xs text-right text-muted-foreground">{formatDate(v.lastDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
