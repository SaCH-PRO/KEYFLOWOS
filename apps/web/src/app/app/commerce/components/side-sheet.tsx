"use client";

import { Component, useEffect, useId, useLayoutEffect, useRef, useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
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
 * The control in the new shell that stands for one in the old shell (the header's Close): the same tag with the same
 * accessible label and text, when exactly one matches. The children and the footer are never matched this way: they
 * are the same nodes (P263 R3, R5 P274-2). Only a control that was in the shell when it was focused is looked up
 * (P273-1): a child removed before the flip is not stood in for by a shell control with its label.
 */
function shellCounterpart(old: HTMLElement, panel: HTMLElement, kept: Array<HTMLElement | null>): HTMLElement | null {
  const same = Array.from(panel.querySelectorAll<HTMLElement>(old.tagName)).filter(
    (el) => !kept.some((k) => k?.contains(el)) && el.getAttribute("aria-label") === old.getAttribute("aria-label") && el.textContent === old.textContent,
  );
  return same.length === 1 ? same[0] : null;
}
/**
 * Swallows the given focus events aimed at `target` for as long as it is held: listened for on window, in the capture
 * phase, so neither the target's own listeners nor React's see them. Returns the release.
 */
function swallowFocusEvents(target: HTMLElement, types: readonly string[]): () => void {
  const stop = (e: Event) => { if (e.target === target) e.stopImmediatePropagation(); };
  for (const t of types) window.addEventListener(t, stop, true);
  return () => { for (const t of types) window.removeEventListener(t, stop, true); };
}
const BLUR_EVENTS = ["blur", "focusout"] as const;
const FOCUS_EVENTS = ["focus", "focusin"] as const;

/**
 * P274-4: the overlays of the sheets that are open (SideSheet and QuickSheet). Escape closes only the topmost: the
 * last in document order, which is the one painted on top (a sheet opened inside another's children comes after it).
 */
const openOverlays = new Set<HTMLElement>();
function isTopmost(overlay: HTMLElement): boolean {
  for (const other of openOverlays) {
    if (other !== overlay && overlay.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) return false;
  }
  return true;
}
function useTopmostEscape(open: boolean, overlayRef: { current: HTMLElement | null }, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    if (overlay) openOverlays.add(overlay);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && overlay && isTopmost(overlay)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (overlay) openOverlays.delete(overlay);
    };
  }, [open, overlayRef, close]);
}

/**
 * Commit-phase hooks of an open sheet, rendered first in its overlay. `onOpen` runs when the overlay mounts, before
 * the children's own layout work (autoFocus): what had focus then is the opener (P274-3). `onBeforeSwap` runs in the
 * commit that swaps the shell for a new layout, before anything is removed (P274-1): React removes the old shell in
 * that commit, and Chromium fires blur on a focused child as it goes.
 */
class SheetCommitHooks extends Component<{ layout: string; onOpen: () => void; onBeforeSwap: () => void }> {
  componentDidMount() { this.props.onOpen(); }
  getSnapshotBeforeUpdate(prev: Readonly<{ layout: string }>) {
    if (prev.layout !== this.props.layout) this.props.onBeforeSwap();
    return null;
  }
  componentDidUpdate() {}
  render() { return null; }
}

/** The click-stop wrapper of a portaled part: it stops clicks at the sheet, and has no box of its own (P274-6). */
const stopClick = (e: { stopPropagation: () => void }) => e.stopPropagation();
const CONTENTS = { display: "contents" } as const;

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // P273-2: the sheet's own id, so two open sheets with the same title are each labelled by their own heading.
  const titleId = `sidesheet-title-${useId()}`;

  // P257 R1-1: onClose and closeDisabled are read through refs, so the focus and keydown effects below depend on
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

  // P274-4: Escape closes this sheet only when it is the topmost open one.
  useTopmostEscape(open, overlayRef, close);

  // P274-3: the opener is what had focus when the overlay mounted (SheetCommitHooks' onOpen), before a child's
  // autoFocus took it. The open frame focuses the panel only if focus is not already in it (a child's autoFocus is
  // kept), and a sheet closed before that frame does not take focus in it. Closing returns focus to the opener.
  const rememberOpener = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
  }, []);
  useEffect(() => {
    if (!open) return;
    if (!previousFocusRef.current) previousFocusRef.current = document.activeElement as HTMLElement | null; // reopened mid-exit
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const back = previousFocusRef.current;
      previousFocusRef.current = null;
      back?.focus();
    };
  }, [open]);

  // P263 R3: the panel is keyed by the layout, so a resize or rotation while open remounts the shell (the phone bottom
  // sheet or the desktop panel). The children and (R5 P274-2) the footer do not remount with it: each renders once,
  // through a portal, into a container this sheet owns, and the container is moved into the current shell's slot. On
  // a flip the same nodes, with their focus target, caret, typed values and component state, are carried over.
  // Removing the old shell drops the focus of a node in it, so the node focused before the flip is focused again
  // (exactly that node; no matching), and its caret and selection are put back. P274-1: the flip is not a blur: the
  // blur that removal fires (Chromium) and the focus that the refocus fires are swallowed, so neither the node's own
  // listeners nor React's onBlur and onFocus see them (a child's popover that closes on blur stays open). If the node
  // cannot be focused again (it became disabled), it is told that it lost focus. The header's Close is focused in the
  // new shell when one stands for it (P273-1: only if it was the shell's when it was focused), otherwise the panel
  // is. Focus outside the sheet is left alone.
  // The containers are made once, on the client only (the server has no document). The portals sit inside the
  // overlay, after the keyed panel: the overlay is not remounted by a flip, so in the React tree the children stay
  // under the sheet (R4): they read the sheet's own presence (a child's exit runs when the sheet closes; a caller's
  // AnimatePresence is not held by them), and their clicks stop at the sheet as the panel's do. A slot's ref puts its
  // container in place before the children's own layout effects run, so a child that measures itself, or autoFocus,
  // finds itself in the document on mount. The portals are rendered only once mounted on the client: a sheet rendered
  // open on the server has empty slots there, and hydrates to the same before the children are put in (R4-3).
  // P274-5: once the sheet has closed (its exit done) or unmounted, the containers are taken out of the old shell, so
  // nothing of it stays reachable from them. A sheet reopened during its exit is not reported as exit-complete
  // (framer-motion cancels that exit; pinned by R3's "reopened while it is still animating out").
  const [content] = useState<HTMLDivElement | null>(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const [footerContent] = useState<HTMLDivElement | null>(() => (typeof document === "undefined" ? null : document.createElement("div")));
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  /**
   * Set before the shell is swapped: what had focus (the old shell is still in place), whether it was a control of the
   * shell itself when it was focused, whether it had focus at that moment (so its removal blur is swallowed), its
   * caret, and the release of that swallowing.
   */
  const movedRef = useRef<{
    last: HTMLElement | null;
    inShell: boolean;
    hadFocus: boolean;
    selection: [number, number] | null;
    release: () => void;
  } | null>(null);
  // R2-4: a focus change only records the focused node (O(1)); nothing is read from the panel until a flip. P273-1:
  // and whether it is the shell's own control (in the panel, not among the children or the footer), read while it is
  // in place.
  const focusedRef = useRef<{ el: HTMLElement; inShell: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      const panel = panelRef.current;
      focusedRef.current = el && panel && panel.contains(el)
        ? { el, inShell: !content?.contains(el) && !footerContent?.contains(el) }
        : null;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      // and no detached subtree stays referenced once the sheet is closed
      focusedRef.current = null;
    };
  }, [open, content, footerContent]);
  const beforeSwap = useCallback(() => {
    const last = focusedRef.current?.el ?? null;
    const hadFocus = !!last && document.activeElement === last;
    // released by the layout effect of this same commit (a commit is not interrupted between the two)
    const release = hadFocus ? swallowFocusEvents(last, BLUR_EVENTS) : () => {};
    movedRef.current = { last, inShell: !!focusedRef.current?.inShell, hadFocus, selection: last ? selectionOf(last) : null, release };
  }, []);
  const attachSlot = useCallback((slot: HTMLDivElement | null) => {
    if (slot && content && content.parentNode !== slot) slot.appendChild(content);
  }, [content]);
  const attachFooterSlot = useCallback((slot: HTMLDivElement | null) => {
    if (slot && footerContent && footerContent.parentNode !== slot) slot.appendChild(footerContent);
  }, [footerContent]);
  useLayoutEffect(() => {
    const moved = movedRef.current;
    movedRef.current = null;
    if (!moved) return;
    moved.release();
    const { last, inShell, hadFocus, selection } = moved;
    const panel = panelRef.current;
    if (!open || !content || !last || !panel || document.activeElement === last) return;
    const kept = content.contains(last) || !!footerContent?.contains(last);
    if (kept) {
      const releaseFocus = hadFocus ? swallowFocusEvents(last, FOCUS_EVENTS) : () => {};
      try { last.focus(); } finally { releaseFocus(); }
    } else if (inShell && last !== panel && !last.isConnected) {
      shellCounterpart(last, panel, [content, footerContent])?.focus();
    }
    // A control that cannot take focus now (disabled) leaves focus on <body>: the panel takes it (P263 R1-4).
    if (!panel.contains(document.activeElement)) panel.focus();
    if (kept && hadFocus && document.activeElement !== last) {
      // its removal blur was swallowed, and it did not get focus back: it is told it lost focus (React hears this one)
      const relatedTarget = document.activeElement;
      last.dispatchEvent(new FocusEvent("blur", { relatedTarget }));
      last.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget }));
      return;
    }
    // The caret is put back explicitly: in Chromium focus() keeps an input's caret, so this is equivalent there (the
    // jsdom mutant survives for the same reason); WebKit and Firefox may move it on focus, so it is kept for them.
    if (selection && document.activeElement === last && (last instanceof HTMLInputElement || last instanceof HTMLTextAreaElement)) {
      try { last.setSelectionRange(selection[0], selection[1]); } catch { /* a type with no selection */ }
    }
  }); // every commit: the swap is handled in the commit that made it
  const detachContainers = useCallback(() => {
    content?.remove();
    footerContent?.remove();
  }, [content, footerContent]);
  // P274-5: unmounted (under StrictMode's simulated unmount the slots' refs put them back on the remount)
  useEffect(() => detachContainers, [detachContainers]);

  return (
    <AnimatePresence onExitComplete={detachContainers}>
      {open && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={isMobile ? "fixed inset-0 bg-black/50 backdrop-blur-sm z-[var(--kf-z-drawer)] flex items-end" : "fixed inset-0 bg-black/50 backdrop-blur-sm z-[var(--kf-z-drawer)]"}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <SheetCommitHooks layout={isMobile ? "phone" : "desktop"} onOpen={rememberOpener} onBeforeSwap={beforeSwap} />
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

              {footer && <div ref={attachFooterSlot} className="p-4 border-t border-border/40 shrink-0 bg-card pb-safe" />}
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

              {footer && <div ref={attachFooterSlot} className="p-4 border-t border-border/40 shrink-0 bg-card" />}
            </motion.div>
          )}
          {mounted && content && createPortal(<div style={CONTENTS} onClick={stopClick}>{children}</div>, content)}
          {mounted && footerContent && footer && createPortal(<div style={CONTENTS} onClick={stopClick}>{footer}</div>, footerContent)}
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
  // P274-4: Escape closes this sheet only when it is the topmost open one (a QuickSheet over a SideSheet closes alone).
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => { onCloseRef.current = onClose; });
  const close = useCallback(() => onCloseRef.current(), []);
  useTopmostEscape(open, overlayRef, close);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={overlayRef}
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
