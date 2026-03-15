"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pencil, Trash2, ArrowUpDown, Repeat, FileText, Lightbulb,
} from "lucide-react";
import { Expense, ExpenseCategory, PAYMENT_METHODS } from "@/lib/client";
import { formatCurrency, formatDate } from "./expense-utils";

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
}

export function ExpenseList({
  expenses, totalExpenses, categories,
  filterCategory, setFilterCategory, filterPayment, setFilterPayment,
  page, setPage, pageSize, setPageSize,
  onEdit, onDelete, onViewDetail,
}: ExpenseListProps) {
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  return (
    <div className="kf-card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border/40 flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-sm font-semibold">All Expenses <span className="text-muted-foreground font-normal">({totalExpenses})</span></h3>
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

      {filteredExpenses.length === 0 ? (
        expenses.length === 0 ? (
          <div className="py-12 text-center">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
              style={{ background: "hsl(var(--kf-error) / 0.1)" }}
            >
              <FileText className="w-7 h-7" style={{ color: "hsl(var(--kf-error) / 0.6)" }} />
            </div>
            <h3 className="text-lg font-semibold mb-1">No expenses recorded</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
              Track your business expenses to understand spending patterns and maximize deductions.
            </p>
            <div
              className="mx-auto max-w-xs flex items-start gap-2 text-left px-4 py-3 kf-radius-md"
              style={{
                background: "hsl(var(--kf-warning) / 0.06)",
                border: "1px solid hsl(var(--kf-warning) / 0.12)",
              }}
            >
              <Lightbulb
                className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                style={{ color: "hsl(var(--kf-warning))" }}
              />
              <p className="kf-text-caption text-muted-foreground">
                Categorize expenses to see spending breakdowns in your Analytics tab.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses match the selected filters.</div>
        )
      ) : (
        <div className="divide-y divide-border/30" role="table" aria-label="Expenses list">
          <div className="hidden md:grid grid-cols-[0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-3 px-4 py-2 text-xs text-muted-foreground uppercase tracking-wider" role="row">
            <span role="columnheader">Date</span><span role="columnheader">Description</span><span role="columnheader">Vendor</span><span role="columnheader">Category</span><span role="columnheader">Method</span><span role="columnheader" className="text-right">Amount</span><span className="w-20" />
          </div>
          <AnimatePresence>
            {filteredExpenses.map(exp => {
              const cat = categories.find(c => c.id === exp.categoryId) || exp.category;
              const pmLabel = PAYMENT_METHODS.find(m => m.value === exp.paymentMethod)?.label;
              return (
                <motion.div key={exp.id} role="row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="grid grid-cols-1 md:grid-cols-[0.8fr_2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-1 md:gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group items-center cursor-pointer" onClick={() => onViewDetail(exp)}>
                  <span className="text-xs text-muted-foreground">{formatDate(exp.date)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{exp.description}</span>
                    {exp.isRecurring && <Repeat className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                    {exp.receiptUrl && <FileText className="w-3 h-3 text-green-400 flex-shrink-0" />}
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{exp.vendor || "---"}</span>
                  <span className="flex items-center gap-1.5 text-xs">{cat && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color || "#6366f1" }} />}{cat?.name || "---"}</span>
                  <span className="text-xs text-muted-foreground">{pmLabel || "---"}</span>
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
    </div>
  );
}
