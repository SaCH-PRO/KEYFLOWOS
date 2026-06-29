"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Search,
  SlidersHorizontal,
  Calendar,
  Download,
  Upload,
  Plus,
  ArrowUpDown,
  AlertCircle,
  CheckCircle,
  Clock,
  Receipt,
  FileText,
  TrendingUp,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  deleteExpense,
  updateExpense,
  getExpenseExportUrl,
  Expense,
  ExpenseBudget,
} from "@/lib/client";
import { getAuthHeaders } from "@/lib/api";
import { useExpensesData } from "./components/use-expenses-data";
import { ExpenseFormSideSheet, ExpensePrefill } from "./components/expense-form-sidesheet";
import { formatCurrency, formatDate } from "./components/expense-utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/* ───────────────────────────────────────────
   Types
   ─────────────────────────────────────────── */
type ExpenseStatusTab = "inbox" | "needs_review" | "pending_approval" | "approved" | "reimbursed" | "all";

interface DerivedStatus {
  key: string;
  label: string;
  color: string;
  bg: string;
}

/* ───────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────── */
function getMerchantInitials(vendor?: string): string {
  if (!vendor) return "?";
  const parts = vendor.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getMerchantColor(vendor?: string): string {
  if (!vendor) return "#94a3b8";
  const colors = ["#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e"];
  let hash = 0;
  for (let i = 0; i < vendor.length; i++) hash = vendor.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function deriveExpenseStatus(expense: Expense): DerivedStatus {
  if (expense.status === "VOID") {
    return { key: "void", label: "Rejected", color: "text-rose-700", bg: "bg-rose-50" };
  }
  if (expense.status === "BILL") {
    return { key: "pending_approval", label: "Pending approval", color: "text-blue-700", bg: "bg-blue-50" };
  }
  if (expense.status === "PAID" && !expense.receiptUrl) {
    return { key: "missing_receipt", label: "Missing receipt", color: "text-orange-700", bg: "bg-orange-50" };
  }
  if (expense.status === "PAID" && !expense.categoryId) {
    return { key: "needs_review", label: "Needs review", color: "text-amber-700", bg: "bg-amber-50" };
  }
  if (expense.isRecurring) {
    return { key: "recurring", label: "Recurring", color: "text-cyan-700", bg: "bg-cyan-50" };
  }
  if (expense.tags?.includes("reimbursable") || expense.tags?.includes("reimbursed")) {
    return { key: "reimbursed", label: "Reimbursed", color: "text-purple-700", bg: "bg-purple-50" };
  }
  return { key: "approved", label: "Approved", color: "text-emerald-700", bg: "bg-emerald-50" };
}

function matchesTab(expense: Expense, tab: ExpenseStatusTab): boolean {
  const ds = deriveExpenseStatus(expense);
  switch (tab) {
    case "inbox":
      return ds.key === "pending_approval" || ds.key === "missing_receipt" || ds.key === "needs_review" || ds.key === "void";
    case "needs_review":
      return ds.key === "needs_review";
    case "pending_approval":
      return ds.key === "pending_approval";
    case "approved":
      return ds.key === "approved" || ds.key === "recurring";
    case "reimbursed":
      return ds.key === "reimbursed";
    case "all":
      return true;
    default:
      return true;
  }
}

function getBudgetImpact(expense: Expense, budgets: ExpenseBudget[]): string {
  if (!expense.categoryId) return "Uncategorized";
  const b = budgets.find((bud) => bud.categoryId === expense.categoryId);
  if (!b) return "No budget";
  if (b.isOverBudget) return "Over budget";
  if (b.isNearAlert) return "At risk";
  return "Within budget";
}

function getBudgetImpactColor(expense: Expense, budgets: ExpenseBudget[]): string {
  if (!expense.categoryId) return "text-muted-foreground";
  const b = budgets.find((bud) => bud.categoryId === expense.categoryId);
  if (!b) return "text-muted-foreground";
  if (b.isOverBudget) return "text-rose-600";
  if (b.isNearAlert) return "text-amber-600";
  return "text-emerald-600";
}

/* ───────────────────────────────────────────
   Components
   ─────────────────────────────────────────── */
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
  iconBg,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:scale-[1.01]",
        onClick && "cursor-pointer"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-3.5 h-3.5", iconColor)} />
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </button>
  );
}

function StatusBadge({ status }: { status: DerivedStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", status.bg, status.color)}>
      {status.label}
    </span>
  );
}

function MerchantAvatar({ vendor }: { vendor?: string }) {
  const color = getMerchantColor(vendor);
  const initials = getMerchantInitials(vendor);
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}

/* ───────────────────────────────────────────
   Main Page
   ─────────────────────────────────────────── */
export default function ExpensesInboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const d = useExpensesData();
  const [activeTab, setActiveTab] = useState<ExpenseStatusTab>("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [prefill, setPrefill] = useState<ExpensePrefill | null>(null);
  const [_detailExpense, _setDetailExpense] = useState<Expense | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [_actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Debounced search sync with hook
  useEffect(() => {
    d.setSearchQuery(searchQuery);
  }, [searchQuery]);

  // Open add drawer when redirected from a device capture with prefill data
  useEffect(() => {
    const raw = searchParams.get("prefill");
    if (!raw) return;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
      if (parsed && typeof parsed === "object") {
        const data = parsed as ExpensePrefill;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- device-capture prefill hydration
        setPrefill({
          description: data.description,
          amount: typeof data.amount === "number" ? data.amount : undefined,
          date: data.date,
          vendor: data.vendor,
          receiptUrl: data.receiptUrl,
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- open side-sheet from query param
        setShowAddDrawer(true);
      }
    } catch {
      // ignore malformed prefill
    }
    // Strip the query param so a refresh does not reopen the drawer
    const next = new URLSearchParams(searchParams.toString());
    next.delete("prefill");
    const url = next.toString() ? `?${next.toString()}` : window.location.pathname;
    router.replace(url, { scroll: false });
  }, [searchParams]);

  const filteredExpenses = useMemo(() => {
    let list = d.expenses.filter((e) => matchesTab(e, activeTab));
    list = [...list].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return sortDir === "desc" ? db - da : da - db;
    });
    return list;
  }, [d.expenses, activeTab, sortDir]);

  const tabCounts = useMemo(() => {
    return {
      inbox: d.expenses.filter((e) => matchesTab(e, "inbox")).length,
      needs_review: d.expenses.filter((e) => matchesTab(e, "needs_review")).length,
      pending_approval: d.expenses.filter((e) => matchesTab(e, "pending_approval")).length,
      approved: d.expenses.filter((e) => matchesTab(e, "approved")).length,
      reimbursed: d.expenses.filter((e) => matchesTab(e, "reimbursed")).length,
      all: d.expenses.length,
    };
  }, [d.expenses]);

  // Stats
  const stats = useMemo(() => {
    const spentThisMonth = d.summary?.total ?? 0;
    const pendingApproval = d.expenses.filter((e) => e.status === "BILL").reduce((s, e) => s + e.amount, 0);
    const missingReceipts = d.expenses.filter((e) => e.status === "PAID" && !e.receiptUrl).length;
    const overBudget = d.budgets.filter((b) => b.isOverBudget).length;
    return { spentThisMonth, pendingApproval, missingReceipts, overBudget };
  }, [d.summary, d.expenses, d.budgets]);

  // Attention queue
  const attentionItems = useMemo(() => {
    const items: { type: string; title: string; desc: string; color: string; bg: string }[] = [];

    // Over policy (amount > 500 without receipt)
    const overPolicy = d.expenses.find((e) => e.amount > 500 && !e.receiptUrl && e.status === "PAID");
    if (overPolicy) {
      items.push({
        type: "over_policy",
        title: "Over policy",
        desc: `${overPolicy.vendor || "Expense"} exceeds travel policy by $${(overPolicy.amount - 500).toFixed(2)}.`,
        color: "text-rose-700",
        bg: "bg-rose-50",
      });
    }

    // Missing receipts
    if (stats.missingReceipts > 0) {
      items.push({
        type: "missing_receipts",
        title: "Missing receipts",
        desc: `${stats.missingReceipts} receipt${stats.missingReceipts !== 1 ? "s" : ""} need${stats.missingReceipts === 1 ? "s" : ""} a reminder before close.`,
        color: "text-amber-700",
        bg: "bg-amber-50",
      });
    }

    // Duplicate suspected
    const seen = new Map<string, Expense>();
    for (const e of d.expenses) {
      const key = `${e.vendor?.toLowerCase()}-${e.amount}`;
      if (seen.has(key)) {
        items.push({
          type: "duplicate",
          title: "Duplicate suspected",
          desc: `${e.vendor || "Expense"} resembles an existing expense.`,
          color: "text-pink-700",
          bg: "bg-pink-50",
        });
        break;
      }
      seen.set(key, e);
    }

    return items.slice(0, 4);
  }, [d.expenses, stats.missingReceipts]);

  const handleDelete = async (id: string) => {
    if (!d.businessId) return;
    setActionLoading((prev) => ({ ...prev, [`delete-${id}`]: true }));
    try {
      await deleteExpense(d.businessId, id);
      toast.success("Expense deleted");
      void d.loadData();
    } catch {
      toast.error("Failed to delete expense");
    }
    setActionLoading((prev) => ({ ...prev, [`delete-${id}`]: false }));
    setConfirmDelete(null);
  };

  const _handleMarkPaid = async (expense: Expense) => {
    if (!d.businessId) return;
    setActionLoading((prev) => ({ ...prev, [`paid-${expense.id}`]: true }));
    try {
      await updateExpense(d.businessId, expense.id, { status: "PAID", paidAt: new Date().toISOString() });
      toast.success("Marked as paid");
      void d.loadData();
    } catch {
      toast.error("Failed to mark as paid");
    }
    setActionLoading((prev) => ({ ...prev, [`paid-${expense.id}`]: false }));
  };

  const handleExport = () => {
    if (!d.businessId) return;
    fetch(getExpenseExportUrl(d.businessId), { headers: getAuthHeaders() })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
      });
  };

  const openAdd = () => { setEditingExpense(null); setPrefill(null); setShowAddDrawer(true); };
  const _openEdit = (exp: Expense) => { setEditingExpense(exp); setShowAddDrawer(true); };

  const totalPages = Math.max(1, Math.ceil(d.totalExpenses / d.pageSize));

  const tabs: { key: ExpenseStatusTab; label: string }[] = [
    { key: "inbox", label: "Inbox" },
    { key: "needs_review", label: "Needs review" },
    { key: "pending_approval", label: "Pending approval" },
    { key: "approved", label: "Approved" },
    { key: "reimbursed", label: "Reimbursed" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Expenses</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Capture, review, approve, and control company spend.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add expense</span>
            </button>
          </div>
        </div>

        {/* Search & actions */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search expenses, merchants, projects, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20 focus:border-[hsl(var(--kf-accent1))]/40"
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
            <button className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">May 2026</span>
            </button>
            <button
              onClick={handleExport}
              className="hidden md:inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Import bank feed</span>
            </button>
            <button className="hidden md:inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <Upload className="w-4 h-4" />
              <span>Upload receipts</span>
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCard
            label="Spent this month"
            value={formatCurrency(stats.spentThisMonth)}
            sub={`${d.summary ? Math.round((stats.spentThisMonth / (d.summary.total * 1.5 || 1)) * 100) : 0}% of monthly budget`}
            icon={TrendingUp}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatCard
            label="Pending approval"
            value={formatCurrency(stats.pendingApproval)}
            sub={`${tabCounts.pending_approval} expense${tabCounts.pending_approval !== 1 ? "s" : ""} waiting`}
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-50"
            onClick={() => setActiveTab("pending_approval")}
          />
          <StatCard
            label="Missing receipts"
            value={String(stats.missingReceipts)}
            sub={stats.missingReceipts > 0 ? "Needs follow-up" : "All receipts attached"}
            icon={Receipt}
            iconColor="text-orange-600"
            iconBg="bg-orange-50"
            onClick={() => setActiveTab("approved")}
          />
          <StatCard
            label="Over budget"
            value={`${stats.overBudget} category${stats.overBudget !== 1 ? "ies" : "y"}`}
            sub={stats.overBudget > 0 ? "Forecast risk this month" : "All on track"}
            icon={AlertTriangle}
            iconColor="text-rose-600"
            iconBg="bg-rose-50"
          />
        </div>

        {/* Main content grid */}
        <div className="flex flex-col xl:flex-row gap-5">
          {/* Left: Tabs + Table */}
          <div className="flex-1 min-w-0">
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "relative px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                    activeTab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                  <span className={cn("ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full", activeTab === t.key ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]" : "bg-muted text-muted-foreground")}>
                    {tabCounts[t.key]}
                  </span>
                  {activeTab === t.key && (
                    <motion.div
                      layoutId="expense-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              {d.loading && d.expenses.length === 0 ? (
                <div className="p-12 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredExpenses.length === 0 ? (
                <div className="p-12 text-center">
                  <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No expenses found</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your filters or add a new expense.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs w-10">
                          <input type="checkbox" className="rounded border-border" />
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">
                          <button onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))} className="inline-flex items-center gap-1 hover:text-foreground">
                            Date
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Merchant</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs hidden md:table-cell">Category</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs hidden lg:table-cell">Owner</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Status</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Amount</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs hidden xl:table-cell">Budget impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExpenses.map((exp) => {
                        const status = deriveExpenseStatus(exp);
                        const budgetImpact = getBudgetImpact(exp, d.budgets);
                        const budgetColor = getBudgetImpactColor(exp, d.budgets);
                        const category = d.categories.find((c) => c.id === exp.categoryId);
                        return (
                          <tr
                            key={exp.id}
                            className="border-b border-border/60 hover:bg-muted/20 transition-colors group cursor-pointer"
                            onClick={() => router.push(`/app/expenses/${exp.id}`)}
                          >
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" className="rounded border-border" />
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(exp.date)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <MerchantAvatar vendor={exp.vendor} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{exp.vendor || "Unknown merchant"}</p>
                                  <p className="text-[11px] text-muted-foreground truncate">{exp.description}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="text-xs text-muted-foreground">{category?.name || "—"}</span>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              <span className="text-xs text-muted-foreground">{exp.vendor || "—"}</span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-semibold text-foreground">{formatCurrency(exp.amount)}</span>
                            </td>
                            <td className="px-4 py-3 hidden xl:table-cell">
                              <span className={cn("text-xs font-medium", budgetColor)}>{budgetImpact}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <button
                    onClick={() => d.setPage((p) => Math.max(1, p - 1))}
                    disabled={d.page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Page {d.page} of {totalPages}
                  </span>
                  <button
                    onClick={() => d.setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={d.page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="w-full xl:w-[320px] flex-shrink-0 space-y-4">
            {/* Attention queue */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Attention queue</h3>
              <p className="text-xs text-muted-foreground mb-3">Prioritised exceptions that need action today.</p>
              {attentionItems.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">All caught up</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attentionItems.map((item, i) => (
                    <div key={i} className={cn("rounded-lg p-3", item.bg)}>
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle className={cn("w-3.5 h-3.5", item.color)} />
                        <span className={cn("text-xs font-semibold", item.color)}>{item.title}</span>
                      </div>
                      <p className={cn("text-[11px] leading-relaxed", item.color)}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Budget pulse */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Budget pulse</h3>
              <p className="text-xs text-muted-foreground mb-3">Monthly spend by category.</p>
              <div className="space-y-3">
                {d.budgets
                  .filter((b) => b.amount > 0)
                  .sort((a, b) => b.percentUsed - a.percentUsed)
                  .slice(0, 6)
                  .map((b) => {
                    const pct = Math.min(100, Math.round(b.percentUsed));
                    const barColor = b.isOverBudget
                      ? "bg-rose-500"
                      : b.isNearAlert
                        ? "bg-amber-500"
                        : "bg-emerald-500";
                    const textColor = b.isOverBudget
                      ? "text-rose-600"
                      : b.isNearAlert
                        ? "text-amber-600"
                        : "text-emerald-600";
                    return (
                      <div key={b.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-foreground font-medium">{b.category?.name || "Uncategorized"}</span>
                          <span className={cn("text-[11px] font-semibold", textColor)}>{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                {d.budgets.filter((b) => b.amount > 0).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">No budgets set</p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 italic">Tip: review exceptions first, not every row.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Drawer */}
      {showAddDrawer && d.businessId && (
        <ExpenseFormSideSheet
          businessId={d.businessId}
          categories={d.categories}
          editingExpense={editingExpense}
          projects={d.projects}
          contacts={d.contacts}
          services={d.services}
          prefill={prefill}
          onClose={() => {
            setShowAddDrawer(false);
            setPrefill(null);
          }}
          onSaved={() => {
            setShowAddDrawer(false);
            setPrefill(null);
            void d.loadData();
          }}
        />
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete expense?"
        message="This action cannot be undone. The expense will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
