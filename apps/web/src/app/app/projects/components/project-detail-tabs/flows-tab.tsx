"use client";

import { Zap, ExternalLink, Play } from "lucide-react";

export function FlowsTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Flows & Automations</p>
            <p className="text-xs text-muted-foreground mt-0.5">Connect this project to automated workflows and playbooks.</p>
          </div>
          <a
            href="/app/automations"
            className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Open Flows
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested Automations</h4>
        <div className="space-y-2">
          {[
            { name: "Client Update on Stage Change", desc: "Notify client when project moves to a new stage." },
            { name: "Task Overdue Alert", desc: "Get notified when a task passes its due date." },
            { name: "Project Completion Follow-Up", desc: "Send a follow-up email when project is marked complete." },
          ].map((flow) => (
            <div key={flow.name} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.1)" }}>
              <Play className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{flow.name}</p>
                <p className="text-[10px] text-muted-foreground">{flow.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
