"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import { Automation, createAutomation, fetchAutomations } from "@/lib/client";

const triggers = [
  "contact.created",
  "contact.updated",
  "contact.stage_changed",
  "invoice.paid",
  "invoice.sent",
  "invoice.overdue",
  "booking.created",
  "booking.confirmed",
  "booking.status_changed",
];

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [form, setForm] = useState({
    name: "",
    trigger: "contact.created",
    actionKind: "CREATE_TASK",
    title: "",
    tag: "",
    eventType: "",
    dueInDays: "2",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAutomations().then((res) => {
      setAutomations(res.data ?? []);
      if (res.error) setError(res.error);
    });
  }, []);

  const handleCreate = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError("Name required.");
      return;
    }
    const actions = [];
    if (form.actionKind === "CREATE_TASK") {
      if (!form.title.trim()) {
        setError("Task title required.");
        return;
      }
      actions.push({ kind: "CREATE_TASK", title: form.title.trim(), dueInDays: Number(form.dueInDays) || 2 });
    } else if (form.actionKind === "TAG_CONTACT") {
      if (!form.tag.trim()) {
        setError("Tag required.");
        return;
      }
      actions.push({ kind: "TAG_CONTACT", tag: form.tag.trim() });
    } else if (form.actionKind === "LOG_EVENT") {
      if (!form.eventType.trim()) {
        setError("Event type required.");
        return;
      }
      actions.push({ kind: "LOG_EVENT", eventType: form.eventType.trim() });
    }
    const res = await createAutomation({
      name: form.name.trim(),
      trigger: form.trigger,
      actionData: { actions },
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    const updated = await fetchAutomations();
    setAutomations(updated.data ?? []);
    setForm({
      name: "",
      trigger: "contact.created",
      actionKind: "CREATE_TASK",
      title: "",
      tag: "",
      eventType: "",
      dueInDays: "2",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">Event-driven playbooks wired to CRM + Commerce.</p>
        </div>
      </div>

      {error && <div className="text-xs text-amber-400">{error}</div>}

      <Card title="Create automation" badge="Active">
        <div className="grid gap-2 md:grid-cols-2">
          <Input label="Name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <label className="text-xs text-muted-foreground">
            Trigger
            <select
              className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              value={form.trigger}
              onChange={(e) => setForm((prev) => ({ ...prev, trigger: e.target.value }))}
            >
              {triggers.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {trigger}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Action
            <select
              className="mt-1 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              value={form.actionKind}
              onChange={(e) => setForm((prev) => ({ ...prev, actionKind: e.target.value }))}
            >
              <option value="CREATE_TASK">Create Task</option>
              <option value="TAG_CONTACT">Tag Contact</option>
              <option value="LOG_EVENT">Log Event</option>
            </select>
          </label>
          {form.actionKind === "CREATE_TASK" && (
            <>
              <Input label="Task title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
              <Input label="Due in days" value={form.dueInDays} onChange={(e) => setForm((prev) => ({ ...prev, dueInDays: e.target.value }))} />
            </>
          )}
          {form.actionKind === "TAG_CONTACT" && (
            <Input label="Tag" value={form.tag} onChange={(e) => setForm((prev) => ({ ...prev, tag: e.target.value }))} />
          )}
          {form.actionKind === "LOG_EVENT" && (
            <Input label="Event type" value={form.eventType} onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))} />
          )}
        </div>
        <div className="mt-3">
          <Button onClick={handleCreate}>Save automation</Button>
        </div>
      </Card>

      <Card title="Live playbooks" badge={`${automations.length}`}>
        <div className="space-y-2">
          {automations.length === 0 && <div className="text-xs text-muted-foreground">No automations yet.</div>}
          {automations.map((automation) => (
            <div key={automation.id} className="rounded-2xl border border-border/60 bg-slate-900/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{automation.name}</div>
                <Badge tone="info">{automation.trigger}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Actions: {Array.isArray((automation as any).actionData?.actions) ? (automation as any).actionData.actions.length : 1}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
