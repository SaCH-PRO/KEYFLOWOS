"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { useNavigationContext } from "@/lib/navigation-context";
import {
  Receipt, DollarSign, Target, Store, Download, ArrowUp, ArrowDown, Minus,
  TrendingUp, AlertTriangle, Tag, FileQuestion, BarChart3, Lightbulb,
  Layers, PieChart,
} from "lucide-react";
import { deleteExpense, getExpenseExportUrl, Expense } from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
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
import { ExpenseInsightsTab } from "./components/expense-insights-tab";
import { ExpenseDetailModal } from "./components/expense-detail-modal";
import { ExpenseTaxCalc } from "./components/expense-tax-calc";

const TABS = [
  { key: "transactions", label: "Transactions", icon: Receipt },
  { key: "budgets", label: "Budgets", icon: Target },
  { key: "categories", label: "Categories", icon: Layers },
  { key: "insights", label: "Insights", icon: Lightbulb },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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

export default function ExpensesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = TABS.some(t => t.key === tabParam) ? tabParam! : "transactions";
  useReturnNavigation({ restoreScrollOnMount: true });
  const { setCurrentMeta } = useNavigationContext();

  const setActiveTab = useCallback((tab: TabKey) => {
    setCurrentMeta({ tab: tab === "transactions" ? null : tab });
    router.replace(`/app/expenses?tab=${tab}`, { scroll: false });
  }, [router, setCurrentMeta]);

  const d = useExpensesData();
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const expenseTaskIdRef = useRef<string | null>(null);
  const expenseSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (showModal) {
      if (!expenseSessionIdRef.current) {
        expenseSessionIdRef.current = editingExpense
          ? `expenses-edit-${editingExpense.id}`
          : `expenses-new-${Date.now()}`;
      }
      const sessionId = expenseSessionIdRef.current;
      const label = editingExpense ? "Edit expense" : "New expense";
      const description = editingExpense
        ? `Resume editing expense: ${editingExpense.description ?? editingExpense.id}`
        : "Resume adding this expense";
      const taskId = registerInterruptedTask({
        id: sessionId,
        module: "expenses",
        label: editingExpense?.description ? `${label} · ${editingExpense.description}` : label,
        description,
        route: "/app/expenses",
        draftId: editingExpense?.id ?? null,
        originRoute: "/app/expenses",
        originLabel: "Expenses",
        taskIntent: editingExpense ? "edit-expense" : "create-expense",
        formData: {
          expenseId: editingExpense?.id ?? null,
          description: editingExpense?.description ?? null,
          amount: editingExpense?.amount ?? null,
          categoryId: editingExpense?.categoryId ?? null,
        },
      });
      expenseTaskIdRef.current = taskId;
    } else {
      expenseSessionIdRef.current = null;
      expenseTaskIdRef.current = null;
    }
  }, [showModal, editingExpense]);

  const aiCustomData = useMemo(() => ({
    expenses: d.expenses,
    totalExpenses: d.totalExpenses,
    categories: d.categories,
    summary: d.summary as Record<string, unknown> | null,
    budgets: d.budgets,
    vendors: d.vendors,
  }), [d.expenses, d.totalExpenses, d.categories, d.summary, d.budgets, d.vendors]);
  useExpensesAiHub(d.businessId, aiCustomData);

  const openEditModal = (exp: Expense) => { setEditingExpense(exp); setShowModal(true); };
  const openAddModal = () => { setEditingExpense(null); setShowModal(true); };

  const handleResumeExpenseTask = useCallback((task: import("@/lib/resume-task-registry").InterruptedTask) => {
    const fd = task.formData;
    if (task.id.startsWith("expenses-edit-") && fd?.id) {
      const match = d.expenses.find((e) => e.id === fd.id);
      if (match) { openEditModal(match); return; }
    }
    openAddModal();
  }, [d.expenses]);

  const handleDelete = async (id: string) => {
    if (!d.businessId) return;
    try { await deleteExpense(d.businessId, id); toast.success("Deleted"); void d.loadData(); } catch { toast.error("Failed"); }
  };
  const handleExport = () => {
    if (!d.businessId) return;
    fetch(getExpenseExportUrl(d.businessId), { headers: getAuthHeaders() })
      .then(r => r.blob()).then(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`; a.click(); });
  };

  const uncategorizedCount = d.expenses.filter(e => !e.categoryId).length;
  const missingReceiptCount = d.expenses.filter(e => !e.receiptUrl).length;
  const largestCategory = d.summary?.byCategory?.[0];
  const largestCategoryPct = largestCategory?.percent ?? 0;

  if (d.loading) return <ListPageSkeleton />;

  return (
    <div className="space-y-6">
      <ResumePrompt module="expenses" onResume={handleResumeExpenseTask} />
      <PageHeader
        icon={Receipt}
        title="Expenses"
        subtitle="Track, analyze, and optimize spending across your business"
        actionLabel="Add Expense"
        onAction={openAddModal}
        actionDataAttr="expenses-add"
        rightSlot={
          <button onClick={handleExport} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        }
      />
      <div className="flex items-center gap-2">
        <PageGuideTrigger moduleKey="expenses" />
      </div>

      <div data-walkthrough="expenses-kpi">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <MetricExplainer label="Total Spent" explanation="Total amount spent across all tracked expenses for the selected period." formula="Sum of all expense amounts" goodValue="Compare month-over-month to spot spending trends.">
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
            <div className={`rounded-xl border bg-card p-3 flex items-center gap-2.5 ${d.overBudgetCount > 0 ? "border-red-500/30" : "border-border/50"}`}>
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: d.overBudgetCount > 0 ? "hsl(var(--kf-error) / 0.1)" : "hsl(var(--kf-info) / 0.1)" }}>
                {d.overBudgetCount > 0 ? <AlertTriangle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-error))" }} /> : <Target className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-info))" }} />}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Budgets</span>
                <span className="text-sm font-bold">{d.budgets.length > 0 ? `${d.budgets.length} active` : "None set"}</span>
                <span className="text-[10px] block mt-0.5">
                  {d.overBudgetCount > 0
                    ? <span style={{ color: "hsl(var(--kf-error))" }}>{d.overBudgetCount} over budget</span>
                    : d.nearAlertCount > 0
                      ? <span style={{ color: "hsl(var(--kf-warning))" }}>{d.nearAlertCount} near limit</span>
                      : <span className="text-muted-foreground">All on track</span>}
                </span>
              </div>
            </div>
          </MetricExplainer>

          <MetricExplainer label="Largest Category" explanation="The category with the highest spending share this period." goodValue="Monitor category concentration to spot overinvestment.">
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}><PieChart className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Top Category</span>
                <span className="text-sm font-bold truncate block">{largestCategory?.name ?? "---"}</span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">{largestCategoryPct > 0 ? `${largestCategoryPct}% of spend` : "No data"}</span>
              </div>
            </div>
          </MetricExplainer>

          <MetricExplainer label="Unclassified" explanation="Expenses missing a category, reducing reporting accuracy." goodValue="Keep this at zero for best budget tracking and reports.">
            <div className={`rounded-xl border bg-card p-3 flex items-center gap-2.5 ${uncategorizedCount > 0 ? "border-amber-500/30" : "border-border/50"}`}>
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: uncategorizedCount > 0 ? "hsl(var(--kf-warning) / 0.1)" : "hsl(var(--kf-success) / 0.1)" }}>
                {uncategorizedCount > 0 ? <FileQuestion className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} /> : <Tag className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Unclassified</span>
                <span className="text-sm font-bold">{uncategorizedCount}</span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">{missingReceiptCount > 0 ? `${missingReceiptCount} no receipt` : "All receipted"}</span>
              </div>
            </div>
          </MetricExplainer>

          <MetricExplainer label="Top Vendor" explanation="The vendor you've spent the most with during the selected period." goodValue="Know your biggest suppliers to negotiate better rates.">
            <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-success) / 0.1)" }}><Store className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /></div>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Top Vendor</span>
                <span className="text-sm font-bold truncate block">{d.vendors[0]?.name ?? "---"}</span>
                <span className="text-[10px] text-muted-foreground block mt-0.5">{d.vendors[0] ? formatCurrency(d.vendors[0].total) : "No vendor data"}</span>
              </div>
            </div>
          </MetricExplainer>
        </div>
      </div>

      <div className="border-b border-border/50" data-walkthrough="expenses-tabs">
        <nav className="flex gap-1 -mb-px overflow-x-auto" role="tablist" aria-label="Expenses workspace modes">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            let badge: React.ReactNode = null;
            if (tab.key === "transactions") badge = d.totalExpenses > 0 ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">{d.totalExpenses}</span> : null;
            if (tab.key === "budgets") badge = d.overBudgetCount > 0 ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}>{d.overBudgetCount}</span> : null;
            if (tab.key === "categories") badge = d.categories.length > 0 ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">{d.categories.length}</span> : null;
            if (tab.key === "insights") {
              const issueCount = d.overBudgetCount + uncategorizedCount + (d.summary?.comparison?.changePercent && d.summary.comparison.changePercent > 20 ? 1 : 0);
              badge = issueCount > 0 ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.15)", color: "hsl(var(--kf-warning))" }}>{issueCount}</span> : null;
            }
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-[hsl(var(--kf-accent1))] text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {badge}
              </button>
            );
          })}
        </nav>
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={activeTab}>
        {activeTab === "transactions" && (
          <div className="space-y-4">
            <ExpenseFilters period={d.period} setPeriod={d.setPeriod} customStart={d.customStart} setCustomStart={d.setCustomStart} customEnd={d.customEnd} setCustomEnd={d.setCustomEnd} searchQuery={d.searchQuery} setSearchQuery={d.setSearchQuery} />
            <ExpenseList expenses={d.expenses} totalExpenses={d.totalExpenses} categories={d.categories} filterCategory={d.filterCategory} setFilterCategory={d.setFilterCategory} filterPayment={d.filterPayment} setFilterPayment={d.setFilterPayment} page={d.page} setPage={d.setPage} pageSize={d.pageSize} setPageSize={d.setPageSize} onEdit={openEditModal} onDelete={handleDelete} onViewDetail={setDetailExpense} onAdd={openAddModal} />
            <ExpenseTaxCalc summary={d.summary} />
          </div>
        )}

        {activeTab === "budgets" && d.businessId && (
          <ExpenseBudgetsTab businessId={d.businessId} budgets={d.budgets} categories={d.categories} expenses={d.expenses} summary={d.summary} onReload={d.loadData} />
        )}

        {activeTab === "categories" && d.businessId && (
          <ExpenseCategoriesTab businessId={d.businessId} categories={d.categories} setCategories={d.setCategories} summary={d.summary} budgets={d.budgets} />
        )}

        {activeTab === "insights" && d.businessId && (
          <ExpenseInsightsTab
            businessId={d.businessId}
            expenses={d.expenses}
            categories={d.categories}
            summary={d.summary}
            vendors={d.vendors}
            budgets={d.budgets}
            onNavigate={setActiveTab}
          />
        )}
      </div>

      <AnimatePresence>{showModal && d.businessId && <ExpenseFormModal businessId={d.businessId} categories={d.categories} editingExpense={editingExpense} onClose={() => setShowModal(false)} onSaved={() => { if (expenseTaskIdRef.current) { markTaskCompleted(expenseTaskIdRef.current); expenseTaskIdRef.current = null; } void d.loadData(); }} />}</AnimatePresence>
      <AnimatePresence>{detailExpense && <ExpenseDetailModal expense={detailExpense} onClose={() => setDetailExpense(null)} onEdit={openEditModal} />}</AnimatePresence>

      <PageGuide moduleKey="expenses" walkthroughSteps={EXPENSES_WALKTHROUGH} />
    </div>
  );
}
