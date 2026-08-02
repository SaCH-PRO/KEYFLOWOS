"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  Brain,
  Clock,
  GitBranch,
  Radar,
  Gauge,
  Scale,
  Waves,
  PenLine,
  Archive,
  Activity,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CognitionPhase } from "./use-key-cognition";

/**
 * KeyCognitionTrace — KEY's thinking, made watchable.
 *
 * Renders the consciousness pipeline as it runs: each cognitive layer appears
 * the moment it finishes, carrying what it actually concluded and how long it
 * actually took.
 *
 * The design constraint that matters here: nothing is invented for effect. Every
 * row corresponds to a step the server really ran, `ms` is measured server-side,
 * and a layer that reported nothing shows nothing rather than filler. A progress
 * display that embellishes is worse than none, because it teaches the user to
 * trust a signal that is not real.
 */

const LAYER_META: Record<
  string,
  { icon: typeof Brain; tint: string; blurb: string }
> = {
  emotion: {
    icon: Heart,
    tint: "text-rose-400",
    blurb: "Reading the emotional register of the question",
  },
  mindState: {
    icon: Brain,
    tint: "text-violet-400",
    blurb: "Choosing how to think about this",
  },
  temporal: {
    icon: Clock,
    tint: "text-sky-400",
    blurb: "Placing it against what came before",
  },
  interoception: {
    icon: Activity,
    tint: "text-cyan-400",
    blurb: "Checking which subsystems are healthy",
  },
  reasoning: {
    icon: GitBranch,
    tint: "text-amber-400",
    blurb: "Reasoning it through several ways at once",
  },
  intuition: {
    icon: Radar,
    tint: "text-teal-400",
    blurb: "Scanning for weak signals nobody asked about",
  },
  metacognition: {
    icon: Gauge,
    tint: "text-lime-400",
    blurb: "Checking how much to trust its own answer",
  },
  ethics: {
    icon: Scale,
    tint: "text-orange-400",
    blurb: "Reviewing whether this is right to recommend",
  },
  emotionalCalibration: {
    icon: Waves,
    tint: "text-pink-400",
    blurb: "Tuning how to say it",
  },
  synthesis: {
    icon: PenLine,
    tint: "text-emerald-400",
    blurb: "Composing the answer",
  },
  consolidate: {
    icon: Archive,
    tint: "text-slate-400",
    blurb: "Recording what it learned",
  },
};

const FALLBACK = { icon: Brain, tint: "text-muted-foreground", blurb: "" };

function pct(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n)
    ? `${Math.round(n * 100)}%`
    : null;
}

/**
 * Turn a layer's raw findings into one short line.
 *
 * Returns null when a layer genuinely found nothing to report — the row then
 * shows only its label, rather than padding with a vacuous phrase.
 */
function summarize(phase: CognitionPhase): string | null {
  const d = phase.detail ?? {};
  switch (phase.layer) {
    case "emotion": {
      const intensity = pct(d.intensity);
      return d.primary
        ? `${String(d.primary)}${intensity ? ` · ${intensity} intensity` : ""}`
        : null;
    }
    case "mindState":
      return d.mindState ? String(d.mindState) : null;
    case "temporal":
      return typeof d.contextChars === "number" && d.contextChars > 0
        ? "history considered"
        : "no prior signal";
    case "reasoning": {
      const modes = Array.isArray(d.modes) ? d.modes.length : d.chains;
      const conf = pct(d.bestConfidence);
      if (!d.bestMode) return null;
      return `${modes ?? "?"} chains · best: ${String(d.bestMode)}${conf ? ` @ ${conf}` : ""}`;
    }
    case "interoception": {
      const total = typeof d.total === "number" ? d.total : 0;
      const healthy = typeof d.healthy === "number" ? d.healthy : 0;
      const unreachable = typeof d.unreachable === "number" ? d.unreachable : 0;
      if (total === 0) return null;
      if (healthy === total) return `all ${total} subsystems healthy`;
      // Naming the count of impaired subsystems is the actionable part; a bare
      // percentage tells the user nothing they can do anything about.
      const impaired = total - healthy;
      return `${impaired}/${total} impaired${unreachable > 0 ? ` (${unreachable} unreachable)` : ""}`;
    }
    case "intuition": {
      const n = typeof d.signals === "number" ? d.signals : 0;
      return n === 0 ? "nothing anomalous" : `${n} weak signal${n === 1 ? "" : "s"}`;
    }
    case "metacognition": {
      const raw = pct(d.raw);
      const cal = pct(d.calibrated);
      if (!raw || !cal) return cal ?? raw;
      // Showing the adjustment is the honest part: it reveals KEY correcting
      // its own overconfidence rather than just asserting a number.
      return raw === cal ? `held at ${cal}` : `${raw} → ${cal}`;
    }
    case "ethics":
      return d.permitted === false ? "flagged for review" : "no concerns";
    case "emotionalCalibration": {
      const e = pct(d.empathy);
      return e ? `empathy ${e}` : null;
    }
    case "synthesis": {
      const actions = typeof d.actions === "number" ? d.actions : 0;
      return actions > 0
        ? `${actions} action${actions === 1 ? "" : "s"} proposed`
        : "no actions proposed";
    }
    case "consolidate":
      return typeof d.layersUsed === "number" ? `${d.layersUsed} layers engaged` : null;
    default:
      return null;
  }
}

interface KeyCognitionTraceProps {
  phases: CognitionPhase[];
  thinking: boolean;
  className?: string;
  /** Start expanded. Collapsed by default so the chat stays a chat. */
  defaultOpen?: boolean;
}

export function KeyCognitionTrace({
  phases,
  thinking,
  className,
  defaultOpen = false,
}: KeyCognitionTraceProps) {
  const [open, setOpen] = useState(defaultOpen);

  const totalMs = useMemo(
    () => (phases.length > 0 ? phases[phases.length - 1].elapsedMs : 0),
    [phases]
  );
  // The server sends the authoritative total on every phase; this fallback only
  // covers the window before the first phase arrives. LAYER_META is declared in
  // pipeline order, so its length is the right default.
  const expected = phases[0]?.of ?? Object.keys(LAYER_META).length;
  const current = phases[phases.length - 1];

  if (phases.length === 0 && !thinking) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/40 text-sm",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {thinking && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              thinking ? "bg-orange-500" : "bg-emerald-500"
            )}
          />
        </span>

        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {thinking
            ? (current?.label ?? "Thinking…")
            : `Thought for ${(totalMs / 1000).toFixed(1)}s`}
        </span>

        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {phases.length}/{expected}
        </span>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <ol className="space-y-0.5 border-t border-border/40 px-3 py-2">
              {phases.map((phase) => {
                const meta = LAYER_META[phase.layer] ?? FALLBACK;
                const Icon = meta.icon;
                const summary = summarize(phase);
                return (
                  <motion.li
                    key={`${phase.step}-${phase.layer}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2.5 py-1"
                  >
                    <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.tint)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {phase.label}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground/60">
                          {phase.ms}ms
                        </span>
                      </div>
                      {summary && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {summary}
                        </p>
                      )}
                    </div>
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500/70" />
                  </motion.li>
                );
              })}

              {thinking && phases.length < expected && (
                <li className="flex items-center gap-2.5 py-1 text-muted-foreground">
                  <span className="ml-[3px] h-2 w-2 animate-pulse rounded-full bg-muted-foreground/40" />
                  <span className="text-[11px] italic">
                    {LAYER_META[
                      Object.keys(LAYER_META)[phases.length]
                    ]?.blurb ?? "working…"}
                  </span>
                </li>
              )}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
