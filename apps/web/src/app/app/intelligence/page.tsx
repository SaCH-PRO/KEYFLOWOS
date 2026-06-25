"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Brain, RefreshCw, Loader2, AlertTriangle, Lightbulb, Sparkles, ArrowRight, Users, TrendingUp, Megaphone, Settings2, Scale, Rocket, ShieldAlert, ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getExecutiveBrief, type BusinessExecutiveBrief, type BusinessIntelligenceInsight } from "@/lib/api/intelligence";
import { ExecutiveBriefPanel } from "./components/executive-brief-panel";
import type { KeyExecutiveMode } from "@/lib/api/intelligence";
import { IntelligenceInsightCard } from "./components/intelligence-insight-card";
import { IntelligenceDomainFilter } from "./components/intelligence-domain-filter";

export default function IntelligencePage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [brief, setBrief] = useState<BusinessExecutiveBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<BusinessIntelligenceInsight["domain"] | "ALL">("ALL");

  useEffect(() => {
    setBusinessId(getStoredBusinessId() ?? null);
  }, []);

  const load = async () => {
    const id = getStoredBusinessId();
    if (!id) {
      setError("No business selected");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await getExecutiveBrief(id);
    if (apiError || !data) {
      setError(apiError || "Failed to load Executive Brief");
      setBrief(null);
    } else {
      setBrief(data);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const filteredInsights = useMemo(() => {
    if (!brief) return [];
    if (activeDomain === "ALL") return brief.insights;
    return brief.insights.filter((i) => i.domain === activeDomain);
  }, [brief, activeDomain]);

  const recommendedActions = useMemo(() => {
    if (!brief) return [];
    const seen = new Set<string>();
    return brief.insights
      .filter((i) => i.recommendedAction?.href)
      .map((i) => ({
        id: i.id,
        label: i.recommendedAction!.label,
        href: i.recommendedAction!.href!,
        domain: i.domain,
      }))
      .filter((a) => {
        if (seen.has(a.href)) return false;
        seen.add(a.href);
        return true;
      })
      .slice(0, 6);
  }, [brief]);

  if (loading) {
    return (
      <WorkspaceShell icon={Brain} title="Intelligence" subtitle="Executive brief and cross-module insights">
        <div className="space-y-6">
          <div className="rounded-2xl border border-border/40 bg-card/40 p-8 flex flex-col items-center justify-center gap-3 h-48 animate-pulse">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating Executive Brief...</p>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !brief) {
    return (
      <WorkspaceShell icon={Brain} title="Intelligence" subtitle="Executive brief and cross-module insights">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">{error || "Executive Brief unavailable"}</p>
          <button
            onClick={load}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Brain} title="Intelligence" subtitle="Executive brief and cross-module insights">
      <div className="space-y-5">
        <ExecutiveBriefPanel brief={brief} />

        <AskKeyAsPanel businessId={businessId} />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h2 className="text-sm font-semibold text-foreground">Insights</h2>
            <span className="text-[10px] text-muted-foreground">({filteredInsights.length})</span>
          </div>
          <IntelligenceDomainFilter active={activeDomain} onChange={setActiveDomain} />
        </div>

        {filteredInsights.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-dashed p-8 text-center"
            style={{ borderColor: "hsl(var(--kf-border) / 0.4)" }}
          >
            <Lightbulb className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No insights match the selected filter.</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredInsights.map((insight, index) => (
              <IntelligenceInsightCard key={insight.id} insight={insight} index={index} />
            ))}
          </div>
        )}

        {recommendedActions.length > 0 && (
          <SectionCard
            title="Recommended Actions"
            icon={Sparkles}
            noPadding
            compact
          >
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {recommendedActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => router.push(action.href)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0 group-hover:bg-[hsl(var(--kf-accent1))]/15 transition-colors">
                    <ArrowRight className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{action.label}</div>
                    <div className="text-[10px] text-muted-foreground">{action.domain}</div>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </WorkspaceShell>
  );
}

const MODE_BUTTONS: { mode: KeyExecutiveMode; label: string; icon: React.ElementType }[] = [
  { mode: "STRATEGIST", label: "Strategist", icon: Users },
  { mode: "CFO", label: "CFO", icon: TrendingUp },
  { mode: "CMO", label: "CMO", icon: Megaphone },
  { mode: "COO", label: "COO", icon: Settings2 },
  { mode: "LEGAL_GUIDE", label: "Legal Guide", icon: Scale },
  { mode: "GROWTH_ADVISOR", label: "Growth", icon: Rocket },
  { mode: "RISK_OFFICER", label: "Risk Officer", icon: ShieldAlert },
  { mode: "EXECUTIVE_ASSISTANT", label: "Assistant", icon: ClipboardList },
];

function AskKeyAsPanel({ businessId }: { businessId: string | null }) {
  const router = useRouter();
  const handleClick = (mode: KeyExecutiveMode) => {
    router.push(`/app/key-modes?mode=${mode}`);
  };

  return (
    <SectionCard title="Ask KEY as..." subtitle="Get a role-specific executive briefing" icon={Brain} compact>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {MODE_BUTTONS.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            disabled={!businessId}
            onClick={() => handleClick(mode)}
            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            <span className="text-[10px] font-medium text-foreground">{label}</span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
