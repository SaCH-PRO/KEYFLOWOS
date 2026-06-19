"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Lightbulb, Target, Zap, ShieldCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import type { KeyExecutiveModeBrief, KeyExecutiveMode, KeyModeFinding, KeyModePriority } from "@/lib/api/intelligence";
import { createKeyActionProposal, type KeyExecutableActionType } from "@/lib/api/key-autonomy";

interface KeyModeBriefPanelProps {
  brief: KeyExecutiveModeBrief;
  mode: KeyExecutiveMode;
  businessId: string;
}

const EXECUTABLE_ACTION_TYPES: KeyExecutableActionType[] = [
  "CREATE_TASK",
  "CREATE_DOCUMENT",
  "GENERATE_CONSTITUTION_VERSION",
  "GENERATE_DOCUMENT_EXPORT",
  "CREATE_GENOME_EVOLUTION_PROPOSAL",
  "SCHEDULE_FOLLOWUP",
  "ESCALATE_THREAD",
];

function isExecutableAction(actionType: string): actionType is KeyExecutableActionType {
  return EXECUTABLE_ACTION_TYPES.includes(actionType as KeyExecutableActionType);
}

export function KeyModeBriefPanel({ brief, mode, businessId }: KeyModeBriefPanelProps) {
  const router = useRouter();
  const [requesting, setRequesting] = useState<string | null>(null);

  const handleAction = async (action: KeyModeBriefPanelProps["brief"]["recommendedActions"][number], index: number) => {
    const key = `${action.actionType}-${index}`;
    if (action.href && !action.requiresApproval && !isExecutableAction(action.actionType)) {
      router.push(action.href);
      return;
    }

    if (!isExecutableAction(action.actionType)) {
      if (action.href) router.push(action.href);
      return;
    }

    setRequesting(key);
    const { data, error } = await createKeyActionProposal(businessId, {
      sourceType: "EXECUTIVE_MODE",
      sourceMode: mode,
      title: action.label,
      summary: brief.summary,
      rationale: brief.diagnosis,
      evidence: brief.findings.map((f) => f.title),
      actionType: action.actionType,
      payload: action.payload ?? {},
    });
    setRequesting(null);

    if (error || !data) {
      toast.error(error || "Failed to request approval");
      return;
    }

    toast.success("Approval requested. KEY will execute once approved.");
    router.push("/app/key-autonomy");
  };

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <h2 className="text-lg font-semibold text-foreground">{brief.title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">{brief.summary}</p>
        <div className="mt-4 rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.06)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
            <span className="text-xs font-semibold">Diagnosis</span>
          </div>
          <p className="text-sm text-foreground">{brief.diagnosis}</p>
        </div>
      </motion.div>

      {brief.recommendedActions.length > 0 && (
        <SectionCard title="Recommended Actions" icon={Zap} noPadding compact>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {brief.recommendedActions.map((action, index) => {
              const key = `${action.actionType}-${index}`;
              const isRequesting = requesting === key;
              const executable = isExecutableAction(action.actionType);
              return (
                <motion.button
                  key={key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => handleAction(action, index)}
                  disabled={isRequesting}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left group disabled:opacity-70"
                >
                  <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0 group-hover:bg-[hsl(var(--kf-accent1))]/15 transition-colors">
                    {isRequesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                    ) : executable || action.requiresApproval ? (
                      <ShieldCheck className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{action.label}</div>
                    {(executable || action.requiresApproval) && (
                      <div className="text-[10px] text-muted-foreground">Request approval</div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title={`Findings (${brief.findings.length})`} icon={Lightbulb} noPadding compact>
        <div className="p-3 space-y-2">
          {brief.findings.length === 0 && (
            <p className="text-sm text-muted-foreground">No findings for this mode.</p>
          )}
          {brief.findings.map((finding, index) => (
            <FindingCard key={finding.id} finding={finding} index={index} />
          ))}
        </div>
      </SectionCard>

      {brief.risks.length > 0 && (
        <SectionCard title={`Risks (${brief.risks.length})`} icon={AlertTriangle} noPadding compact>
          <div className="p-3 space-y-2">
            {brief.risks.map((finding, index) => (
              <FindingCard key={finding.id} finding={finding} index={index} />
            ))}
          </div>
        </SectionCard>
      )}

      {brief.opportunities.length > 0 && (
        <SectionCard title={`Opportunities (${brief.opportunities.length})`} icon={Lightbulb} noPadding compact>
          <div className="p-3 space-y-2">
            {brief.opportunities.map((finding, index) => (
              <FindingCard key={finding.id} finding={finding} index={index} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function FindingCard({ finding, index }: { finding: KeyModeFinding; index: number }) {
  const router = useRouter();
  const { label, color, bg } = priorityStyle(finding.priority);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="rounded-xl p-3 border border-border/20"
      style={{ background: "hsl(var(--kf-card) / 0.5)" }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ color, background: bg }}>
          {finding.priority}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{finding.title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{finding.finding}</p>
      {finding.evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {finding.evidence.map((evidence, i) => (
            <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50 mt-1.5 shrink-0" />
              {evidence}
            </li>
          ))}
        </ul>
      )}
      {finding.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {finding.actions.map((action, i) => (
            <button
              key={i}
              onClick={() => action.href && router.push(action.href)}
              disabled={!action.href}
              className="text-[10px] px-2 py-1 rounded-md border border-border/30 bg-card/50 hover:bg-card/80 transition-colors disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function priorityStyle(priority: KeyModePriority) {
  switch (priority) {
    case "CRITICAL":
      return { label: "Critical", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" };
    case "HIGH":
      return { label: "High", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" };
    case "MEDIUM":
      return { label: "Medium", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" };
    case "LOW":
    default:
      return { label: "Low", color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted) / 0.15)" };
  }
}
