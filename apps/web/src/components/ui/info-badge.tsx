"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, X, BookOpen } from "lucide-react";
import { dispatchOpenNotes } from "@/components/keyflow/notes-context";

interface InfoBadgeProps {
  title: string;
  body: string;
  learnMoreHref?: string;
  /**
   * When set, renders a "Read more in Notes" link that opens the unified Notes
   * drawer scoped to the given page key.
   */
  notesPageKey?: string;
  side?: "top" | "bottom" | "left" | "right";
  iconSize?: number;
  children?: ReactNode;
}

export function InfoBadge({
  title,
  body,
  learnMoreHref,
  notesPageKey,
  side = "bottom",
  iconSize = 14,
  children,
}: InfoBadgeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const positionClasses: Record<string, string> = {
    top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
    left: "right-full mr-2 top-1/2 -translate-y-1/2",
    right: "left-full ml-2 top-1/2 -translate-y-1/2",
  };

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(!open); } }}
        className="inline-flex items-center justify-center rounded-full transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none cursor-pointer"
        style={{
          width: iconSize + 8,
          height: iconSize + 8,
          minWidth: 28,
          minHeight: 28,
        }}
        aria-label={`Info: ${title}`}
        aria-expanded={open}
      >
        {children ?? (
          <Info
            style={{ width: iconSize, height: iconSize, color: "hsl(var(--kf-accent2))" }}
          />
        )}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, scale: 0.95, y: side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-[60] block ${positionClasses[side]}`}
            style={{ width: 280 }}
          >
            <span
              className="block rounded-xl p-3 shadow-2xl"
              style={{
                background: "hsl(var(--kf-bg))",
                border: "1px solid hsl(var(--kf-accent2) / 0.2)",
                boxShadow: "0 12px 32px hsl(0 0% 0% / 0.35)",
              }}
            >
              <span className="flex items-start justify-between gap-2 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <span className="text-xs font-semibold">{title}</span>
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className="p-0.5 rounded hover:bg-muted/40 transition-colors shrink-0"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </span>
              <span className="block text-[11px] text-muted-foreground leading-relaxed">{body}</span>
              {learnMoreHref && (
                <a
                  href={learnMoreHref}
                  className="inline-block mt-2 text-[11px] font-medium transition-colors"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                >
                  Learn more →
                </a>
              )}
              {notesPageKey && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    dispatchOpenNotes({
                      scope: { kind: "page", pageKey: notesPageKey },
                      tab: "page",
                    });
                  }}
                  className="inline-flex items-center gap-1 mt-2 text-[11px] font-medium transition-colors hover:underline"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                >
                  <BookOpen className="w-3 h-3" />
                  Read more in Notes
                </button>
              )}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
