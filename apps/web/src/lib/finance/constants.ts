/**
 * Financial constants — status enums, pipeline stages, color mappings.
 */

export const FINANCIAL_STAGES = [
  { key: "draft", label: "Drafts", color: "#94a3b8" },
  { key: "sent", label: "Outbound", color: "#f59e0b" },
  { key: "viewed", label: "Viewed", color: "#06b6d4" },
  { key: "action_needed", label: "Action", color: "#ef4444" },
  { key: "accepted", label: "Accepted", color: "#8b5cf6" },
  { key: "paid", label: "Paid", color: "#10b981" },
  { key: "lost", label: "Lost", color: "#64748b" },
] as const;

export const RECORD_TYPE_META: Record<
  string,
  { label: string; singular: string; color: string; bg: string; icon: string }
> = {
  quote: {
    label: "Quotes",
    singular: "Quote",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    icon: "FileText",
  },
  invoice: {
    label: "Invoices",
    singular: "Invoice",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    icon: "Receipt",
  },
  payment: {
    label: "Payments",
    singular: "Payment",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    icon: "DollarSign",
  },
  recurring: {
    label: "Recurring",
    singular: "Schedule",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    icon: "Repeat",
  },
};

export const STATUS_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  DRAFT: { text: "text-slate-300", bg: "bg-slate-500/15", border: "border-slate-500/30" },
  SENT: { text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30" },
  VIEWED: { text: "text-cyan-300", bg: "bg-cyan-500/15", border: "border-cyan-500/30" },
  ACCEPTED: { text: "text-violet-300", bg: "bg-violet-500/15", border: "border-violet-500/30" },
  REJECTED: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-500/30" },
  EXPIRED: { text: "text-muted-foreground", bg: "bg-muted/20", border: "border-muted/30" },
  PAID: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  OVERDUE: { text: "text-red-300", bg: "bg-red-500/15", border: "border-red-500/30" },
  VOID: { text: "text-muted-foreground", bg: "bg-muted/20", border: "border-muted/30" },
  PARTIALLY_PAID: { text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30" },
  ACTIVE: { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  PENDING: { text: "text-amber-300", bg: "bg-amber-500/15", border: "border-amber-500/30" },
};

export const DEFAULT_STATUS_STYLE = { text: "text-muted-foreground", bg: "bg-muted/20", border: "border-muted/30" };

export function getStatusStyle(status: string) {
  return STATUS_COLORS[status] ?? DEFAULT_STATUS_STYLE;
}
