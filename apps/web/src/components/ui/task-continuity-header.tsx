"use client";

import { ArrowLeft, Save, Clock } from "lucide-react";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { cn } from "@/lib/utils";

interface TaskContinuityHeaderProps {
  taskLabel: string;
  draftStatus?: "saved" | "saving" | "unsaved" | null;
  draftLabel?: string;
  onSave?: () => void;
  className?: string;
  returnHref?: string;
  returnLabel?: string;
}

export function TaskContinuityHeader({
  taskLabel,
  draftStatus,
  draftLabel,
  onSave,
  className,
  returnHref,
  returnLabel,
}: TaskContinuityHeaderProps) {
  const { getReturnLabel, getReturnHref, navigateBack, getOriginWorkspace } = useReturnNavigation();

  const resolvedReturnLabel = returnLabel ?? getReturnLabel();
  const resolvedReturnHref = returnHref ?? getReturnHref();
  const originWorkspace = getOriginWorkspace();

  const handleReturn = () => {
    if (returnHref) {
      navigateBack(returnHref);
    } else {
      navigateBack();
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm",
        className
      )}
    >
      <button
        onClick={handleReturn}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
        title={resolvedReturnLabel}
      >
        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        <span className="max-w-[180px] truncate hidden sm:inline">{resolvedReturnLabel}</span>
      </button>

      <div className="w-px h-4 bg-border/60 shrink-0" />

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground truncate">{taskLabel}</span>
        {originWorkspace && (
          <span className="hidden sm:inline text-[11px] text-muted-foreground/70 truncate">
            · Opened from {originWorkspace}
          </span>
        )}
      </div>

      {(draftStatus || onSave) && (
        <div className="flex items-center gap-2 shrink-0">
          {draftStatus === "saving" && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground animate-pulse">
              <Clock className="w-3 h-3" />
              Saving…
            </span>
          )}
          {draftStatus === "saved" && draftLabel && (
            <span className="text-[11px] text-muted-foreground/70">{draftLabel}</span>
          )}
          {draftStatus === "unsaved" && (
            <span className="text-[11px] text-amber-500/80">Unsaved changes</span>
          )}
          {onSave && (
            <button
              onClick={onSave}
              className="flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground border border-border/60 hover:border-border rounded-lg px-2.5 py-1.5 transition-all"
            >
              <Save className="w-3 h-3" />
              <span className="hidden sm:inline">Save</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
