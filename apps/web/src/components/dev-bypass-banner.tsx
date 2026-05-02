"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, ShieldAlert } from "lucide-react";
import {
  applyDevBypassToLocalStorage,
  getActiveDevProfile,
  isDevAuthBypassEnabled,
  KEYFLOW_DEV_PROFILES,
  switchDevProfile,
  type KeyflowDevProfile,
} from "@/lib/keyflow-dev-auth";

/**
 * Small fixed-position dev-mode badge that is only ever rendered when the
 * frontend dev-auth bypass flag is on. Its presence is the visible cue that
 * the current "session" is a seeded keyflowdev profile, not a real one. The
 * dropdown lets developers swap between role levels without restarting the
 * server.
 */
export function DevBypassBanner() {
  const [active, setActive] = useState(false);
  const [profile, setProfile] = useState<KeyflowDevProfile | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isDevAuthBypassEnabled()) return;
    applyDevBypassToLocalStorage();
    setProfile(getActiveDevProfile());
    setActive(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (!active || !profile) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[9999]"
    >
      {open && (
        <div
          role="menu"
          aria-label="Switch dev profile"
          className="mb-2 w-72 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-1.5 shadow-xl backdrop-blur"
        >
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-amber-300/80">
            Switch dev profile
          </div>
          <ul className="flex flex-col gap-0.5">
            {KEYFLOW_DEV_PROFILES.map((p) => {
              const isActive = p.key === profile.key;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      if (isActive) {
                        setOpen(false);
                        return;
                      }
                      switchDevProfile(p.key);
                    }}
                    className={`w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                      isActive
                        ? "bg-amber-500/20 text-amber-100"
                        : "text-zinc-200 hover:bg-zinc-800/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[10px] text-amber-300/80">
                        {p.userRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : p.membershipRole}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {p.email}
                    </div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">
                      {p.description}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] text-zinc-500">
            Tip: append <code className="text-zinc-300">?as=staff</code> to any URL.
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Dev auth bypass active — switch profile"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 shadow-lg backdrop-blur transition-colors hover:bg-amber-500/25"
      >
        <ShieldAlert className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
        <span className="tracking-tight">
          Dev: {profile.label}
          <span className="hidden sm:inline text-amber-200/70"> · {profile.email}</span>
        </span>
        <ChevronUp
          className={`h-3 w-3 text-amber-300/80 transition-transform ${open ? "" : "rotate-180"}`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
