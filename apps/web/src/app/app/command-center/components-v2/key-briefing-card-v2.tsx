"use client";

import { Lightbulb, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import type { KeyBriefing } from "@/lib/api/business-command-center";

interface KeyBriefingCardV2Props {
  briefing: KeyBriefing;
  className?: string;
}

export function KeyBriefingCardV2({ briefing, className }: KeyBriefingCardV2Props) {
  return (
    <Surface className={cn("p-5", className)}>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15">
          <Lightbulb className="h-3.5 w-3.5 text-gold-foreground" />
        </div>
        <h3 className="font-display text-sm font-semibold text-foreground">KEY Briefing</h3>
      </div>

      <p className="text-sm font-medium text-foreground mb-3">{briefing.headline}</p>

      {briefing.bullets.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {briefing.bullets.map((bullet, idx) => (
            <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
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
              className="flex items-start gap-2 rounded-xl bg-rose/10 px-3 py-2 text-xs text-rose"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {warning}
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}
