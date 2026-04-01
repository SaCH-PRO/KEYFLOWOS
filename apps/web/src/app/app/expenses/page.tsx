"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { Receipt, DollarSign, Target, Store, Download, ArrowUp, ArrowDown, Minus, BarChart3 } from "lucide-react";
import { deleteExpense, getExpenseExportUrl, Expense } from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { StatCards } from "@/components/ui/stat-cards";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
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
  const { ai, handleAction: handleAiAction } = useExpensesAiHub(d.businessId, aiCustomData);

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
      <PageHeader icon={Receipt} title="Expenses" subtitle="Track, analyze, and optimize your business spending" actionLabel="Add Expense" onAction={openAddModal}
        rightSlot={<button onClick={handleExport} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"><Download className="w-4 h-4" /> Export CSV</button>} />
      <FeatureGuide featureKey="expenses" title="Getting Started with Expenses" description="Track spending, set budgets, and manage vendors" steps={GUIDE_STEPS} />
      <StatCards items={[
        { label: "Total Spent", value: formatCurrency(d.summary?.total ?? 0), sub: <ChangeIndicator value={d.summary?.comparison?.changePercent ?? 0} />, icon: DollarSign, color: "hsl(var(--kf-error))" },
        { label: "Transactions", value: String(d.summary?.count ?? 0), sub: `Avg ${formatCurrency(d.summary?.averageExpense ?? 0)}`, icon: Receipt, color: "hsl(var(--kf-accent1))" },
        { label: "Budgets", value: d.budgets.length > 0 ? `${d.budgets.length} active` : "None set", sub: d.overBudgetCount > 0 ? <span style={{ color: "hsl(var(--kf-error))" }}>{d.overBudgetCount} over budget</span> : d.nearAlertCount > 0 ? <span style={{ color: "hsl(var(--kf-warning))" }}>{d.nearAlertCount} near limit</span> : "All on track", icon: Target, color: "hsl(var(--kf-info))" },
        { label: "Top Vendor", value: d.vendors[0]?.name ?? "---", sub: d.vendors[0] ? formatCurrency(d.vendors[0].total) : "No vendor data", icon: Store, color: "hsl(var(--kf-success))" },
      ]} />
      <TabNav tabs={[
        { key: "expenses", label: "Expenses", icon: Receipt },
        { key: "budgets", label: "Budgets", icon: Target },
        { key: "analytics", label: "Analytics", icon: BarChart3 },
      ]} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as Tab)} layoutId="expenses-tab-underline" />
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
          <div className="space-y-6">
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
      <AnimatePresence>{ai.panelOpen && <AiCommandHub ai={ai} moduleName="Expenses" onAction={handleAiAction} />}</AnimatePresence>
      <AiHubTrigger ai={ai} moduleName="Expenses" />
    </div>
  );
}
