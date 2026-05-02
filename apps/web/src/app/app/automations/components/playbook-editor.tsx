"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, Plus, Filter, ArrowDown, Clock, Workflow, MessageSquare } from "lucide-react";
import { InfoBadge } from "@/components/ui/info-badge";
import { Button, Input } from "@keyflow/ui";
import { createPlaybook, updatePlaybook, Playbook } from "@/lib/client";
import {
  TRIGGER_GROUPS,
  ACTION_GROUPS,
  CONDITION_OPTIONS,
  getFlowModules,
  MODULE_COLORS,
  buildNaturalLanguageSummary,
  type ActionStep,
  type AutomationTemplate,
} from "./automation-constants";

type ConditionOperator = "AND" | "OR";

interface ConditionGroup {
  operator: ConditionOperator;
  conditions: string[];
}

function parseConditionFromPlaybook(condition: string | null | undefined): ConditionGroup {
  if (!condition) return { operator: "AND", conditions: [""] };
  try {
    const parsed = JSON.parse(condition);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.conditions)) {
      return { operator: parsed.operator || "AND", conditions: parsed.conditions.length ? parsed.conditions : [""] };
    }
  } catch {}
  return { operator: "AND", conditions: [condition] };
}

function serializeConditionGroup(group: ConditionGroup): string | null {
  const filled = group.conditions.filter((c) => c);
  if (filled.length === 0) return null;
  if (filled.length === 1) return filled[0];
  return JSON.stringify({ operator: group.operator, conditions: filled });
}

interface PlaybookEditorProps {
  open: boolean;
  onClose: () => void;
  onSaved: (playbook: Playbook) => void;
  template?: AutomationTemplate | null;
  editingPlaybook?: Playbook | null;
  businessId?: string | null;
}

export function PlaybookEditor({ open, onClose, onSaved, template, editingPlaybook, businessId }: PlaybookEditorProps) {
  const [form, setForm] = useState({ name: "", triggerEvent: "" });
  const [conditionGroup, setConditionGroup] = useState<ConditionGroup>({ operator: "AND", conditions: [""] });
  const [actionSteps, setActionSteps] = useState<ActionStep[]>([{ type: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEditing = !!editingPlaybook;

  useEffect(() => {
    if (editingPlaybook) {
      const actions = Array.isArray(editingPlaybook.actions)
        ? (editingPlaybook.actions as ActionStep[])
        : [{ type: "" }];
      setForm({ name: editingPlaybook.name, triggerEvent: editingPlaybook.triggerEvent });
      setConditionGroup(parseConditionFromPlaybook(editingPlaybook.condition));
      setActionSteps(actions.length ? [...actions] : [{ type: "" }]);
      setError(null);
    } else if (template) {
      setForm({ name: template.name, triggerEvent: template.trigger });
      setConditionGroup({ operator: "AND", conditions: [""] });
      setActionSteps(template.actions.length ? [...template.actions] : [{ type: "" }]);
      setError(null);
    } else {
      setForm({ name: "", triggerEvent: "" });
      setConditionGroup({ operator: "AND", conditions: [""] });
      setActionSteps([{ type: "" }]);
      setError(null);
    }
  }, [editingPlaybook, template]);

  const addStep = () => setActionSteps((s) => [...s, { type: "" }]);
  const removeStep = (i: number) => setActionSteps((s) => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, type: string) =>
    setActionSteps((s) => s.map((st, idx) => (idx === i ? { ...st, type } : st)));
  const updateStepConfig = (i: number, key: string, value: string) =>
    setActionSteps((s) => s.map((st, idx) => (idx === i ? { ...st, config: { ...st.config, [key]: value } } : st)));

  const addCondition = () => setConditionGroup((g) => ({ ...g, conditions: [...g.conditions, ""] }));
  const removeCondition = (i: number) =>
    setConditionGroup((g) => ({ ...g, conditions: g.conditions.filter((_, idx) => idx !== i) }));
  const updateCondition = (i: number, value: string) =>
    setConditionGroup((g) => ({ ...g, conditions: g.conditions.map((c, idx) => (idx === i ? value : c)) }));
  const toggleOperator = () =>
    setConditionGroup((g) => ({ ...g, operator: g.operator === "AND" ? "OR" : "AND" }));

  const naturalLanguage = useMemo(
    () => buildNaturalLanguageSummary(form.triggerEvent, conditionGroup.conditions, actionSteps, conditionGroup.operator),
    [form.triggerEvent, conditionGroup, actionSteps]
  );

  const touchedModules = useMemo(
    () => form.triggerEvent ? getFlowModules(form.triggerEvent, actionSteps.filter((a) => a.type)) : [],
    [form.triggerEvent, actionSteps]
  );

  async function handleSave() {
    setError(null);
    const validSteps = actionSteps.filter((s) => s.type);
    if (!form.name.trim() || !form.triggerEvent || validSteps.length === 0) {
      setError("Name, trigger, and at least one action are required");
      return;
    }
    setSaving(true);
    const serializedCondition = serializeConditionGroup(conditionGroup);

    if (isEditing) {
      const { data, error: apiError } = await updatePlaybook({
        playbookId: editingPlaybook!.id,
        name: form.name,
        triggerEvent: form.triggerEvent,
        condition: serializedCondition,
        actions: validSteps,
        businessId: businessId ?? undefined,
      });
      setSaving(false);
      if (apiError) setError(apiError);
      else if (data) { onSaved(data); onClose(); }
    } else {
      const { data, error: apiError } = await createPlaybook({
        name: form.name,
        triggerEvent: form.triggerEvent,
        condition: serializedCondition || undefined,
        actions: validSteps,
        businessId: businessId ?? undefined,
      });
      setSaving(false);
      if (apiError) setError(apiError);
      else if (data) {
        onSaved(data);
        setForm({ name: "", triggerEvent: "" });
        setConditionGroup({ operator: "AND", conditions: [""] });
        setActionSteps([{ type: "" }]);
        onClose();
      }
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="rounded-2xl border border-primary/40 bg-card p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Workflow className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                {isEditing ? `Edit: ${editingPlaybook!.name}` : template ? `Create from: ${template.name}` : "New Flow"}
              </h3>
              <button
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))", border: "1px solid hsl(var(--kf-warning) / 0.3)" }}>
                {error}
              </div>
            )}

            <Input
              label="Flow Name"
              placeholder="e.g. Send receipt on payment"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />

            <div className="space-y-3">
              <StepBlock
                number={1}
                label="TRIGGER"
                sublabel="When this happens..."
                color="hsl(var(--kf-accent1))"
                icon={<Zap className="w-3.5 h-3.5" />}
                infoBadge={{ title: "Flow Trigger", body: "The event that starts this flow. For example, 'Invoice Paid' fires whenever a client completes payment." }}
              >
                <select
                  className="w-full rounded-lg border border-border/60 bg-input px-3 py-2.5 text-sm"
                  value={form.triggerEvent}
                  onChange={(e) => setForm((f) => ({ ...f, triggerEvent: e.target.value }))}
                >
                  <option value="">Select trigger...</option>
                  {TRIGGER_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.options.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </StepBlock>

              {form.triggerEvent && (
                <div className="flex justify-center">
                  <ArrowDown className="w-4 h-4 text-muted-foreground/30" />
                </div>
              )}

              <StepBlock
                number={2}
                label="CONDITIONS"
                sublabel="Only if... (optional)"
                color="hsl(var(--kf-info))"
                icon={<Filter className="w-3.5 h-3.5" />}
                infoBadge={{ title: "Flow Conditions", body: "Narrow when the flow runs. Without a condition, it fires for every trigger. Use AND/OR logic." }}
                actions={
                  <div className="flex items-center gap-2">
                    {conditionGroup.conditions.filter((c) => c).length > 1 && (
                      <button
                        type="button"
                        onClick={toggleOperator}
                        className="text-[10px] font-bold px-2 py-1 rounded-md transition-colors"
                        style={{
                          color: conditionGroup.operator === "AND" ? "hsl(var(--kf-info))" : "hsl(var(--kf-accent2))",
                          background: conditionGroup.operator === "AND" ? "hsl(var(--kf-info) / 0.1)" : "hsl(var(--kf-accent2) / 0.1)",
                        }}
                      >
                        {conditionGroup.operator}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={addCondition}
                      className="text-[10px] font-medium px-2 py-1 rounded-md transition-colors"
                      style={{ color: "hsl(var(--kf-info))", background: "hsl(var(--kf-info) / 0.1)" }}
                    >
                      <Plus className="w-3 h-3 inline mr-0.5" /> Add
                    </button>
                  </div>
                }
              >
                <div className="space-y-2">
                  {conditionGroup.conditions.map((cond, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {i > 0 && (
                        <span
                          className="text-[9px] font-bold w-6 shrink-0 text-center rounded py-0.5"
                          style={{
                            color: conditionGroup.operator === "AND" ? "hsl(var(--kf-info))" : "hsl(var(--kf-accent2))",
                            background: conditionGroup.operator === "AND" ? "hsl(var(--kf-info) / 0.1)" : "hsl(var(--kf-accent2) / 0.1)",
                          }}
                        >
                          {conditionGroup.operator}
                        </span>
                      )}
                      {i === 0 && <span className="w-6 shrink-0" />}
                      <select
                        className="flex-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm"
                        value={cond}
                        onChange={(e) => updateCondition(i, e.target.value)}
                      >
                        {CONDITION_OPTIONS.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      {conditionGroup.conditions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCondition(i)}
                          className="text-muted-foreground/50 hover:text-foreground text-xs min-w-[32px] min-h-[32px] flex items-center justify-center"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </StepBlock>

              <div className="flex justify-center">
                <ArrowDown className="w-4 h-4 text-muted-foreground/30" />
              </div>

              <StepBlock
                number={3}
                label="ACTIONS"
                sublabel="Then do these (in order)..."
                color="hsl(var(--kf-success))"
                icon={<Zap className="w-3.5 h-3.5" />}
                actions={
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-[10px] font-medium px-2 py-1 rounded-md transition-colors"
                    style={{ color: "hsl(var(--kf-success))", background: "hsl(var(--kf-success) / 0.1)" }}
                  >
                    <Plus className="w-3 h-3 inline mr-0.5" /> Add Step
                  </button>
                }
              >
                <div className="space-y-2">
                  {actionSteps.map((step, i) => (
                    <div key={i} className="rounded-lg p-2.5 space-y-2" style={{ background: "hsl(var(--muted) / 0.1)", border: "1px solid hsl(var(--border) / 0.3)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-success) / 0.15)" }}>
                          <span className="text-[10px] font-bold" style={{ color: "hsl(var(--kf-success))" }}>{i + 1}</span>
                        </div>
                        <select
                          className="flex-1 rounded-lg border border-border/60 bg-input px-3 py-2 text-sm"
                          value={step.type}
                          onChange={(e) => updateStep(i, e.target.value)}
                        >
                          <option value="">Select action...</option>
                          {ACTION_GROUPS.map((g) => (
                            <optgroup key={g.group} label={g.group}>
                              {g.options.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {actionSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeStep(i)}
                            className="text-muted-foreground/50 hover:text-foreground text-xs min-w-[32px] min-h-[32px] flex items-center justify-center"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {step.type === "delay" && (
                        <div className="flex items-center gap-2 pl-7">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">Wait</span>
                          <input
                            type="number"
                            className="w-16 rounded-lg border border-border/60 bg-input px-2 py-1 text-xs text-center"
                            placeholder="hours"
                            value={step.config?.hours ?? ""}
                            onChange={(e) => updateStepConfig(i, "hours", e.target.value)}
                          />
                          <span className="text-[11px] text-muted-foreground">hours</span>
                        </div>
                      )}
                      {step.type === "create_task" && (
                        <div className="flex items-center gap-2 pl-7">
                          <input
                            type="text"
                            className="flex-1 rounded-lg border border-border/60 bg-input px-2 py-1 text-xs"
                            placeholder="Task title..."
                            value={step.config?.title ?? ""}
                            onChange={(e) => updateStepConfig(i, "title", e.target.value)}
                          />
                        </div>
                      )}
                      {step.type === "add_tag" && (
                        <div className="flex items-center gap-2 pl-7">
                          <input
                            type="text"
                            className="flex-1 rounded-lg border border-border/60 bg-input px-2 py-1 text-xs"
                            placeholder="Tag name..."
                            value={step.config?.tag ?? ""}
                            onChange={(e) => updateStepConfig(i, "tag", e.target.value)}
                          />
                        </div>
                      )}
                      {i < actionSteps.length - 1 && (
                        <div className="flex justify-center pt-1">
                          <ArrowDown className="w-3 h-3 text-muted-foreground/20" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </StepBlock>
            </div>

            {touchedModules.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Modules:</span>
                {touchedModules.map((mod) => (
                  <span
                    key={mod}
                    className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                    style={{
                      background: `${MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))"}15`,
                      color: MODULE_COLORS[mod] ?? "hsl(var(--muted-foreground))",
                    }}
                  >
                    {mod}
                  </span>
                ))}
              </div>
            )}

            {naturalLanguage && (
              <div
                className="rounded-xl px-4 py-3 text-sm leading-relaxed flex items-start gap-2.5"
                style={{ background: "hsl(var(--kf-accent2) / 0.06)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}
              >
                <MessageSquare className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                <p className="text-muted-foreground italic">{naturalLanguage}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Flow"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StepBlock({
  number: _number,
  label,
  sublabel,
  color,
  icon,
  infoBadge,
  actions,
  children,
}: {
  number: number;
  label: string;
  sublabel: string;
  color: string;
  icon: React.ReactNode;
  infoBadge?: { title: string; body: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${color}25` }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: `${color}08` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: `${color}20`, color }}
          >
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
              {infoBadge && <InfoBadge title={infoBadge.title} body={infoBadge.body} side="right" iconSize={10} />}
            </div>
            <p className="text-[10px] text-muted-foreground">{sublabel}</p>
          </div>
        </div>
        {actions}
      </div>
      <div className="p-3">
        {children}
      </div>
    </div>
  );
}
