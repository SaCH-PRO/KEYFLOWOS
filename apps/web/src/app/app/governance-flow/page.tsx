"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, FileText, Settings, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { FlowShell } from "@/components/layout/flow-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";

export default function GovernanceFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [summary, setSummary] = useState<{ open: number; bySeverity: Array<{ severity: string; count: number }> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchSummary() {
      if (!businessId) return;
      const res = await apiGet<{ open: number; bySeverity: Array<{ severity: string; count: number }> }>(`/governance/businesses/${businessId}/summary`);
      if (!cancelled && res.data) setSummary(res.data);
    }
    fetchSummary();
    return () => { cancelled = true; };
  }, [businessId]);

  const highRiskCount = summary?.bySeverity.find((s) => s.severity === "HIGH" || s.severity === "CRITICAL")?.count ?? 0;

  const sections = [
    { label: "Approvals", href: "/app/approvals", icon: CheckCircle2, desc: "Pending and resolved approvals" },
    { label: "Audit Logs", href: "/app/evidence", icon: FileText, desc: "Business event history" },
    { label: "AI Autonomy", href: "/app/settings/ai", icon: Settings, desc: "KEY governance settings" },
  ];

  return (
    <FlowShell
      title="Governance Flow"
      subtitle="Protect the business. Approvals, risks, and compliance."
      icon={ShieldCheck}
      activeFlowId="governance"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="Open Risks" value={summary?.open ?? 0} icon={ShieldAlert} />
        <MetricCard label="High/Critical" value={highRiskCount} icon={AlertTriangle} iconColor="#ef4444" />
        <MetricCard label="Approval Items" value="—" icon={CheckCircle2} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => (
          <button key={s.label} onClick={() => router.push(s.href)} className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </FlowShell>
  );
}
