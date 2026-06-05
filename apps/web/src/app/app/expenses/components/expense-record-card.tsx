"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Receipt,
  FileText,
  Pencil,
  Trash2,
  CheckCircle2,
  Repeat,
  Paperclip,
  Clock,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { Expense, ExpenseCategory } from "@/lib/client";
import { PAYMENT_METHODS } from "@/lib/client";

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  card: CreditCard,
  cash: Banknote,
  bank_transfer: Banknote,
  mobile_money: Smartphone,
  cheque: FileText,
  other: Wallet,
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PAID: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", label: "Paid" },
  BILL: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", label: "Bill" },
  VOID: { bg: "bg-muted/20", text: "text-muted-foreground", border: "border-muted/30", label: "Void" },
};

interface ExpenseRecordCardProps {
  expense: Expense;
  categories: ExpenseCategory[];
  selected?: boolean;
  onToggleSelect?: () => void;
  onEdit?: (exp: Expense) => void;
  onDelete?: (exp: Expense) => void;
  onMarkPaid?: (exp: Expense) => void;
  onViewDetail?: (exp: Expense) => void;
}

export function ExpenseRecordCard({
  expense,
  categories,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onMarkPaid,
  onViewDetail,
}: ExpenseRecordCardProps) {
  const [showActions, setShowActions] = useState(false);
  const cat = categories.find((c) => c.id === expense.categoryId) || expense.category;
  const pm = PAYMENT_METHODS.find((m) => m.value === expense.paymentMethod);
  const PayIcon = (pm?.value && PAYMENT_ICONS[pm.value]) || Wallet;
  const statusStyle = STATUS_STYLES[expense.status || "PAID"] || STATUS_STYLES.PAID;

  const isBill = expense.status === "BILL";
  const isOverdue = isBill && expense.dueDate && new Date(expense.dueDate) < new Date();
  const isUrgent = isOverdue;
  const hasReceipt = !!expense.receiptUrl;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={() => onViewDetail?.(expense)}
      className={`group relative rounded-2xl border transition-all cursor-pointer overflow-hidden ${
        selected
          ? "border-rose-500/40 bg-rose-500/5"
          : isUrgent
          ? "border-red-500/20 bg-red-500/[0.02] hover:border-red-500/40"
          : "border-border/40 bg-card hover:border-rose-500/30 hover:bg-white/[0.02]"
      }`}
    >
      {/* Urgency indicator */}
      {isUrgent && <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-red-500/60" />}

      <div className={`flex items-center gap-3 p-3.5 ${isUrgent ? "pl-4" : ""}`}>
        {/* Checkbox */}
        {onToggleSelect && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className={`w-4 h-4 rounded border shrink-0 transition-colors ${
              selected
                ? "bg-rose-500 border-rose-500"
                : "border-border/50 hover:border-rose-500/50"
            }`}
          >
            {selected && (
              <svg className="w-3 h-3 text-white mx-auto mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )}

        {/* Type icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isBill ? "bg-amber-500/10" : "bg-rose-500/10"}`}>
          {isBill ? <FileText className="w-4 h-4 text-amber-400" /> : <Receipt className="w-4 h-4 text-rose-400" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{expense.description}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {statusStyle.label}
            </span>
            {expense.isRecurring && (
              <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                <Repeat className="w-3 h-3" />
                Recurring
              </span>
            )}
            {hasReceipt && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                <Paperclip className="w-3 h-3" />
                Receipt
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{new Date(expense.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            {expense.vendor && (
              <>
                <span className="text-border">·</span>
                <span className="truncate">{expense.vendor}</span>
              </>
            )}
            {cat && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: cat.color || "#6366f1" }} />
                  {cat.name}
                </span>
              </>
            )}
            {pm && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <PayIcon className="w-3 h-3" />
                  {pm.label}
                </span>
              </>
            )}
            {isOverdue && expense.dueDate && (
              <>
                <span className="text-border">·</span>
                <span className="text-red-400 font-medium flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  Overdue
                </span>
              </>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="text-right shrink-0 self-start mt-0.5">
          <p className="text-sm font-bold text-foreground">{formatCurrency(expense.amount, expense.currency)}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{isBill ? "bill" : "expense"}</p>
        </div>
      </div>

      {/* Action bar */}
      <div
        className={`border-t border-border/30 bg-white/[0.02] flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto transition-all ${
          showActions ? "opacity-100 max-h-20" : "opacity-0 max-h-0 sm:group-hover:opacity-100 sm:group-hover:max-h-20"
        }`}
      >
        {onEdit && (
          <ActionBtn icon={Pencil} label="Edit" onClick={(e) => { e.stopPropagation(); onEdit(expense); }} />
        )}
        {isBill && onMarkPaid && (
          <ActionBtn icon={CheckCircle2} label="Mark Paid" variant="primary" onClick={(e) => { e.stopPropagation(); onMarkPaid(expense); }} />
        )}
        {onDelete && (
          <ActionBtn icon={Trash2} label="Delete" variant="danger" onClick={(e) => { e.stopPropagation(); onDelete(expense); }} />
        )}
      </div>
    </motion.div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  variant = "default",
}: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: "primary" | "danger" | "default";
}) {
  const variantClasses = {
    primary: "text-rose-400 hover:bg-rose-400/10",
    danger: "text-red-400 hover:bg-red-400/10",
    default: "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${variantClasses[variant]} shrink-0`}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
