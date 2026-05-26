"use client";

import { Eye, Printer } from "lucide-react";

interface DetailViewPrintProps {
  onPreview: () => void;
  onPrint: () => void;
  accentColor: string;
  compact?: boolean;
}

export function DetailViewPrint({ onPreview, onPrint, accentColor, compact }: DetailViewPrintProps) {
  const label = compact ? "Preview" : "View as Customer";
  const py = compact ? "py-3" : "py-3";

  return (
    <div className="flex gap-2">
      <button
        onClick={onPreview}
        className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
        style={{ paddingTop: py, paddingBottom: py }}
      >
        <Eye className="w-4 h-4" style={{ color: accentColor }} />
        {label}
      </button>
      <button
        onClick={onPrint}
        className="flex items-center justify-center gap-2 px-4 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
        style={{ paddingTop: py, paddingBottom: py }}
        title="Print / Save as PDF"
      >
        <Printer className="w-4 h-4" style={{ color: accentColor }} />
      </button>
    </div>
  );
}
