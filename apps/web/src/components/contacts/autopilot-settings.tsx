"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Bot, MessageSquare, Gift, DollarSign, Bell, Clock,
  Loader2, Moon,
} from "lucide-react";
import { fetchAutopilotSettings, updateAutopilotSettings } from "@/lib/client";
import type { AutopilotSettings } from "@/lib/client";

interface AutopilotSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  businessId?: string;
}

const TRIGGER_CONFIG = [
  { key: "follow_up" as const, label: "Follow Ups", desc: "Auto-suggest follow-ups for stale contacts", icon: MessageSquare },
  { key: "birthday" as const, label: "Birthdays", desc: "Send birthday greetings to contacts", icon: Gift },
  { key: "payment_reminder" as const, label: "Payment Reminders", desc: "Remind contacts about outstanding invoices", icon: DollarSign },
  { key: "check_in" as const, label: "Check Ins", desc: "Periodic check-ins with active clients", icon: Bell },
  { key: "offer" as const, label: "Offers", desc: "Send re-engagement offers to cold prospects", icon: Gift },
];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? "bg-[hsl(var(--kf-accent2))]" : "bg-white/[0.08]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

export function AutopilotSettingsPanel({ open, onClose, businessId }: AutopilotSettingsPanelProps) {
  const [settings, setSettings] = useState<AutopilotSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAutopilotSettings(businessId).then((res) => {
      if (res.data) setSettings(res.data);
      setLoading(false);
    });
  }, [open, businessId]);

  const save = useCallback(async (patch: Partial<AutopilotSettings>) => {
    if (!settings) return;
    setSaving(true);
    const merged = { ...settings, ...patch };
    setSettings(merged);
    try {
      const result = await updateAutopilotSettings(patch, businessId);
      if (result.data) setSettings(result.data);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }, [settings, businessId]);

  const toggleTrigger = useCallback((key: keyof AutopilotSettings["triggers"]) => {
    if (!settings) return;
    save({
      triggers: { ...settings.triggers, [key]: !settings.triggers[key] },
    });
  }, [settings, save]);

  const toggleAutoApprove = useCallback((type: string) => {
    if (!settings) return;
    const current = settings.autoApproveTypes;
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    save({ autoApproveTypes: updated });
  }, [settings, save]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 border-l border-border/50 bg-card/95 backdrop-blur-xl overflow-y-auto"
          >
            <div className="p-5">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5">
                    <Bot className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Autopilot Settings</h2>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">Configure AI-powered automation</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
                  aria-label="Close settings"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-muted-foreground/50 animate-spin" />
                </div>
              ) : settings ? (
                <div className="space-y-6">
                  <div className="rounded-xl border border-border/50 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">Master Toggle</p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          {settings.enabled ? "Autopilot is active" : "Autopilot is disabled"}
                        </p>
                      </div>
                      <Toggle
                        checked={settings.enabled}
                        onChange={(v) => save({ enabled: v } as any)}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">Action Triggers</h3>
                    <div className="space-y-2">
                      {TRIGGER_CONFIG.map(({ key, label, desc, icon: Icon }) => (
                        <div
                          key={key}
                          className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white/[0.02] hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="p-2 rounded-lg bg-white/[0.04] shrink-0">
                            <Icon className="w-4 h-4 text-muted-foreground/60" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{label}</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-0.5">{desc}</p>
                          </div>
                          <Toggle
                            checked={settings.triggers[key]}
                            onChange={() => toggleTrigger(key)}
                            disabled={saving || !settings.enabled}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">Auto-Approve</h3>
                    <p className="text-xs text-muted-foreground/60 mb-3">
                      These action types will execute automatically without needing your approval.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TRIGGER_CONFIG.map(({ key, label }) => {
                        const isActive = settings.autoApproveTypes.includes(key);
                        return (
                          <button
                            key={key}
                            onClick={() => toggleAutoApprove(key)}
                            disabled={saving || !settings.enabled}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                              isActive
                                ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border-[hsl(var(--kf-accent2))]/30"
                                : "bg-white/[0.02] text-muted-foreground/60 border-border/40 hover:bg-white/[0.04]"
                            } disabled:opacity-50`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3 flex items-center gap-1.5">
                      <Moon className="w-3.5 h-3.5" />
                      Quiet Hours
                    </h3>
                    <p className="text-xs text-muted-foreground/60 mb-3">
                      Autopilot won&apos;t send messages during quiet hours (Trinidad time).
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide mb-1 block">From</label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                          <input
                            type="time"
                            value={settings.quietHoursStart}
                            onChange={(e) => save({ quietHoursStart: e.target.value })}
                            disabled={saving || !settings.enabled}
                            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-border/40 bg-white/[0.03] text-foreground disabled:opacity-50"
                          />
                        </div>
                      </div>
                      <span className="text-muted-foreground/40 mt-5">to</span>
                      <div className="flex-1">
                        <label className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide mb-1 block">Until</label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                          <input
                            type="time"
                            value={settings.quietHoursEnd}
                            onChange={(e) => save({ quietHoursEnd: e.target.value })}
                            disabled={saving || !settings.enabled}
                            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-border/40 bg-white/[0.03] text-foreground disabled:opacity-50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {saving && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Saving...
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground/60">Failed to load settings</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
