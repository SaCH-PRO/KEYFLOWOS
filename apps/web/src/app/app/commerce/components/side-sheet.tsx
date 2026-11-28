"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";

/** No store to subscribe to: useSyncExternalStore here only tells the server render (and hydration) from the client. */
const subscribeNothing = () => () => {};

/** A text field's caret and selection, or null (P263 R1-6). */
function selectionOf(el: Element): [number, number] | null {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  try {
    return el.selectionStart === null || el.selectionEnd === null ? null : [el.selectionStart, el.selectionEnd];
  } catch {
    return null; // input types with no selection (number, date, ...) throw on read in some engines
  }
}
/**
 * The control in the new shell that stands for one in the old shell (the header's Close, a footer button): the same
 * tag with the same accessible label and text, when exactly one matches. The children are never matched this way:
 * they are the same nodes (P263 R3).
 */
function shellCounterpart(old: HTMLElement, panel: HTMLElement, content: HTMLElement): HTMLElement | null {
  const same = Array.from(panel.querySelectorAll<HTMLElement>(old.tagName)).filter(
    (el) => !content.contains(el) && el.getAttribute("aria-label") === old.getAttribute("aria-label") && el.textContent === old.textContent,
  );
  return same.length === 1 ? same[0] : null;
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

  // P263 R3: the panel is keyed by the layout, so a resize or rotation while open remounts the shell (the phone bottom
  // sheet or the desktop panel). The children do not remount with it: they render once, through a portal, into a
  // container this sheet owns, and the container is moved into the current shell's content slot. On a flip the same
  // nodes, with their focus target, caret, typed values and component state, are carried over. Moving a focused node
  // drops its focus, so the node focused before the flip is focused again (exactly that node; no matching), and its
  // caret and selection are put back. A control in the shell itself (the header's Close, a footer button) is
  // focused in the new shell when one stands for it, otherwise the panel is. Focus outside the sheet is left alone.
  // The container is made once, on the client only (the server has no document). The portal sits inside the overlay,
  // after the keyed panel: the overlay is not remounted by a flip, so in the React tree the children stay under the
  // sheet (R4): they read the sheet's own presence (a child's exit runs when the sheet closes; a caller's
  // AnimatePresence is not held by them), and their clicks stop at the sheet as the panel's do. The slot's ref puts the
  // container in place before the children's own layout effects run, so a child that measures itself, or autoFocus,
  // finds itself in the document on mount. The portal is rendered only once mounted on the client: a sheet rendered
  // open on the server has an empty slot there, and hydrates to the same before the children are put in (R4-3).
  const [content] = useState<HTMLDivElement | null>(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  /** Set when the container moved into a new slot: what had focus then (the old shell is already gone) and its caret. */
  const movedRef = useRef<{ last: HTMLElement | null; selection: [number, number] | null } | null>(null);
  // R2-4: a focus change only records the focused node (O(1)); nothing is read from the panel until a flip.
  const focusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const panel = panelRef.current;
      focusedRef.current = el && panel && panel.contains(el) ? el : null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      // and no detached subtree stays referenced once the sheet is closed
      focusedRef.current = null;
    };
  }, [open]);
  const attachSlot = useCallback((slot: HTMLDivElement | null) => {
    if (!slot || !content || content.parentNode === slot) return;
    const last = focusedRef.current;
    movedRef.current = { last, selection: last ? selectionOf(last) : null };
    slot.appendChild(content);
  }, [content]);
  useLayoutEffect(() => {
    const moved = movedRef.current;
    movedRef.current = null;
    if (!open || !moved || !content) return;
    const { last, selection } = moved;
    const panel = panelRef.current;
    if (!last || !panel || document.activeElement === last) return;
    if (content.contains(last)) {
      last.focus();
    } else if (last !== panel && !last.isConnected) {
      shellCounterpart(last, panel, content)?.focus();
    }
    // A control that cannot take focus now (disabled) leaves focus on <body>: the panel takes it (P263 R1-4).
    if (!panel.contains(document.activeElement)) { panel.focus(); return; }
    if (selection && document.activeElement === last && (last instanceof HTMLInputElement || last instanceof HTMLTextAreaElement)) {
      try { last.setSelectionRange(selection[0], selection[1]); } catch { /* a type with no selection */ }
    }
  }); // every commit: whatever remounted the slot, the move is handled in the commit that made it

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

              <div ref={attachSlot} className="flex-1 overflow-y-auto overscroll-contain p-4" />

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

              <div ref={attachSlot} className="flex-1 overflow-y-auto overscroll-contain p-5" />

              {footer && (
                <div className="p-4 border-t border-border/40 shrink-0 bg-card">
                  {footer}
                </div>
              )}
            </motion.div>
          )}
          {mounted && content && createPortal(<div onClick={(e) => e.stopPropagation()}>{children}</div>, content)}
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
