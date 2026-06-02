"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, Users } from "lucide-react";
import { fetchAdminUsers, type AdminUser } from "@/lib/api/admin-analytics";

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminUsers(search || undefined, limit, offset);
      if (res.data) {
        setUsers(res.data.items);
        setTotal(res.data.total);
      }
    } catch (e) {
      console.error("Failed to load users", e);
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Platform-wide user list with quick diagnostics.</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <Users className="inline w-4 h-4 mr-1" />
          {total} total
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="w-full max-w-sm rounded-xl border border-border/60 bg-card/50 pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-slate-950/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Businesses</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold">
                          {u.name?.charAt(0)?.toUpperCase() || u.email.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.role}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.businessCount}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      active
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-xs">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset((o) => o + limit)}
            disabled={offset + limit >= total}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
