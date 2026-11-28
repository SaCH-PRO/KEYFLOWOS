"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  getExpenseExportUrl,
  Expense,
  ExpenseBudget,
} from "@/lib/client";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { useUpload } from "@/hooks/use-upload";
import { useExpensesData } from "./components/use-expenses-data";
import { ExpenseFormSideSheet, ExpensePrefill, isOwnUploadPath } from "./components/expense-form-sidesheet";
import { ReadFailureNote } from "./components/read-failure-note";
import type { BlockRead } from "./components/use-expenses-data";
import { ExpenseCategoriesTab } from "./components/expense-categories-tab";
import RecurringExpensesPanel from "./components/recurring-expenses-panel";
import { PERIODS, formatCurrency, formatDate, expenseExportFileName, startRefusal, canStartFor, BUSINESS_CHANGED_ELSEWHERE } from "./components/expense-utils";
import { NoAccessState } from "@/components/ui/no-access-state";

/* ───────────────────────────────────────────
   Types
   ─────────────────────────────────────────── */
type ExpenseStatusTab = "inbox" | "needs_review" | "pending_approval" | "approved" | "reimbursed" | "all";
/** EXPENSES-HUB-3 (BUG-060): the page's views. Categories and Recurring were built but never mounted. */
type ExpensesView = "expenses" | "categories" | "recurring";
const VIEWS: { key: ExpensesView; label: string }[] = [
  { key: "expenses", label: "Expenses" },
  { key: "categories", label: "Categories" },
  { key: "recurring", label: "Recurring" },
];

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
  // EXPENSES-HUB-2 (BUG-059): the sheet opens as an expense (Add expense) or a bill to pay later (Record bill).
  const [sheetKind, setSheetKind] = useState<"expense" | "bill">("expense");
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [prefill, setPrefill] = useState<ExpensePrefill | null>(null);
  const [_detailExpense, _setDetailExpense] = useState<Expense | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [view, setView] = useState<ExpensesView>("expenses");
  const [showFilters, setShowFilters] = useState(false);
  const [recurringTrigger, setRecurringTrigger] = useState(0);
  const [recurringRead, setRecurringRead] = useState<BlockRead>({ kind: "loading" });
  // R27-3: leaving the Recurring view forgets its list read, so on return the first render offers no "New recurring
  // expense" from the earlier visit's answer (reset during render, before the panel can report).
  if (view !== "recurring" && recurringRead.kind !== "loading") setRecurringRead({ kind: "loading" });
  // P254 R3-2: a New request is for the business it was pressed under. The panel remounts on a business change
  // (directly or via none) and opens its builder when triggerNew is set at mount, so the request is forgotten in the
  // render that shows the new business, before that panel mounts.
  const [triggerBusiness, setTriggerBusiness] = useState(d.businessId);
  if (triggerBusiness !== d.businessId) {
    setTriggerBusiness(d.businessId);
    setRecurringTrigger(0);
  }
  // EXPENSES-HUB-3: "Upload receipts" was a button with no handler. A receipt goes up through the one presigned
  // upload (hooks/use-upload.ts) and opens Add expense with it attached; saving writes it to Expense.receiptUrl.
  const { uploadFile, isUploading: uploadingReceipt } = useUpload();

  // R23-5: a sheet opened for the business the page has left closes in the render that shows the new one, so no
  // instance of it is ever given the new business's id while it holds the old one's state (React's reset on a prop
  // change, during render). Not on the first business: a device capture's prefill opens the sheet then.
  const [sheetBusiness, setSheetBusiness] = useState(d.businessId);
  if (sheetBusiness !== d.businessId) {
    setSheetBusiness(d.businessId);
    if (sheetBusiness) {
      setShowAddDrawer(false);
      setPrefill(null);
      setEditingExpense(null);
    }
  }

  // Debounced search sync with hook. R23-7: the hook's setter (a state setter, so stable) is the dependency, not
  // the hook's whole result, which is a new object on every render.
  const { setSearchQuery: setDataSearchQuery } = d;
  useEffect(() => {
    setDataSearchQuery(searchQuery);
  }, [searchQuery, setDataSearchQuery]);

  // R23-7: the router is read through a ref, so a router object that changes identity between renders never runs
  // the prefill effect again (it runs when the search params change, as before).
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

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
         
        setShowAddDrawer(true);
      }
    } catch {
      // ignore malformed prefill
    }
    // Strip the query param so a refresh does not reopen the drawer
    const next = new URLSearchParams(searchParams.toString());
    next.delete("prefill");
    const url = next.toString() ? `?${next.toString()}` : window.location.pathname;
    routerRef.current.replace(url, { scroll: false });
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
    const spentInPeriod = d.summary?.total ?? 0;
    // COR MINOR-5: a sum over the page of rows loaded is said to be one; the missing-receipt count is the server's,
    // for the period it summed.
    const pendingApproval = d.expenses.filter((e) => e.status === "BILL").reduce((s, e) => s + e.amount, 0);
    const missingReceipts = d.summary?.missingReceiptCount ?? 0;
    const overBudget = d.budgets.filter((b) => b.isOverBudget).length;
    return { spentInPeriod, pendingApproval, missingReceipts, overBudget };
  }, [d.summary, d.expenses, d.budgets]);
  // R24b: a Retry of a refused block reads the page again (the hook's reads are one round trip).
  const retryRead = () => { void d.loadData(); };
  const summaryOk = d.summaryRead.kind === "ok";
  const budgetsOk = d.budgetsRead.kind === "ok";
  /** What a block whose own read did not come back shows instead of a figure (COR MINOR-7). */
  const blockState = (r: typeof d.summaryRead) =>
    r.kind === "no-access" ? "No access" : r.kind === "failed" ? "Couldn't load" : "…";

  // Attention queue
  const attentionItems = useMemo(() => {
    const items: { type: string; title: string; desc: string; color: string; bg: string }[] = [];
    // BUG-072 (fixed by removal): an "Over policy ... exceeds travel policy by $..." item was invented here from a
    // 500 limit the business never set. There is no expense policy in v1, so nothing is said about one.

    // Missing receipts: the server's count, over every status (C-m2: said so, as the card is).
    if (summaryOk && stats.missingReceipts > 0) {
      const period = PERIODS.find((p) => p.value === d.period)?.label ?? "this period";
      items.push({
        type: "missing_receipts",
        title: "Missing receipts",
        desc: `${stats.missingReceipts} expense${stats.missingReceipts !== 1 ? "s" : ""} without a receipt · ${period}, all statuses.`,
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
  }, [d.expenses, d.period, stats.missingReceipts, summaryOk]);

  const handleExport = () => {
    if (!d.businessId) return;
    const forBusiness = d.businessId;
    const fileName = expenseExportFileName(forBusiness);
    // R14-3: a failure after a switch is not said on the other business. A CSV that arrives after the switch still
    // downloads: the owner asked for that export, and the file names nothing but the rows it holds.
    fetch(getExpenseExportUrl(forBusiness), { headers: getAuthHeaders() })
      .then(async (r) => {
        // A refused or failed export used to download the error body as the CSV.
        if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to export expenses. Ask the owner for access." : "Couldn't export expenses.");
        return r.blob();
      })
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = fileName; // R15-2: names the business the export was asked for
        a.click();
      })
      .catch((err: unknown) => {
        if (d.isCurrentBusiness(forBusiness)) toast.error(err instanceof Error ? err.message : "Couldn't export expenses.");
      });
  };

  // SEC-EXH3-1: the business this page shows. An upload started for it attaches only to it: the presign is sent for
  // the stored business (hooks/use-upload.ts), so a mismatch is refused before sending, a switch while it runs drops
  // its answer, and a path issued for another business is never attached.
  const pageBusiness = useRef<string | null>(null);
  useEffect(() => {
    pageBusiness.current = d.businessId;
  }, [d.businessId]);

  const handleReceiptChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // The same photo can be chosen again after a failure.
    e.target.value = "";
    if (!file) return;
    const bid = d.businessId;
    const refusal = startRefusal(bid, d.isCurrentBusiness);
    if (refusal || !bid) {
      toast.error(refusal === BUSINESS_CHANGED_ELSEWHERE || !refusal ? "The business changed in another tab. Reload this page, then upload the receipt." : refusal);
      return;
    }
    const uploaded = await uploadFile(file);
    // R19-5: the reply is judged by the start check's test too (a silent switch moves only the stored id).
    if (pageBusiness.current !== bid || !canStartFor(bid, d.isCurrentBusiness)) return;
    if (!uploaded) {
      toast.error("Couldn't upload the receipt. Try again.");
      return;
    }
    const path = uploaded.objectPath;
    if (!isOwnUploadPath(path, bid)) {
      toast.error("Couldn't attach the receipt: it was stored for another business. Try again.");
      return;
    }
    const receiptUrl = path.startsWith("http") ? path : `${API_BASE}${path}`;
    toast.success("Receipt uploaded");
    setEditingExpense(null);
    setSheetKind("expense");
    // COR MINOR-2: the photo goes with it, so the save makes the same Drive copy the sheet's own photo makes.
    setPrefill({ receiptUrl, receiptFile: file });
    setShowAddDrawer(true);
  };

  const openAdd = () => { setEditingExpense(null); setPrefill(null); setSheetKind("expense"); setShowAddDrawer(true); };
  const openBill = () => { setEditingExpense(null); setPrefill(null); setSheetKind("bill"); setShowAddDrawer(true); };
  const _openEdit = (exp: Expense) => { setEditingExpense(exp); setSheetKind("expense"); setShowAddDrawer(true); };

  const totalPages = Math.max(1, Math.ceil(d.totalExpenses / d.pageSize));
  const periodLabel = PERIODS.find((p) => p.value === d.period)?.label ?? "this period";

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
          {/* COR MINOR-8: a member who may not read expenses is not offered expense writes (the server still gates). */}
          {d.read.kind === "ok" && (
          <div className="flex items-center gap-2">
            <button
              onClick={openBill}
              aria-label="Record bill"
              title="Record a bill to pay later"
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Record bill</span>
            </button>
            <button
              onClick={openAdd}
              aria-label="Add expense"
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] sm:min-h-0 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add expense</span>
            </button>
          </div>
          )}
        </div>

        {/* BUG-064 (journey J6): a refused read is "No access - ask the owner", a failed one says it could not load;
            neither shows the page's empty values (TTD 0.00, "No expenses found", "All caught up"). */}
        {d.read.kind === "loading" ? (
          <div className="p-12 flex items-center justify-center" role="status" aria-label="Loading expenses">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : d.read.kind === "no-business" ? (
          <div role="status" className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm font-medium text-foreground">No business is selected.</p>
            <p className="text-xs text-muted-foreground mt-1">Choose a business from the switcher to see its expenses.</p>
          </div>
        ) : d.read.kind === "no-access" ? (
          <NoAccessState message={d.read.message} what="expenses" />
        ) : d.read.kind === "failed" ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">{d.read.message}</p>
            <button
              onClick={() => void d.loadData()}
              className="mt-3 inline-flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg border border-border text-sm text-foreground hover:bg-muted/50"
            >
              Try again
            </button>
          </div>
        ) : (
        <>
        {/* Views (BUG-060) */}
        <div role="tablist" aria-label="Expenses views" className="inline-flex items-center gap-1 p-1 mb-5 rounded-lg border border-border bg-card">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              id={`expenses-view-${v.key}`}
              aria-selected={view === v.key}
              aria-controls={`expenses-panel-${v.key}`}
              onClick={() => {
                // COR MINOR-6: the panel opens its builder when triggerNew is set at mount, so a click from an
                // earlier visit must not survive leaving the tab.
                if (v.key !== view) setRecurringTrigger(0);
                setView(v.key);
              }}
              className={cn(
                "px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-md text-sm font-medium transition-colors",
                view === v.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "categories" && d.businessId && (
          <div role="tabpanel" id="expenses-panel-categories" aria-labelledby="expenses-view-categories">
            <ExpenseCategoriesTab
              businessId={d.businessId}
              categories={d.categories}
              isCurrentBusiness={d.isCurrentBusiness}
              addCategory={d.addCategory}
              removeCategory={d.removeCategory}
              summary={d.summary}
              budgets={d.budgets}
              categoriesRead={d.categoriesRead}
              onRetry={retryRead}
            />
          </div>
        )}

        {view === "recurring" && (
          <div role="tabpanel" id="expenses-panel-recurring" aria-labelledby="expenses-view-recurring" className="space-y-4">
            {/* R26-6: offered only when the Recurring list's read answered (never beside a refused or unread list). */}
            {recurringRead.kind === "ok" && (
            <div className="flex justify-end">
              <button
                onClick={() => setRecurringTrigger((n) => n + 1)}
                className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New recurring expense
              </button>
            </div>
            )}
            <RecurringExpensesPanel businessId={d.businessId} categories={d.categories} triggerNew={recurringTrigger} isCurrentBusiness={d.isCurrentBusiness} categoriesRead={d.categoriesRead} onRetryCategories={retryRead} onListRead={setRecurringRead} />
          </div>
        )}

        {view === "expenses" && (
        <div role="tabpanel" id="expenses-panel-expenses" aria-labelledby="expenses-view-expenses">
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
          {/* BUG-073: every toolbar control does what it says. The month label was "May 2026" in every month and did
              nothing; it is the period the server sums. "Import bank feed" downloaded the CSV export: it is named so. */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-controls="expenses-filters"
              aria-label="Filters"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-card text-sm hover:text-foreground hover:bg-muted/50 transition-colors",
                showFilters || d.filterCategory ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
            </button>
            <label className="relative inline-flex items-center">
              <Calendar className="w-4 h-4 absolute left-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <select
                value={d.period}
                onChange={(e) => d.setPeriod(e.target.value)}
                aria-label="Time period"
                className="pl-9 pr-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <button
              onClick={handleExport}
              className="hidden md:inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
            <label
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-[hsl(var(--kf-accent1))]/30",
                uploadingReceipt && "opacity-60 pointer-events-none"
              )}
            >
              {uploadingReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
              <span className="hidden sm:inline">{uploadingReceipt ? "Uploading…" : "Upload receipt"}</span>
              {/* On a phone this opens the camera (capture); the Add expense sheet's Upload file takes any image or PDF. */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Upload receipt"
                className="sr-only"
                disabled={uploadingReceipt}
                onChange={handleReceiptChosen}
              />
            </label>
          </div>
        </div>

        {showFilters && (
          <div id="expenses-filters" className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg border border-border bg-card">
            <select
              value={d.filterCategory}
              onChange={(e) => d.setFilterCategory(e.target.value)}
              aria-label="Category"
              className="px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg border border-border bg-background text-sm text-foreground"
            >
              <option value="">All categories</option>
              {d.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ReadFailureNote read={d.categoriesRead} onRetry={retryRead} />
            {d.filterCategory && (
              <button
                onClick={() => d.setFilterCategory("")}
                className="px-3 py-2 min-h-[44px] sm:min-h-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {/* BUG-072 (fixed by removal): the line under this figure was "<n>% of monthly budget", the total divided
              by 1.5 times itself (67% with any spend, budget or not). It now says only what the server counted. */}
          <StatCard
            label={`Spent · ${periodLabel}`}
            value={summaryOk ? formatCurrency(stats.spentInPeriod, undefined, d.businessId) : blockState(d.summaryRead)}
            sub={summaryOk && d.summary ? `${d.summary.count} expense${d.summary.count !== 1 ? "s" : ""}` : ""}
            icon={TrendingUp}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatCard
            label="Pending approval"
            value={formatCurrency(stats.pendingApproval, undefined, d.businessId)}
            sub={`${tabCounts.pending_approval} bill${tabCounts.pending_approval !== 1 ? "s" : ""} on this page`}
            icon={Clock}
            iconColor="text-amber-600"
            iconBg="bg-amber-50"
            onClick={() => setActiveTab("pending_approval")}
          />
          <StatCard
            label={`Missing receipts · ${periodLabel}`}
            value={summaryOk ? String(stats.missingReceipts) : blockState(d.summaryRead)}
            sub={!summaryOk ? "" : "All statuses, bills and voided included"}
            icon={Receipt}
            iconColor="text-orange-600"
            iconBg="bg-orange-50"
            // R2-4: the server's count has no status filter; it opens no narrower list (it opened Approved).
          />
          <StatCard
            label="Over budget this month"
            value={budgetsOk ? `${stats.overBudget} ${stats.overBudget === 1 ? "category" : "categories"}` : blockState(d.budgetsRead)}
            sub={!budgetsOk ? "" : stats.overBudget > 0 ? "Over this month's budget" : "All on track"}
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
                        {/* COR MINOR-5: an "Owner" column showed the vendor; an expense has no owner field. */}
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
                              {formatDate(exp.date, d.businessId)}
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
                            <td className="px-4 py-3">
                              <StatusBadge status={status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-semibold text-foreground">{formatCurrency(exp.amount, exp.currency, d.businessId)}</span>
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
                {!budgetsOk && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    {d.budgetsRead.kind === "no-access" ? "No access to budgets - ask the owner." : d.budgetsRead.kind === "failed" ? d.budgetsRead.message : "Loading budgets…"}
                  </p>
                )}
                {budgetsOk && d.budgets
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
                {budgetsOk && d.budgets.filter((b) => b.amount > 0).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">No budgets set</p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 italic">Tip: review exceptions first, not every row.</p>
            </div>
          </div>
        </div>
        </div>
        )}
        </>
        )}
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
          initialKind={sheetKind}
          onClose={() => {
            setShowAddDrawer(false);
            setPrefill(null);
          }}
          onSaved={() => {
            setShowAddDrawer(false);
            setPrefill(null);
            void d.loadData();
          }}
          isCurrentBusiness={d.isCurrentBusiness}
          categoriesRead={d.categoriesRead}
          onRetryCategories={retryRead}
          linksRead={d.pickersRead}
          onRetryLinks={d.retryPickers}
        />
      )}

    </div>
  );
}
