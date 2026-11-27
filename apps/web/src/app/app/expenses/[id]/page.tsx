"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  X,
  Download,
  Loader2,
  FileText,
  ExternalLink,
  Pencil,
  Trash2,
  Ban,
  Check,
  Upload,
} from "lucide-react";
import {
  getExpense,
  deleteExpense,
  fetchExpenseCategories,
  fetchExpenseBudgets,
  Expense,
  ExpenseCategory,
  ExpenseBudget,
} from "@/lib/client";
import { voidBill } from "@/lib/api/finance";
import { BUSINESS_CHANGED_EVENT, getStoredBusinessId } from "@/lib/workspace";
import { EXPENSES_BUSINESS_ID_KEY, businessCurrency, businessTimeZone, dayInZone, formatCurrency, formatDate, canStartFor, refusedStart } from "../components/expense-utils";
import { ExpenseFormSideSheet, RECEIPT_STORED_NOTE, RECEIPT_UNAVAILABLE_NOTE, receiptKind } from "../components/expense-form-sidesheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { refusalMessage } from "@/lib/failure-kit";
import { BillPayDialog } from "../components/bill-pay-dialog";

/**
 * EXPENSES-HUB-1 (BUG-031): the server refuses to delete a posted expense (expenses.service deleteExpense, FIN3) in
 * words meant for a developer ("call POST /finance/.../void"). Said to the owner: why, and the way out, Void.
 */
const POSTED_DELETE_REFUSAL = /cannot delete a posted expense/i;
/** The way out fits the row (review COR M1): a paid expense is voided, a bill is rejected, a void row is done. */
function postedDeleteWords(status: string | undefined): string {
  if (status === "BILL") {
    return "This bill is posted to your books, so it can't be deleted. Reject it instead: that voids it and reverses its entries.";
  }
  if (status === "VOID") {
    return "This expense is already voided: its entries are reversed and it stays on record, so it can't be deleted.";
  }
  return "This expense is posted to your books, so it can't be deleted. Void it instead: that reverses its entries and keeps it on record as voided.";
}

function _getMerchantColor(vendor?: string): string {
  if (!vendor) return "#94a3b8";
  const colors = ["#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1", "#14b8a6", "#f43f5e"];
  let hash = 0;
  for (let i = 0; i < vendor.length; i++) hash = vendor.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function deriveStatus(expense: Expense) {
  if (expense.status === "VOID") return { label: "Rejected", color: "text-rose-700", bg: "bg-rose-50" };
  if (expense.status === "BILL") return { label: "Needs review", color: "text-amber-700", bg: "bg-amber-50" };
  if (expense.status === "PAID" && !expense.receiptUrl) return { label: "Missing receipt", color: "text-orange-700", bg: "bg-orange-50" };
  if (expense.status === "PAID" && !expense.categoryId) return { label: "Needs review", color: "text-amber-700", bg: "bg-amber-50" };
  if (expense.isRecurring) return { label: "Recurring", color: "text-cyan-700", bg: "bg-cyan-50" };
  return { label: "Approved", color: "text-emerald-700", bg: "bg-emerald-50" };
}

/**
 * The expense's own month, as { month, year } (COR MINOR-4: its budget is that month's). A calendar day (date-only, or
 * exactly midnight UTC, as the forms store a date) is read as written; any other instant in the business's zone.
 */
function expenseMonth(date: string, businessId: string | null): { month: number; year: number } {
  const calendar = /^(\d{4})-(\d{2})-\d{2}(?:T00:00(?::00(?:\.0+)?)?Z)?$/.exec(date);
  const day = calendar ? date.slice(0, 10) : dayInZone(new Date(date), businessTimeZone(businessId));
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

export default function ExpenseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expenseId = params.id as string;

  const [expense, setExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [businessId, _setBusinessId] = useState<string | null>(() => getStoredBusinessId() ?? null);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // R14-4: this page shows one business's expense. A switch (this tab's switcher, or another tab's stored id) leaves
  // for the Expenses list and stops showing it; a reply for it that lands after the switch says nothing.
  const [left, setLeft] = useState(false);
  const isCurrentBusiness = useCallback((forBusiness: string) => getStoredBusinessId() === forBusiness, []);
  // R19-5: replies to this page's actions are judged by the start check's test.
  const live = (forBusiness: string) => canStartFor(forBusiness, isCurrentBusiness);
  // R15-5: leaving is one step, used by the listeners and by a read that lands after the stored business moved on.
  // The router is read through a ref: a router object that changes identity between renders must not re-run the
  // read effect (which depends on leave).
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  // R16-2: once only. A real switch fires the listener, and the read that then lands is stale too.
  const leftRef = useRef(false);
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    setLeft(true);
    routerRef.current.replace("/app/expenses");
  }, []);
  useEffect(() => {
    if (!businessId) return;
    const check = () => {
      if (getStoredBusinessId() === businessId) return;
      leave();
    };
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === EXPENSES_BUSINESS_ID_KEY) check(); };
    window.addEventListener(BUSINESS_CHANGED_EVENT, check);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, check);
      window.removeEventListener("storage", onStorage);
    };
  }, [businessId, leave]);

  useEffect(() => {
    if (!businessId || !expenseId) return;
    // R16-1: a read that lands after this page has gone (unmounted, or the read replaced) does nothing, and above
    // all navigates nowhere: the user may be on another page by then.
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [expRes, catRes] = await Promise.all([
          getExpense(businessId, expenseId),
          fetchExpenseCategories(businessId),
        ]);
        if (!active) return;
        // R15-5: a read that lands for a business no longer stored writes nothing and leaves the page at once
        // (another tab's switch can reach the stored id before its storage event reaches this tab).
        if (!isCurrentBusiness(businessId)) { leave(); return; }
        if (expRes.data) setExpense(expRes.data);
        if (catRes.data) setCategories(catRes.data);
        // COR MINOR-4: the budgets of the expense's own month, not of the month it is today.
        if (expRes.data) {
          const { month, year } = expenseMonth(expRes.data.date, businessId);
          const budRes = await fetchExpenseBudgets(businessId, month, year);
          if (!active) return;
          if (!isCurrentBusiness(businessId)) { leave(); return; }
          if (budRes.data) setBudgets(budRes.data);
        }
      } catch {
        if (active && isCurrentBusiness(businessId)) toast.error("Failed to load expense");
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [businessId, expenseId, isCurrentBusiness, leave]);

  const category = useMemo(() => categories.find((c) => c.id === expense?.categoryId), [categories, expense]);
  const budget = useMemo(() => budgets.find((b) => b.categoryId === expense?.categoryId), [budgets, expense]);
  const status = useMemo(() => (expense ? deriveStatus(expense) : { label: "", color: "", bg: "" }), [expense]);

  // FOLLOW3-B7 (owner ruling D-67): Approve pays the BILL (POST bills/:id/pay, Dr AP / Cr the account paid from)
  // and Reject voids it (POST bills/:id/void, the reversal). EXPENSES-HUB-1 (D-168, BUG-025): Approve no longer pays
  // at once from Cash; it opens Pay, which asks the account and the method (components/bill-pay-dialog.tsx). Each
  // door answers the row as it now stands; a refusal is said in the server's words (FAILURE-KIT).
  const runVoid = async (action: "reject" | "void", success: string) => {
    if (!businessId || !expense) return;
    // R19-3: a refused start says why (another business chosen, or the choice could not be read); R20-5: and its
    // confirm closes, as Pay's dialog does.
    if (refusedStart(businessId, isCurrentBusiness)) {
      setConfirmVoid(false);
      return;
    }
    setActionLoading(action);
    try {
      const res = await voidBill(businessId, expense.id);
      if (!live(businessId)) return;
      const refusal = refusalMessage(res, { what: action === "void" ? "void this expense" : "reject this bill" });
      if (refusal !== null) {
        toast.error(refusal);
      } else {
        toast.success(success);
        if (res.data) setExpense({ ...expense, ...res.data });
      }
    } catch {
      if (live(businessId)) toast.error(action === "void" ? "Couldn't void this expense." : "Failed to reject");
    }
    setActionLoading(null);
    setConfirmVoid(false);
  };

  const handleApprove = () => setShowPay(true);
  const handleReject = () => runVoid("reject", "Bill rejected and voided");
  const handleVoid = () => runVoid("void", "Expense voided");

  // EXPENSES-HUB-1 (BUG-031): deleteExpense answers a refusal as { error } and does not throw, so the page reads
  // the answer: "Expense deleted" only when it went through.
  const handleDelete = async () => {
    if (!businessId || !expense) return;
    if (refusedStart(businessId, isCurrentBusiness)) {
      setConfirmDelete(false);
      return;
    }
    setActionLoading("delete");
    try {
      const res = await deleteExpense(businessId, expense.id);
      if (!live(businessId)) return;
      const refusal = refusalMessage(res, { what: "delete this expense" });
      if (refusal !== null) {
        toast.error(POSTED_DELETE_REFUSAL.test(refusal) ? postedDeleteWords(expense.status) : refusal);
      } else {
        toast.success("Expense deleted");
        router.push("/app/expenses");
      }
    } catch {
      if (live(businessId)) toast.error("Couldn't delete this expense.");
    }
    setActionLoading(null);
    setConfirmDelete(false);
  };

  if (left) {
    // R14-4: the business changed: nothing of the old one's expense is shown, and nothing can be done to it.
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">The business changed. Opening your expenses…</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!expense) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Expense not found</p>
          <button onClick={() => router.push("/app/expenses")} className="mt-3 text-sm text-[hsl(var(--kf-accent1))] hover:underline">
            Back to expenses
          </button>
        </div>
      </div>
    );
  }

  const isPending = expense.status === "BILL";
  // D-170: a posted expense (paid; a bill is corrected by Reject) offers Void.
  const canVoid = expense.status === "PAID";
  const percentUsed = budget ? Math.min(100, Math.round(budget.percentUsed)) : 0;
  // The server's remaining already counts this expense (spent is the month's paid expenses); it is shown as is.
  const { month: budgetMonth, year: budgetYear } = expenseMonth(expense.date, businessId);
  const budgetMonthLabel = new Date(Date.UTC(budgetYear, budgetMonth - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const receipt = receiptKind(expense.receiptUrl, businessId);

  return (
    <div className="min-h-screen bg-background">
      {/* pb-28 below md: room above the fixed mobile navigation, so the last Actions (Delete, Void) can be scrolled
          clear of it at 375 (the sweep found Delete covered: the app shell's own pb-28 sits under its h-full
          PageTransition box, not under a page taller than it). */}
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 pb-28 md:pb-6">
        {/* Back link */}
        <button
          onClick={() => router.push("/app/expenses")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to expenses
        </button>

        {/* Title row */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-foreground">{expense.vendor || expense.description}</h1>
              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", status.bg, status.color)}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(expense.amount, expense.currency, businessId)} · {category?.name || "Uncategorized"} · {expense.vendor || "—"} · {expense.paymentMethod || "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPending && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={!!actionLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={handleReject}
                  disabled={!!actionLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-foreground border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Reject
                </button>
              </>
            )}
          </div>
        </div>

        {/* Info cards. EXPENSES-HUB-3 (BUG-072, fixed by removal): an "Approval: Manager / Jane → Finance" (or
            "Self / Auto-approved") card, "Policy check passed", "Uploaded today" and "Recurring SaaS" were invented
            here; v1 has no approval chain and no expense policy. Each card shows only what the server sent. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Amount", value: formatCurrency(expense.amount, expense.currency, businessId), sub: expense.currency || businessCurrency(businessId) },
            { label: "Merchant", value: expense.vendor || "—", sub: expense.isRecurring ? "Recurring" : "One-time" },
            { label: "Date", value: formatDate(expense.date, businessId), sub: "" },
            { label: "Status", value: status.label, sub: "" },
          ].map((card, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">{card.label}</p>
              <p className="text-sm font-semibold text-foreground">{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Three-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Receipt preview */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Receipt preview</h3>
              {expense.receiptUrl && receipt === "link" && (
                <a
                  href={expense.receiptUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              )}
            </div>
            {receipt === "stored" || receipt === "unavailable" ? (
              // COR MINOR-1 / R2-3: no route serves an /objects/ path yet (server row P222). This business's upload is
              // said to be stored; any other /objects/ path is not claimed as this expense's receipt. Neither is linked.
              <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border bg-muted/30 text-center px-4">
                <FileText className="w-10 h-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-foreground">{receipt === "stored" ? RECEIPT_STORED_NOTE : RECEIPT_UNAVAILABLE_NOTE}</p>
              </div>
            ) : receipt === "link" && expense.receiptUrl ? (
              // R11-4: only an address receiptKind calls a link is linked; a blank one (whitespace only) is "none".
              expense.receiptUrl.trim().match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={expense.receiptUrl.trim()}
                  alt="Receipt"
                  className="w-full max-h-96 object-contain rounded-lg border border-border/40"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border bg-muted/30">
                  <FileText className="w-10 h-10 text-muted-foreground/40 mb-2" />
                  <a
                    href={expense.receiptUrl.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--kf-accent1))] hover:underline"
                  >
                    View receipt <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border bg-muted/30">
                <Upload className="w-10 h-10 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No receipt uploaded</p>
              </div>
            )}
          </div>

          {/* Expense details */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Expense details</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Category</label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background">
                  {category?.color && <div className="w-2 h-2 rounded-full" style={{ background: category.color }} />}
                  <span className="text-sm text-foreground">{category?.name || "Uncategorized"}</span>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Budget line</label>
                <div className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground">
                  {category?.name || "Uncategorized"}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Project</label>
                <div className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground">
                  {expense.projectId || "—"}
                </div>
              </div>
              {/* BUG-072: "Tax treatment: Tax included" and "Policy: Within policy" were the same for every expense. */}
              {expense.notes && (
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Reviewer note</label>
                  <div className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground">
                    {expense.notes}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Budget impact + Activity */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Budget impact</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {category?.name || "Uncategorized"} · {budgetMonthLabel}
              </p>
              {budget ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly budget</span>
                    <span className="font-semibold text-foreground">{formatCurrency(budget.amount, undefined, businessId)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Spent so far</span>
                    <span className="font-semibold text-foreground">{formatCurrency(budget.spent, undefined, businessId)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">This expense</span>
                    <span className="font-semibold text-foreground">{formatCurrency(expense.amount, expense.currency, businessId)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining</span>
                    <span className={cn("font-semibold", budget.remaining < 0 ? "text-rose-600" : "text-foreground")}>
                      {formatCurrency(budget.remaining, undefined, businessId)}
                    </span>
                  </div>
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn("text-xs font-semibold", budget.isOverBudget ? "text-rose-600" : "text-emerald-600")}>
                        {budget.isOverBudget ? "Over budget" : "Within budget"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{percentUsed}% used</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          budget.isOverBudget ? "bg-rose-500" : budget.isNearAlert ? "bg-amber-500" : "bg-emerald-500"
                        )}
                        style={{ width: `${Math.min(100, percentUsed)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No budget set for this category.</p>
              )}
            </div>

            {/* BUG-072: the "Approval & activity" list ("Uploaded receipt", "Rule suggested ...", "Queued for review",
                "Approved", each stamped "Today") and its dead "Add comment" were invented. The history is the server's. */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">History</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Recorded</dt>
                  <dd className="text-foreground">{formatDate(expense.createdAt, businessId)}</dd>
                </div>
                {expense.paidAt && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="text-foreground">{formatDate(expense.paidAt, businessId)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Actions */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Actions</h3>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowEdit(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground border border-border hover:bg-muted transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  Edit expense
                </button>
                {canVoid && (
                  <button
                    onClick={() => setConfirmVoid(true)}
                    disabled={!!actionLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground border border-border hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <Ban className="w-4 h-4" />
                    Void expense
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-600 border border-rose-200 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete expense
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit drawer */}
      {showEdit && businessId && (
        <ExpenseFormSideSheet
          businessId={businessId}
          categories={categories}
          editingExpense={expense}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            const res = await getExpense(businessId, expenseId);
            if (res.data && isCurrentBusiness(businessId)) setExpense(res.data);
          }}
          isCurrentBusiness={isCurrentBusiness}
        />
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete expense?"
        message="This action cannot be undone. The expense will be permanently removed."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        busy={actionLoading === "delete"}
      />

      {/* Confirm void (D-170) */}
      <ConfirmDialog
        open={confirmVoid}
        title="Void this expense?"
        message="Voiding reverses its entries in your books. The expense stays on record as voided, and this can't be undone."
        confirmLabel="Void expense"
        variant="danger"
        onConfirm={handleVoid}
        onCancel={() => setConfirmVoid(false)}
        busy={actionLoading === "void"}
      />

      {/* Pay a bill: asks the account and the method (D-168) */}
      {showPay && businessId && (
        <BillPayDialog
          businessId={businessId}
          bill={expense}
          onClose={() => setShowPay(false)}
          isCurrentBusiness={isCurrentBusiness}
          onPaid={(paid) => {
            setShowPay(false);
            toast.success("Bill paid");
            if (paid) setExpense({ ...expense, ...paid });
          }}
        />
      )}
    </div>
  );
}
