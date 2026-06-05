"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  FileText,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  Send,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { Invoice, Quote, Expense } from "@/lib/client";

type ActivityType = "all" | "in" | "out" | "pending";

interface ActivityItem {
  id: string;
  type: "invoice" | "quote" | "payment" | "expense" | "overdue";
  direction: "in" | "out" | "pending";
  title: string;
  subtitle?: string;
  amount: number;
  currency: string;
  date: string;
  href: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}

interface MoneyActivityFeedProps {
  invoices: Invoice[];
  quotes: Quote[];
  expenses: Expense[];
  currency?: string;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FILTERS: { key: ActivityType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "Money In" },
  { key: "out", label: "Money Out" },
  { key: "pending", label: "Pending" },
];

export function MoneyActivityFeed({
  invoices,
  quotes,
  expenses,
  currency = "TTD",
}: MoneyActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityType>("all");

  const items = useMemo<ActivityItem[]>(() => {
    const all: ActivityItem[] = [];

    // Invoices
    invoices.forEach((inv) => {
      const contactName = inv.contact
        ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim()
        : "Unknown";

      if (inv.status === "PAID" && inv.paidAt) {
        all.push({
          id: `inv-paid-${inv.id}`,
          type: "payment",
          direction: "in",
          title: `Payment received`,
          subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contactName}`,
          amount: Number(inv.total) ?? 0,
          currency: inv.currency ?? currency,
          date: inv.paidAt,
          href: `/app/commerce?tab=pipeline&invoice=${inv.id}`,
          icon: DollarSign,
          iconColor: "text-emerald-500",
          iconBg: "bg-emerald-500/10",
        });
      } else if (inv.status === "OVERDUE") {
        all.push({
          id: `inv-overdue-${inv.id}`,
          type: "overdue",
          direction: "pending",
          title: `Invoice overdue`,
          subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contactName}`,
          amount: Number(inv.total) ?? 0,
          currency: inv.currency ?? currency,
          date: inv.dueDate ?? inv.issueDate ?? new Date().toISOString(),
          href: `/app/commerce?tab=pipeline&invoice=${inv.id}`,
          icon: AlertTriangle,
          iconColor: "text-amber-500",
          iconBg: "bg-amber-500/10",
        });
      } else if (inv.status === "SENT") {
        all.push({
          id: `inv-sent-${inv.id}`,
          type: "invoice",
          direction: "pending",
          title: `Invoice sent`,
          subtitle: `Invoice #${inv.invoiceNumber ?? inv.id.slice(0, 6)} — ${contactName}`,
          amount: Number(inv.total) ?? 0,
          currency: inv.currency ?? currency,
          date: inv.issueDate ?? new Date().toISOString(),
          href: `/app/commerce?tab=pipeline&invoice=${inv.id}`,
          icon: Send,
          iconColor: "text-blue-500",
          iconBg: "bg-blue-500/10",
        });
      }
    });

    // Quotes
    quotes.forEach((q) => {
      const contactName = q.contact
        ? `${q.contact.firstName ?? ""} ${q.contact.lastName ?? ""}`.trim()
        : "Unknown";

      if (q.status === "ACCEPTED") {
        all.push({
          id: `quote-acc-${q.id}`,
          type: "quote",
          direction: "in",
          title: `Quote accepted`,
          subtitle: `Quote #${q.quoteNumber} — ${contactName}`,
          amount: q.total,
          currency: q.currency,
          date: q.createdAt,
          href: `/app/commerce?tab=pipeline&quote=${q.id}`,
          icon: CheckCircle2,
          iconColor: "text-emerald-500",
          iconBg: "bg-emerald-500/10",
        });
      } else if (q.status === "SENT") {
        all.push({
          id: `quote-sent-${q.id}`,
          type: "quote",
          direction: "pending",
          title: `Quote sent`,
          subtitle: `Quote #${q.quoteNumber} — ${contactName}`,
          amount: q.total,
          currency: q.currency,
          date: q.sentAt ?? q.createdAt,
          href: `/app/commerce?tab=pipeline&quote=${q.id}`,
          icon: FileText,
          iconColor: "text-blue-500",
          iconBg: "bg-blue-500/10",
        });
      }
    });

    // Expenses
    expenses.forEach((ex) => {
      all.push({
        id: `exp-${ex.id}`,
        type: "expense",
        direction: "out",
        title: ex.description || "Expense",
        subtitle: ex.vendor ? `Paid to ${ex.vendor}` : undefined,
        amount: ex.amount,
        currency: ex.currency ?? currency,
        date: ex.date,
        href: "/app/expenses",
        icon: TrendingDown,
        iconColor: "text-rose-500",
        iconBg: "bg-rose-500/10",
      });
    });

    // Sort by date desc
    return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, quotes, expenses, currency]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.direction === filter);
  }, [items, filter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-2xl border border-border/60 bg-card"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recent Activity
        </p>
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                filter === f.key
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border/30">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No activity in this period
          </div>
        ) : (
          filtered.slice(0, 10).map((item, idx) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors group"
              >
                <div className={`w-8 h-8 rounded-lg ${item.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${item.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-xs font-semibold ${item.direction === "in" ? "text-emerald-500" : item.direction === "out" ? "text-rose-500" : "text-foreground"}`}>
                    {item.direction === "in" ? "+" : item.direction === "out" ? "−" : ""}
                    {formatCurrency(item.amount, item.currency)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(item.date)}</p>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {filtered.length > 10 && (
        <div className="px-4 py-2 border-t border-border/40 text-center">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length - 10} more items
          </span>
        </div>
      )}
    </motion.div>
  );
}
