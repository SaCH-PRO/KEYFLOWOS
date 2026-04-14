"use client";

import { useEffect, useState } from "react";
import {
  Zap, ExternalLink, Play, CheckCircle, AlertTriangle,
  Activity, Shield, RefreshCw,
} from "lucide-react";
import { fetchCrossModuleWorkflows, fetchAutomationCoverage, type CrossModuleWorkflow, type AutomationCoverage } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

interface FlowsTabProps {
  projectId?: string;
  projectName?: string;
  businessId?: string;
}

export function FlowsTab({ projectId, businessId: propBusinessId }: FlowsTabProps) {
  const [workflows, setWorkflows] = useState<CrossModuleWorkflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [coverage, setCoverage] = useState<AutomationCoverage | null>(null);

  useEffect(() => {
    const businessId = propBusinessId || getStoredBusinessId();
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchCrossModuleWorkflows(businessId),
      fetchAutomationCoverage(businessId),
    ]).then(([wfRes, covRes]) => {
      if (cancelled) return;
      if (wfRes.data) {
        const projectWorkflows = wfRes.data.filter(
          (wf) => wf.triggerEvent.startsWith("project.") || wf.category === "projects"
        );
        setWorkflows(projectWorkflows);
      }
      if (covRes.data) {
        setCoverage(covRes.data);
      }
    }).catch((err) => {
      console.error("[FlowsTab] fetch error:", err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [propBusinessId]);

  const activeFlows = workflows.filter((w) => w.enabled);
  const inactiveFlows = workflows.filter((w) => !w.enabled);

  const projectModule = coverage?.modules.find((m) => m.module === "projects");
  const overallPct = coverage?.overallPct ?? null;
  const moduleCoveragePct = projectModule?.coveragePct ?? null;
  const automatedCount = projectModule?.automatedCount ?? 0;
  const totalProcesses = projectModule?.totalProcesses ?? 0;

  const suggestedAutomations = [
    { name: "Client Update on Stage Change", desc: "Notify client when project moves to a new stage.", icon: RefreshCw },
    { name: "Task Overdue Alert", desc: "Get notified when a task passes its due date.", icon: AlertTriangle },
    { name: "Project Completion Follow-Up", desc: "Send a follow-up email when project is marked complete.", icon: CheckCircle },
    { name: "Milestone Invoice Generation", desc: "Auto-generate an invoice when a milestone is completed.", icon: Shield },
  ];

  return (
    <div className="space-y-4">
      {overallPct !== null && (
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              Automation Coverage
            </h4>
            <span
              className="text-xs font-bold"
              style={{ color: overallPct >= 60 ? "hsl(var(--kf-success))" : overallPct >= 30 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" }}
            >
              {overallPct}%
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-muted/30">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${overallPct}%`,
                background: overallPct >= 60 ? "hsl(var(--kf-success))" : overallPct >= 30 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))",
              }}
            />
          </div>
          {projectModule && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Projects: {automatedCount} of {totalProcesses} processes automated ({moduleCoveragePct}%)
            </p>
          )}
          {!projectModule && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Overall business automation coverage
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Flows & Automations</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Loading..." : `${activeFlows.length} active flow${activeFlows.length !== 1 ? "s" : ""} for projects`}
            </p>
          </div>
          <a
            href="/app/automations"
            className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors shrink-0"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Open Flows
          </a>
        </div>
      </div>

      {!loading && activeFlows.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Project Flows</h4>
          <div className="space-y-2">
            {activeFlows.map((flow) => (
              <div key={flow.key} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: "hsl(var(--kf-success) / 0.04)" }}>
                <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{flow.name}</p>
                  {flow.lastRunAt && (
                    <p className="text-[10px] text-muted-foreground">
                      Last run {new Date(flow.lastRunAt).toLocaleDateString()} · {flow.runCount} run{flow.runCount !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-success))" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && inactiveFlows.length > 0 && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Inactive Flows</h4>
          <div className="space-y-2">
            {inactiveFlows.map((flow) => (
              <div key={flow.key} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.1)" }}>
                <Play className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground truncate flex-1">{flow.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested Automations</h4>
        <div className="space-y-2">
          {suggestedAutomations.map((flow) => (
            <div key={flow.name} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.1)" }}>
              <flow.icon className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{flow.name}</p>
                <p className="text-[10px] text-muted-foreground">{flow.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
