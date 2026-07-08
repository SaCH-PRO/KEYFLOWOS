"use client";

import { useState } from "react";
import { Shield, AlertTriangle, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyChatPlanStep } from "./types";

interface KeyPlanCardProps {
  step: KeyChatPlanStep;
  onConfirm: (toolCallId: string, confirmed: boolean, toolName: string, args: Record<string, unknown>) => void;
  isResolving?: boolean;
}

export function KeyPlanCard({ step, onConfirm, isResolving }: KeyPlanCardProps) {
  const [showArgs, setShowArgs] = useState(false);

  const resolved = step.status === "completed" || step.status === "rejected" || step.status === "failed";

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border/50 bg-card/60 shadow-sm">
      <div className="flex items-start gap-3 p-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            step.riskLevel === "high" && "bg-red-500/10 text-red-500",
            step.riskLevel === "medium" && "bg-amber-500/10 text-amber-500",
            step.riskLevel === "low" && "bg-emerald-500/10 text-emerald-500"
          )}
        >
          {step.riskLevel === "high" ? <AlertTriangle className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{step.description || step.name}</p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                step.riskLevel === "high" && "bg-red-500/10 text-red-500",
                step.riskLevel === "medium" && "bg-amber-500/10 text-amber-500",
                step.riskLevel === "low" && "bg-emerald-500/10 text-emerald-500"
              )}
            >
              {step.riskLevel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowArgs((s) => !s)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showArgs ? "Hide details" : "Show details"}
          </button>

          {showArgs && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-[11px]">
              {JSON.stringify(step.arguments, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {!resolved && (
        <div className="flex items-center justify-end gap-2 border-t border-border/40 px-3 py-2">
          <button
            type="button"
            disabled={isResolving}
            onClick={() => onConfirm(step.toolCallId, false, step.name, step.arguments)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {isResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Deny
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => onConfirm(step.toolCallId, true, step.name, step.arguments)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Allow
          </button>
        </div>
      )}
    </div>
  );
}
