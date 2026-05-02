"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  applyDevBypassToLocalStorage,
  isDevAuthBypassEnabled,
  KEYFLOW_DEV_USER_EMAIL,
} from "@/lib/keyflow-dev-auth";

/**
 * Small fixed-position dev-mode badge that is only ever rendered when the
 * frontend dev-auth bypass flag is on. Its presence is the visible cue that
 * the current "session" is the seeded keyflowdev profile, not a real one.
 */
export function DevBypassBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!isDevAuthBypassEnabled()) return;
    applyDevBypassToLocalStorage();
    setActive(true);
  }, []);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-label="Dev auth bypass active"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 shadow-lg backdrop-blur"
    >
      <ShieldAlert className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
      <span className="tracking-tight">
        Dev profile — keyflowdev
        <span className="hidden sm:inline text-amber-200/70"> · {KEYFLOW_DEV_USER_EMAIL}</span>
      </span>
    </div>
  );
}
