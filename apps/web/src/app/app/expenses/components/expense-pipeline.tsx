"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ExpenseRecordCard } from "./expense-record-card";
import { ExpenseMetricsRow } from "./expense-metrics-row";
import { ExpenseStageBar, type ExpenseView } from "./expense-stage-bar";
import { ExpenseFilters } from "./expense-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText } from "lucide-react";
import type { Expense, ExpenseCategory, ExpenseSummary } from "@/lib/client";
import { deleteExpense, updateExpense } from "@/lib/client";
import type { ProjectOption, ContactOption, ServiceOption } from "./use-expenses-data";

interface ExpensePipelineProps {
  businessId: string | null;
  expenses: Expense[];
  totalExpenses: number;
  categories: ExpenseCategory[];
  summary: ExpenseSummary | null;
  period: string;
  setPeriod: (v: string) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  filterCategory: string;
  setFilterCategory: (v: string) => void;
  filterPayment: string;
  setFilterPayment: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  page: number;
  setPage: (v: number | ((p: number) => number)) => void;
  pageSize: number;
  setPageSize: (v: number) => void;
  onReload: () => void;
  onEdit: (exp: Expense) => void;
  onAdd?: () => void;
  projects?: ProjectOption[];
  contacts?: ContactOption[];
  services?: ServiceOption[];
  loading?: boolean;
}

export function ExpensePipeline({
  businessId,
  expenses,
  totalExpenses,
  categories,
  summary,
  period,
  setPeriod,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  searchQuery,
  setSearchQuery,
  setFilterStatus,
  page,
  setPage,
  pageSize,
  onReload,
  onEdit,
  onAdd,
}: ExpensePipelineProps) {
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [_actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Sync view with URL ?view= query param
  const _paramView = searchParams.get("view") as ExpenseView | null;
  const validViews: ExpenseView[] = ["all", "expenses", "bills", "receipts"];
  const [view, setViewState] = useState<ExpenseView>(() => {
    const param = new URLSearchParams(window.location.search).get("view") as ExpenseView | null;
    return validViews.includes(param as ExpenseView) ? (param as ExpenseView) : "all";
  });

  const setView = useCallback(
    (v: ExpenseView) => {
      setViewState(v);
      // Map view to status filter for API
      if (v === "expenses") setFilterStatus("PAID");
      else if (v === "bills") setFilterStatus("BILL");
      else setFilterStatus("");
      // Update URL
      const url = new URL(window.location.href);
      if (v === "all") url.searchParams.delete("view");
      else url.searchParams.set("view", v);
      window.history.replaceState({}, "", url);
    },
    [setFilterStatus]
  );

  // Client-side filter for "receipts" view
  const filteredExpenses = useMemo(() => {
    if (view === "receipts") return expenses.filter((e) => !!e.receiptUrl);
    return expenses;
  }, [expenses, view]);

  const counts = useMemo(() => {
    const all = expenses.length;
    const paid = expenses.filter((e) => e.status === "PAID").length;
    const bills = expenses.filter((e) => e.status === "BILL").length;
    const receipts = expenses.filter((e) => !!e.receiptUrl).length;
    return { all, expenses: paid, bills, receipts };
  }, [expenses]);

  const totalPages = Math.max(1, Math.ceil(totalExpenses / pageSize));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const _toggleAll = () => {
    if (selectedIds.size === filteredExpenses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredExpenses.map((e) => e.id)));
    }
  };

  const handleMarkPaid = async (expense: Expense) => {
    if (!businessId) return;
    setActionLoading((prev) => ({ ...prev, [`paid-${expense.id}`]: true }));
    try {
      await updateExpense(businessId, expense.id, { status: "PAID", paidAt: new Date().toISOString() });
      toast.success("Bill marked as paid");
      onReload();
    } catch {
      toast.error("Failed to mark as paid");
    }
    setActionLoading((prev) => ({ ...prev, [`paid-${expense.id}`]: false }));
  };

  const handleDelete = async (expense: Expense) => {
    if (!businessId) return;
    if (!window.confirm("Delete this expense?")) return;
    setActionLoading((prev) => ({ ...prev, [`delete-${expense.id}`]: true }));
    try {
      await deleteExpense(businessId, expense.id);
      toast.success("Expense deleted");
      onReload();
    } catch {
      toast.error("Failed to delete");
    }
    setActionLoading((prev) => ({ ...prev, [`delete-${expense.id}`]: false }));
  };

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <ExpenseMetricsRow expenses={expenses} summary={summary} />
        <ExpenseStageBar activeView={view} onChange={setView} counts={counts} />
      </div>

      {/* Filters */}
      <ExpenseFilters
        period={period}
        setPeriod={setPeriod}
        customStart={customStart}
        setCustomStart={setCustomStart}
        customEnd={customEnd}
        setCustomEnd={setCustomEnd}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Bulk actions */}
      {hasSelection && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-rose-500/5 border border-rose-500/20">
          <span className="text-xs font-medium text-rose-400">{selectedIds.size} selected</span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* Card list */}
      {filteredExpenses.length === 0 ? (
        expenses.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No expenses found"
            description="Record your business expenses to track spending and manage bills."
            actionLabel={onAdd ? "Add Expense" : undefined}
            onAction={onAdd}
          />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses match the selected filters.</div>
        )
      ) : (
        <div className="space-y-2">
          {filteredExpenses.map((exp) => (
            <ExpenseRecordCard
              key={exp.id}
              expense={exp}
              categories={categories}
              selected={selectedIds.has(exp.id)}
              onToggleSelect={() => toggleSelect(exp.id)}
              onEdit={onEdit}
              onDelete={handleDelete}
              onMarkPaid={handleMarkPaid}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-xs border border-border/40 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-xs border border-border/40 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
