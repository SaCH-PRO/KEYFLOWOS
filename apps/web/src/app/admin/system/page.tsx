const insights = [
  "24 new businesses created this week; 64% completed onboarding.",
  "Automation usage up 12% after playbook update.",
  "Churn risk: contacts → quotes drop detected in 3 workspaces.",
];

const actions = [
  "Review onboarding drop-offs in step 2 (calendar connect).",
  "Promote DM → Booking playbook; 18% uplift observed.",
  "Investigate suspended workspace 'Wellness Hub'.",
];

export default function AdminSystem() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">System Mind</h1>
        <p className="text-sm text-muted-foreground">AI insights and owner actions.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5 space-y-3 shadow-[var(--kf-glow)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">AI Insights</h3>
            <span className="text-[11px] rounded-full bg-[var(--kf-mint)]/10 border border-[var(--kf-mint)]/50 px-2 py-1 text-[var(--kf-mint)]">
              Live
            </span>
          </div>
          <div className="space-y-2 text-sm text-foreground">
            {insights.map((i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-background p-3">
                {i}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-3 shadow-[var(--kf-shadow)]">
          <h3 className="text-sm font-semibold">Suggested Actions</h3>
          <div className="space-y-2 text-sm text-foreground">
            {actions.map((a) => (
              <div key={a} className="rounded-xl border border-border/60 bg-background p-3">
                {a}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
