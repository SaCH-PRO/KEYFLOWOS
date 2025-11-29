"use client";

import { Sparkles, Zap } from "lucide-react";

const playbooks = [
  {
    name: "Invoice paid → Send receipt + booking confirmation",
    trigger: "invoice.paid",
    action: "Email + WhatsApp confirmation",
    status: "Active",
  },
  {
    name: "New lead → Create contact + draft DM",
    trigger: "contact.created",
    action: "Social DM draft",
    status: "Draft",
  },
];

export default function AutomationsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Event-driven playbooks. Triggers fire on bookings, invoices, contacts, and social events.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Live Playbooks</div>
            <p className="text-sm text-muted-foreground">These respond to emitted events in the backend.</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            <Zap className="w-4 h-4" />
            New playbook
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {playbooks.map((pb) => (
            <div
              key={pb.name}
              className="rounded-2xl border border-border/60 bg-slate-900/60 p-3 flex flex-col gap-1 text-sm"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">{pb.name}</div>
                <span className="rounded-full border border-emerald-400/60 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
                  {pb.status}
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground">Trigger: {pb.trigger}</div>
              <div className="text-[12px] text-muted-foreground">Action: {pb.action}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Future: visual builder with nodes for trigger → conditions → actions, connected to React Flow.
        </div>
      </div>
    </div>
  );
}
