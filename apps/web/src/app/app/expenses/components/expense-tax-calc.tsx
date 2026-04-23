"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, ChevronDown, ChevronRight } from "lucide-react";
import { ExpenseSummary } from "@/lib/client";
import { formatCurrency } from "./expense-utils";

interface ExpenseTaxCalcProps {
  summary: ExpenseSummary | null;
}

export function ExpenseTaxCalc({ summary }: ExpenseTaxCalcProps) {
  const [showTaxCalc, setShowTaxCalc] = useState(false);
  const [taxRate, setTaxRate] = useState("12.5");
  const [annualIncome, setAnnualIncome] = useState("");

  const taxCalc = (() => {
    const income = parseFloat(annualIncome) || 0;
    const rate = parseFloat(taxRate) || 0;
    const totalExp = summary?.total || 0;
    const taxableIncome = Math.max(0, income - totalExp);
    const estimatedTax = taxableIncome * (rate / 100);
    const effectiveRate = income > 0 ? (estimatedTax / income) * 100 : 0;
    return { income, totalExpenses: totalExp, taxableIncome, estimatedTax, effectiveRate };
  })();

  return (
    <div className="kf-card rounded-xl overflow-hidden">
      <button onClick={() => setShowTaxCalc(!showTaxCalc)} className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Calculator className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Tax Estimator</h3>
        {showTaxCalc ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {showTaxCalc && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-4">
              <p className="text-xs text-muted-foreground">Estimate your tax liability based on income and tracked expenses. Default rate is Trinidad VAT (12.5%).</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground mb-1 block">Annual Income (TTD)</label><input type="number" value={annualIncome} onChange={e => setAnnualIncome(e.target.value)} placeholder="0.00" className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Tax Rate (%)</label><input type="number" step="0.1" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Income</p><p className="text-sm font-semibold text-green-400">{formatCurrency(taxCalc.income)}</p></div>
                <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Deductions</p><p className="text-sm font-semibold text-red-400">{formatCurrency(taxCalc.totalExpenses)}</p></div>
                <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Taxable</p><p className="text-sm font-semibold text-amber-400">{formatCurrency(taxCalc.taxableIncome)}</p></div>
                <div className="bg-white/5 rounded-lg p-3 text-center"><p className="text-[10px] text-muted-foreground uppercase">Est. Tax</p><p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{formatCurrency(taxCalc.estimatedTax)}</p></div>
              </div>
              {taxCalc.effectiveRate > 0 && <p className="text-xs text-muted-foreground text-center">Effective tax rate: {taxCalc.effectiveRate.toFixed(1)}%</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
