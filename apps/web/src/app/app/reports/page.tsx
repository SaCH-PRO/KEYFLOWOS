export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          KPI snapshots and exportable summaries will live here.
        </p>
      </div>
      <div className="rounded-3xl border border-border/60 bg-slate-950/70 p-6 text-sm text-muted-foreground">
        Upcoming: revenue, bookings, and engagement dashboards powered by live data.
      </div>
    </div>
  );
}
