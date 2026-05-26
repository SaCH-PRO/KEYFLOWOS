"use client";

import { Calendar } from "lucide-react";
import { ReactNode } from "react";

interface DetailDateGridProps {
  dateLabel1: string;
  dateValue1: string | null;
  dateLabel2: string;
  dateValue2: string | null;
  dateExtra?: ReactNode;
  accentColor: string;
  compact?: boolean;
}

export function DetailDateGrid({
  dateLabel1,
  dateValue1,
  dateLabel2,
  dateValue2,
  dateExtra,
  accentColor,
  compact,
}: DetailDateGridProps) {
  const pad = compact ? "p-3" : "p-3.5";
  const mb = compact ? "mb-1" : "mb-1.5";

  const fmt = (v: string | null | undefined) =>
    v
      ? new Date(v).toLocaleDateString("en-TT", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "—";

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className={`${pad} rounded-2xl bg-white/[0.03] border border-border/40`}>
        <div className={`flex items-center gap-1.5 ${mb}`}>
          <Calendar className="w-3.5 h-3.5" style={{ color: accentColor, opacity: 0.85 }} />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{dateLabel1}</p>
        </div>
        <p className="text-sm font-semibold">{fmt(dateValue1)}</p>
      </div>
      <div className={`${pad} rounded-2xl bg-white/[0.03] border border-border/40`}>
        <div className={`flex items-center gap-1.5 ${mb}`}>
          <Calendar className="w-3.5 h-3.5" style={{ color: accentColor, opacity: 0.85 }} />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{dateLabel2}</p>
        </div>
        <p className="text-sm font-semibold">{fmt(dateValue2)}</p>
        {dateExtra}
      </div>
    </div>
  );
}
