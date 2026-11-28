"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";

/**
 * P263: what identifies the control focused in the panel, so the same control can be found again in a remounted panel
 * (the node itself is gone). Read by iterating the panel's elements and comparing attributes: no selector is built, so
 * an id or label with any characters is matched and the lookup cannot throw.
 */
type FocusSnapshot = {
  /** The panel itself was focused. */
  panel: boolean;
  /**
   * Each identifier the control carries (an attribute, or the text of its <label>s), with how many elements in the
   * panel carried that value and which of them this control was.
   */
  ids: Array<{ key: IdKey; value: string; nth: number; count: number }>;
  /** Its index among the panel's focusables, and the whole sequence of their tag:type (P263 R2-1). */
  index: number;
  sequence: string[];
  /** The control itself: detached by the remount, it still holds its caret and selection, read when refocusing. */
  node: HTMLElement | null;
};
type IdKey = "id" | "name" | "aria-label" | "placeholder" | "label";
const ID_KEYS: IdKey[] = ["id", "name", "aria-label", "placeholder", "label"];
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';
function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el !== panel && el.getAttribute("tabindex") !== "-1");
}
const signature = (el: HTMLElement) => `${el.tagName}:${el.getAttribute("type") ?? ""}`;
/** An identifier's value on an element: an attribute, or (P263 R2-1) the text of the element's <label>s. */
function idValue(el: HTMLElement, key: IdKey): string | null {
  if (key !== "label") return el.getAttribute(key) || null;
  const labels = (el as HTMLInputElement).labels;
  const text = labels ? Array.from(labels).map((l) => (l.textContent ?? "").trim()).filter(Boolean).join(" ") : "";
  return text || null;
}
function carrying(panel: HTMLElement, key: IdKey, value: string): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>("*")).filter((el) => idValue(el, key) === value);
}
function selectionOf(el: HTMLElement): [number, number] | null {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  try {
    return el.selectionStart === null || el.selectionEnd === null ? null : [el.selectionStart, el.selectionEnd];
  } catch {
    return null; // input types with no selection (number, date, ...) throw on read in some engines
  }
}
function snapshotOf(el: HTMLElement, panel: HTMLElement): FocusSnapshot {
  if (el === panel) return { panel: true, ids: [], index: -1, sequence: [], node: null };
  const ids: FocusSnapshot["ids"] = [];
  for (const key of ID_KEYS) {
    const value = idValue(el, key);
    if (!value) continue;
    const matches = carrying(panel, key, value);
    ids.push({ key, value, nth: matches.indexOf(el), count: matches.length });
  }
  const focusables = focusablesIn(panel);
  return { panel: false, ids, index: focusables.indexOf(el), sequence: focusables.map(signature), node: el };
}
/** The control in `panel` that the snapshot names, or null (then the panel is focused). */
function findAgain(snap: FocusSnapshot, panel: HTMLElement): HTMLElement | null {
  if (snap.panel) return null;
  try {
    for (const { key, value, nth, count } of snap.ids) {
      const matches = carrying(panel, key, value);
      // P263 R1-2, R2-2: an identifier names this control when it matches one element, or the same one of as many
      // matches as before. P263 R1-3: one that finds nothing (a useId id that changed) falls through.
      if (matches.length === 1 && count === 1) return matches[0];
      if (matches.length > 1 && matches.length === count && nth >= 0) return matches[nth];
    }
    // P263 R1-1, R2-1: no identifier names it: the same position, only when the panel's focusables are the same
    // controls in the same order (any added, removed or reordered control could put a different field there).
    const focusables = focusablesIn(panel);
    const same = focusables.length === snap.sequence.length && focusables.every((el, i) => signature(el) === snap.sequence[i]);
    if (same && snap.index >= 0) return focusables[snap.index] ?? null;
  } catch {
    // never let a lookup throw out of the layout effect: focus the panel instead
  }
  return null;
}
/** Focuses the control again (with its caret and selection), or the panel when it is gone or cannot take focus. */
function refocus(snap: FocusSnapshot, panel: HTMLElement) {
  const target = findAgain(snap, panel);
  target?.focus();
  // P263 R1-4: a matched control that cannot take focus now (disabled) leaves focus on <body>: the panel takes it.
  if (!target || !panel.contains(document.activeElement)) { panel.focus(); return; }
  // P263 R1-6: a text field keeps its caret and selection (as the old node last had them).
  const selection = snap.node ? selectionOf(snap.node) : null;
  if (selection && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    try { target.setSelectionRange(selection[0], selection[1]); } catch { /* a type with no selection */ }
  }
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
  // removed (focus falls to <body>). While open, the control focused in the panel is remembered (FocusSnapshot); when
  // the layout flips, that control in the new panel is focused, or the panel itself when it cannot be found or take
  // focus. Focus outside the sheet is left alone.
  // P263 R2-4: a focus change only records the focused node and the panel it is in (O(1): no scan of the panel). The
  // snapshot is taken when the layout flips, against that panel as it was when the remount detached it (the node's own
  // tree), so its position is never stale (R2-1 (b)) and a large panel costs nothing per tab or click.
  const focusedRef = useRef<{ node: HTMLElement; panel: HTMLElement } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const panel = panelRef.current;
      focusedRef.current = el && panel && panel.contains(el) ? { node: el, panel } : null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      // and no detached subtree stays referenced once the sheet is closed
      focusedRef.current = null;
    };
  }, [open]);
  const layoutRef = useRef(isMobile);
  useLayoutEffect(() => {
    if (layoutRef.current === isMobile) return;
    layoutRef.current = isMobile;
    const panel = panelRef.current;
    const last = focusedRef.current;
    if (!open || !panel || !last) return;
    refocus(snapshotOf(last.node, last.panel), panel);
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
