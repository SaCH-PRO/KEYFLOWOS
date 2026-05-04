"use client";

import { HelpCircle } from "lucide-react";
import { useOptionalNotes, type OpenNotesOptions } from "./notes-context";

interface NotesTriggerProps {
  pageKey?: string;
  label?: string;
  variant?: "header" | "icon" | "pill";
  options?: OpenNotesOptions;
  className?: string;
  ariaLabel?: string;
}

/**
 * Header "?" button. Opens the unified Notes drawer scoped to the current page.
 * Falls back to dispatching a window event when used outside the NotesProvider
 * (so it still works in legacy spots without crashing).
 */
export function NotesTrigger({
  pageKey,
  label,
  variant = "icon",
  options,
  className,
  ariaLabel = "Open Notes (?)",
}: NotesTriggerProps) {
  const ctx = useOptionalNotes();

  const handleClick = () => {
    const opts: OpenNotesOptions = { ...(options ?? {}) };
    if (pageKey && !opts.scope && !opts.pageKey) opts.pageKey = pageKey;
    if (ctx) ctx.openNotes(opts);
    else if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kf-notes-open", { detail: opts }));
    }
  };

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        title="Notes (?)"
        className={
          className ??
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg min-h-[32px]"
        }
        style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
      >
        <HelpCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        {label ?? "Notes"}
      </button>
    );
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        title="Notes (?)"
        className={
          className ??
          "inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
        }
        style={{
          background: "hsl(var(--kf-accent1) / 0.1)",
          color: "hsl(var(--kf-accent1))",
        }}
      >
        <HelpCircle className="w-3 h-3" />
        {label ?? "Read more in Notes"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title="Notes (?)"
      className={
        className ??
        "inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      }
    >
      <HelpCircle className="w-4 h-4" />
    </button>
  );
}
