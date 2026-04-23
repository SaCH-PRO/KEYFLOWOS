"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, ChevronDown, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InfoBadge } from "@/components/ui/info-badge";

export interface DunningRule {
  id: string;
  daysAfterDue: number;
  enabled: boolean;
}

const DEFAULT_RULES: DunningRule[] = [
  { id: "rule_1", daysAfterDue: 1, enabled: true },
  { id: "rule_2", daysAfterDue: 7, enabled: true },
  { id: "rule_3", daysAfterDue: 14, enabled: true },
  { id: "rule_4", daysAfterDue: 30, enabled: false },
];

interface DunningRulesPanelProps {
  businessId: string | null;
}

export function DunningRulesPanel({ businessId }: DunningRulesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<DunningRule[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`kf_dunning_rules_${businessId}`);
      if (saved) {
        try { return JSON.parse(saved); } catch { /* use defaults */ }
      }
    }
    return DEFAULT_RULES;
  });
  const [saving, setSaving] = useState(false);

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function addRule() {
    const maxDays = Math.max(...rules.map((r) => r.daysAfterDue), 0);
    setRules((prev) => [
      ...prev,
      { id: `rule_${Date.now()}`, daysAfterDue: maxDays + 7, enabled: true },
    ]);
  }

  function updateDays(id: string, days: number) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, daysAfterDue: Math.max(1, days) } : r)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(`kf_dunning_rules_${businessId}`, JSON.stringify(rules));
      }
      toast.success("Dunning rules saved");
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <Bell className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Auto-Reminders (Dunning)
        </span>
        <InfoBadge
          title="Dunning Rules"
          body="Automatically send payment reminders to clients when invoices become overdue. Configure how many days after the due date each reminder is sent."
          side="right"
          iconSize={10}
        />
        <span className="text-[10px] text-muted-foreground/50 ml-auto mr-2">
          {enabledCount} active rule{enabledCount !== 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    rule.enabled
                      ? "border-amber-500/20 bg-amber-500/5"
                      : "border-border/30 bg-white/[0.01] opacity-60"
                  }`}
                >
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`w-8 h-5 rounded-full transition-colors relative shrink-0 ${
                      rule.enabled ? "bg-amber-500" : "bg-muted/40"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        rule.enabled ? "left-3.5" : "left-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Send reminder</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={rule.daysAfterDue}
                    onChange={(e) => updateDays(rule.id, parseInt(e.target.value) || 1)}
                    className="w-14 px-2 py-1 text-xs text-center bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">days after due</span>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="ml-auto p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={addRule}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-border/40 hover:bg-white/[0.06] transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Rule
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors ml-auto disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save Rules
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
