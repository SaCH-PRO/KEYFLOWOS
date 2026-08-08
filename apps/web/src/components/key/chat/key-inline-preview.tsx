"use client";

import { Dna, ShoppingBag, Calendar, CheckCircle, AlertTriangle, XCircle, Clock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyInlinePreviewData } from "./types";

interface KeyInlinePreviewProps {
  preview: KeyInlinePreviewData;
  onAction?: (value: string) => void;
}

const TYPE_CONFIG: Record<
  KeyInlinePreviewData["type"],
  { icon: React.ElementType; label: string; tone: string; bg: string }
> = {
  genome: { icon: Dna, label: "Genome", tone: "text-violet", bg: "bg-violet/10" },
  commerce: { icon: ShoppingBag, label: "Commerce", tone: "text-rose", bg: "bg-rose/10" },
  temporal: { icon: Calendar, label: "Temporal", tone: "text-mint", bg: "bg-mint/10" },
  approval: { icon: CheckCircle, label: "Approval", tone: "text-gold", bg: "bg-gold/10" },
  task: { icon: Clock, label: "Task", tone: "text-sky", bg: "bg-sky/10" },
  email: { icon: ArrowRight, label: "Email", tone: "text-orange", bg: "bg-orange/10" },
};

const STATUS_CONFIG: Record<
  NonNullable<KeyInlinePreviewData["status"]>,
  { icon: React.ElementType; tone: string; bg: string; label: string }
> = {
  pending: { icon: Clock, tone: "text-gold", bg: "bg-gold/10", label: "Pending" },
  success: { icon: CheckCircle, tone: "text-mint", bg: "bg-mint/10", label: "Success" },
  warning: { icon: AlertTriangle, tone: "text-orange", bg: "bg-orange/10", label: "Warning" },
  error: { icon: XCircle, tone: "text-rose", bg: "bg-rose/10", label: "Error" },
};

export function KeyInlinePreview({ preview, onAction }: KeyInlinePreviewProps) {
  const config = TYPE_CONFIG[preview.type];
  const status = preview.status ? STATUS_CONFIG[preview.status] : null;
  const Icon = config.icon;
  const StatusIcon = status?.icon;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border/40 bg-card/60 shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
        <div className={cn("flex h-6 w-6 items-center justify-center rounded-lg", config.bg)}>
          <Icon className={cn("h-3.5 w-3.5", config.tone)} />
        </div>
        <span className="text-xs font-semibold text-foreground">{config.label}</span>
        {status && StatusIcon && (
          <div className={cn("ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", status.bg, status.tone)}>
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5">
        {preview.title && <p className="text-sm font-medium text-foreground">{preview.title}</p>}
        {preview.description && <p className="text-xs text-muted-foreground">{preview.description}</p>}

        {preview.meta && Object.keys(preview.meta).length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Object.entries(preview.meta).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-muted/40 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{key}</p>
                <p className="truncate text-xs font-medium text-foreground">
                  {value === null || value === undefined ? "—" : String(value)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview.actions && preview.actions.length > 0 && (
        <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2">
          {preview.actions.map((action) => (
            <button
              key={action.value}
              type="button"
              onClick={() => onAction?.(action.value)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                action.variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
                action.variant === "danger" && "bg-rose text-white hover:bg-rose/90",
                (action.variant === "secondary" || !action.variant) && "bg-muted text-foreground hover:bg-muted/80",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
