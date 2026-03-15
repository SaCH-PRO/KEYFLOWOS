"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Zap, Power, PowerOff, Lightbulb } from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { Playbook, fetchPlaybooks, createPlaybook, updatePlaybook } from "@/lib/client";
import { ExplainerButton } from "./explainer-button";

const TRIGGER_OPTIONS = [
  { value: "invoice.paid", label: "Invoice Paid" },
  { value: "invoice.sent", label: "Invoice Sent" },
  { value: "invoice.overdue", label: "Invoice Overdue" },
  { value: "booking.created", label: "Booking Created" },
  { value: "booking.confirmed", label: "Booking Confirmed" },
  { value: "booking.cancelled", label: "Booking Cancelled" },
  { value: "contact.created", label: "Contact Created" },
  { value: "contact.updated", label: "Contact Updated" },
];

const ACTION_OPTIONS = [
  { value: "send_email", label: "Send Email" },
  { value: "send_whatsapp", label: "Send WhatsApp" },
  { value: "create_task", label: "Create Task" },
  { value: "add_tag", label: "Add Tag" },
  { value: "update_status", label: "Update Status" },
];

export function PlaybookPanel() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [form, setForm] = useState({ name: "", triggerEvent: "", actionType: "" });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchPlaybooks();
      setPlaybooks(data ?? []);
      if (error) setError(error);
      setLoading(false);
    };
    void load();
  }, []);

  async function handleCreate() {
    setFormError(null);
    if (!form.name.trim() || !form.triggerEvent || !form.actionType) {
      setFormError("All fields are required");
      return;
    }
    const { data, error } = await createPlaybook({
      name: form.name,
      triggerEvent: form.triggerEvent,
      actions: [{ type: form.actionType }],
    });
    if (error) setFormError(error);
    if (data) {
      setPlaybooks((prev) => [data, ...prev]);
      setForm({ name: "", triggerEvent: "", actionType: "" });
      setShowBuilder(false);
    }
  }

  async function handleToggle(playbook: Playbook) {
    const { data, error } = await updatePlaybook({
      playbookId: playbook.id,
      enabled: !playbook.enabled,
    });
    if (error) {
      setError(error);
    } else if (data) {
      setPlaybooks((prev) => prev.map((p) => (p.id === playbook.id ? data : p)));
    }
  }

  function getTriggerLabel(trigger: string) {
    return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;
  }

  function getActionLabel(actions: unknown) {
    if (!Array.isArray(actions) || actions.length === 0) return "No actions";
    const action = actions[0] as { type?: string };
    return ACTION_OPTIONS.find((a) => a.value === action.type)?.label ?? action.type ?? "Custom action";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ExplainerButton
          items={[
            { title: "What is a Playbook?", text: "A Playbook is a simple rule: WHEN something happens (the trigger) → THEN do something automatically (the action). For example: WHEN a booking is confirmed → THEN send a WhatsApp reminder." },
            { title: "Create a Playbook", text: "Click '+ New Playbook', give it a name, pick what triggers it (e.g. invoice paid, new booking), and choose the action (e.g. send email, update status)." },
            { title: "Toggle On/Off", text: "Each playbook has a power button. Toggle it ON to activate, OFF to pause. Pausing doesn't delete your setup — you can re-enable it anytime." },
            { title: "Starter Ideas", text: "Try these: 1) Auto-send receipt when invoice is paid, 2) Welcome email for new contacts, 3) Follow-up after a booking, 4) Thank-you after a purchase." },
          ]}
        />
        <button
          onClick={() => setShowBuilder(!showBuilder)}
          className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Playbook
        </button>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-primary/40 bg-slate-950/80 p-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4" /> Create Playbook
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  label="Playbook Name"
                  placeholder="Send receipt on payment"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">When this happens...</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={form.triggerEvent}
                    onChange={(e) => setForm((f) => ({ ...f, triggerEvent: e.target.value }))}
                  >
                    <option value="">Select trigger...</option>
                    {TRIGGER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Do this...</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={form.actionType}
                    onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
                  >
                    <option value="">Select action...</option>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowBuilder(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Create Playbook</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Live Playbooks</div>
            <p className="text-sm text-muted-foreground">These respond to emitted events in your business.</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {playbooks.filter((p) => p.enabled).length} active / {playbooks.length} total
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading playbooks...</div>
        ) : playbooks.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-muted) / 0.3)" }}>
            <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
              <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <p className="text-sm font-medium mb-1">No automations yet</p>
            <p className="text-xs text-muted-foreground">Create a playbook to start automating your business flows.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                className={`rounded-2xl border p-3 flex flex-col gap-2 text-sm transition-colors ${
                  pb.enabled
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border/60 bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{pb.name}</div>
                  <button
                    onClick={() => handleToggle(pb)}
                    className={`rounded-full p-1.5 transition-colors ${
                      pb.enabled
                        ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        : "bg-slate-500/20 text-slate-400 hover:bg-slate-500/30"
                    }`}
                  >
                    {pb.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="text-primary">Trigger:</span> {getTriggerLabel(pb.triggerEvent)}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="text-primary">Action:</span> {getActionLabel(pb.actions)}
                </div>
                <div className="text-[11px] text-muted-foreground/60">
                  Created: {new Date(pb.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="kf-card-accent p-3 text-xs text-muted-foreground flex items-center gap-2">
          <Lightbulb className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
          Coming soon: Visual flow builder with conditions, delays, and multi-step actions.
        </div>
      </div>
    </div>
  );
}
