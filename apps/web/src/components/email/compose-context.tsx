"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ComposeModal, type ComposePrefill } from "./compose-modal";

interface ComposeContextValue {
  open: (prefill?: ComposePrefill & { onSent?: () => void }) => void;
  close: () => void;
  isOpen: boolean;
}

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error("useCompose must be used inside ComposeProvider");
  return ctx;
}

interface InternalState {
  isOpen: boolean;
  prefill: (ComposePrefill & { onSent?: () => void }) | undefined;
  setIsOpen: (v: boolean) => void;
  setPrefill: (p: (ComposePrefill & { onSent?: () => void }) | undefined) => void;
}

function DeepLinkBridge({ state }: { state: InternalState }) {
  const router = useRouter();
  const pathname = usePathname();

  // Open from ?compose=1
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("compose") === "1") {
      state.setPrefill({
        to: searchParams.get("to") ?? undefined,
        subject: searchParams.get("subject") ?? undefined,
      });
      state.setIsOpen(true);
    }
  }, [state]);

  // Strip compose query params when closed externally
  useEffect(() => {
    if (!state.isOpen) {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("compose")) {
        searchParams.delete("compose");
        searchParams.delete("to");
        searchParams.delete("subject");
        const qs = searchParams.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    }
  }, [state.isOpen, router, pathname]);

  return null;
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<(ComposePrefill & { onSent?: () => void }) | undefined>(undefined);

  const open = useCallback((p?: ComposePrefill & { onSent?: () => void }) => {
    setPrefill(p);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+Shift+M
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        setPrefill(undefined);
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  const bridgeState: InternalState = { isOpen, prefill, setIsOpen, setPrefill };

  const handleSent = useCallback(() => {
    prefill?.onSent?.();
  }, [prefill]);

  return (
    <ComposeContext.Provider value={value}>
      <Suspense fallback={null}>
        <DeepLinkBridge state={bridgeState} />
      </Suspense>
      {children}
      <ComposeModal open={isOpen} onClose={close} prefill={prefill} onSent={handleSent} />
    </ComposeContext.Provider>
  );
}
