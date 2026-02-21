"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@keyflow/ui";
import { Sparkles, Zap, Plus, Power, PowerOff } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { Playbook, fetchPlaybooks, createPlaybook, updatePlaybook } from "@/lib/client";

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

export default function AutomationsPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [form, setForm] = useState({ name: "", triggerEvent: "", actionType: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);

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
      <PageHeader
        icon={Zap}
        title="Automations"
        subtitle="Build workflows to automate your business"
        actionLabel="New Playbook"
        onAction={() => setShowBuilder(!showBuilder)}
        rightSlot={
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        }
      />

      <FeatureGuide
        featureKey="automations"
        title="Getting Started with Automations"
        description="Automations (Playbooks) let your business run on autopilot. Instead of manually following up, sending receipts, or updating records — set it once and let KeyFlow handle the rest every time."
        steps={[
          { title: "Understand the Concept", description: "A Playbook is simple: WHEN something happens (the trigger) → THEN do something automatically (the action). For example: WHEN a booking is confirmed → THEN send a WhatsApp reminder to the client." },
          { title: "Click '+ New Playbook'", description: "Give your playbook a clear name that describes what it does, like \"Send receipt when invoice paid\" or \"Welcome new contacts\". A good name helps you manage multiple automations later." },
          { title: "Pick Your Trigger", description: "Choose the event that kicks things off. Options include: a new booking is created, an invoice gets paid, a new contact is added, or a form submission comes in. This is the 'WHEN' part." },
          { title: "Set Your Action", description: "Choose what should happen automatically. For example: send a confirmation email, update a contact's status, create a follow-up task, or notify you via WhatsApp. This is the 'THEN' part." },
          { title: "Activate & Monitor", description: "Toggle your playbook ON to start it. It will run automatically every time the trigger fires. You can pause it anytime without losing your setup — just toggle it OFF and back ON when ready." },
          { title: "Start with These Common Playbooks", description: "Try these to save hours each week: 1) Auto-send receipt when invoice is paid, 2) Welcome email to new contacts, 3) Follow-up reminder after a booking, 4) Thank-you message after a purchase." },
        ]}
      />

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {showBuilder && (
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
      )}

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
          <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No playbooks yet. Create one to start automating your business flows.
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

        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Coming soon: Visual flow builder with conditions, delays, and multi-step actions.
        </div>
      </div>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
