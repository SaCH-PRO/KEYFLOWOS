"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface RichTooltipProps {
  title: string;
  description?: string;
  shortcut?: string;
  /** Optional page key for a "Read more in Notes" deep-link inside the tooltip body. */
  notesPageKey?: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  delayMs?: number;
  maxWidth?: number;
}

export function RichTooltip({
  title,
  description,
  shortcut,
  notesPageKey,
  children,
  side = "top",
  align = "center",
  delayMs = 400,
  maxWidth = 240,
}: RichTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delayMs);
  }, [delayMs]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (longPressRef.current) clearTimeout(longPressRef.current);
    setVisible(false);
  }, []);

  const handleTouchStart = useCallback(() => {
    longPressRef.current = setTimeout(() => setVisible(true), 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    setTimeout(() => setVisible(false), 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, []);

  const positionClasses: Record<string, string> = {
    top: "bottom-full mb-2",
    bottom: "top-full mt-2",
    left: "right-full mr-2 top-1/2 -translate-y-1/2",
    right: "left-full ml-2 top-1/2 -translate-y-1/2",
  };

  const alignClasses: Record<string, string> = {
    start: side === "top" || side === "bottom" ? "left-0" : "",
    center: side === "top" || side === "bottom" ? "left-1/2 -translate-x-1/2" : "",
    end: side === "top" || side === "bottom" ? "right-0" : "",
  };

  const animateFrom = {
    top: { y: 4 },
    bottom: { y: -4 },
    left: { x: 4 },
    right: { x: -4 },
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, ...animateFrom[side] }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-[60] pointer-events-none ${positionClasses[side]} ${alignClasses[align]}`}
            style={{ maxWidth }}
          >
            <div
              className="rounded-lg px-3 py-2 shadow-xl"
              style={{
                background: "hsl(var(--kf-bg))",
                border: "1px solid hsl(var(--kf-border) / 0.5)",
                boxShadow: "0 8px 24px hsl(0 0% 0% / 0.3)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                  {title}
                </span>
                {shortcut && (
                  <kbd
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.4)",
                      color: "hsl(var(--kf-accent1))",
                      border: "1px solid hsl(var(--kf-border) / 0.3)",
                    }}
                  >
                    {shortcut}
                  </kbd>
                )}
              </div>
              {description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {description}
                </p>
              )}
              {notesPageKey && (
                <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-accent1))" }}>
                  Press <kbd className="font-mono">?</kbd> to read more in Notes
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
