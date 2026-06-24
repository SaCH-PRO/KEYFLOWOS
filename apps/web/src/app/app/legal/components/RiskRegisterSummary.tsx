"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Loader2, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { generateRiskRegister } from "@/lib/api/business-genesis";

interface Risk {
  id: string;
  title: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  LOW: "hsl(var(--kf-info))",
  MEDIUM: "hsl(var(--kf-warning))",
  HIGH: "hsl(var(--kf-error))",
  CRITICAL: "hsl(var(--kf-error))",
};

const SEVERITY_BG: Record<string, string> = {
  LOW: "hsl(var(--kf-info) / 0.1)",
  MEDIUM: "hsl(var(--kf-warning) / 0.1)",
  HIGH: "hsl(var(--kf-error) / 0.1)",
  CRITICAL: "hsl(var(--kf-error) / 0.15)",
};

export function RiskRegisterSummary() {
  const [businessId] = useState<string | null>(() => getStoredBusinessId());
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(() => !businessId);
  const [generating, setGenerating] = useState(false);

  const loadRisks = useCallback(async () => {
    const bid = businessId;
    if (!bid) return;
    const { data } = await apiGet<Risk[]>(`/governance/businesses/${bid}/risks?status=OPEN`);
    if (data) setRisks(data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    Promise.resolve().then(() => loadRisks());
  }, [loadRisks]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const { data, error } = await generateRiskRegister(businessId);
    setGenerating(false);
    if (error || !data) {
      toast.error(error || "Could not generate risk register.");
      return;
    }
    toast.success(`Created ${data.length} risk${data.length === 1 ? "" : "s"} from your blueprint.`);
    void loadRisks();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-4 sm:p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" style={{ color: "hsl(var(--kf-error))" }} />
          Risk register
        </h3>
        {!loading && risks.length > 0 && (
          <span className="text-xs font-medium text-muted-foreground">
            {risks.length} open risk{risks.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading risks...
        </div>
      ) : risks.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground py-2">
            No open risks yet. Generate them from your blueprint to track what needs attention.
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="kf-btn-secondary flex items-center gap-2 px-4 py-2 text-xs"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Generate from blueprint
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {risks.map((risk) => {
              const severity = risk.severity || "MEDIUM";
              const Icon = severity === "CRITICAL" || severity === "HIGH" ? AlertTriangle : AlertCircle;
              return (
                <li
                  key={risk.id}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                  style={{
                    background: SEVERITY_BG[severity],
                    borderColor: `hsl(var(--kf-border) / 0.3)`,
                  }}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: SEVERITY_COLOR[severity] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium">{risk.title}</p>
                      <span
                        className="flex-shrink-0 text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: SEVERITY_BG[severity],
                          color: SEVERITY_COLOR[severity],
                        }}
                      >
                        {severity}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground capitalize">{risk.category.toLowerCase()}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="kf-btn-secondary flex items-center gap-2 px-4 py-2 text-xs"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Refresh from blueprint
                </>
              )}
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}
