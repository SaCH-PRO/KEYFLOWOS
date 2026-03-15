"use client";

import { motion } from "framer-motion";
import { Pencil, X, Repeat, FileText, ExternalLink } from "lucide-react";
import { Expense, PAYMENT_METHODS } from "@/lib/client";
import { formatCurrency, formatDate } from "./expense-utils";

interface ExpenseDetailModalProps {
  expense: Expense;
  onClose: () => void;
  onEdit: (exp: Expense) => void;
}

export function ExpenseDetailModal({ expense, onClose, onEdit }: ExpenseDetailModalProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="expense-detail-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-lg bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.1))" }}>
          <h2 id="expense-detail-title" className="text-base font-semibold">Expense Details</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => { onEdit(expense); onClose(); }} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><Pencil className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-center"><p className="text-2xl font-bold text-red-400">{formatCurrency(expense.amount)}</p><p className="text-sm text-muted-foreground">{expense.description}</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Date</p><p className="text-sm">{formatDate(expense.date)}</p></div>
            <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Vendor</p><p className="text-sm">{expense.vendor || "---"}</p></div>
            <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Category</p><div className="flex items-center gap-1.5">{expense.category && <div className="w-2 h-2 rounded-full" style={{ background: expense.category.color || "#6366f1" }} />}<p className="text-sm">{expense.category?.name || "Uncategorized"}</p></div></div>
            <div className="bg-white/5 rounded-lg p-3"><p className="text-[10px] text-muted-foreground uppercase mb-0.5">Payment</p><p className="text-sm">{PAYMENT_METHODS.find(m => m.value === expense.paymentMethod)?.label || "---"}</p></div>
          </div>
          {expense.isRecurring && (
            <div className="flex items-center gap-2 bg-blue-500/10 rounded-lg px-3 py-2 text-xs text-blue-400"><Repeat className="w-3.5 h-3.5" /> Recurring {expense.recurringFrequency?.toLowerCase()}</div>
          )}
          {expense.tags && expense.tags.length > 0 && (
            <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Tags</p><div className="flex flex-wrap gap-1">{expense.tags.map(tag => <span key={tag} className="bg-white/10 text-xs px-2 py-0.5 rounded-full">{tag}</span>)}</div></div>
          )}
          {expense.notes && (
            <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Notes</p><p className="text-sm text-muted-foreground">{expense.notes}</p></div>
          )}
          {expense.receiptUrl && (
            <div><p className="text-[10px] text-muted-foreground uppercase mb-1">Receipt</p>
              {expense.receiptUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                <img src={expense.receiptUrl} alt="Receipt" className="w-full max-h-64 object-contain rounded-lg border border-border/40" />
              ) : (
                <a href={expense.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--kf-accent1))] hover:underline"><FileText className="w-4 h-4" /> View Receipt <ExternalLink className="w-3 h-3" /></a>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
