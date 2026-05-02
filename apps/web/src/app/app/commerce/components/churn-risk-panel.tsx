"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AiBadge } from "@/components/ui/ai-badge";
import {
  AlertTriangle,
  UserX,
  TrendingDown,
  Clock,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Shield,
} from "lucide-react";
import { commerceAiChurnRisk, type CommerceChurnRisk } from "@/lib/client";

interface ChurnRiskPanelProps {
  businessId: string | null;
}

const RISK_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/15 border-red-500/30",
  high: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  medium: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  low: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
};

export function ChurnRiskPanel({ businessId }: ChurnRiskPanelProps) {
  const [data, setData] = useState<CommerceChurnRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commerceAiChurnRisk(businessId);
      if (res.data) setData(res.data);
    } catch {
      setError("Failed to analyze churn risk. Please try again.");
    }
    setLoading(false);
  }, [businessId]);

  if (!data && !loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-orange-500/10">
            <UserX className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">Churn Risk Alerts <AiBadge label="AI" compact /></h3>
            <p className="text-xs text-muted-foreground">Detect declining payment patterns in recurring customers</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{error}</p>}
        <button
          onClick={analyze}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          <Sparkles className="w-4 h-4" />
          Scan for Churn Risk
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-8 flex flex-col items-center">
        <Loader2 className="w-6 h-6 animate-spin text-orange-400 mb-3" />
        <p className="text-sm text-muted-foreground">Analyzing recurring customers...</p>
      </div>
    );
  }

  if (!data) return null;

  if (data.alerts.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">No Churn Risk Detected</h3>
            <p className="text-xs text-muted-foreground">All recurring customers look healthy</p>
          </div>
        </div>
        <button onClick={analyze} className="text-xs text-muted-foreground hover:text-foreground">Scan again</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Churn Risk Alerts</h3>
              <p className="text-xs text-muted-foreground">{data.alerts.length} customers at risk</p>
            </div>
          </div>
          <button onClick={analyze} className="text-xs text-muted-foreground hover:text-foreground">Refresh</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-orange-400">{data.summary.totalAtRisk}</p>
            <p className="text-[10px] text-muted-foreground">At Risk</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-red-400">${data.summary.revenueAtRisk.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Revenue at Risk</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-red-400">{data.summary.criticalCount}</p>
            <p className="text-[10px] text-muted-foreground">Critical</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-orange-400">{data.summary.highCount}</p>
            <p className="text-[10px] text-muted-foreground">High Risk</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border/20">
        {data.alerts.map((alert) => {
          const isExpanded = expanded === alert.contactId;
          return (
            <div key={alert.contactId} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : alert.contactId)}
                className="w-full flex items-center gap-3 text-left"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${alert.riskLevel === "critical" ? "bg-red-400" : alert.riskLevel === "high" ? "bg-orange-400" : alert.riskLevel === "medium" ? "bg-amber-400" : "bg-emerald-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{alert.contactName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${RISK_COLORS[alert.riskLevel] ?? RISK_COLORS.medium}`}>
                      {alert.riskLevel}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">${alert.monthlyRevenue.toLocaleString()}/mo · {alert.urgency.replace(/_/g, " ")}</p>
                </div>
                <div className="text-sm font-bold shrink-0">{alert.riskScore}%</div>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {alert.signals.map((signal, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-300">
                            <TrendingDown className="w-2.5 h-2.5" /> {signal}
                          </span>
                        ))}
                      </div>
                      <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                        <p className="text-xs font-medium text-orange-300">{alert.recommendedAction}</p>
                        {alert.lastPaymentDate && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            <Clock className="w-2.5 h-2.5 inline mr-1" />Last payment: {new Date(alert.lastPaymentDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {data.retentionStrategies.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30 bg-orange-500/5 space-y-1">
          {data.retentionStrategies.map((strategy, i) => (
            <p key={i} className="text-xs text-orange-300 flex items-start gap-1.5">
              <Shield className="w-3 h-3 mt-0.5 shrink-0" /> {strategy}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
