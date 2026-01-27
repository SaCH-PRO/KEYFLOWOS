const events = [
  { type: "invoice.paid", time: "12:00", detail: "Invoice #104 paid by Sarah" },
  { type: "booking.created", time: "11:45", detail: "Consult with Dr. Ali" },
  { type: "automation.run", time: "11:30", detail: "Review flow triggered" },
];

export default function AdminEvents() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground">Recent platform-wide signals.</p>
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-2 shadow-[var(--kf-shadow)]">
        {events.map((e) => (
          <div key={e.detail} className="rounded-xl border border-border/60 bg-background px-3 py-3 text-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{e.type}</span>
              <span>{e.time}</span>
            </div>
            <div className="mt-1 text-foreground">{e.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
