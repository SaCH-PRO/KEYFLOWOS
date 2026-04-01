"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X } from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { createPlaybook, updatePlaybook, Playbook } from "@/lib/client";
import {
  TRIGGER_GROUPS,
  ACTION_GROUPS,
  type ActionStep,
  type AutomationTemplate,
} from "./automation-constants";

const CONDITION_OPTIONS = [
  { value: "", label: "No condition (always run)" },
  { value: "contact.has_email", label: "Contact has email" },
  { value: "contact.has_phone", label: "Contact has phone number" },
  { value: "contact.is_active", label: "Contact is active" },
  { value: "contact.is_new", label: "Contact was created in last 7 days" },
  { value: "invoice.above_threshold", label: "Invoice total above threshold" },
  { value: "booking.is_first", label: "First booking for contact" },
  { value: "time.business_hours", label: "During business hours only" },
];

interface PlaybookEditorProps {
  open: boolean;
  onClose: () => void;
  onSaved: (playbook: Playbook) => void;
  template?: AutomationTemplate | null;
  editingPlaybook?: Playbook | null;
  businessId?: string | null;
}

export function PlaybookEditor({ open, onClose, onSaved, template, editingPlaybook, businessId }: PlaybookEditorProps) {
  const [form, setForm] = useState({ name: "", triggerEvent: "", condition: "" });
  const [actionSteps, setActionSteps] = useState<ActionStep[]>([{ type: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEditing = !!editingPlaybook;

  useEffect(() => {
    if (editingPlaybook) {
      const actions = Array.isArray(editingPlaybook.actions)
        ? (editingPlaybook.actions as ActionStep[])
        : [{ type: "" }];
      setForm({ name: editingPlaybook.name, triggerEvent: editingPlaybook.triggerEvent, condition: editingPlaybook.condition ?? "" });
      setActionSteps(actions.length ? [...actions] : [{ type: "" }]);
      setError(null);
    } else if (template) {
      setForm({ name: template.name, triggerEvent: template.trigger, condition: "" });
      setActionSteps(template.actions.length ? [...template.actions] : [{ type: "" }]);
      setError(null);
    } else {
      setForm({ name: "", triggerEvent: "", condition: "" });
      setActionSteps([{ type: "" }]);
      setError(null);
    }
  }, [editingPlaybook, template]);

  const addStep = () => setActionSteps((s) => [...s, { type: "" }]);
  const removeStep = (i: number) => setActionSteps((s) => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, type: string) =>
    setActionSteps((s) => s.map((st, idx) => (idx === i ? { ...st, type } : st)));

  async function handleSave() {
    setError(null);
    const validSteps = actionSteps.filter((s) => s.type);
    if (!form.name.trim() || !form.triggerEvent || validSteps.length === 0) {
      setError("Name, trigger, and at least one action are required");
      return;
    }
    setSaving(true);

    if (isEditing) {
      const { data, error: apiError } = await updatePlaybook({
        playbookId: editingPlaybook!.id,
        name: form.name,
        triggerEvent: form.triggerEvent,
        condition: form.condition || null,
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
        condition: form.condition || undefined,
        actions: validSteps,
        businessId: businessId ?? undefined,
      });
      setSaving(false);
      if (apiError) {
        setError(apiError);
      } else if (data) {
        onSaved(data);
        setForm({ name: "", triggerEvent: "", condition: "" });
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
                <label className="text-xs text-muted-foreground mb-1 block">When this happens...</label>
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

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Only if... (optional condition)</label>
              <select
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm"
                value={form.condition}
                onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
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

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Automation"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
