"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { PageNotesMount } from "@/components/keyflow/page-notes-mount";
import {
  Receipt,
  Target,
  Lightbulb,
  Layers,
  TrendingUp,
  LayoutDashboard,
  Repeat,
} from "lucide-react";
import { deleteExpense, getExpenseExportUrl, Expense } from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { formatCurrency } from "./components/expense-utils";
import { useExpensesData } from "./components/use-expenses-data";
import { ExpenseFilters } from "./components/expense-filters";
import { ExpensePipeline } from "./components/expense-pipeline";
import { ExpensesSnapshotTab } from "./components/expenses-snapshot-tab";
import RecurringExpensesPanel from "./components/recurring-expenses-panel";
import { ExpenseFormSideSheet } from "./components/expense-form-sidesheet";
import { ExpenseBudgetsTab } from "./components/expense-budgets-tab";
import { ExpenseCategoriesTab } from "./components/expense-categories-tab";
import { ExpenseInsightsTab } from "./components/expense-insights-tab";
import { ExpenseDetailModal } from "./components/expense-detail-modal";
import { ExpenseTaxCalc } from "./components/expense-tax-calc";
import { ExpensesActionMenu } from "./components/expenses-action-menu";
import { TabFrame } from "../commerce/components/tab-frame";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";

const TABS = [
  { key: "snapshot", label: "Snapshot", icon: LayoutDashboard },
  { key: "pipeline", label: "Pipeline", icon: TrendingUp },
  { key: "budgets", label: "Budgets", icon: Target },
  { key: "categories", label: "Categories", icon: Layers },
  { key: "insights", label: "Insights", icon: Lightbulb },
  { key: "recurring", label: "Recurring", icon: Repeat },
];

type TabKey = "snapshot" | "pipeline" | "budgets" | "categories" | "insights" | "recurring";

export default function ExpensesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const activeTab: TabKey = (["snapshot", "pipeline", "budgets", "categories", "insights", "recurring"] as TabKey[]).includes(tabParam as TabKey) ? tabParam! : "snapshot";

  const setActiveTab = useCallback((tab: string) => {
    router.replace(`${pathname}?tab=${tab}`, { scroll: false });
  }, [router, pathname]);

  // Reset view param when leaving pipeline tab
  useEffect(() => {
    if (activeTab !== "pipeline") {
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      window.history.replaceState({}, "", url);
    }
  }, [activeTab]);

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

  if (d.loading && !d.businessId) return <ListPageSkeleton />;

  const metricStrip = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-walkthrough="expenses-kpi">
      {[
        { label: "Total Spent", value: formatCurrency(d.summary?.total ?? 0), color: d.summary && d.summary.total > 0 ? "text-rose-400" : "text-muted-foreground" },
        { label: "Transactions", value: String(d.summary?.count ?? 0), color: "text-muted-foreground" },
        { label: "Over Budget", value: d.overBudgetCount > 0 ? `${d.overBudgetCount} budgets` : "All on track", color: d.overBudgetCount > 0 ? "text-rose-400" : "text-emerald-400" },
        { label: "Uncategorized", value: uncategorizedCount > 0 ? `${uncategorizedCount} items` : "All classified", color: uncategorizedCount > 0 ? "text-amber-400" : "text-emerald-400" },
        { label: "Health", value: `${spendingHealth}%`, color: spendingHealth >= 80 ? "text-emerald-400" : spendingHealth >= 50 ? "text-amber-400" : "text-rose-400" },
      ].map((stat) => (
        <span key={stat.label} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="text-xs">{stat.label}:</span>
          <span className={cn("text-xs font-semibold", stat.color)}>{stat.value}</span>
        </span>
      ))}
    </div>
  );

  return (
    <KeyflowUnifiedShell
      module="expenses"
      pageTitle="Expenses"
      availableActions={["Add expense", "Export CSV", "View budgets", "View insights"]}
    >
      <WorkspaceShell
        icon={Receipt}
        title="Expenses"
        subtitle="Track, analyze, and optimize spending across your business"
        tabLayoutId="expenses-tabs"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        headerRight={
          <div className="flex items-center gap-2">
            <NotesTrigger pageKey="expenses" variant="header" />
            <ExpensesActionMenu
              onAddExpense={openAddModal}
              onExport={handleExport}
              onViewBudgets={() => setActiveTab("budgets")}
              onViewInsights={() => setActiveTab("insights")}
            />
          </div>
        }
        banners={
          <ResumePrompt module="expenses" onResume={handleResumeExpenseTask} />
        }
        metricStrip={metricStrip}
      >
        {activeTab === "snapshot" && (
          <TabFrame loading={d.loading}>
            <ExpensesSnapshotTab
              expenses={d.expenses}
              categories={d.categories}
              summary={d.summary}
              budgets={d.budgets}
              onNavigate={setActiveTab}
              onViewExpense={setDetailExpense}
            />
          </TabFrame>
        )}

        {activeTab === "pipeline" && (
          <TabFrame loading={d.loading}>
            <ExpensePipeline
              businessId={d.businessId}
              expenses={d.expenses}
              totalExpenses={d.totalExpenses}
              categories={d.categories}
              summary={d.summary}
              period={d.period}
              setPeriod={d.setPeriod}
              customStart={d.customStart}
              setCustomStart={d.setCustomStart}
              customEnd={d.customEnd}
              setCustomEnd={d.setCustomEnd}
              searchQuery={d.searchQuery}
              setSearchQuery={d.setSearchQuery}
              filterCategory={d.filterCategory}
              setFilterCategory={d.setFilterCategory}
              filterPayment={d.filterPayment}
              setFilterPayment={d.setFilterPayment}
              filterStatus={d.filterStatus}
              setFilterStatus={d.setFilterStatus}
              page={d.page}
              setPage={d.setPage}
              pageSize={d.pageSize}
              setPageSize={d.setPageSize}
              onReload={d.loadData}
              onEdit={openEditModal}
              onAdd={openAddModal}
              projects={d.projects}
              contacts={d.contacts}
              services={d.services}
              loading={d.loading}
            />
          </TabFrame>
        )}

        {activeTab === "budgets" && d.businessId && (
          <TabFrame loading={d.loading}>
            <ExpenseBudgetsTab
              businessId={d.businessId}
              budgets={d.budgets}
              categories={d.categories}
              expenses={d.expenses}
              summary={d.summary}
              onReload={d.loadData}
            />
          </TabFrame>
        )}

        {activeTab === "categories" && d.businessId && (
          <TabFrame loading={d.loading}>
            <ExpenseCategoriesTab
              businessId={d.businessId}
              categories={d.categories}
              setCategories={d.setCategories}
              summary={d.summary}
              budgets={d.budgets}
            />
          </TabFrame>
        )}

        {activeTab === "insights" && d.businessId && (
          <TabFrame loading={d.loading}>
            <div className="space-y-4">
              {intelligence.moduleCoverage && (
                <AutomationCoverageIndicator
                  coveragePct={intelligence.moduleCoverage.coveragePct}
                  automatedCount={intelligence.moduleCoverage.automatedCount}
                  totalProcesses={intelligence.moduleCoverage.totalProcesses}
                />
              )}
              <GraphInsightsPanel
                recommendations={intelligence.recommendations}
                loading={intelligence.loading}
                onDismiss={intelligence.dismiss}
                onNavigate={(route) => router.push(route)}
              />
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
            </div>
          </TabFrame>
        )}

        {activeTab === "recurring" && d.businessId && (
          <TabFrame loading={d.loading}>
            <RecurringExpensesPanel
              businessId={d.businessId}
              categories={d.categories}
            />
          </TabFrame>
        )}

        {showModal && d.businessId && (
          <ExpenseFormSideSheet
            businessId={d.businessId}
            categories={d.categories}
            editingExpense={editingExpense}
            projects={d.projects}
            contacts={d.contacts}
            services={d.services}
            onClose={() => setShowModal(false)}
            onSaved={() => {
              if (expenseTaskIdRef.current) {
                markTaskCompleted(expenseTaskIdRef.current);
                expenseTaskIdRef.current = null;
              }
              void d.loadData();
            }}
          />
        )}
        <AnimatePresence>
          {detailExpense && <ExpenseDetailModal expense={detailExpense} onClose={() => setDetailExpense(null)} onEdit={openEditModal} />}
        </AnimatePresence>

        <PageNotesMount pageKey="expenses" />
      </WorkspaceShell>
    </KeyflowUnifiedShell>
  );
}


