"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain, Shield, ShieldCheck, ShieldAlert, AlertTriangle,
  Activity, Loader2, Zap, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiGovernance,
  updateAiGovernance,
  type AiAutonomySettings,
} from "@/lib/client";
import { ExecutionHistory } from "@/components/ai/execution-history";
import { ActionQueue } from "@/components/ai/action-queue";

const MODES: Array<{
  id: AiAutonomySettings["mode"];
  label: string;
  description: string;
  icon: typeof Shield;
  color: string;
  bg: string;
  border: string;
}> = [
  {
    id: "advisory",
    label: "Advisory",
    description: "AI suggests actions but never executes automatically. All actions require manual approval.",
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  {
    id: "assisted",
    label: "Assisted",
    description: "AI auto-executes low-risk actions (Tier 1). Everything else requires your confirmation.",
    icon: Shield,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  {
    id: "pro_auto",
    label: "Pro Auto",
    description: "AI auto-executes up to Tier 2 actions. High-risk and admin actions still need approval.",
    icon: Zap,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  {
    id: "restricted",
    label: "Restricted",
    description: "AI is completely locked. All actions are blocked and require admin intervention.",
    icon: Lock,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
];

type SectionTab = "governance" | "queue" | "history";

export default function AiControlCenterPage() {
  const [settings, setSettings] = useState<AiAutonomySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SectionTab>("governance");
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    const res = await fetchAiGovernance(biz);
    if (res.data) setSettings(res.data);
    else if (res.error) toast.error(res.error);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleModeChange = useCallback(async (mode: AiAutonomySettings["mode"]) => {
    const biz = getStoredBusinessId();
    if (!biz || !settings) return;
    setSaving(true);
    const res = await updateAiGovernance(biz, { mode });
    if (res.data) {
      setSettings(res.data);
      toast.success(`Autonomy mode set to ${mode}`);
    } else {
      toast.error(res.error || "Failed to update");
    }
    setSaving(false);
  }, [settings]);

  const handleMaxTierChange = useCallback(async (tier: number) => {
    const biz = getStoredBusinessId();
    if (!biz || !settings) return;
    setSaving(true);
    const res = await updateAiGovernance(biz, { maxAutoTier: tier });
    if (res.data) {
      setSettings(res.data);
      toast.success(`Max auto tier set to ${tier}`);
    } else {
      toast.error(res.error || "Failed to update");
    }
    setSaving(false);
  }, [settings]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">AI Control Center</h1>
            <p className="text-xs text-muted-foreground/60">Manage AI autonomy, approvals, and execution history</p>
          </div>
        </div>
        {settings && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            MODES.find(m => m.id === settings.mode)?.bg || ""
          } ${MODES.find(m => m.id === settings.mode)?.color || ""} border ${
            MODES.find(m => m.id === settings.mode)?.border || ""
          }`}>
            {(() => { const M = MODES.find(m => m.id === settings.mode); return M ? <M.icon className="w-3.5 h-3.5" /> : null; })()}
            {MODES.find(m => m.id === settings.mode)?.label || settings.mode}
          </div>
        )}
      </div>

      <div className="flex items-center border-b border-border/30">
        {([
          { id: "governance" as SectionTab, label: "Governance", icon: Shield },
          { id: "queue" as SectionTab, label: `Action Queue${pendingCount > 0 ? ` (${pendingCount})` : ""}`, icon: AlertTriangle },
          { id: "history" as SectionTab, label: "Execution History", icon: Activity },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
              activeTab === t.id
                ? "border-[hsl(var(--kf-accent1))] text-foreground/90"
                : "border-transparent text-muted-foreground/50 hover:text-foreground/70"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "governance" && settings && (
        <div className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-foreground/80 mb-3">Autonomy Mode</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MODES.map(mode => {
                const isActive = settings.mode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id)}
                    disabled={saving}
                    className={`flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${
                      isActive
                        ? `${mode.border} ${mode.bg}`
                        : "border-border/30 bg-card/30 hover:bg-card/50 hover:border-border/50"
                    } disabled:opacity-50`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${mode.bg}`}>
                      <mode.icon className={`w-4.5 h-4.5 ${mode.color}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${isActive ? mode.color : "text-foreground/80"}`}>
                          {mode.label}
                        </span>
                        {isActive && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${mode.bg} ${mode.color}`}>
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground/60 mt-1 leading-relaxed">{mode.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border/20 pt-6">
            <h2 className="text-sm font-semibold text-foreground/80 mb-3">Max Auto-Execution Tier</h2>
            <p className="text-xs text-muted-foreground/60 mb-4">
              Actions at or below this tier execute automatically. Higher-tier actions require approval.
              Tier 4 (Admin) always requires manual approval regardless of this setting.
            </p>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map(tier => {
                const isActive = settings.maxAutoTier === tier;
                const tierLabels: Record<number, string> = { 1: "Low risk only", 2: "Low + Medium", 3: "Up to High" };
                const tierColors: Record<number, string> = {
                  1: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
                  2: "text-blue-400 bg-blue-500/10 border-blue-500/30",
                  3: "text-amber-400 bg-amber-500/10 border-amber-500/30",
                };
                return (
                  <button
                    key={tier}
                    onClick={() => handleMaxTierChange(tier)}
                    disabled={saving}
                    className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border transition-all disabled:opacity-50 ${
                      isActive ? tierColors[tier] : "border-border/30 bg-card/30 text-muted-foreground/50 hover:bg-card/50"
                    }`}
                  >
                    <span className="text-sm font-bold">Tier {tier}</span>
                    <span className="text-[10px]">{tierLabels[tier]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {(settings.blockedTools.length > 0 || settings.blockedModules.length > 0) && (
            <div className="border-t border-border/20 pt-6">
              <h2 className="text-sm font-semibold text-foreground/80 mb-3">Restrictions</h2>
              {settings.blockedModules.length > 0 && (
                <div className="mb-3">
                  <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Blocked Modules</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {settings.blockedModules.map(m => (
                      <span key={m} className="px-2 py-1 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20">{m}</span>
                    ))}
                  </div>
                </div>
              )}
              {settings.blockedTools.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Blocked Tools</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {settings.blockedTools.map(t => (
                      <span key={t} className="px-2 py-1 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "queue" && (
        <ActionQueue onCountChange={setPendingCount} />
      )}

      {activeTab === "history" && (
        <ExecutionHistory />
      )}
    </div>
  );
}
