"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Clock, Power, PowerOff, Settings2 } from "lucide-react";
import {
  CrossModuleWorkflow,
  fetchCrossModuleWorkflows,
  updateCrossModuleWorkflow,
} from "@/lib/client";
import { ExplainerButton } from "./explainer-button";

const CATEGORY_COLORS: Record<string, string> = {
  Commerce: "hsl(var(--kf-accent1))",
  Marketing: "#8b5cf6",
  Bookings: "#06b6d4",
};

export function WorkflowConfig({ businessId }: { businessId: string | null }) {
  const [workflows, setWorkflows] = useState<CrossModuleWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchCrossModuleWorkflows(businessId ?? undefined);
      setWorkflows(data ?? []);
      if (error) setError(error);
      setLoading(false);
    };
    void load();
  }, [businessId]);

  async function handleToggle(wf: CrossModuleWorkflow) {
    setUpdating(wf.key);
    const { error } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      enabled: !wf.enabled,
    });
    if (error) {
      setError(error);
    } else {
      setWorkflows((prev) =>
        prev.map((w) => (w.key === wf.key ? { ...w, enabled: !w.enabled } : w))
      );
    }
    setUpdating(null);
  }

  async function handleConfigUpdate(wf: CrossModuleWorkflow, newConfig: Record<string, string | number | boolean | null>) {
    setUpdating(wf.key);
    const { error } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      config: newConfig,
    });
    if (error) {
      setError(error);
    } else {
      setWorkflows((prev) =>
        prev.map((w) => (w.key === wf.key ? { ...w, config: newConfig } : w))
      );
    }
    setUpdating(null);
  }

  const categories = Array.from(new Set(workflows.map((w) => w.category)));

  return (
    <div className="space-y-4">
      <ExplainerButton
        items={[
          { title: "What is Cross-Module Intelligence?", text: "These are smart workflows that connect your CRM, Commerce, Bookings, and Marketing modules. They listen for events and automatically take actions across modules." },
          { title: "How does it work?", text: "When an event happens (like a quote being sent or a booking being cancelled), the intelligence agent automatically creates follow-up tasks, updates contacts, sends notifications, and more." },
          { title: "Toggle On/Off", text: "Each workflow can be enabled or disabled independently. Disabling a workflow stops it from running but preserves your configuration." },
          { title: "Configuration", text: "Click the settings icon on any workflow to adjust parameters like follow-up delays, auto-enrollment options, and more." },
        ]}
      />

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading intelligence workflows...</div>
      ) : (
        <>
          <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Cross-Module Intelligence
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Smart workflows that connect your modules and automate cross-cutting actions.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {workflows.filter((w) => w.enabled).length} active / {workflows.length} total
              </div>
            </div>
          </div>

          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: CATEGORY_COLORS[category] ?? "hsl(var(--kf-accent1))" }}
                />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{category}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {workflows
                  .filter((w) => w.category === category)
                  .map((wf) => (
                    <motion.div
                      key={wf.key}
                      layout
                      className={`rounded-2xl border p-3 flex flex-col gap-2 text-sm transition-colors ${
                        wf.enabled
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-border/60 bg-slate-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold flex items-center gap-2">
                          <Brain className="w-4 h-4" style={{ color: CATEGORY_COLORS[wf.category] ?? "hsl(var(--kf-accent1))" }} />
                          {wf.name}
                        </div>
                        <div className="flex items-center gap-1">
                          {wf.configSchema.length > 0 && (
                            <button
                              onClick={() => setExpandedKey(expandedKey === wf.key ? null : wf.key)}
                              className="rounded-full p-1.5 transition-colors bg-slate-500/10 text-slate-400 hover:bg-slate-500/20"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggle(wf)}
                            disabled={updating === wf.key}
                            className={`rounded-full p-1.5 transition-colors ${
                              wf.enabled
                                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                : "bg-slate-500/20 text-slate-400 hover:bg-slate-500/30"
                            } ${updating === wf.key ? "opacity-50" : ""}`}
                          >
                            {wf.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <p className="text-[12px] text-muted-foreground leading-relaxed">{wf.description}</p>

                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
                        <span className="inline-flex items-center gap-1">
                          <Zap className="w-3 h-3" /> {wf.triggerEvent}
                        </span>
                        {wf.runCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {wf.runCount} runs
                          </span>
                        )}
                        {wf.lastRunAt && (
                          <span>Last: {new Date(wf.lastRunAt).toLocaleDateString()}</span>
                        )}
                      </div>

                      <AnimatePresence>
                        {expandedKey === wf.key && wf.configSchema.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-border/40 pt-2 mt-1 space-y-2">
                              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Configuration</div>
                              {wf.configSchema.map((field) => (
                                <div key={field.key} className="flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground flex-1">{field.label}</label>
                                  {field.type === "boolean" ? (
                                    <button
                                      onClick={() =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: !(wf.config[field.key] ?? field.default),
                                        })
                                      }
                                      className={`w-8 h-5 rounded-full transition-colors relative ${
                                        (wf.config[field.key] ?? field.default)
                                          ? "bg-emerald-500"
                                          : "bg-slate-600"
                                      }`}
                                    >
                                      <div
                                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                          (wf.config[field.key] ?? field.default)
                                            ? "translate-x-3.5"
                                            : "translate-x-0.5"
                                        }`}
                                      />
                                    </button>
                                  ) : field.type === "number" ? (
                                    <input
                                      type="number"
                                      className="w-20 rounded-lg border border-border/60 bg-slate-900 px-2 py-1 text-xs text-right"
                                      value={String(wf.config[field.key] ?? field.default ?? "")}
                                      onChange={(e) =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: parseInt(e.target.value, 10) || field.default,
                                        })
                                      }
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      className="w-32 rounded-lg border border-border/60 bg-slate-900 px-2 py-1 text-xs"
                                      value={String(wf.config[field.key] ?? field.default ?? "")}
                                      onChange={(e) =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: e.target.value,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
