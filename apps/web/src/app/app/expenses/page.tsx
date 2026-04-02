"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { Receipt, DollarSign, Target, Store, Download, ArrowUp, ArrowDown, Minus, BarChart3 } from "lucide-react";
import { deleteExpense, getExpenseExportUrl, Expense } from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";

import { ListPageSkeleton } from "@/components/ui/skeleton";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ModuleWalkthrough, WalkthroughTrigger } from "@/components/ui/module-walkthrough";
import { MetricExplainer } from "@/components/ui/metric-explainer";
import { EXPENSES_WALKTHROUGH, METRIC_DEFINITIONS } from "@/lib/walkthrough-definitions";
import { formatCurrency } from "./components/expense-utils";
import { useExpensesData } from "./components/use-expenses-data";
import { useExpensesAiHub } from "./hooks/use-expenses-ai-hub";
import { ExpenseFilters } from "./components/expense-filters";
import { ExpenseList } from "./components/expense-list";
import { ExpenseFormModal } from "./components/expense-form-modal";
import { ExpenseBudgetsTab } from "./components/expense-budgets-tab";
import { ExpenseCategoriesTab } from "./components/expense-categories-tab";
import { ExpenseAnalyticsTab } from "./components/expense-analytics-tab";
import { ExpenseDetailModal } from "./components/expense-detail-modal";
import { ExpenseTaxCalc } from "./components/expense-tax-calc";

function ChangeIndicator({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="w-3 h-3" /> No change</span>;
  const isUp = value > 0;
  return (
    <span className="text-xs flex items-center gap-0.5" style={{ color: isUp ? "hsl(var(--kf-error))" : "hsl(var(--kf-success))" }}>
      {isUp ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(value).toFixed(1)}% vs prev
    </span>
  );
}

type Tab = "expenses" | "budgets" | "analytics";

const GUIDE_STEPS = [
  { title: "Add Expenses", description: "Record business expenses with amount, vendor, date, and payment method." },
  { title: "Set Budgets", description: "Create monthly spending budgets per category and get alerts when approaching limits." },
  { title: "Track Vendors", description: "See analytics on your top vendors and spending distribution." },
  { title: "Categorize Spending", description: "Create custom categories with colors to organize and visualize your expenses." },
  { title: "Export Reports", description: "Download your expense data as CSV for accounting and tax purposes." },
  { title: "Upload Receipts", description: "Attach receipt images to expenses for record-keeping and compliance." },
];

export default function ExpensesPage() {
  const d = useExpensesData();
  const [activeTab, setActiveTab] = useState<Tab>("expenses");
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);

  const aiCustomData = useMemo(() => ({
    expenses: d.expenses,
    totalExpenses: d.totalExpenses,
    categories: d.categories,
    summary: d.summary as Record<string, unknown> | null,
  }), [d.expenses, d.totalExpenses, d.categories, d.summary]);
  useExpensesAiHub(d.businessId, aiCustomData);

  const openEditModal = (exp: Expense) => { setEditingExpense(exp); setShowModal(true); };
  const openAddModal = () => { setEditingExpense(null); setShowModal(true); };
  const handleDelete = async (id: string) => {
    if (!d.businessId) return;
    try { await deleteExpense(d.businessId, id); toast.success("Deleted"); void d.loadData(); } catch { toast.error("Failed"); }
  };
  const handleExport = () => {
    if (!d.businessId) return;
    fetch(getExpenseExportUrl(d.businessId), { headers: getAuthHeaders() })
      .then(r => r.blob()).then(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`; a.click(); });
  };

  if (d.loading) return <ListPageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader icon={Receipt} title="Expenses" subtitle="Track, analyze, and optimize your business spending" actionLabel="Add Expense" onAction={openAddModal} actionDataAttr="expenses-add"
        rightSlot={<button onClick={handleExport} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"><Download className="w-4 h-4" /> Export CSV</button>} />
      <div className="flex items-center gap-2">
        <FeatureGuide featureKey="expenses" title="Getting Started with Expenses" description="Track spending, set budgets, and manage vendors" steps={GUIDE_STEPS} />
        <WalkthroughTrigger moduleKey="expenses" />
      </div>
      <div data-walkthrough="expenses-kpi">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <MetricExplainer label={METRIC_DEFINITIONS.budget_utilization.label} explanation="Total amount spent across all tracked expenses for the selected period." formula="Sum of all expense amounts" goodValue="Compare month-over-month to spot spending trends.">
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-error) / 0.1)" }}><DollarSign className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-error))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Total Spent</span>
                <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-error))" }}>{formatCurrency(d.summary?.total ?? 0)}</span>
                <div className="mt-0.5"><ChangeIndicator value={d.summary?.comparison?.changePercent ?? 0} /></div>
              </div>
            </div>
          </MetricExplainer>
          <MetricExplainer label="Transactions" explanation="Number of individual expense records logged in the selected period." formula="Count of expense entries" goodValue="Track frequency to ensure all expenses are being captured.">
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}><Receipt className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Transactions</span>
                <span className="text-sm font-bold">{String(d.summary?.count ?? 0)}</span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">Avg {formatCurrency(d.summary?.averageExpense ?? 0)}</span>
              </div>
            </div>
          </MetricExplainer>
          <MetricExplainer label={METRIC_DEFINITIONS.budget_utilization.label} explanation={METRIC_DEFINITIONS.budget_utilization.explanation} formula={METRIC_DEFINITIONS.budget_utilization.formula} goodValue={METRIC_DEFINITIONS.budget_utilization.goodValue}>
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-info) / 0.1)" }}><Target className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-info))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Budgets</span>
                <span className="text-sm font-bold">{d.budgets.length > 0 ? `${d.budgets.length} active` : "None set"}</span>
                <span className="text-[10px] block mt-0.5">{d.overBudgetCount > 0 ? <span style={{ color: "hsl(var(--kf-error))" }}>{d.overBudgetCount} over budget</span> : d.nearAlertCount > 0 ? <span style={{ color: "hsl(var(--kf-warning))" }}>{d.nearAlertCount} near limit</span> : <span className="text-muted-foreground">All on track</span>}</span>
              </div>
            </div>
          </MetricExplainer>
          <MetricExplainer label="Top Vendor" explanation="The vendor you've spent the most with during the selected period." goodValue="Know your biggest suppliers to negotiate better rates.">
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-success) / 0.1)" }}><Store className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Top Vendor</span>
                <span className="text-sm font-bold">{d.vendors[0]?.name ?? "---"}</span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">{d.vendors[0] ? formatCurrency(d.vendors[0].total) : "No vendor data"}</span>
              </div>
            </div>
          </MetricExplainer>
        </div>
      </div>
      <div data-walkthrough="expenses-tabs">
        <TabNav tabs={[
          { key: "expenses", label: "Expenses", icon: Receipt },
          { key: "budgets", label: "Budgets", icon: Target },
          { key: "analytics", label: "Analytics", icon: BarChart3 },
        ]} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as Tab)} layoutId="expenses-tab-underline" />
      </div>
      {(activeTab === "expenses" || activeTab === "analytics") && (
        <ExpenseFilters period={d.period} setPeriod={d.setPeriod} customStart={d.customStart} setCustomStart={d.setCustomStart} customEnd={d.customEnd} setCustomEnd={d.setCustomEnd} searchQuery={d.searchQuery} setSearchQuery={d.setSearchQuery} />
      )}
      <AnimatePresence mode="wait">
        {activeTab === "expenses" && (
          <div className="space-y-4">
            <ExpenseList expenses={d.expenses} totalExpenses={d.totalExpenses} categories={d.categories} filterCategory={d.filterCategory} setFilterCategory={d.setFilterCategory} filterPayment={d.filterPayment} setFilterPayment={d.setFilterPayment} page={d.page} setPage={d.setPage} pageSize={d.pageSize} setPageSize={d.setPageSize} onEdit={openEditModal} onDelete={handleDelete} onViewDetail={setDetailExpense} onAdd={openAddModal} />
            <ExpenseTaxCalc summary={d.summary} />
          </div>
        )}
        {activeTab === "budgets" && (
          <div className="space-y-6" data-walkthrough="expenses-budgets">
            {d.businessId && <ExpenseBudgetsTab businessId={d.businessId} budgets={d.budgets} categories={d.categories} onReload={d.loadData} />}
            {d.businessId && <ExpenseCategoriesTab businessId={d.businessId} categories={d.categories} setCategories={d.setCategories} />}
          </div>
        )}
        {activeTab === "analytics" && (
          <ExpenseAnalyticsTab summary={d.summary} vendors={d.vendors} loading={d.loading} />
        )}
      </AnimatePresence>
      <AnimatePresence>{showModal && d.businessId && <ExpenseFormModal businessId={d.businessId} categories={d.categories} editingExpense={editingExpense} onClose={() => setShowModal(false)} onSaved={d.loadData} />}</AnimatePresence>
      <AnimatePresence>{detailExpense && <ExpenseDetailModal expense={detailExpense} onClose={() => setDetailExpense(null)} onEdit={openEditModal} />}</AnimatePresence>

      <ModuleWalkthrough moduleKey="expenses" steps={EXPENSES_WALKTHROUGH} />
    </div>
  );
}
