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
    <div className="rounded-3xl border border-border/60 bg-slate-950/80 backdrop-blur-xl p-3 md:p-4 flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold">Business Graph</h2>
          <p className="text-[11px] text-muted-foreground">Visual flow from lead → revenue → booked time.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Stable throughput
        </span>
      </div>

      <div className="relative flex-1 mt-3">
        <div className="absolute inset-4 rounded-[2rem] bg-gradient-to-br from-primary/10 via-slate-900/80 to-emerald-500/5 blur-2xl pointer-events-none" />

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
                    className={`h-16 w-16 rounded-3xl flex flex-col items-center justify-center shadow-soft-elevated ${
                      isBottleneck
                        ? "bg-amber-500/10 border border-amber-400/70 text-amber-100"
                        : "bg-slate-950 border border-border/70"
                    }`}
                  >
                    <span className="text-xs font-semibold">{phase.value}</span>
                    <span className="text-[9px] text-muted-foreground">{phase.label}</span>
                  </div>
                  {idx < phases.length - 1 && (
                    <div className="hidden md:block absolute left-1/2 top-1/2 translate-x-[52px] -translate-y-1/2 w-16 h-px bg-gradient-to-r from-primary/40 via-primary/80 to-emerald-400/60">
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
          Bottleneck: <span className="text-amber-300">{bottleneck ?? "Quotes → Paid"}</span>
        </span>
        <button className="text-primary hover:underline">Ask AI to fix this</button>
      </div>
    </div>
  );
}
