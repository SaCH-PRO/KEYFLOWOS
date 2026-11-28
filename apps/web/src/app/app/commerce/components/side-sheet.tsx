"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";

/** A selector that finds this control again in a remounted panel (P263), or null when nothing identifies it. */
function focusKey(el: HTMLElement): string | null {
  const q = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));
  if (el.id) return `#${q(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${q(name)}"]`;
  const label = el.getAttribute("aria-label");
  if (label) return `${tag}[aria-label="${q(label)}"]`;
  return null;
}

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  /**
   * P257: while set, the sheet cannot be closed by its own controls: the header Close is disabled and says so
   * (disabled, aria-disabled), and Escape and the overlay do nothing. For a sheet whose save is in flight. Default false.
   */
  closeDisabled?: boolean;
}

const WIDTH_MAP = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function SideSheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = "lg",
  closeDisabled = false,
}: SideSheetProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `sidesheet-title-${title.replace(/\s+/g, "-").toLowerCase()}`;

  // P257 R1-1: onClose and closeDisabled are read through refs, so the focus and keydown effect below depends on
  // `open` only. A caller passing a new onClose each render (an inline arrow; the expense sheet re-rendering as it is
  // typed in) or toggling closeDisabled re-ran that effect on every render: its cleanup focused the opener and the
  // rerun focused the panel, so focus left the field after every keystroke.
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  });
  // P257: every way the sheet closes itself goes through this, so closeDisabled holds them all; it calls the latest
  // onClose.
  const close = useCallback(() => {
    if (!closeDisabledRef.current) onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, close]);

  // P263: the panel is keyed by the layout, so a resize or rotation while open remounts it and the focused control is
  // removed (focus falls to <body>). While open, the control focused in the panel is remembered by what identifies it
  // across the remount (its id, name or accessible label; the node itself is gone); when the layout flips, that
  // control in the new panel is focused, or the panel itself when there is none. Focus outside the sheet is left alone.
  const focusedRef = useRef<{ inPanel: boolean; key: string | null }>({ inPanel: false, key: null });
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const panel = panelRef.current;
      if (!el || !panel || !panel.contains(el)) { focusedRef.current = { inPanel: false, key: null }; return; }
      focusedRef.current = { inPanel: true, key: el === panel ? null : focusKey(el) };
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);
  const layoutRef = useRef(isMobile);
  useLayoutEffect(() => {
    if (layoutRef.current === isMobile) return;
    layoutRef.current = isMobile;
    const panel = panelRef.current;
    if (!open || !panel || !focusedRef.current.inPanel) return;
    const key = focusedRef.current.key;
    const same = key ? panel.querySelector<HTMLElement>(key) : null;
    (same ?? panel).focus();
  }, [isMobile, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={isMobile ? "fixed inset-0 bg-black/50 backdrop-blur-sm z-[var(--kf-z-drawer)] flex items-end" : "fixed inset-0 bg-black/50 backdrop-blur-sm z-[var(--kf-z-drawer)]"}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          {/* MOUNT-QUOTES: the two branches are keyed. useIsMobile() starts false, so a sheet
              that mounts when it opens shows the desktop panel for a frame and then the bottom
              sheet; as the same element in the same slot the node was reused and kept the
              desktop slide's x in flight (the bottom sheet sat 345px to the right on a phone). */}
          {isMobile ? (
            <motion.div
              key="sheet-phone"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className="w-full bg-card rounded-t-2xl border-t border-border/60 shadow-2xl flex flex-col outline-none"
              style={{ maxHeight: "90vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
                <div
                  className="w-10 h-1 rounded-full"
                  style={{ background: "hsl(var(--kf-muted-foreground) / 0.3)" }}
                />
              </div>

              <div className="px-4 py-3 border-b border-border/40 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {icon}
                    <div>
                      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
                      {subtitle && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={close}
                    disabled={closeDisabled}
                    aria-disabled={closeDisabled || undefined}
                    aria-label="Close"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-4">
                {children}
              </div>

              {footer && (
                <div className="p-4 border-t border-border/40 shrink-0 bg-card pb-safe">
                  {footer}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="sheet-desktop"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={`absolute right-0 top-0 bottom-0 w-full ${WIDTH_MAP[width]} bg-card border-l border-border/60 shadow-2xl flex flex-col outline-none`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-border/40 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {icon}
                    <div>
                      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
                      {subtitle && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={close}
                    disabled={closeDisabled}
                    aria-disabled={closeDisabled || undefined}
                    aria-label="Close"
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-5">
                {children}
              </div>

              {footer && (
                <div className="p-4 border-t border-border/40 shrink-0 bg-card">
                  {footer}
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface QuickSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function QuickSheet({
  open,
  onClose,
  title,
  children,
}: QuickSheetProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[var(--kf-z-drawer)] flex items-end sm:items-center justify-center"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="w-full max-w-sm bg-card rounded-t-2xl sm:rounded-2xl border border-border/60 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{title}</h3>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
