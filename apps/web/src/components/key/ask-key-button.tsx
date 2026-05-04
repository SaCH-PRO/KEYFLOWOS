"use client";

import { Sparkles } from "lucide-react";
import { openKey, type OpenKeyDetail } from "./key-agent";
import { cn } from "@/lib/utils";

interface AskKeyButtonProps extends OpenKeyDetail {
  label?: string;
  className?: string;
  variant?: "primary" | "ghost" | "compact";
  title?: string;
}

/**
 * Single per-module entry point into the KEY super-CEO agent.
 * Replaces the old per-module AI search bars and command centers.
 * Use anywhere with optional `prompt` and `context` to scope KEY.
 */
export function AskKeyButton({
  label = "Ask KEY",
  className,
  variant = "ghost",
  title,
  ...detail
}: AskKeyButtonProps) {
  const baseStyles =
    variant === "primary"
      ? "bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white hover:opacity-90"
      : variant === "compact"
        ? "border border-border/50 bg-card hover:border-[hsl(var(--kf-accent1))]/30 text-muted-foreground hover:text-foreground text-xs px-2 py-1"
        : "border border-border/50 bg-card hover:border-[hsl(var(--kf-accent1))]/30 text-muted-foreground hover:text-foreground";

  return (
    <button
      type="button"
      onClick={() => openKey({ mode: "chat", ...detail })}
      title={title || "Ask KEY about this"}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all",
        baseStyles,
        className,
      )}
    >
      <Sparkles className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}
