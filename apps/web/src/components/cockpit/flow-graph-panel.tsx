"use client";

import { motion } from "framer-motion";

export type Phase = { label: string; value: number };

const defaultPhases: Phase[] = [
  { label: "Leads", value: 24 },
  { label: "Conversations", value: 15 },
  { label: "Quotes Sent", value: 8 },
  { label: "Invoices Paid", value: 5 },
  { label: "Bookings", value: 5 },
];

export function FlowGraphPanel({ phases = defaultPhases, bottleneck }: { phases?: Phase[]; bottleneck?: string }) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-3 md:p-4 flex flex-col h-[420px] shadow-[var(--kf-shadow)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold">Business Graph</h2>
          <p className="text-[11px] text-muted-foreground">Visual flow from lead → revenue → booked time.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kf-mint)]/10 border border-[var(--kf-mint)]/50 px-2 py-0.5 text-[10px] text-[var(--kf-mint)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--kf-mint)] animate-pulse" />
          Stable throughput
        </span>
      </div>

      <div className="relative flex-1 mt-3">
        <div className="absolute inset-4 rounded-[2rem] bg-gradient-to-br from-primary/10 via-transparent to-accent/10 blur-2xl pointer-events-none" />

        <div className="relative h-full flex items-center justify-between px-4">
          {phases.map((phase, idx) => {
            const isBottleneck = bottleneck && phase.label === bottleneck;
            return (
              <motion.div
                key={phase.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="relative">
                  <div
                    className={`h-16 w-16 rounded-3xl flex flex-col items-center justify-center shadow-[0_12px_30px_rgba(15,23,42,0.08)] ${
                      isBottleneck
                        ? "bg-[var(--kf-amber)]/10 border border-[var(--kf-amber)]/70 text-[var(--kf-amber)]"
                        : "bg-background border border-border/70"
                    }`}
                  >
                    <span className="text-xs font-semibold">{phase.value}</span>
                    <span className="text-[9px] text-muted-foreground">{phase.label}</span>
                  </div>
                  {idx < phases.length - 1 && (
                    <div className="hidden md:block absolute left-1/2 top-1/2 translate-x-[52px] -translate-y-1/2 w-16 h-px bg-gradient-to-r from-primary/40 via-primary/80 to-accent/60">
                      <span className="block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Bottleneck: <span className="text-[var(--kf-amber)]">{bottleneck ?? "Quotes → Paid"}</span>
        </span>
        <button className="text-primary hover:underline">Ask AI to fix this</button>
      </div>
    </div>
  );
}
