"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FlaskConical, Play, Loader2, X } from "lucide-react";
import { runSimulation, fetchCashFlowForecast } from "@/lib/client";
import type { SimulationResult, CashFlowForecast } from "./types";
import { ForecastPanel } from "./forecast-panel";

interface SimulationDrawerProps {
  businessId: string | null;
}

export function SimulationDrawer({ businessId }: SimulationDrawerProps) {
  const [open, setOpen] = useState(false);
  const [simScenario, setSimScenario] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const handleSimulate = useCallback(async () => {
    if (!businessId || !simScenario.trim() || simLoading) return;
    setSimLoading(true);
    try {
      const res = await runSimulation(businessId, simScenario.trim());
      if (res.data) setSimResult(res.data);
    } catch {}
    setSimLoading(false);
  }, [businessId, simScenario, simLoading]);

  const handleRefreshForecast = useCallback(async () => {
    if (!businessId || forecastLoading) return;
    setForecastLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId);
      if (res.data) setForecast(res.data);
    } catch {}
    setForecastLoading(false);
  }, [businessId, forecastLoading]);

  return (
    <>
      <button
        onClick={() => { setOpen(true); if (!forecast) handleRefreshForecast(); }}
        className="flex items-center gap-1.5 px-3 py-1.5 kf-radius-md text-xs font-medium transition-all hover:bg-muted/30 border border-border text-muted-foreground hover:text-foreground"
      >
        <FlaskConical className="w-3 h-3" />
        Simulator
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0" style={{ background: "hsl(var(--kf-background) / 0.6)" }} onClick={() => setOpen(false)} />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <h2 className="kf-text-heading font-semibold">Simulator & Forecast</h2>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <div>
                  <h3 className="kf-text-caption font-semibold uppercase tracking-wider text-muted-foreground mb-3">What-If Simulator</h3>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={simScenario}
                      onChange={(e) => setSimScenario(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
                      placeholder="e.g., Raise prices 20%"
                      className="flex-1 bg-muted/20 border border-border kf-radius-md px-3 py-2 text-xs focus:outline-none focus:border-muted-foreground/30 placeholder:text-muted-foreground/50"
                      disabled={simLoading || !businessId}
                    />
                    <button
                      onClick={handleSimulate}
                      disabled={simLoading || !simScenario.trim() || !businessId}
                      className="p-2 kf-radius-md transition-colors disabled:opacity-40"
                      style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
                    >
                      {simLoading
                        ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
                        : <Play className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                      }
                    </button>
                  </div>
                  {simResult && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="kf-card p-3">
                      <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">{simResult.simulation}</p>
                    </motion.div>
                  )}
                </div>
                <ForecastPanel forecast={forecast} loading={forecastLoading} onRefresh={handleRefreshForecast} disabled={!businessId} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
