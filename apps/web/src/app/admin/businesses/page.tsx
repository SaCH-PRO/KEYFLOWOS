"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, Building2 } from "lucide-react";
import { fetchAdminBusinesses, type AdminBusiness } from "@/lib/api/admin-analytics";

export default function AdminBusinesses() {
  const [businesses, setBusinesses] = useState<AdminBusiness[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminBusinesses(search || undefined, limit, offset);
      if (res.data) {
        setBusinesses(res.data.items);
        setTotal(res.data.total);
      }
    } catch (e) {
      console.error("Failed to load businesses", e);
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
          <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
          <p className="text-sm text-muted-foreground">All workspaces with owner and activity.</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <Building2 className="inline w-4 h-4 mr-1" />
          {total} total
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search businesses..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          className="w-full max-w-sm rounded-xl border border-border/60 bg-card/50 pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-slate-950/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Business</th>
              <th className="px-4 py-3 text-left font-medium">Owner</th>
              <th className="px-4 py-3 text-left font-medium">Members</th>
              <th className="px-4 py-3 text-left font-medium">Contacts</th>
              <th className="px-4 py-3 text-left font-medium">Invoices</th>
            </tr>
          </thead>
          <tbody>
            {loading && businesses.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : businesses.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No businesses found.</td></tr>
            ) : (
              businesses.map((b) => (
                <tr key={b.id} className="border-t border-border/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{b.currency} · {b.timezone}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div>{b.owner.name || b.owner.email}</div>
                    <div className="text-xs">{b.owner.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{b.memberCount}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.contactCount}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.invoiceCount}</td>
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
