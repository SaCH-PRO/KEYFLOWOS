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
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">Business Graph</h2>
          <p className="text-xs text-muted-foreground">Visual flow from lead → revenue → booked time.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 px-2.5 py-1 text-[10px] text-primary font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Stable throughput
        </span>
      </div>

      <div className="relative flex-1 mt-2">
        <div 
          className="absolute inset-4 rounded-2xl blur-3xl pointer-events-none opacity-20"
          style={{ background: `linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))` }}
        />

        <div className="relative h-full flex items-center justify-between px-2 md:px-4">
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
                    className={`h-16 w-16 md:h-18 md:w-18 rounded-2xl flex flex-col items-center justify-center ${
                      isBottleneck
                        ? "bg-accent/10 border-2 border-accent/60"
                        : "bg-muted border border-border"
                    }`}
                  >
                    <span className="text-sm font-bold">{phase.value}</span>
                    <span className="text-[9px] text-muted-foreground text-center px-1">{phase.label}</span>
                  </div>
                  {idx < phases.length - 1 && (
                    <div 
                      className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 w-8 h-0.5 ml-1"
                      style={{ background: `linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))` }}
                    >
                      <span 
                        className="absolute right-0 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full"
                        style={{ background: "hsl(var(--kf-accent2))" }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
        <span>
          Bottleneck: <span className="text-accent font-medium">{bottleneck ?? "Quotes → Paid"}</span>
        </span>
        <button className="text-primary hover:underline font-medium">Ask AI to fix this</button>
      </div>
    </div>
  );
}
