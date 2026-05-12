"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Zap,
  Loader2,
  Calendar,
  Star,
  Mail,
  UserPlus,
  AlertTriangle,
  Package,
  BarChart3,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchAutopilotRules, updateAutopilotRule, type AutopilotRule } from "@/lib/client";

const RULE_ICONS: Record<string, typeof Zap> = {
  booking_reminder: Calendar,
  review_request: Star,
  invoice_reminder: Mail,
  lead_followup: UserPlus,
  abandoned_quote: AlertTriangle,
  low_stock: Package,
  weekly_report: BarChart3,
};

const RULE_CATEGORIES: Record<string, string> = {
  booking_reminder: "Bookings",
  review_request: "Reviews",
  invoice_reminder: "Finance",
  lead_followup: "CRM",
  abandoned_quote: "Commerce",
  low_stock: "Inventory",
  weekly_report: "Reports",
};

export function AutopilotRulesSettings() {
  const [rules, setRules] = useState<AutopilotRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchAutopilotRules(biz);
      if (res.data) setRules(res.data);
    } catch {
      toast.error("Failed to load autopilot rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule: AutopilotRule) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setSavingId(rule.id);
    try {
      await updateAutopilotRule(biz, rule.id, { enabled: !rule.enabled });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      );
      toast.success(`${rule.label} ${rule.enabled ? "disabled" : "enabled"}`);
    } catch {
      toast.error("Failed to update rule");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  const grouped = rules.reduce<Record<string, AutopilotRule[]>>((acc, r) => {
    const cat = RULE_CATEGORIES[r.key] || r.category || "General";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground/80">Autopilot Rules</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            Automatically handle routine tasks. {enabledCount} of {rules.length} rules enabled.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {enabledCount}/{rules.length} active
        </div>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-2">
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {category}
          </h3>
          <div className="space-y-2">
            {items.map((rule) => {
              const Icon = RULE_ICONS[rule.key] || Zap;
              return (
                <div
                  key={rule.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    rule.enabled
                      ? "border-border/50 bg-card/50"
                      : "border-border/20 bg-muted/20 opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        rule.enabled ? "bg-primary/10" : "bg-muted"
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 ${
                          rule.enabled ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    </div>
                    <div>
                      <p className="text-xs font-medium">{rule.label}</p>
                      <p className="text-[11px] text-muted-foreground/60">{rule.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(rule)}
                    disabled={savingId === rule.id}
                    className="shrink-0 transition-opacity disabled:opacity-50"
                    aria-label={rule.enabled ? `Disable ${rule.label}` : `Enable ${rule.label}`}
                  >
                    {savingId === rule.id ? (
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    ) : rule.enabled ? (
                      <ToggleRight className="w-5 h-5 text-primary" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
