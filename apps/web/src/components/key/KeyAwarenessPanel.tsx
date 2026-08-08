"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Radar,
  UserMinus,
  Lightbulb,
  Moon,
  BookOpen,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  TrendingUp,
  PlugZap,
} from "lucide-react";
import { getApiBase } from "@/lib/api-base";
import { fetchWithAuthRetry } from "@/lib/api";
import { cn } from "@/lib/utils";

const API_BASE = getApiBase();

/**
 * What KEY noticed on its own, without being asked.
 *
 * The proactive layers record weak signals, churn predictions, ideas and
 * reflection cycles on a schedule. Until this panel existed, nothing read any
 * of it back — KEY was noticing into a drawer nobody opens.
 *
 * Two deliberate choices:
 *
 *  1. NO MOCK FALLBACK. A sibling component falls back to invented data when
 *     its fetch fails. Doing that here would show fabricated "signals" as
 *     things KEY had genuinely observed about the business, which is the exact
 *     dishonesty this feature exists to avoid. An error says error; an empty
 *     feed says empty.
 *
 *  2. Confidence is shown, never hidden. These are weak signals by definition —
 *     presenting them at uniform certainty would misrepresent what they are.
 */

type AwarenessKind =
  | "weakSignal"
  | "churnRisk"
  | "idea"
  | "reflection"
  | "hypothesis"
  | "concern"
  | "momentum"
  | "integration";

interface AwarenessItem {
  id: string;
  kind: AwarenessKind;
  headline: string;
  suggestedAction?: string;
  confidence: number;
  noticedAt: string;
  detail?: Record<string, unknown>;
}

interface AwarenessResponse {
  items: AwarenessItem[];
  counts: Record<string, number>;
  latestAt: string | null;
}

const KIND_META: Record<
  AwarenessKind,
  { label: string; icon: typeof Radar; tint: string; ring: string }
> = {
  // An automated intake that has stopped working, or gone quiet long enough
  // that it probably has. Amber rather than red: it is usually a reconnect,
  // not an incident — but it must not read as informational, because the
  // failure it reports is one that produces no other symptom until year end.
  integration: {
    label: "Intake",
    icon: PlugZap,
    tint: "text-orange-400",
    ring: "ring-orange-500/20",
  },
  weakSignal: {
    label: "Weak signal",
    icon: Radar,
    tint: "text-teal-400",
    ring: "ring-teal-500/20",
  },
  churnRisk: {
    label: "Churn risk",
    icon: UserMinus,
    tint: "text-rose-400",
    ring: "ring-rose-500/20",
  },
  idea: {
    label: "Idea",
    icon: Lightbulb,
    tint: "text-amber-400",
    ring: "ring-amber-500/20",
  },
  reflection: {
    label: "Reflection",
    icon: BookOpen,
    tint: "text-sky-400",
    ring: "ring-sky-500/20",
  },
  concern: {
    label: "Concern",
    icon: AlertTriangle,
    tint: "text-rose-400",
    ring: "ring-rose-500/20",
  },
  momentum: {
    label: "Momentum",
    icon: TrendingUp,
    tint: "text-emerald-400",
    ring: "ring-emerald-500/20",
  },
  hypothesis: {
    label: "Hypothesis",
    icon: Moon,
    tint: "text-violet-400",
    ring: "ring-violet-500/20",
  },
};

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

interface KeyAwarenessPanelProps {
  businessId: string;
  className?: string;
  /** Cap the rows rendered. The API is already bounded server-side. */
  limit?: number;
}

export function KeyAwarenessPanel({
  businessId,
  className,
  limit = 12,
}: KeyAwarenessPanelProps) {
  const [items, setItems] = useState<AwarenessItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<AwarenessKind | "all">("all");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuthRetry(
        `${API_BASE}/api/v1/cortex/awareness?businessId=${encodeURIComponent(businessId)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`Could not load (HTTP ${res.status})`);
      const data = (await res.json()) as AwarenessResponse;
      setItems(data.items ?? []);
      setCounts(data.counts ?? {});
    } catch (err) {
      // Deliberately no mock fallback — see the note at the top of this file.
      setError((err as Error).message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)).slice(0, limit),
    [items, filter, limit],
  );

  const kindsPresent = useMemo(
    () => (Object.keys(KIND_META) as AwarenessKind[]).filter((k) => (counts[k] ?? 0) > 0),
    [counts],
  );

  return (
    <div className={cn("rounded-2xl border border-border/50 bg-card/40", className)}>
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
        <Radar className="h-4 w-4 shrink-0 text-teal-400" />
        <div className="min-w-0 flex-1">
          {/* Deliberately NOT "What KEY noticed" — KeyNoticedStream already
              uses that heading for a different source (live module-event
              insights from ProAutoMonitor). Two panels with the same title
              showing different data is worse than either alone. */}
          <h3 className="text-sm font-semibold">Signals &amp; predictions</h3>
          <p className="text-xs text-muted-foreground">
            From KEY&apos;s background scans, not this conversation
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {kindsPresent.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All {items.length}
          </FilterChip>
          {kindsPresent.map((k) => (
            <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
              {KIND_META[k].label} {counts[k]}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="px-4 py-3">
        {loading && items.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">{error}</p>
              <p className="text-[11px] text-muted-foreground">
                Nothing is shown rather than placeholder data.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-xs text-muted-foreground">
              KEY hasn&apos;t flagged anything yet.
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              It scans for weak signals every 10 minutes and reviews churn risk daily.
            </p>
          </div>
        )}

        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {visible.map((item) => {
              const meta = KIND_META[item.kind] ?? KIND_META.weakSignal;
              const Icon = meta.icon;
              const isOpen = expanded === item.id;

              return (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg border border-transparent transition-colors hover:border-border/40 hover:bg-muted/30"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className="flex w-full items-start gap-2.5 px-2 py-2 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className={cn("mt-0.5 rounded-md p-1 ring-1", meta.ring)}>
                      <Icon className={cn("h-3 w-3", meta.tint)} />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-snug text-foreground">
                        {item.headline}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{meta.label}</span>
                        <span aria-hidden>·</span>
                        {/* Confidence is always visible: these are weak signals
                            by definition, and hiding uncertainty would
                            misrepresent what they are. */}
                        <span className="tabular-nums">
                          {Math.round(item.confidence * 100)}% confident
                        </span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(item.noticedAt)}</span>
                      </span>
                    </span>

                    {item.suggestedAction && (
                      <ChevronDown
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && item.suggestedAction && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <p className="px-2 pb-2 pl-9 text-[11px] leading-relaxed text-muted-foreground">
                          <span className="font-medium text-foreground/80">
                            KEY suggests:{" "}
                          </span>
                          {item.suggestedAction}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-teal-500/30 bg-teal-500/10 text-teal-300"
          : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
