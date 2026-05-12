"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Loader2,
  ChevronRight,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { fetchAutopilotRules, updateAutopilotRule, type AutopilotRule } from "@/lib/client";
import { toast } from "sonner";

interface AutopilotRulesWidgetProps {
  businessId: string;
}

export function AutopilotRulesWidget({ businessId }: AutopilotRulesWidgetProps) {
  const router = useRouter();
  const [rules, setRules] = useState<AutopilotRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAutopilotRules(businessId);
      if (res.data) setRules(res.data);
    } catch {
      toast.error("Failed to load autopilot rules");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule: AutopilotRule) => {
    setSavingId(rule.id);
    try {
      await updateAutopilotRule(businessId, rule.id, { enabled: !rule.enabled });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      );
    } catch {
      toast.error("Failed to update rule");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 p-4 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Autopilot</h3>
          <span className="text-[10px] text-muted-foreground">
            {enabledCount}/{rules.length} active
          </span>
        </div>
        <button
          onClick={() => router.push("/app/settings/ai-control?tab=autopilot")}
          className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Settings
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="p-3 space-y-1">
        {rules.slice(0, 5).map((rule) => (
          <button
            key={rule.id}
            onClick={() => toggle(rule)}
            disabled={savingId === rule.id}
            className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors text-left disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              {rule.enabled ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs">{rule.label}</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                rule.enabled
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {rule.enabled ? "On" : "Off"}
            </span>
          </button>
        ))}
        {rules.length > 5 && (
          <button
            onClick={() => router.push("/app/settings/ai-control?tab=autopilot")}
            className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            +{rules.length - 5} more rules
          </button>
        )}
      </div>
    </div>
  );
}
