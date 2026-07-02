"use client";

import { Lightbulb, AlertTriangle } from "lucide-react";
import type { KeyBriefing } from "@/lib/api/business-command-center";

interface KeyBriefingCardProps {
  briefing: KeyBriefing;
  className?: string;
}

export function KeyBriefingCard({ briefing, className = "" }: KeyBriefingCardProps) {
  return (
    <div className={`kf-card kf-radius-lg p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Lightbulb className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <h3 className="text-sm font-semibold">KEY Briefing</h3>
      </div>

      <p className="text-sm font-medium mb-3">{briefing.headline}</p>

      {briefing.bullets.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {briefing.bullets.map((bullet, idx) => (
            <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-[hsl(var(--kf-accent1))] mt-1.5 flex-shrink-0" />
              {bullet}
            </li>
          ))}
        </ul>
      )}

      {briefing.warnings.length > 0 && (
        <div className="space-y-1.5">
          {briefing.warnings.map((warning, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
