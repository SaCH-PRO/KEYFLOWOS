"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/currency";
import { normalizeInvoice, normalizeQuote, getPipelineStage } from "@/lib/finance/utils";
import { getStatusStyle, RECORD_TYPE_META } from "@/lib/finance/constants";
import { getContactName } from "@/lib/finance/utils";
import type { Invoice, Quote } from "@/lib/client";

interface PipelinePreviewProps {
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
  limit?: number;
}

export function PipelinePreview({ invoices, quotes, currency, limit = 5 }: PipelinePreviewProps) {
  const records = useMemo(() => {
    const all = [
      ...invoices.map(normalizeInvoice),
      ...quotes.map(normalizeQuote),
    ];

    // Sort by urgency: overdue first, then action needed, then sent, then drafts, then won
    const urgencyOrder: Record<string, number> = {
      overdue: 0,
      action_needed: 1,
      sent: 2,
      viewed: 3,
      draft: 4,
      accepted: 5,
      paid: 6,
      lost: 7,
    };

    return all
      .sort((a, b) => {
        const ua = urgencyOrder[getPipelineStage(a.status)] ?? 999;
        const ub = urgencyOrder[getPipelineStage(b.status)] ?? 999;
        if (ua !== ub) return ua - ub;
        return new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime();
      })
      .slice(0, limit);
  }, [invoices, quotes]);

  if (records.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">Pipeline Preview</h2>
        </div>
        <Link
          href="/app/commerce?tab=pipeline"
          className="inline-flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))] hover:underline"
        >
          View all
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="space-y-2">
        {records.map((record, idx) => {
          const meta = RECORD_TYPE_META[record.type];
          const statusStyle = getStatusStyle(record.status);
          const isUrgent = record.status === "OVERDUE" || record.status === "PARTIALLY_PAID";

          return (
            <motion.div
              key={record.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                isUrgent
                  ? "border-red-500/20 bg-red-500/[0.02]"
                  : "border-border/40 bg-card hover:border-[hsl(var(--kf-accent1))]/20"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center shrink-0`}>
                <span className={`text-xs font-bold ${meta.color}`}>
                  {record.type === "quote" ? "Q" : "I"}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">{record.number}</span>
                  <span className={`text-[9px] font-semibold px-1 py-0.5 rounded uppercase tracking-wider border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                    {record.status}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{getContactName(record.contact)}</p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-foreground">{formatCurrency(record.total, currency)}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
