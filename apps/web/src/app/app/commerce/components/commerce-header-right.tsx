"use client";

import { DollarSign } from "lucide-react";
import { ServiceLinkWidget } from "./service-link-widget";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { RichTooltip } from "@/components/ui/rich-tooltip";

interface CommerceHeaderRightProps {
  revenuePulse: string;
}

export function CommerceHeaderRight({ revenuePulse }: CommerceHeaderRightProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="hidden md:block">
        <ServiceLinkWidget compact />
      </div>
      <NotesTrigger pageKey="commerce" variant="header" />
      <RichTooltip
        title="Revenue Pulse"
        description="Total payments collected this month across all invoices."
        side="bottom"
      >
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-help text-xs"
          style={{ border: "1px solid hsl(var(--kf-border) / 0.4)", background: "hsl(var(--kf-muted) / 0.08)" }}
        >
          <DollarSign className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
          <span className="font-semibold text-xs" style={{ color: "hsl(var(--kf-success))" }}>
            {revenuePulse}
          </span>
          <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            collected
          </span>
        </div>
      </RichTooltip>
    </div>
  );
}
