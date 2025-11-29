const businesses = [
  { name: "Demo Clinic", owner: "owner@example.com", mrr: "TTD 22,500", status: "active" },
  { name: "Studio North", owner: "studio@example.com", mrr: "TTD 15,400", status: "active" },
  { name: "Wellness Hub", owner: "ops@example.com", mrr: "TTD 8,200", status: "suspended" },
];

export default function AdminBusinesses() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
        <p className="text-sm text-muted-foreground">All workspaces with owner, MRR, and status.</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-slate-950/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Business</th>
              <th className="px-4 py-3 text-left font-medium">Owner</th>
              <th className="px-4 py-3 text-left font-medium">MRR</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((b) => (
              <tr key={b.name} className="border-t border-border/60">
                <td className="px-4 py-3">{b.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{b.owner}</td>
                <td className="px-4 py-3 text-muted-foreground">{b.mrr}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary"
                    aria-label={`Status ${b.status}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
