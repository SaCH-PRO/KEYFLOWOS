"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchPresenceLeads, type PresenceLead } from "@/lib/client";

export default function PresenceLeadsPage() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [items, setItems] = useState<PresenceLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    fetchPresenceLeads(businessId, 50).then((res) => {
      if (res.error) setError(res.error);
      else setItems(res.data?.items ?? []);
    });
  }, [businessId]);

  if (!businessId) return <div className="p-6 text-sm text-muted-foreground">Pick a workspace.</div>;
  if (error) return <div className="p-6 text-sm text-rose-300">{error}</div>;
  if (!items) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading leads…
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-orange-400" /> Storefront leads
          </h2>
          <p className="text-xs text-muted-foreground">Contacts captured through your storefront forms.</p>
        </div>
        <Link href="/app/crm/contacts" className="text-xs text-orange-400 hover:underline">
          View all contacts →
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-slate-900/40 p-8 text-center text-sm text-muted-foreground">
          No storefront leads yet. They will appear here as visitors fill out your forms.
        </div>
      ) : (
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/60 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Contact</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">Stage</th>
                <th className="text-left px-3 py-2 font-medium">Captured</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const name = c.displayName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
                return (
                  <tr key={c.id} className="border-t border-border/30 hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <Link href={`/app/crm/contacts/${c.id}`} className="hover:text-orange-400">
                        {name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.email || c.phone || c.whatsappNumber || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.sourceDetail || "storefront"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{c.lifecycleStage || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
