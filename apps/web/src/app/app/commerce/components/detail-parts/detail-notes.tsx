"use client";

import { StickyNote } from "lucide-react";

interface DetailNotesProps {
  notes: string | null | undefined;
  accentColor: string;
  compact?: boolean;
}

export function DetailNotes({ notes, accentColor, compact }: DetailNotesProps) {
  if (!notes) return null;

  if (compact) {
    return (
      <div className="p-3 rounded-2xl bg-white/[0.03] border border-border/40">
        <div className="flex items-center gap-1.5 mb-1.5">
          <StickyNote className="w-3.5 h-3.5" style={{ color: accentColor, opacity: 0.85 }} />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{notes}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <StickyNote className="w-4 h-4" style={{ color: accentColor, opacity: 0.85 }} />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h4>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{notes}</p>
      </div>
    </div>
  );
}
