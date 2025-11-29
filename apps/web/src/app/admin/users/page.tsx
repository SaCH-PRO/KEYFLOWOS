const users = [
  { email: "owner@example.com", businesses: 3, lastActive: "2025-11-29", status: "active" },
  { email: "clinic@example.com", businesses: 1, lastActive: "2025-11-28", status: "active" },
  { email: "studio@example.com", businesses: 2, lastActive: "2025-11-26", status: "inactive" },
];

export default function AdminUsers() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Platform-wide user list with quick diagnostics.</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-slate-950/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Businesses</th>
              <th className="px-4 py-3 text-left font-medium">Last Active</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-t border-border/60">
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.businesses}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.lastActive}</td>
                <td className="px-4 py-3">
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary"
                    aria-label={`Status ${u.status}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {u.status}
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
