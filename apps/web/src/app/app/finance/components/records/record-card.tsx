"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  FileText, Receipt, DollarSign, Repeat, Clock, CheckCircle2, Send,
  Banknote, ArrowRightLeft, Ban, Trash2, Copy, Mail, RotateCcw,
  ChevronRight, User
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { getStatusStyle, RECORD_TYPE_META } from "@/lib/finance/constants";
import { getContactName } from "@/lib/finance/utils";
import type { FinancialRecord } from "@/lib/finance/types";

export type PipelineAction =
  | "send" | "accept" | "reject" | "convert" | "delete" | "duplicate"
  | "mark-paid" | "record-payment" | "void" | "remind" | "resend-receipt"
  | "copy-link" | "share-whatsapp";

interface RecordCardProps {
  record: FinancialRecord;
  onClick?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  onAction?: (record: FinancialRecord, action: PipelineAction) => void;
  actionLoading?: Record<string, boolean>;
  compact?: boolean;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  quote: FileText,
  invoice: Receipt,
  payment: DollarSign,
  recurring: Repeat,
};

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  variant = "default",
  disabled = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: "primary" | "danger" | "default";
  disabled?: boolean;
}) {
  const variantClasses = {
    primary: "text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10",
    danger: "text-red-400 hover:bg-red-400/10",
    default: "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]",
  };
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${variantClasses[variant]} disabled:opacity-40 shrink-0`}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function PaymentProgress({ record }: { record: FinancialRecord }) {
  if (record.type !== "invoice" || !record.payments || record.payments.length === 0) return null;
  const paid = record.payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const pct = Math.min(100, Math.round((paid / Math.max(record.total, 1)) * 100));
  const isFullyPaid = pct >= 100;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{isFullyPaid ? "Fully paid" : `${pct}% paid`}</span>
        <span className={isFullyPaid ? "text-emerald-400" : "text-amber-400"}>
          {formatCurrency(paid, record.currency)} / {formatCurrency(record.total, record.currency)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full rounded-full ${isFullyPaid ? "bg-emerald-500/60" : "bg-amber-500/60"}`}
        />
      </div>
    </div>
  );
}

export function RecordCard({ record, onClick, selected, onToggleSelect, onAction, actionLoading }: RecordCardProps) {
  const [showActions, setShowActions] = useState(false);
  const meta = RECORD_TYPE_META[record.type];
  const statusStyle = getStatusStyle(record.status);
  const Icon = TYPE_ICONS[record.type] ?? FileText;
  const contactName = getContactName(record.contact);

  const isOverdue = record.status === "OVERDUE";
  const isUrgent = isOverdue || record.status === "PARTIALLY_PAID";
  const isPaid = record.status === "PAID";
  const isDraft = record.status === "DRAFT";
  const isSent = record.status === "SENT";
  const isVoid = record.status === "VOID";
  const _isRejected = record.status === "REJECTED";

  const handleAction = (action: PipelineAction) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onAction?.(record, action);
  };

  const loadingKey = (action: string) => `${action}-${record.id}`;

  // Build contextual actions
  const actions: React.ReactNode[] = [];

  if (record.type === "quote") {
    if (isDraft) {
      actions.push(
        <ActionBtn key="send" icon={Send} label="Send" onClick={handleAction("send")} variant="primary" disabled={actionLoading?.[loadingKey("send-quote")]} />,
        <ActionBtn key="duplicate" icon={Copy} label="Duplicate" onClick={handleAction("duplicate")} variant="default" />,
      );
    }
    if (isSent) {
      actions.push(
        <ActionBtn key="accept" icon={CheckCircle2} label="Accept" onClick={handleAction("accept")} variant="primary" disabled={actionLoading?.[loadingKey("accept-quote")]} />,
        <ActionBtn key="reject" icon={Ban} label="Reject" onClick={handleAction("reject")} variant="danger" disabled={actionLoading?.[loadingKey("reject-quote")]} />,
      );
    }
    if (isSent && !record.convertedToInvoiceId) {
      actions.push(
        <ActionBtn key="convert" icon={ArrowRightLeft} label="Convert" onClick={handleAction("convert")} variant="primary" disabled={actionLoading?.[loadingKey("convert")]} />,
      );
    }
    if (!isPaid && !isVoid) {
      actions.push(
        <ActionBtn key="delete" icon={Trash2} label="Delete" onClick={handleAction("delete")} variant="danger" disabled={actionLoading?.[loadingKey("delete-quote")]} />,
      );
    }
  }

  if (record.type === "invoice") {
    if (isDraft) {
      actions.push(
        <ActionBtn key="send" icon={Send} label="Send" onClick={handleAction("send")} variant="primary" disabled={actionLoading?.[loadingKey("send-inv")]} />,
        <ActionBtn key="duplicate" icon={Copy} label="Duplicate" onClick={handleAction("duplicate")} variant="default" />,
      );
    }
    if (isSent || isOverdue) {
      actions.push(
        <ActionBtn key="paid" icon={CheckCircle2} label="Mark Paid" onClick={handleAction("mark-paid")} variant="primary" disabled={actionLoading?.[loadingKey("paid")]} />,
        <ActionBtn key="payment" icon={Banknote} label="Record" onClick={handleAction("record-payment")} variant="primary" disabled={actionLoading?.[loadingKey("payment")]} />,
      );
    }
    if (isSent || isOverdue) {
      actions.push(
        <ActionBtn key="remind" icon={Mail} label="Remind" onClick={handleAction("remind")} variant="default" disabled={actionLoading?.[loadingKey("remind")]} />,
      );
    }
    if (isPaid) {
      actions.push(
        <ActionBtn key="receipt" icon={RotateCcw} label="Receipt" onClick={handleAction("resend-receipt")} variant="default" disabled={actionLoading?.[loadingKey("receipt")]} />,
      );
    }
    if (!isVoid && !isPaid) {
      actions.push(
        <ActionBtn key="void" icon={Ban} label="Void" onClick={handleAction("void")} variant="danger" disabled={actionLoading?.[loadingKey("void")]} />,
      );
    }
    if (!isPaid && !isVoid) {
      actions.push(
        <ActionBtn key="delete" icon={Trash2} label="Delete" onClick={handleAction("delete")} variant="danger" disabled={actionLoading?.[loadingKey("delete-inv")]} />,
      );
    }
  }

  const hasActions = actions.length > 0 && onAction;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={`group relative rounded-2xl border transition-all cursor-pointer overflow-hidden ${
        selected
          ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/5"
          : isUrgent
          ? "border-red-500/20 bg-red-500/[0.02] hover:border-red-500/40"
          : "border-border/40 bg-card hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-white/[0.02]"
      }`}
    >
      {/* Urgency indicator */}
      {isUrgent && <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-red-500/60" />}

      <div className={`flex items-center gap-3 p-3.5 ${isUrgent ? "pl-4" : ""}`}>
        {/* Checkbox */}
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))] shrink-0"
          />
        )}

        {/* Type icon */}
        <div className={`w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-4 h-4 ${meta.color}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">{record.number}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {record.status}
            </span>
            {record.convertedToInvoiceId && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" />
                Converted
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 truncate">
              <User className="w-3 h-3" />
              {contactName}
            </span>
            {record.dueDate && (
              <>
                <span className="text-border">·</span>
                <span className={`flex items-center gap-1 ${isOverdue ? "text-red-400 font-medium" : ""}`}>
                  <Clock className="w-3 h-3" />
                  {isOverdue ? "Overdue" : `Due ${new Date(record.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                </span>
              </>
            )}
          </div>

          {/* Payment progress */}
          <PaymentProgress record={record} />
        </div>

        {/* Amount */}
        <div className="text-right shrink-0 self-start mt-0.5">
          <p className="text-sm font-bold text-foreground">{formatCurrency(record.total, record.currency)}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{record.type}</p>
        </div>

        {/* Chevron */}
        <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground/60 transition-colors self-center" />
      </div>

      {/* Action bar — shows on hover (desktop) or always (mobile) */}
      {hasActions && (
        <div className={`border-t border-border/30 bg-white/[0.02] flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto transition-all ${
          showActions ? "opacity-100 max-h-20" : "opacity-0 max-h-0 sm:group-hover:opacity-100 sm:group-hover:max-h-20"
        }`}>
          {actions}
        </div>
      )}
    </motion.div>
  );
}
