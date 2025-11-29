const metrics = [
  { label: "Total Users", value: "1,280", delta: "+6 today" },
  { label: "Businesses", value: "540", delta: "+22 this week" },
  { label: "GMV (30d)", value: "TTD 325,000", delta: "+8.4%" },
  { label: "Automations", value: "12,840 runs", delta: "+12%" },
];

const insights = [
  "24 new businesses created this week; 64% completed onboarding.",
  "Automation usage up 12% after playbook update.",
  "Churn risk: contacts → quotes drop detected in 3 workspaces.",
];

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overwatch</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide visibility across users, businesses, revenue, and automations.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 shadow-soft-elevated"
          >
            <div className="text-xs text-muted-foreground uppercase tracking-[0.12em]">{m.label}</div>
            <div className="text-xl font-semibold mt-1">{m.value}</div>
            <div className="text-xs text-emerald-300 mt-1">{m.delta}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Growth funnel</h3>
              <p className="text-xs text-muted-foreground">Signups → Businesses → Paid → Automations</p>
            </div>
            <span className="text-[11px] rounded-full bg-primary/10 border border-primary/40 px-2 py-1 text-primary">
              Live
            </span>
          </div>
          <div className="mt-4 h-48 rounded-xl border border-border/60 bg-gradient-to-r from-slate-900 via-primary/10 to-emerald-400/10" />
        </div>
        <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">System Mind</h3>
            <span className="text-[11px] rounded-full bg-emerald-500/10 border border-emerald-400/50 px-2 py-1 text-emerald-200">
              AI
            </span>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            {insights.map((i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-slate-900/70 p-3">
                {i}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
