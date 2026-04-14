"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pencil, Trash2, ArrowUpDown, Repeat, FileText, Receipt,
  CreditCard, Banknote, Smartphone, CheckCircle, AlertCircle,
  Tag, CheckSquare, Square, Layers, FolderKanban, Users, Briefcase,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoBadge } from "@/components/ui/info-badge";
import { Expense, ExpenseCategory, PAYMENT_METHODS, updateExpense, RecurringCandidate } from "@/lib/client";
import { formatCurrency, formatDate } from "./expense-utils";
import { toast } from "sonner";
import type { ProjectOption, ContactOption, ServiceOption } from "./use-expenses-data";

interface ExpenseListProps {
  expenses: Expense[];
  totalExpenses: number;
  categories: ExpenseCategory[];
  filterCategory: string;
  setFilterCategory: (v: string) => void;
  filterPayment: string;
  setFilterPayment: (v: string) => void;
  page: number;
  setPage: (v: number | ((p: number) => number)) => void;
  pageSize: number;
  setPageSize: (v: number) => void;
  onEdit: (exp: Expense) => void;
  onDelete: (expenseId: string) => void;
  onViewDetail: (exp: Expense) => void;
  onAdd?: () => void;
  businessId?: string | null;
  onReload?: () => void;
  projects?: ProjectOption[];
  contacts?: ContactOption[];
  services?: ServiceOption[];
  recurringCandidates?: RecurringCandidate[];
}

const PAYMENT_ICONS: Record<string, typeof CreditCard> = {
  card: CreditCard,
  cash: Banknote,
  bank_transfer: Banknote,
  mobile_money: Smartphone,
  cheque: FileText,
};

const RECURRING_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export function ExpenseList({
  expenses, totalExpenses, categories,
  filterCategory, setFilterCategory, filterPayment, setFilterPayment,
  page, setPage, pageSize, setPageSize,
  onEdit, onDelete, onViewDetail, onAdd,
  businessId, onReload,
  projects = [], contacts = [], services = [],
  recurringCandidates = [],
}: ExpenseListProps) {
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [inlineCatExpId, setInlineCatExpId] = useState<string | null>(null);
  const [showRecurring, setShowRecurring] = useState(false);

  const filteredExpenses = useMemo(() =>
    [...expenses].sort((a, b) => {
      if (sortField === "date") {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      return sortDir === "asc" ? a.amount - b.amount : b.amount - a.amount;
    }), [expenses, sortField, sortDir]);

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const totalPages = Math.max(1, Math.ceil(totalExpenses / pageSize));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredExpenses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredExpenses.map(e => e.id)));
    }
  };

  const handleBulkCategorize = async () => {
    if (!businessId || !bulkCategoryId || selectedIds.size === 0) return;
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          updateExpense(businessId, id, { categoryId: bulkCategoryId })
        )
      );
      toast.success(`${selectedIds.size} expense${selectedIds.size > 1 ? "s" : ""} categorized`);
      setSelectedIds(new Set());
      setBulkCategoryId("");
      onReload?.();
    } catch {
      toast.error("Failed to bulk categorize");
    }
  };

  const handleInlineCategory = async (expenseId: string, categoryId: string) => {
    if (!businessId) return;
    try {
      await updateExpense(businessId, expenseId, { categoryId: categoryId || null });
      toast.success("Category updated");
      setInlineCatExpId(null);
      onReload?.();
    } catch {
      toast.error("Failed to update category");
    }
  };

  const uncategorizedInView = filteredExpenses.filter(e => !e.categoryId).length;

  return (
    <div className="kf-card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border/40 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">All Expenses <span className="text-muted-foreground font-normal">({totalExpenses})</span> <InfoBadge title="Expense Tracking" body="Track all business expenses by category and payment method. Use filters to drill into specific types. Recurring expenses are marked with a repeat icon." side="right" iconSize={11} /></h3>
          {uncategorizedInView > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "hsl(var(--kf-warning) / 0.12)", color: "hsl(var(--kf-warning))" }}>
              {uncategorizedInView} uncategorized
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="appearance-none bg-white/5 border border-white/10 rounded-lg pl-7 pr-8 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
            <option value="">All Methods</option>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={() => toggleSort("date")} className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${sortField === "date" ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]" : "border-white/10 text-muted-foreground hover:text-white"}`}>Date <ArrowUpDown className="w-3 h-3" /></button>
          <button onClick={() => toggleSort("amount")} className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${sortField === "amount" ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]" : "border-white/10 text-muted-foreground hover:text-white"}`}>Amount <ArrowUpDown className="w-3 h-3" /></button>
        </div>
      </div>

      {selectedIds.size > 0 && businessId && (
        <div className="px-4 py-2.5 border-b border-border/40 flex items-center gap-3" style={{ background: "hsl(var(--kf-accent1) / 0.06)" }}>
          <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>{selectedIds.size} selected</span>
          <select
            value={bulkCategoryId}
            onChange={e => setBulkCategoryId(e.target.value)}
            className="bg-transparent border border-border/60 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
          >
            <option value="">Assign category...</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            onClick={handleBulkCategorize}
            disabled={!bulkCategoryId}
            className="kf-btn-primary px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40 flex items-center gap-1"
          >
            <Layers className="w-3 h-3" /> Apply
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-white ml-auto">Clear</button>
        </div>
      )}

      {filteredExpenses.length === 0 ? (
        expenses.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No expenses recorded"
            description="Track your business expenses to understand spending patterns and maximize deductions."
            actionLabel={onAdd ? "Add Expense" : undefined}
            onAction={onAdd}
            tip="Categorize expenses and set budgets to unlock spending intelligence in the Insights tab."
          />
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses match the selected filters.</div>
        )
      ) : (
        <div className="divide-y divide-border/30" role="table" aria-label="Expenses list">
          <div className="hidden md:grid grid-cols-[auto_0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider" role="row">
            <span className="w-6 flex items-center">
              <button onClick={toggleAll} className="text-muted-foreground hover:text-white transition-colors">
                {selectedIds.size === filteredExpenses.length && filteredExpenses.length > 0
                  ? <CheckSquare className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  : <Square className="w-3.5 h-3.5" />
                }
              </button>
            </span>
            <span role="columnheader">Date</span><span role="columnheader">Description</span><span role="columnheader">Vendor</span><span role="columnheader">Category</span><span role="columnheader">Method</span><span role="columnheader" className="text-right">Amount</span><span className="w-20" />
          </div>
          <AnimatePresence>
            {filteredExpenses.map(exp => {
              const cat = categories.find(c => c.id === exp.categoryId) || exp.category;
              const pmLabel = PAYMENT_METHODS.find(m => m.value === exp.paymentMethod)?.label;
              const PayIcon = PAYMENT_ICONS[exp.paymentMethod || ""] || CreditCard;
              const hasReceipt = !!exp.receiptUrl;
              const hasTags = exp.tags && exp.tags.length > 0;
              const isSelected = selectedIds.has(exp.id);
              const showInlineCat = inlineCatExpId === exp.id;
              return (
                <motion.div key={exp.id} role="row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className={`grid grid-cols-1 md:grid-cols-[auto_0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-1 md:gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors group items-center cursor-pointer ${isSelected ? "bg-white/[0.03]" : ""}`} onClick={() => onViewDetail(exp)}>
                  <span className="w-6 flex items-center">
                    <button onClick={e => { e.stopPropagation(); toggleSelect(exp.id); }} className="text-muted-foreground hover:text-white transition-colors">
                      {isSelected
                        ? <CheckSquare className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                        : <Square className="w-3.5 h-3.5" />
                      }
                    </button>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDate(exp.date)}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{exp.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {exp.isRecurring && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400" title={`Recurring: ${RECURRING_LABELS[exp.recurringFrequency || "MONTHLY"] || "Monthly"}`}>
                          <Repeat className="w-2.5 h-2.5" />
                          {RECURRING_LABELS[exp.recurringFrequency || "MONTHLY"]?.[0] || "M"}
                        </span>
                      )}
                      {hasReceipt ? (
                        <span className="inline-flex items-center text-[10px] px-1 py-0.5 rounded-full bg-green-500/10 text-green-400" title="Receipt attached">
                          <CheckCircle className="w-2.5 h-2.5" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] px-1 py-0.5 rounded-full bg-amber-500/10 text-amber-400 opacity-50 group-hover:opacity-100" title="No receipt">
                          <AlertCircle className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {hasTags && (
                        <span className="inline-flex items-center text-[10px] px-1 py-0.5 rounded-full bg-white/5 text-muted-foreground" title={exp.tags!.join(", ")}>
                          <Tag className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {exp.projectId && (() => {
                        const proj = projects.find(p => p.id === exp.projectId);
                        return proj ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400" title={`Project: ${proj.name}`}>
                            <FolderKanban className="w-2.5 h-2.5" />
                          </span>
                        ) : null;
                      })()}
                      {exp.contactId && (() => {
                        const ct = contacts.find(c => c.id === exp.contactId);
                        return ct ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400" title={`Client: ${ct.name}`}>
                            <Users className="w-2.5 h-2.5" />
                          </span>
                        ) : null;
                      })()}
                      {exp.serviceId && (() => {
                        const svc = services.find(s => s.id === exp.serviceId);
                        return svc ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400" title={`Service: ${svc.name}`}>
                            <Briefcase className="w-2.5 h-2.5" />
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{exp.vendor || <span className="opacity-40">---</span>}</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    {showInlineCat ? (
                      <select
                        autoFocus
                        value={exp.categoryId || ""}
                        onClick={e => e.stopPropagation()}
                        onChange={e => { e.stopPropagation(); handleInlineCategory(exp.id, e.target.value); }}
                        onBlur={() => setInlineCatExpId(null)}
                        className="bg-card border border-border/60 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))] w-full"
                      >
                        <option value="">None</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : cat ? (
                      <button
                        onClick={e => { e.stopPropagation(); setInlineCatExpId(exp.id); }}
                        className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                        title="Click to change category"
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color || "#6366f1" }} />
                        <span className="truncate">{cat.name}</span>
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setInlineCatExpId(exp.id); }}
                        className="text-amber-400/60 text-[10px] hover:text-amber-300 transition-colors"
                        title="Click to assign category"
                      >
                        Uncategorized
                      </button>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {exp.paymentMethod && <PayIcon className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{pmLabel || <span className="opacity-40">---</span>}</span>
                  </span>
                  <span className="text-sm font-semibold text-right text-red-400">{formatCurrency(exp.amount)}</span>
                  <div className="flex items-center gap-1 w-20 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); onEdit(exp); }} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); onDelete(exp.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {totalExpenses > 0 && (
        <div className="p-4 border-t border-border/40 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows per page:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          </div>
        </div>
      )}

      {recurringCandidates.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowRecurring(prev => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Repeat className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-sm font-semibold">Recurring Expense Detection</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "hsl(var(--kf-accent2) / 0.12)", color: "hsl(var(--kf-accent2))" }}>
                {recurringCandidates.length} pattern{recurringCandidates.length !== 1 ? "s" : ""} found
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{showRecurring ? "Hide" : "Show"}</span>
          </button>
          <AnimatePresence>
            {showRecurring && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-[11px] text-muted-foreground mb-3">
                    These expenses follow a recurring pattern based on vendor, amount, and timing. Review to confirm and manage recurring commitments.
                  </p>
                  {recurringCandidates.map((rc) => {
                    const freqLabel = RECURRING_LABELS[rc.frequency] || rc.frequency;
                    return (
                      <div key={`${rc.vendor}-${rc.amount}`} className="bg-white/[0.03] rounded-lg p-3 flex items-center gap-3 hover:bg-white/[0.05] transition-colors">
                        <div className="p-2 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
                          <Repeat className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold truncate">{rc.vendor}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-500/10 text-blue-400">{freqLabel}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{rc.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-semibold text-red-400 block">{formatCurrency(rc.amount)}</span>
                          <span className="text-[10px] text-muted-foreground">{rc.occurrences} occurrence{rc.occurrences !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-muted-foreground block">~{Math.round(rc.avgDaysBetween)}d apart</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
