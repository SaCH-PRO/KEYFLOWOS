"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export type Phase = { label: string; value: number };

const defaultPhases: Phase[] = [
  { label: "Leads", value: 24 },
  { label: "Conversations", value: 15 },
  { label: "Quotes Sent", value: 8 },
  { label: "Invoices Paid", value: 5 },
  { label: "Bookings", value: 5 },
];

export function FlowGraphPanel({ phases = defaultPhases, bottleneck }: { phases?: Phase[]; bottleneck?: string }) {
  const maxValue = Math.max(...phases.map(p => p.value), 1);
  
  return (
    <div className="kf-card p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Business Flow</h2>
          <p className="text-sm text-muted-foreground">Your conversion funnel, live</p>
        </div>
        <span className="kf-badge kf-badge-primary">
          <span 
            className="h-1.5 w-1.5 rounded-full mr-1.5 animate-pulse"
            style={{ background: "hsl(var(--kf-accent1))" }}
          />
          Live
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-3">
        {phases.map((phase, idx) => {
          const isBottleneck = bottleneck && phase.label === bottleneck;
          const width = Math.max((phase.value / maxValue) * 100, 15);
          
          return (
            <motion.div
              key={phase.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.08 }}
              className="flex items-center gap-3"
            >
              <div className="w-24 text-sm text-muted-foreground truncate">
                {phase.label}
              </div>
              
              <div className="flex-1 h-10 bg-muted rounded-xl overflow-hidden relative">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ delay: idx * 0.1, duration: 0.5, ease: "easeOut" }}
                  className="h-full rounded-xl flex items-center justify-end px-3"
                  style={{ 
                    background: isBottleneck 
                      ? "linear-gradient(90deg, hsl(var(--kf-accent2) / 0.8), hsl(var(--kf-accent2)))"
                      : "linear-gradient(90deg, hsl(var(--kf-accent1) / 0.7), hsl(var(--kf-accent1)))"
                  }}
                >
                  <span className="text-white text-sm font-bold">{phase.value}</span>
                </motion.div>
                
                {isBottleneck && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium px-2 py-0.5 rounded-full bg-background/80 text-accent2" style={{ color: "hsl(var(--kf-accent2))" }}>
                    Bottleneck
                  </div>
                )}
              </div>
              
              {idx < phases.length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </motion.div>
          );
        })}
      </div>
      
      {bottleneck && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>{bottleneck}</span> is your current bottleneck. Focus here to improve flow.
          </p>
        </div>
      )}
    </div>
  );
}
