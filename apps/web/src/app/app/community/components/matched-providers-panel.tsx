"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, MessageSquare, ChevronDown, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { MatchedProvidersSnapshot } from "@/lib/client";
import { API_BASE } from "@/lib/api";

interface MatchedProvidersPanelProps {
  matchedProviders: MatchedProvidersSnapshot;
}

export function MatchedProvidersPanel({ matchedProviders }: MatchedProvidersPanelProps) {
  const [open, setOpen] = useState(false);
  const [emptyDismissed, setEmptyDismissed] = useState(false);
  const router = useRouter();

  const providers = Array.isArray(matchedProviders.providers) ? matchedProviders.providers : [];
  const count = providers.length;

  // Older snapshots persisted before pending/empty states existed don't carry a
  // `status` field — treat them as complete so they keep rendering as before.
  const status: "pending" | "complete" =
    matchedProviders.status === "pending" ? "pending" : "complete";

  if (status === "pending") {
    return (
      <div
        className="rounded-lg border border-[hsl(var(--kf-accent1))]/25 bg-[hsl(var(--kf-accent1))]/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full flex items-center gap-2 px-2.5 py-1.5">
          <Loader2 className="w-3 h-3 text-[hsl(var(--kf-accent1))] flex-shrink-0 animate-spin" />
          <span className="text-[11px] text-[hsl(var(--kf-accent1))] font-medium">
            Looking for providers who can help…
          </span>
        </div>
      </div>
    );
  }

  if (count === 0) {
    if (emptyDismissed) return null;
    return (
      <div
        className="rounded-lg border border-white/10 bg-white/[0.03]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full flex items-center gap-2 px-2.5 py-1.5">
          <Sparkles className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="text-[11px] text-muted-foreground">
            No matches found yet — we&apos;ll notify you when we find a fit
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEmptyDismissed(true);
            }}
            aria-label="Dismiss"
            className="ml-auto p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-[hsl(var(--kf-accent1))]/25 bg-[hsl(var(--kf-accent1))]/5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
        <span className="text-[11px] text-[hsl(var(--kf-accent1))] font-medium">
          We notified {count} {count === 1 ? "provider" : "providers"} who can help
        </span>
        <ChevronDown
          className={`w-3 h-3 text-[hsl(var(--kf-accent1))] ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2 space-y-1.5">
              {providers.map((p) => {
                const logo = p.logoUrl
                  ? p.logoUrl.startsWith("http")
                    ? p.logoUrl
                    : `${API_BASE}${p.logoUrl}`
                  : null;
                return (
                  <div
                    key={p.businessId}
                    className="flex items-center gap-2 p-1.5 rounded-md bg-white/5 border border-white/10"
                  >
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-[10px] overflow-hidden flex-shrink-0">
                      {logo ? (
                        <Image src={logo} alt={p.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                      ) : (
                        p.name?.[0] || "?"
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1" title={p.explanation}>
                        {p.explanation || p.headline || "Likely a good fit"}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/app/community?message=${p.businessId}`);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-[hsl(var(--kf-accent1))]/15 hover:bg-[hsl(var(--kf-accent1))]/25 text-[hsl(var(--kf-accent1))] text-[10px] font-medium transition-colors flex-shrink-0"
                      aria-label={`Message ${p.name}`}
                    >
                      <MessageSquare className="w-3 h-3" />
                      DM
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
