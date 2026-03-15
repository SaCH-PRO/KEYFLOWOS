"use client";

import { useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type SheetWidth = "sm" | "md" | "lg";

const WIDTH_MAP: Record<SheetWidth, string> = {
  sm: "320px",
  md: "480px",
  lg: "640px",
};

const MOBILE_BREAKPOINT = 640;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: SheetWidth;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  width = "md",
  children,
  footer,
}: SideSheetProps) {
  const isMobile = useIsMobile();

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className={isMobile ? "fixed inset-0 z-50 flex items-end" : "fixed inset-0 z-50 flex justify-end"}
          role="dialog"
          aria-modal="true"
          aria-labelledby="side-sheet-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0"
            style={{ background: "hsl(var(--kf-foreground) / 0.5)" }}
            onClick={onClose}
          />

          {isMobile ? (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative flex flex-col w-full rounded-t-2xl border-t"
              style={{
                maxHeight: "90vh",
                background: "hsl(var(--kf-card))",
                borderColor: "hsl(var(--kf-border))",
              }}
            >
              <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                <div
                  className="w-10 h-1 rounded-full"
                  style={{ background: "hsl(var(--kf-muted-foreground) / 0.3)" }}
                />
              </div>

              <div
                className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <div className="min-w-0">
                  <h2 id="side-sheet-title" className="kf-text-emphasis font-semibold truncate">{title}</h2>
                  {subtitle && (
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {subtitle}
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="min-w-[44px] min-h-[44px] kf-radius-sm flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ color: "hsl(var(--kf-muted-foreground))" }}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {children}
              </div>

              {footer && (
                <div
                  className="flex items-center justify-end gap-2 px-4 py-3 flex-shrink-0 border-t pb-safe"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative flex flex-col h-full border-l"
              style={{
                width: WIDTH_MAP[width],
                maxWidth: "100vw",
                background: "hsl(var(--kf-card))",
                borderColor: "hsl(var(--kf-border))",
              }}
            >
              <div
                className="flex items-center justify-between px-5 py-4 flex-shrink-0 border-b"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <div className="min-w-0">
                  <h2 id="side-sheet-title" className="kf-text-emphasis font-semibold truncate">{title}</h2>
                  {subtitle && (
                    <p className="text-xs mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {subtitle}
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 kf-radius-sm flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ color: "hsl(var(--kf-muted-foreground))" }}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {children}
              </div>

              {footer && (
                <div
                  className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0 border-t"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}
