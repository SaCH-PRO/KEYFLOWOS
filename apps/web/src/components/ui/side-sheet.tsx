"use client";

import { useEffect, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

type SheetWidth = "sm" | "md" | "lg" | "2xl";

/**
 * FU-SIDESHEET-MOBILE-OFFSET (D-283). The layout is CSS: below 640px (Tailwind's sm) the sheet is a bottom sheet
 * the full width of the screen, and from 640px up a right-hand panel this wide. Nothing in it waits for an effect,
 * so a sheet mounted already open on a phone is laid out as the bottom sheet from its first render (useIsMobile()
 * starts false and flipped it there from the desktop panel, which left the panel offset off the right edge).
 * Each class is written out whole so Tailwind generates it.
 */
const WIDTH_CLASS: Record<SheetWidth, string> = {
  sm: "sm:w-[320px]",
  md: "sm:w-[480px]",
  lg: "sm:w-[640px]",
  "2xl": "sm:w-[768px]",
};

/** The phone side of Tailwind's sm breakpoint (min-width: 640px), as useIsMobile() asks it. */
const PHONE_QUERY = "(max-width: 639px)";

function subscribePhone(onChange: () => void) {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const phoneNow = () => window.matchMedia(PHONE_QUERY).matches;
/** The server has no screen; hydration reads this too, so the server's HTML and the first client render agree. */
const phoneOnServer = () => false;

/**
 * Which way the sheet slides: up from the bottom on a phone, in from the right from 640px up. Read from matchMedia
 * during render (not in an effect), so a sheet that mounts on a phone starts its phone slide. Only the slide's
 * direction depends on it; wherever a slide starts from, the panel ends at x: 0 and y: 0.
 */
function usePhoneSlide(): boolean {
  return useSyncExternalStore(subscribePhone, phoneNow, phoneOnServer);
}

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
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
  const phone = usePhoneSlide();

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

  // Off screen: below the bottom edge on a phone, past the right edge from 640px up. The panel always animates to
  // x: 0 and y: 0, so a slide begun for one layout can never leave the other offset.
  const offscreen = phone ? { x: 0, y: "100%" } : { x: "100%", y: 0 };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[var(--kf-z-drawer)] flex items-end sm:items-stretch sm:justify-end"
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

          <motion.div
            initial={offscreen}
            animate={{ x: 0, y: 0 }}
            exit={offscreen}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className={`relative flex flex-col w-full max-h-[90vh] rounded-t-2xl border-t sm:h-full sm:max-h-none sm:max-w-[100vw] sm:rounded-none sm:border-t-0 sm:border-l ${WIDTH_CLASS[width]}`}
            style={{
              background: "hsl(var(--kf-card))",
              borderColor: "hsl(var(--kf-border))",
            }}
          >
            {/* The bottom sheet's grab handle; the right-hand panel has none. */}
            <div className="flex justify-center pt-2 pb-1 flex-shrink-0 sm:hidden">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: "hsl(var(--kf-muted-foreground) / 0.3)" }}
              />
            </div>

            <div
              className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 flex-shrink-0 border-b"
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
                className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 kf-radius-sm flex items-center justify-center flex-shrink-0 transition-colors"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
                aria-label="Close"
              >
                <X className="w-5 h-5 sm:w-4 sm:h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
              {children}
            </div>

            {footer && (
              <div
                className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 flex-shrink-0 border-t pb-safe"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
