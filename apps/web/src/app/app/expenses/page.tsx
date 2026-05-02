"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { WorkspaceMetricStrip } from "@/components/ui/workspace-metric-strip";
import {
  Receipt,
  DollarSign,
  Target,
  Store,
  Download,
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  Tag,
  FileQuestion,
  Lightbulb,
  Layers,
  PieChart,
  ShieldCheck,
} from "lucide-react";
import { deleteExpense, getExpenseExportUrl, Expense } from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { EXPENSES_WALKTHROUGH } from "@/lib/walkthrough-definitions";
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
import type { MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";

const TABS = [
  { key: "transactions", label: "Transactions", icon: Receipt },
  { key: "budgets", label: "Budgets", icon: Target },
  { key: "categories", label: "Categories", icon: Layers },
  { key: "insights", label: "Insights", icon: Lightbulb },
];

type TabKey = "transactions" | "budgets" | "categories" | "insights";

export default function ExpensesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = (["transactions", "budgets", "categories", "insights"] as TabKey[]).includes(tabParam as TabKey) ? tabParam! : "transactions";

  const setActiveTab = useCallback((tab: string) => {
    router.replace(`/app/expenses?tab=${tab}`, { scroll: false });
  }, [router]);

  const d = useExpensesData();
  const intelligence = useGraphIntelligence({ businessId: d.businessId, module: "expenses" });
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

  const { aiHook: expensesAi, updateExpensesContext } = useExpensesAiHub();

  const handleExpensesAiAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("switch_tab:")) {
      const tab = actionKey.replace("switch_tab:", "");
      if (["transactions", "budgets", "categories", "insights"].includes(tab)) setActiveTab(tab);
      return;
    }
    if (actionKey === "add_expense") {
      setEditingExpense(null);
      setShowModal(true);
    }
  }, [setActiveTab]);

  useEffect(() => {
    if (d.businessId) {
      updateExpensesContext({
        businessId: d.businessId,
        activeView: activeTab,
        expenses: d.expenses,
        categories: d.categories,
        budgets: d.budgets,
        vendors: d.vendors,

        summary: d.summary as Record<string, unknown> | null,
      });
    }
  }, [d.businessId, activeTab, d.expenses, d.categories, d.budgets, d.vendors, d.summary, updateExpensesContext]);

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

  const totalCount = d.summary?.count ?? d.totalExpenses;

  const summaryAny = d.summary as Record<string, unknown> | null;
  const uncategorizedCount = (typeof summaryAny?.uncategorizedCount === "number" ? summaryAny.uncategorizedCount : null) ?? d.expenses.filter(e => !e.categoryId).length;
  const missingReceiptCount = (typeof summaryAny?.missingReceiptCount === "number" ? summaryAny.missingReceiptCount : null) ?? d.expenses.filter(e => !e.receiptUrl).length;
  const recurringCount = (typeof summaryAny?.recurringCount === "number" ? summaryAny.recurringCount : null) ?? d.expenses.filter(e => e.isRecurring).length;
  const largestCategory = d.summary?.byCategory?.[0];
  const largestCategoryPct = largestCategory?.percent ?? 0;

  const spendingHealth = useMemo(() => {
    let score = 100;
    if (d.overBudgetCount > 0) score -= d.overBudgetCount * 15;
    if (d.nearAlertCount > 0) score -= d.nearAlertCount * 5;
    if (uncategorizedCount > 5) score -= 10;
    else if (uncategorizedCount > 0) score -= 5;
    if (totalCount > 0 && missingReceiptCount > totalCount * 0.5) score -= 10;
    const changePct = d.summary?.comparison?.changePercent ?? 0;
    if (changePct > 30) score -= 15;
    else if (changePct > 15) score -= 8;
    return Math.max(0, Math.min(100, score));
  }, [d.overBudgetCount, d.nearAlertCount, uncategorizedCount, missingReceiptCount, d.summary, totalCount]);

  if (d.loading) return <ListPageSkeleton />;

  const metricItems: MetricStripItem[] = [
    {
      label: "Total Spent",
      value: formatCurrency(d.summary?.total ?? 0),
      icon: DollarSign,
      iconColor: "hsl(var(--kf-error))",
      sub: <ChangeIndicator value={d.summary?.comparison?.changePercent ?? 0} />,
    },
    {
      label: "Transactions",
      value: String(d.summary?.count ?? 0),
      icon: Receipt,
      iconColor: "hsl(var(--kf-accent1))",
      sub: `Avg ${formatCurrency(d.summary?.averageExpense ?? 0)}`,
    },
    {
      label: "Budgets",
      value: d.budgets.length > 0 ? `${d.budgets.length} active` : "None set",
      icon: d.overBudgetCount > 0 ? AlertTriangle : Target,
      iconColor: d.overBudgetCount > 0 ? "hsl(var(--kf-error))" : "hsl(var(--kf-info))",
      sub: d.overBudgetCount > 0
        ? <span style={{ color: "hsl(var(--kf-error))" }}>{d.overBudgetCount} over budget</span>
        : d.nearAlertCount > 0
          ? <span style={{ color: "hsl(var(--kf-warning))" }}>{d.nearAlertCount} near limit</span>
          : "All on track",
      threshold: d.overBudgetCount > 0 ? { status: "critical" as const } : undefined,
    },
    {
      label: "Top Category",
      value: largestCategory?.name ?? "---",
      icon: PieChart,
      iconColor: "hsl(var(--kf-accent2))",
      sub: largestCategoryPct > 0 ? `${largestCategoryPct}% of spend` : "No data",
    },
    {
      label: "Unclassified",
      value: String(uncategorizedCount),
      icon: uncategorizedCount > 0 ? FileQuestion : Tag,
      iconColor: uncategorizedCount > 0 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))",
      sub: missingReceiptCount > 0 ? `${missingReceiptCount} no receipt` : "All receipted",
      threshold: uncategorizedCount > 0 ? { status: "warn" as const } : undefined,
    },
    {
      label: "Top Vendor",
      value: d.vendors[0]?.name ?? "---",
      icon: Store,
      iconColor: "hsl(var(--kf-success))",
      sub: d.vendors[0] ? formatCurrency(d.vendors[0].total) : "No vendor data",
    },
    {
      label: "Health Score",
      value: `${spendingHealth}%`,
      icon: ShieldCheck,
      iconColor: spendingHealth >= 80 ? "hsl(var(--kf-success))" : spendingHealth >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))",
      sub: spendingHealth >= 80 ? "Good standing" : spendingHealth >= 50 ? "Needs attention" : "Critical issues",
      threshold: spendingHealth < 50 ? { status: "critical" as const } : spendingHealth < 80 ? { status: "warn" as const } : undefined,
    },
  ];

  return (
    <WorkspaceShell
      icon={Receipt}
      title="Expenses"
      subtitle="Track, analyze, and optimize spending across your business"
      actionLabel="Add Expense"
      onAction={openAddModal}
      actionDataAttr="expenses-add"
      ai={{ hook: expensesAi, moduleName: "Expenses", onAction: handleExpensesAiAction }}
      headerRight={
        <button onClick={handleExport} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabLayoutId="expenses-tab"
      banners={
        <>
          <ResumePrompt module="expenses" onResume={handleResumeExpenseTask} />
          <div className="flex items-center gap-2">
            <PageGuideTrigger moduleKey="expenses" />
          </div>
        </>
      }
      metricStrip={
        <div data-walkthrough="expenses-kpi">
          <WorkspaceMetricStrip items={metricItems} columns={6} compact />
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        {intelligence.moduleCoverage && (
          <AutomationCoverageIndicator
            coveragePct={intelligence.moduleCoverage.coveragePct}
            automatedCount={intelligence.moduleCoverage.automatedCount}
            totalProcesses={intelligence.moduleCoverage.totalProcesses}
          />
        )}
      </div>

      <GraphInsightsPanel
        recommendations={intelligence.recommendations}
        loading={intelligence.loading}
        onDismiss={intelligence.dismiss}
        onNavigate={(route) => router.push(route)}
        className="mb-4"
      />

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={activeTab} data-walkthrough="expenses-tabs">
        {activeTab === "transactions" && (
          <div className="space-y-4">
            <ExpenseFilters period={d.period} setPeriod={d.setPeriod} customStart={d.customStart} setCustomStart={d.setCustomStart} customEnd={d.customEnd} setCustomEnd={d.setCustomEnd} searchQuery={d.searchQuery} setSearchQuery={d.setSearchQuery} />
            <ExpenseList expenses={d.expenses} totalExpenses={d.totalExpenses} categories={d.categories} filterCategory={d.filterCategory} setFilterCategory={d.setFilterCategory} filterPayment={d.filterPayment} setFilterPayment={d.setFilterPayment} page={d.page} setPage={d.setPage} pageSize={d.pageSize} setPageSize={d.setPageSize} onEdit={openEditModal} onDelete={handleDelete} onViewDetail={setDetailExpense} onAdd={openAddModal} businessId={d.businessId} onReload={d.loadData} projects={d.projects} contacts={d.contacts} services={d.services} recurringCandidates={d.recurringCandidates} />
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
            marginData={d.marginData}
            projects={d.projects}
            contacts={d.contacts}
            services={d.services}
            recurringCandidates={d.recurringCandidates}
            onNavigate={setActiveTab}
            periodTotalCount={totalCount}
            periodUncategorizedCount={uncategorizedCount}
            periodMissingReceiptCount={missingReceiptCount}
            periodRecurringCount={recurringCount}
          />
        )}
      </div>

      <AnimatePresence>{showModal && d.businessId && <ExpenseFormModal businessId={d.businessId} categories={d.categories} editingExpense={editingExpense} projects={d.projects} contacts={d.contacts} services={d.services} onClose={() => setShowModal(false)} onSaved={() => { if (expenseTaskIdRef.current) { markTaskCompleted(expenseTaskIdRef.current); expenseTaskIdRef.current = null; } void d.loadData(); }} />}</AnimatePresence>
      <AnimatePresence>{detailExpense && <ExpenseDetailModal expense={detailExpense} onClose={() => setDetailExpense(null)} onEdit={openEditModal} />}</AnimatePresence>

      <PageGuide moduleKey="expenses" walkthroughSteps={EXPENSES_WALKTHROUGH} />
    </WorkspaceShell>
  );
}

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
