"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CONSENT_KEY = "cookie-consent";

type ConsentValue = "all" | "essential" | null;

export function CookieConsentBanner() {
  const [consent, setConsent] = useState<ConsentValue>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
      try {
        const stored = localStorage.getItem(CONSENT_KEY);
        if (stored === "all" || stored === "essential") {
          setConsent(stored);
        }
      } catch {
        // localStorage may be blocked
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const save = (value: ConsentValue) => {
    try {
      if (value) localStorage.setItem(CONSENT_KEY, value);
      else localStorage.removeItem(CONSENT_KEY);
    } catch {
      // ignore
    }
    setConsent(value);
  };

  if (!mounted || consent !== null) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-lg",
        "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3",
      )}
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
    >
      <p className="text-xs text-slate-700 leading-relaxed max-w-2xl">
        We use cookies to improve your experience and analyze traffic. Choose &quot;Accept all&quot; to enable analytics and
        tracking, or &quot;Essential only&quot; for core functionality.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => save("essential")}
          className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => save("all")}
          className="px-3 py-1.5 rounded-md bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}

export function getCookieConsent(): ConsentValue {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === "all" || stored === "essential") return stored;
  } catch {
    // ignore
  }
  return null;
}
