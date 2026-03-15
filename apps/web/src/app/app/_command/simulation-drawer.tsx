"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical,
  Play,
  Loader2,
  X,
  BarChart3,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import {
  runSimulation,
  fetchCashFlowForecast,
} from "@/lib/client";
import type { SimulationResult, CashFlowForecast } from "./types";
import { formatCurrency } from "./types";

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
        onClick={() => {
          setOpen(true);
          if (!forecast) handleRefreshForecast();
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 kf-radius-md text-xs font-medium transition-all hover:bg-muted/30 border border-border text-muted-foreground hover:text-foreground"
      >
        <FlaskConical className="w-3 h-3" />
        Simulator
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end"
          >
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />
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
                  <h2 className="kf-text-heading font-semibold">
                    Simulator & Forecast
                  </h2>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <div>
                  <h3 className="kf-text-caption font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    What-If Simulator
                  </h3>
                  <div className="flex gap-2 mb-3">
                    <input
                      value={simScenario}
                      onChange={(e) => setSimScenario(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleSimulate()
                      }
                      placeholder="e.g., Raise prices 20%"
                      className="flex-1 bg-muted/20 border border-border kf-radius-md px-3 py-2 text-xs focus:outline-none focus:border-muted-foreground/30 placeholder:text-muted-foreground/50"
                      disabled={simLoading || !businessId}
                    />
                    <button
                      onClick={handleSimulate}
                      disabled={
                        simLoading || !simScenario.trim() || !businessId
                      }
                      className="p-2 kf-radius-md transition-colors disabled:opacity-40"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.15)",
                      }}
                    >
                      {simLoading ? (
                        <Loader2
                          className="w-4 h-4 animate-spin"
                          style={{ color: "hsl(var(--kf-accent1))" }}
                        />
                      ) : (
                        <Play
                          className="w-4 h-4"
                          style={{ color: "hsl(var(--kf-accent1))" }}
                        />
                      )}
                    </button>
                  </div>
                  {simResult && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="kf-card p-3"
                    >
                      <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                        {simResult.simulation}
                      </p>
                    </motion.div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="kf-text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                      Cash Flow Forecast
                    </h3>
                    <button
                      onClick={handleRefreshForecast}
                      disabled={forecastLoading || !businessId}
                      className="flex items-center gap-1 px-2.5 py-1 kf-radius-md text-[10px] font-medium transition-colors disabled:opacity-40 bg-muted/30 border border-border hover:bg-muted/50"
                    >
                      <RefreshCw
                        className={forecastLoading ? "w-3 h-3 animate-spin" : "w-3 h-3"}
                      />
                      {forecast ? "Refresh" : "Load"}
                    </button>
                  </div>

                  {forecastLoading && !forecast ? (
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-10 kf-radius-md bg-muted/20 animate-pulse"
                        />
                      ))}
                    </div>
                  ) : forecast ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-muted/20 kf-radius-md p-3">
                          <p className="text-[9px] text-muted-foreground uppercase mb-0.5">
                            Balance
                          </p>
                          <p
                            className="text-sm font-bold"
                            style={{
                              color:
                                forecast.currentBalance >= 0
                                  ? "hsl(var(--kf-success))"
                                  : "hsl(var(--kf-error))",
                            }}
                          >
                            {formatCurrency(forecast.currentBalance)}
                          </p>
                        </div>
                        <div className="bg-muted/20 kf-radius-md p-3">
                          <p className="text-[9px] text-muted-foreground uppercase mb-0.5">
                            30-Day
                          </p>
                          <p
                            className="text-sm font-bold"
                            style={{
                              color:
                                forecast.projectedBalance >= 0
                                  ? "hsl(var(--kf-success))"
                                  : "hsl(var(--kf-error))",
                            }}
                          >
                            {formatCurrency(forecast.projectedBalance)}
                          </p>
                        </div>
                      </div>
                      {forecast.daysUntilNegative !== null && (
                        <div
                          className="kf-radius-md p-3 flex items-center gap-2"
                          style={{
                            background: "hsl(var(--kf-error) / 0.1)",
                            border: "1px solid hsl(var(--kf-error) / 0.2)",
                          }}
                        >
                          <AlertTriangle
                            className="w-4 h-4 flex-shrink-0"
                            style={{ color: "hsl(var(--kf-error))" }}
                          />
                          <p className="text-[11px]" style={{ color: "hsl(var(--kf-error))" }}>
                            Balance may go negative in{" "}
                            {forecast.daysUntilNegative} days
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 bg-muted/20 kf-radius-md p-3">
                        {forecast.trend === "up" ||
                        forecast.trend === "improving" ? (
                          <TrendingUp
                            className="w-4 h-4"
                            style={{ color: "hsl(var(--kf-success))" }}
                          />
                        ) : (
                          <TrendingDown
                            className="w-4 h-4"
                            style={{ color: "hsl(var(--kf-error))" }}
                          />
                        )}
                        <div>
                          <p className="text-[9px] text-muted-foreground">
                            Trend
                          </p>
                          <p className="text-xs font-medium capitalize">
                            {forecast.trend}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <BarChart3
                        className="w-8 h-8 mx-auto mb-2 opacity-20"
                        style={{ color: "hsl(var(--kf-accent2))" }}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Load your cash flow projections
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
