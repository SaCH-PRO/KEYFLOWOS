const charts = [
  { title: "Users (7d)", note: "Active vs. new signups" },
  { title: "GMV (30d)", note: "Platform-wide revenue" },
  { title: "Bookings (7d)", note: "Created vs. completed" },
  { title: "Automations", note: "Executions per playbook" },
];

export default function AdminAnalytics() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Growth metrics for the entire platform.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {charts.map((chart) => (
          <div
            key={chart.title}
            className="rounded-2xl border border-border/70 bg-slate-950/70 p-5 space-y-3 shadow-soft-elevated"
          >
            <div>
              <h3 className="text-sm font-semibold">{chart.title}</h3>
              <p className="text-xs text-muted-foreground">{chart.note}</p>
            </div>
            <div className="h-44 rounded-xl border border-border/60 bg-gradient-to-r from-slate-900 via-primary/10 to-emerald-400/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
