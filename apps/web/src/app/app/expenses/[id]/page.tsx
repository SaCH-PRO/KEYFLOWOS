"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CheckCircle,
  X,
  Receipt,
  Download,
  Loader2,
  FileText,
  ExternalLink,
  Pencil,
  Trash2,
  Check,
  Clock,
  Upload,
  MessageSquare,
} from "lucide-react";
import {
  getExpense,
  deleteExpense,
  updateExpense,
  fetchExpenseCategories,
  fetchExpenseBudgets,
  Expense,
  ExpenseCategory,
  ExpenseBudget,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency, formatDate } from "../components/expense-utils";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function getMerchantColor(vendor?: string): string {
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

export default function ExpenseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const expenseId = params.id as string;

  const [expense, setExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(() => getStoredBusinessId() ?? null);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !expenseId) return;
    (async () => {
      setLoading(true);
      try {
        const [expRes, catRes, budRes] = await Promise.all([
          getExpense(businessId, expenseId),
          fetchExpenseCategories(businessId),
          fetchExpenseBudgets(businessId),
        ]);
        if (expRes.data) setExpense(expRes.data);
        if (catRes.data) setCategories(catRes.data);
        if (budRes.data) setBudgets(budRes.data);
      } catch {
        toast.error("Failed to load expense");
      }
      setLoading(false);
    })();
  }, [businessId, expenseId]);

  const category = useMemo(() => categories.find((c) => c.id === expense?.categoryId), [categories, expense]);
  const budget = useMemo(() => budgets.find((b) => b.categoryId === expense?.categoryId), [budgets, expense]);
  const status = useMemo(() => (expense ? deriveStatus(expense) : { label: "", color: "", bg: "" }), [expense]);

  const handleApprove = async () => {
    if (!businessId || !expense) return;
    setActionLoading("approve");
    try {
      await updateExpense(businessId, expense.id, { status: "PAID", paidAt: new Date().toISOString() });
      toast.success("Expense approved");
      const res = await getExpense(businessId, expenseId);
      if (res.data) setExpense(res.data);
    } catch {
      toast.error("Failed to approve");
    }
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!businessId || !expense) return;
    setActionLoading("reject");
    try {
      await updateExpense(businessId, expense.id, { status: "VOID" });
      toast.success("Expense rejected");
      const res = await getExpense(businessId, expenseId);
      if (res.data) setExpense(res.data);
    } catch {
      toast.error("Failed to reject");
    }
    setActionLoading(null);
  };

  const handleDelete = async () => {
    if (!businessId || !expense) return;
    setActionLoading("delete");
    try {
      await deleteExpense(businessId, expense.id);
      toast.success("Expense deleted");
      router.push("/app/expenses");
    } catch {
      toast.error("Failed to delete");
    }
    setActionLoading(null);
    setConfirmDelete(false);
  };

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
  const percentUsed = budget ? Math.min(100, Math.round(budget.percentUsed)) : 0;
  const remainingAfter = budget ? Math.max(0, budget.remaining - expense.amount) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
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
              {formatCurrency(expense.amount)} · {category?.name || "Uncategorized"} · {expense.vendor || "—"} · {expense.paymentMethod || "—"}
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
                  {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
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
            <button
              onClick={() => {}}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-foreground border border-border hover:bg-muted transition-colors"
            >
              <Receipt className="w-4 h-4" />
              Match transaction
            </button>
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {[
            { label: "Amount", value: formatCurrency(expense.amount), sub: expense.currency || "USD" },
            { label: "Merchant", value: expense.vendor || "—", sub: expense.isRecurring ? "Recurring SaaS" : "One-time" },
            { label: "Date", value: formatDate(expense.date), sub: "Uploaded today" },
            { label: "Status", value: status.label, sub: expense.status === "BILL" ? "Policy check passed" : "Recorded" },
            { label: "Approval", value: isPending ? "Manager" : "Self", sub: isPending ? "Jane → Finance" : "Auto-approved" },
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
              {expense.receiptUrl && (
                <a
                  href={expense.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              )}
            </div>
            {expense.receiptUrl ? (
              expense.receiptUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={expense.receiptUrl}
                  alt="Receipt"
                  className="w-full max-h-96 object-contain rounded-lg border border-border/40"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 rounded-lg border border-dashed border-border bg-muted/30">
                  <FileText className="w-10 h-10 text-muted-foreground/40 mb-2" />
                  <a
                    href={expense.receiptUrl}
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
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Tax treatment</label>
                <div className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground">
                  {"Tax included"}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Policy</label>
                <div className="px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground">
                  Within policy
                </div>
              </div>
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
                {category?.name || "Uncategorized"} · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
              {budget ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly budget</span>
                    <span className="font-semibold text-foreground">{formatCurrency(budget.amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Spent so far</span>
                    <span className="font-semibold text-foreground">{formatCurrency(budget.spent)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">This expense</span>
                    <span className="font-semibold text-foreground">{formatCurrency(expense.amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining after</span>
                    <span className={cn("font-semibold", remainingAfter < 0 ? "text-rose-600" : "text-foreground")}>
                      {formatCurrency(remainingAfter)}
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

            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Approval & activity</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Upload className="w-3 h-3 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">Uploaded receipt</p>
                    <p className="text-[11px] text-muted-foreground">{expense.vendor || "User"}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Today</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle className="w-3 h-3 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">Rule suggested {category?.name || "category"}</p>
                    <p className="text-[11px] text-muted-foreground">System</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Today</span>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Clock className="w-3 h-3 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">Queued for review</p>
                    <p className="text-[11px] text-muted-foreground">Finance workflow</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Today</span>
                </div>
                {expense.status === "PAID" && (
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">Approved</p>
                      <p className="text-[11px] text-muted-foreground">Finance</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">Today</span>
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border/60">
                <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Add comment
                </button>
              </div>
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
            if (res.data) setExpense(res.data);
          }}
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
      />
    </div>
  );
}
