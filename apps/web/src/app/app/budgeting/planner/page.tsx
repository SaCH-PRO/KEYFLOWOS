"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Save,
  HelpCircle,
  Copy,
  ArrowRightLeft,
  CheckCircle,
  Loader2,
  Lock,
  Unlock,
} from "lucide-react";
import {
  fetchExpenseBudgets,
  fetchExpenseCategories,
  upsertExpenseBudget,
  ExpenseBudget,
  ExpenseCategory,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(amount: number): string {
  return `TTD $${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatK(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return String(Math.round(amount));
}

interface CellData {
  amount: number;
  locked: boolean;
}

export default function BudgetPlannerPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [year, _setYear] = useState(new Date().getFullYear());
  const [edits, setEdits] = useState<Record<string, CellData>>({});
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const catRes = await fetchExpenseCategories(businessId);
      if (catRes.data) setCategories(catRes.data);

      // Fetch budgets for all months of the year
      const allBudgets: ExpenseBudget[] = [];
      for (let m = 1; m <= 12; m++) {
        const res = await fetchExpenseBudgets(businessId, m, year);
        if (res.data) allBudgets.push(...res.data);
      }
      setBudgets(allBudgets);

      // Populate edits from fetched budgets
      const initialEdits: Record<string, CellData> = {};
      allBudgets.forEach((b) => {
        initialEdits[`${b.categoryId || "none"}-${b.month}`] = {
          amount: b.amount,
          locked: false,
        };
      });
      setEdits(initialEdits);
    } catch {
      toast.error("Failed to load budgets");
    }
    setLoading(false);
  }, [businessId, year]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const gridData = useMemo(() => {
    const cats: ExpenseCategory[] = categories.length > 0 ? categories : [{ id: "none", name: "Uncategorized", color: undefined } as unknown as ExpenseCategory];
    return cats.map((cat) => {
      const row: { cat: ExpenseCategory; cells: (number | null)[]; total: number; status: string } = {
        cat,
        cells: [],
        total: 0,
        status: "On track",
      };
      for (let m = 1; m <= 12; m++) {
        const key = `${cat.id}-${m}`;
        const val = edits[key]?.amount ?? budgets.find((b) => b.categoryId === cat.id && b.month === m)?.amount ?? null;
        row.cells.push(val);
        if (val !== null) row.total += val;
      }
      // Derive status from total vs some heuristic
      const avgMonthly = row.total / 12;
      const maxMonthly = Math.max(...row.cells.map((c) => c ?? 0));
      if (maxMonthly > avgMonthly * 1.5) row.status = "At risk";
      if (maxMonthly > avgMonthly * 2) row.status = "Over";
      return row;
    });
  }, [categories, budgets, edits]);

  const colTotals = useMemo(() => {
    const totals: number[] = [];
    for (let m = 0; m < 12; m++) {
      totals.push(gridData.reduce((sum, row) => sum + (row.cells[m] ?? 0), 0));
    }
    return totals;
  }, [gridData]);

  const grandTotal = useMemo(() => colTotals.reduce((s, v) => s + v, 0), [colTotals]);

  const handleCellChange = (catId: string, month: number, value: string) => {
    const num = value === "" ? 0 : parseFloat(value);
    if (Number.isNaN(num)) return;
    const key = `${catId}-${month}`;
    setEdits((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { locked: false }), amount: num },
    }));
  };

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      const promises = Object.entries(edits).map(async ([key, data]) => {
        const [catId, monthStr] = key.split("-");
        const month = parseInt(monthStr, 10);
        await upsertExpenseBudget(businessId, {
          categoryId: catId === "none" ? undefined : catId,
          month,
          year,
          amount: data.amount,
          alertAt: 80,
          rollover: false,
        });
      });
      await Promise.all(promises);
      toast.success("Budget saved");
      void loadData();
    } catch {
      toast.error("Failed to save budget");
    }
    setSaving(false);
  };

  const handleSpreadAnnual = () => {
    // Spread each row's total evenly across 12 months
    const newEdits = { ...edits };
    gridData.forEach((row) => {
      const monthly = Math.round(row.total / 12);
      for (let m = 1; m <= 12; m++) {
        const key = `${row.cat.id}-${m}`;
        newEdits[key] = { ...(newEdits[key] || { locked: false }), amount: monthly };
      }
    });
    setEdits(newEdits);
    toast.success("Annual amounts spread across months");
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string }> = {
      "On track": { bg: "bg-emerald-50", color: "text-emerald-700" },
      "At risk": { bg: "bg-amber-50", color: "text-amber-700" },
      Over: { bg: "bg-rose-50", color: "text-rose-700" },
      Review: { bg: "bg-purple-50", color: "text-purple-700" },
      Healthy: { bg: "bg-teal-50", color: "text-teal-700" },
      Locked: { bg: "bg-slate-50", color: "text-slate-700" },
    };
    const s = map[status] || map["On track"];
    return (
      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium", s.bg, s.color)}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <button
              onClick={() => router.push("/app/budgeting")}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to budgeting
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Budget planner</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Build, version, and approve budgets by month, category, team, or project.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden sm:flex items-center justify-center w-9 h-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            {year} Operating Budget
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground">
            <Unlock className="w-3.5 h-3.5 text-muted-foreground" />
            Version: Draft v3
          </div>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Copy className="w-3.5 h-3.5" />
            Copy from last year
          </button>
          <button
            onClick={handleSpreadAnnual}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Spread annual amount
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/5 transition-colors ml-auto">
            <CheckCircle className="w-3.5 h-3.5" />
            Submit for approval
          </button>
        </div>

        {/* Grid */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Monthly budget grid</h3>
              <p className="text-xs text-muted-foreground">Spreadsheet-style planning with totals, locking, and approval-ready controls.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 text-purple-700">Draft</span>
              <span className="text-xs text-muted-foreground">Total annual budget</span>
              <span className="text-lg font-bold text-foreground">{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs sticky left-0 bg-muted/30 min-w-[140px]">Category</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="px-2 py-2.5 text-right font-medium text-muted-foreground text-xs min-w-[60px]">{m}</th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs min-w-[80px]">Total</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs min-w-[80px]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {gridData.map((row) => (
                    <tr key={row.cat.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 sticky left-0 bg-card font-medium text-sm text-foreground">
                        <div className="flex items-center gap-2">
                          {row.cat.color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: row.cat.color }} />}
                          {row.cat.name}
                        </div>
                      </td>
                      {row.cells.map((val, idx) => {
                        const month = idx + 1;
                        const key = `${row.cat.id}-${month}`;
                        const isSelected = selectedCell === key;
                        return (
                          <td key={idx} className="px-2 py-2">
                            <input
                              type="text"
                              value={val === null || val === 0 ? "" : formatK(val)}
                              onChange={(e) => handleCellChange(row.cat.id, month, e.target.value.replace(/[^0-9.]/g, ""))}
                              onFocus={() => setSelectedCell(key)}
                              onBlur={() => setSelectedCell(null)}
                              className={cn(
                                "w-full text-right text-xs py-1 px-1.5 rounded border outline-none transition-colors bg-transparent",
                                isSelected
                                  ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5"
                                  : "border-transparent hover:border-border"
                              )}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">{formatCurrency(row.total)}</td>
                      <td className="px-3 py-2">{statusBadge(row.status)}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                    <td className="px-3 py-2.5 text-sm text-foreground sticky left-0 bg-muted/20">Total</td>
                    {colTotals.map((total, i) => (
                      <td key={i} className="px-2 py-2.5 text-right text-xs text-foreground">{formatK(total)}</td>
                    ))}
                    <td className="px-3 py-2.5 text-right text-sm text-foreground">{formatCurrency(grandTotal)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bottom info */}
        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          {selectedCell && (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20 text-sm">
              <span className="text-[hsl(var(--kf-accent1))] font-medium">Selected cell</span>
              <span className="text-muted-foreground">{selectedCell}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground ml-auto">
            Tip: use <span className="font-medium text-foreground">Spread annual amount</span> to distribute yearly totals across months.
          </p>
        </div>
      </div>
    </div>
  );
}
