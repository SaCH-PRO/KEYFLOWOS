"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle,
  Send,
  Eye,
  DollarSign,
  Bell,
  Receipt,
  Ban,
  AlertTriangle,
  RefreshCw,
  FileText,
} from "lucide-react";
import { getInvoiceTimeline, type InvoiceTimelineEntry } from "@/lib/client";

interface Props {
  businessId: string;
  invoiceId: string;
  accentColor?: string;
  // bumped externally (e.g. after a "Resend receipt") to force a refetch
  refreshKey?: number | string;
}

const ICONS: Record<string, { icon: typeof Activity; tone: string }> = {
  "invoice.created": { icon: FileText, tone: "text-slate-400" },
  "invoice.sent": { icon: Send, tone: "text-blue-400" },
  "invoice.viewed": { icon: Eye, tone: "text-violet-400" },
  "invoice.payment_recorded": { icon: DollarSign, tone: "text-amber-400" },
  "invoice.paid": { icon: CheckCircle, tone: "text-emerald-400" },
  "invoice.refund": { icon: RefreshCw, tone: "text-orange-400" },
  "invoice.payment_failed": { icon: AlertTriangle, tone: "text-red-400" },
  "invoice.payment_reminder_sent": { icon: Bell, tone: "text-amber-400" },
  "invoice.receipt_sent": { icon: Receipt, tone: "text-emerald-400" },
  "invoice.overdue": { icon: AlertTriangle, tone: "text-red-400" },
  "invoice.void": { icon: Ban, tone: "text-slate-400" },
};

function formatRelative(at: string) {
  const d = new Date(at);
  return d.toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" });
}

export function InvoiceTimeline({ businessId, invoiceId, accentColor = "#F97316", refreshKey }: Props) {
  const [entries, setEntries] = useState<InvoiceTimelineEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getInvoiceTimeline(businessId, invoiceId);
      if (cancelled) return;
      setEntries(res.data?.entries ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, invoiceId, refreshKey]);

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <Activity className="w-4 h-4" style={{ color: accentColor, opacity: 0.85 }} />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Activity Timeline
        </h4>
      </div>
      <div className="px-4 py-3">
        {loading && !entries && (
          <p className="text-xs text-muted-foreground">Loading activity…</p>
        )}
        {entries && entries.length === 0 && (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        )}
        {entries && entries.length > 0 && (
          <ol className="relative space-y-3 pl-4 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-border/40">
            {entries
              .slice()
              .reverse()
              .map((e) => {
                const meta = ICONS[e.type] ?? { icon: Activity, tone: "text-slate-400" };
                const Icon = meta.icon;
                return (
                  <li key={e.id} className="relative">
                    <span
                      className={`absolute -left-4 top-0.5 w-3.5 h-3.5 rounded-full bg-card border border-border/60 flex items-center justify-center ${meta.tone}`}
                    >
                      <Icon className="w-2.5 h-2.5" />
                    </span>
                    <p className="text-xs font-medium text-foreground/90">{e.label}</p>
                    <p className="text-[10px] text-muted-foreground/70">{formatRelative(e.at)}</p>
                  </li>
                );
              })}
          </ol>
        )}
      </div>
    </div>
  );
}
