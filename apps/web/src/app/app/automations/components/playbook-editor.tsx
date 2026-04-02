"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, Plus, Eye, EyeOff, Filter } from "lucide-react";
import { InfoBadge } from "@/components/ui/info-badge";
import { Button, Input } from "@keyflow/ui";
import { createPlaybook, updatePlaybook, Playbook } from "@/lib/client";
import {
  TRIGGER_GROUPS,
  ACTION_GROUPS,
  getTriggerLabel,
  getActionLabel,
  type ActionStep,
  type AutomationTemplate,
} from "./automation-constants";

const CONDITION_OPTIONS = [
  { value: "", label: "Select condition..." },
  { value: "contact.has_email", label: "Contact has email" },
  { value: "contact.has_phone", label: "Contact has phone number" },
  { value: "contact.is_active", label: "Contact is active" },
  { value: "contact.is_new", label: "Contact was created in last 7 days" },
  { value: "invoice.above_threshold", label: "Invoice total above threshold" },
  { value: "booking.is_first", label: "First booking for contact" },
  { value: "time.business_hours", label: "During business hours only" },
];

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

function VisualFlowPreview({
  triggerEvent,
  conditionGroup,
  actionSteps,
}: {
  triggerEvent: string;
  conditionGroup: ConditionGroup;
  actionSteps: ActionStep[];
}) {
  const filledConditions = conditionGroup.conditions.filter((c) => c);
  const filledActions = actionSteps.filter((a) => a.type);

  if (!triggerEvent && filledActions.length === 0) {
    return (
      <div className="rounded-xl p-4 text-center" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
        <p className="text-xs text-muted-foreground">
          Select a trigger and actions to see the automation flow.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4 space-y-0" style={{ background: "hsl(var(--kf-muted)/0.1)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
      {triggerEvent && (
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1)/0.15)" }}
            >
              <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            {(filledConditions.length > 0 || filledActions.length > 0) && (
              <div className="w-px h-4" style={{ background: "hsl(var(--kf-border)/0.4)" }} />
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Trigger</p>
            <p className="text-sm font-medium">{getTriggerLabel(triggerEvent)}</p>
          </div>
        </div>
      )}

      {filledConditions.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "hsl(var(--kf-info)/0.15)" }}
            >
              <Filter className="w-4 h-4" style={{ color: "hsl(var(--kf-info))" }} />
            </div>
            {filledActions.length > 0 && (
              <div className="w-px h-4" style={{ background: "hsl(var(--kf-border)/0.4)" }} />
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Condition{filledConditions.length > 1 ? `s (${conditionGroup.operator})` : ""}
            </p>
            {filledConditions.map((c, i) => {
              const label = CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
              return (
                <p key={i} className="text-sm font-medium">
                  {i > 0 && (
                    <span
                      className="text-[10px] font-bold mr-1"
                      style={{ color: conditionGroup.operator === "AND" ? "hsl(var(--kf-info))" : "hsl(var(--kf-accent2))" }}
                    >
                      {conditionGroup.operator}
                    </span>
                  )}
                  {label}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {filledActions.map((action, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "hsl(var(--kf-success)/0.15)" }}
            >
              <span className="text-xs font-bold" style={{ color: "hsl(var(--kf-success))" }}>{i + 1}</span>
            </div>
            {i < filledActions.length - 1 && (
              <div className="w-px h-4" style={{ background: "hsl(var(--kf-border)/0.4)" }} />
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Action {i + 1}</p>
            <p className="text-sm font-medium">{getActionLabel(action.type)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlaybookEditor({ open, onClose, onSaved, template, editingPlaybook, businessId }: PlaybookEditorProps) {
  const [form, setForm] = useState({ name: "", triggerEvent: "" });
  const [conditionGroup, setConditionGroup] = useState<ConditionGroup>({ operator: "AND", conditions: [""] });
  const [actionSteps, setActionSteps] = useState<ActionStep[]>([{ type: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showFlow, setShowFlow] = useState(false);

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

  const addCondition = () => setConditionGroup((g) => ({ ...g, conditions: [...g.conditions, ""] }));
  const removeCondition = (i: number) =>
    setConditionGroup((g) => ({ ...g, conditions: g.conditions.filter((_, idx) => idx !== i) }));
  const updateCondition = (i: number, value: string) =>
    setConditionGroup((g) => ({ ...g, conditions: g.conditions.map((c, idx) => (idx === i ? value : c)) }));
  const toggleOperator = () =>
    setConditionGroup((g) => ({ ...g, operator: g.operator === "AND" ? "OR" : "AND" }));

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
      if (apiError) {
        setError(apiError);
      } else if (data) {
        onSaved(data);
        onClose();
      }
    } else {
      const { data, error: apiError } = await createPlaybook({
        name: form.name,
        triggerEvent: form.triggerEvent,
        condition: serializedCondition || undefined,
        actions: validSteps,
        businessId: businessId ?? undefined,
      });
      setSaving(false);
      if (apiError) {
        setError(apiError);
      } else if (data) {
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
          <div className="rounded-2xl border border-primary/40 bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                {isEditing ? `Edit: ${editingPlaybook!.name}` : template ? `Create from: ${template.name}` : "New Automation"}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Automation Name"
                placeholder="e.g. Send receipt on payment"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div>
                <label className="text-xs text-muted-foreground mb-1 inline-flex items-center gap-1">When this happens... <InfoBadge title="Automation Trigger" body="The event that starts this automation. For example, 'Invoice Paid' fires whenever a client completes payment. Each automation needs exactly one trigger." side="right" iconSize={10} /></label>
                <select
                  className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm"
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
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground inline-flex items-center gap-1">Only if... (optional conditions) <InfoBadge title="Automation Conditions" body="Conditions narrow when the automation runs. Without a condition, it fires for every trigger event. Add multiple conditions and choose AND (all must match) or OR (any must match)." side="right" iconSize={10} /></label>
                <div className="flex items-center gap-2">
                  {conditionGroup.conditions.filter((c) => c).length > 1 && (
                    <button
                      type="button"
                      onClick={toggleOperator}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors min-h-[32px]"
                      style={{
                        color: conditionGroup.operator === "AND" ? "hsl(var(--kf-info))" : "hsl(var(--kf-accent2))",
                        background: conditionGroup.operator === "AND" ? "hsl(var(--kf-info) / 0.1)" : "hsl(var(--kf-accent2) / 0.1)",
                      }}
                    >
                      {conditionGroup.operator === "AND" ? "AND — all must match" : "OR — any must match"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addCondition}
                    className="text-[11px] font-medium px-2 py-1 rounded-lg transition-colors min-h-[32px]"
                    style={{ color: "hsl(var(--kf-accent1))", background: "hsl(var(--kf-accent1) / 0.1)" }}
                  >
                    <Plus className="w-3 h-3 inline mr-0.5" />
                    Add Condition
                  </button>
                </div>
              </div>
              {conditionGroup.conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-2">
                  {i > 0 && (
                    <span
                      className="text-[10px] font-bold w-8 shrink-0 text-center rounded-md py-0.5"
                      style={{
                        color: conditionGroup.operator === "AND" ? "hsl(var(--kf-info))" : "hsl(var(--kf-accent2))",
                        background: conditionGroup.operator === "AND" ? "hsl(var(--kf-info) / 0.1)" : "hsl(var(--kf-accent2) / 0.1)",
                      }}
                    >
                      {conditionGroup.operator}
                    </span>
                  )}
                  {i === 0 && <span className="w-8 shrink-0" />}
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
                      className="text-muted-foreground/50 hover:text-foreground text-xs min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Then do these actions (in order)...</label>
                <button
                  type="button"
                  onClick={addStep}
                  className="text-[11px] font-medium px-2 py-1 rounded-lg transition-colors"
                  style={{ color: "hsl(var(--kf-accent1))", background: "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  + Add Step
                </button>
              </div>
              {actionSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground/40 w-5 shrink-0 text-center">{i + 1}</span>
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
                      className="text-muted-foreground/50 hover:text-foreground text-xs min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowFlow((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[44px]"
                style={{
                  color: showFlow ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                  background: showFlow ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.2)",
                }}
              >
                {showFlow ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showFlow ? "Hide Flow" : "Preview Flow"}
              </button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Automation"}
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {showFlow && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <VisualFlowPreview
                    triggerEvent={form.triggerEvent}
                    conditionGroup={conditionGroup}
                    actionSteps={actionSteps}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
