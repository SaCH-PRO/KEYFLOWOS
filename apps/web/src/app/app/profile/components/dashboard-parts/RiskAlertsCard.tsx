"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Shield, AlertCircle, XCircle, Zap, CheckCircle2 } from "lucide-react";
import { AssessmentResult, Recommendation, fadeUp } from "./types";

export function RiskAlertsCard({
  assessment,
  criticalRecs,
}: {
  assessment: AssessmentResult;
  criticalRecs: Recommendation[];
}) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
        <AlertTriangle className="h-4 w-4" />
        Risk Alerts
      </div>
      {criticalRecs.length > 0 ? (
        <div className="space-y-2">
          {criticalRecs.map((rec) => (
            <div key={rec.id} className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1">
              <div className="flex items-center gap-2">
                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="text-xs font-medium text-red-400">{rec.title}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
              {rec.suggestedAction && (
                <p className="text-[11px] text-red-400 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {rec.suggestedAction}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : assessment.risks.length > 0 ? (
        <div className="space-y-2">
          {assessment.risks.map((risk, i) => (
            <div key={i} className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">{risk}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
          <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">No critical risks detected. Keep monitoring as you grow.</p>
        </div>
      )}
    </motion.div>
  );
}
