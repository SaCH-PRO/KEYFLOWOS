"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { BrainCircuit, Users, Radar, Fuel as FuelIcon } from "lucide-react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Mission Control hero — the "business ship" console (audit §7.4):
 *   Hull Integrity = Genome, Fuel = Cash, Crew = People, Radar = Temporal.
 * Each vital is tappable and drills into its module. All fetches race a 12s
 * timeout and degrade to "—" rather than blocking the console.
 */

interface Vital {
  label: string;
  value: string;
  caption: string;
  tone: "good" | "warn" | "bad" | "muted";
  href: string;
}

const TONE_TEXT: Record<Vital["tone"], string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-rose-400",
  muted: "text-muted-foreground",
};

const TONE_RING: Record<Vital["tone"], string> = {
  good: "stroke-emerald-400",
  warn: "stroke-amber-400",
  bad: "stroke-rose-400",
  muted: "stroke-muted-foreground/40",
};

function raceTimeout<T>(p: Promise<{ data: T | null; error: string | null }>, ms = 12_000) {
  return Promise.race([
    p,
    new Promise<{ data: null; error: string }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: "timeout" }), ms),
    ),
  ]);
}

function HullRing({ score, tone }: { score: number; tone: Vital["tone"] }) {
  const pct = Math.max(0, Math.min(100, score));
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-border/40" />
      <motion.circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className={TONE_RING[tone]}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
        transition={{ duration: 1.4, ease: "easeOut", delay: 0.2 }}
        style={{ strokeDasharray: circ }}
      />
    </svg>
  );
}

function RadarSweep({ active }: { active: boolean }) {
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded-full border border-border/40 bg-background/60">
      <div className="absolute inset-0 rounded-full border border-border/20" />
      <div className="absolute inset-2 rounded-full border border-border/20" />
      <div
        className={cn(
          "absolute inset-0 rounded-full",
          active ? "animate-[spin_3s_linear_infinite]" : "animate-[spin_8s_linear_infinite]",
        )}
        style={{
          background:
            "conic-gradient(from 0deg, rgba(52,211,153,0.5), transparent 60deg, transparent 360deg)",
        }}
      />
      {active && (
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-rose-400" />
      )}
    </div>
  );
}

function VitalCard({ vital, visual }: { vital: Vital; visual: React.ReactNode }) {
  return (
    <Link
      href={vital.href}
      className="group flex items-center gap-3 rounded-2xl border border-border/40 bg-card/50 px-4 py-3 transition-all hover:border-primary/30 hover:bg-card/80 active:scale-[0.98]"
    >
      <div className="shrink-0">{visual}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{vital.label}</p>
        <p className={cn("truncate font-display text-lg font-semibold", TONE_TEXT[vital.tone])}>{vital.value}</p>
        <p className="truncate text-[10px] text-muted-foreground">{vital.caption}</p>
      </div>
    </Link>
  );
}

export function MissionControlHero({ businessId, hullScore }: { businessId: string; hullScore: number }) {
  const [fuel, setFuel] = useState<{ safeToSpend: number; currency: string } | null>(null);
  const [crew, setCrew] = useState<{ count: number; avgScore: number } | null>(null);
  const [radar, setRadar] = useState<{ todayTotal: number; overdue: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [safeRes, crewRes, temporalRes] = await Promise.all([
        raceTimeout(apiGet<{ safeToSpend: number; currency?: string }>(`/finance/businesses/${businessId}/safe-to-spend`)),
        raceTimeout(
          apiGet<Array<{ overallScore: number }>>(`/staff-performance/businesses/${businessId}/team-summary`),
        ),
        raceTimeout(
          apiGet<{ today?: { bookings?: number; tasksDue?: number; events?: number; tasksOverdue?: number } }>(
            `/temporal/businesses/${businessId}/overview`,
          ),
        ),
      ]);
      if (cancelled) return;
      if (safeRes.data) setFuel({ safeToSpend: safeRes.data.safeToSpend, currency: safeRes.data.currency ?? "TTD" });
      if (Array.isArray(crewRes.data)) {
        const scores = crewRes.data.map((s) => s.overallScore ?? 0);
        setCrew({
          count: scores.length,
          avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        });
      }
      if (temporalRes.data?.today) {
        const t = temporalRes.data.today;
        setRadar({
          todayTotal: (t.bookings ?? 0) + (t.tasksDue ?? 0) + (t.events ?? 0),
          overdue: t.tasksOverdue ?? 0,
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const hullTone: Vital["tone"] = hullScore >= 70 ? "good" : hullScore >= 40 ? "warn" : "bad";
  const fuelTone: Vital["tone"] = !fuel ? "muted" : fuel.safeToSpend > 0 ? "good" : "warn";
  const crewTone: Vital["tone"] = !crew ? "muted" : crew.avgScore >= 70 ? "good" : crew.avgScore >= 40 ? "warn" : "bad";
  const radarTone: Vital["tone"] = !radar ? "muted" : radar.overdue > 0 ? "bad" : radar.todayTotal > 0 ? "good" : "muted";

  const vitals = useMemo<Vital[]>(
    () => [
      {
        label: "Hull Integrity",
        value: `${Math.round(hullScore)}%`,
        caption: "Genome completeness",
        tone: hullTone,
        href: "/app/genome",
      },
      {
        label: "Fuel",
        value: fuel ? `${fuel.currency} ${Math.round(fuel.safeToSpend).toLocaleString()}` : "—",
        caption: "Safe to spend",
        tone: fuelTone,
        href: "/app/financial-flow",
      },
      {
        label: "Crew",
        value: crew ? `${crew.count}` : "—",
        caption: crew ? `avg score ${crew.avgScore}%` : "staff positions",
        tone: crewTone,
        href: "/app/performance",
      },
      {
        label: "Radar",
        value: radar ? `${radar.todayTotal} today` : "—",
        caption: radar && radar.overdue > 0 ? `${radar.overdue} overdue!` : "temporal flow",
        tone: radarTone,
        href: "/app/temporal-flow",
      },
    ],
    [hullScore, hullTone, fuel, fuelTone, crew, crewTone, radar, radarTone],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      aria-label="Mission control vitals"
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <VitalCard vital={vitals[0]} visual={<HullRing score={hullScore} tone={hullTone} />} />
      <VitalCard vital={vitals[1]} visual={<FuelIcon className={cn("h-8 w-8", TONE_TEXT[fuelTone])} />} />
      <VitalCard vital={vitals[2]} visual={<Users className={cn("h-8 w-8", TONE_TEXT[crewTone])} />} />
      <VitalCard vital={vitals[3]} visual={<RadarSweep active={!!radar && radar.overdue > 0} />} />
    </motion.section>
  );
}
