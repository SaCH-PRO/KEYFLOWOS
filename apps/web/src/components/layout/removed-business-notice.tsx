"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { listMyBusinesses, selectBusiness, type CachedBusiness } from "@/lib/workspace";
import {
  BUSINESS_REMOVED_EVENT,
  dismissRemovedBusinessNotice,
  getRemovedBusinessNotice,
  type RemovedBusinessNotice as Notice,
} from "@/lib/removed-business-notice";

/**
 * SWP-REMOVED-MEMBER-NOTICE (BUG-117, journey J8): a lasting notice, mounted by the app shell, telling a member who
 * lost access to a business that they did, by name, with the businesses they still have. It stays until dismissed
 * (it is not a toast) and appears as soon as workspace.ts announces a removal.
 */
export function RemovedBusinessNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [remaining, setRemaining] = useState<CachedBusiness[]>([]);

  useEffect(() => {
    const read = () => setNotice(getRemovedBusinessNotice());
    read();
    window.addEventListener(BUSINESS_REMOVED_EVENT, read);
    return () => window.removeEventListener(BUSINESS_REMOVED_EVENT, read);
  }, []);

  useEffect(() => {
    if (!notice) return;
    let cancelled = false;
    void listMyBusinesses().then((list) => {
      if (!cancelled) setRemaining((list ?? []).filter((b) => b.id !== notice.id));
    });
    return () => {
      cancelled = true;
    };
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      role="alert"
      className="mx-3 md:mx-6 mt-2 rounded-xl border border-[hsl(var(--kf-warning)/0.4)] bg-[hsl(var(--kf-warning)/0.08)] px-4 py-3 text-sm flex items-start gap-3"
    >
      <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0 text-[hsl(var(--kf-warning))]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">
          {notice.name ? <>You no longer have access to {notice.name}.</> : <>You no longer have access to a business you were working in.</>}
        </p>
        <p className="text-muted-foreground mt-0.5">
          {notice.name ?? "Its"} owner removed you from the team. Ask them if you think this is a mistake.
        </p>
        {remaining.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Your businesses:</span>
            {remaining.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBusiness(b.id)}
                className="rounded-lg border border-border px-2.5 py-1 min-h-[44px] sm:min-h-[32px] hover:bg-muted/40"
              >
                Open {b.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          dismissRemovedBusinessNotice();
          setNotice(null);
        }}
        className="rounded-lg p-2 min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
