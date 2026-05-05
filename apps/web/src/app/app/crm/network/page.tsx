"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Button } from "@keyflow/ui";
import {
  CONTACT_RELATIONSHIP_EDGE_TYPES,
  getContactRelationshipEdgeLabel,
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  getContactRelationshipHealthLabel,
} from "@keyflow/shared";
import { fetchNetworkGraph, type NetworkGraph } from "@/lib/client";
import { NetworkGraph as NetworkGraphView } from "@/components/contacts/network-graph";

export default function NetworkPage() {
  const router = useRouter();
  const [graph, setGraph] = useState<NetworkGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<string>("");
  const [health, setHealth] = useState<string>("");
  const [minDealValue, setMinDealValue] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await fetchNetworkGraph(undefined, {
        type: type || undefined,
        relationshipHealth: health || undefined,
        minDealValue: minDealValue ? Number(minDealValue) : undefined,
        search: search || undefined,
      });
      if (cancelled) return;
      if (res.data) setGraph(res.data);
      setLoading(false);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [type, health, minDealValue, search]);

  const stats = useMemo(() => {
    const byType = new Map<string, number>();
    for (const e of graph.edges) {
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    }
    return { nodes: graph.nodes.length, edges: graph.edges.length, byType };
  }, [graph]);

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Network</h1>
          <p className="text-sm text-muted-foreground">
            Map of relationships, referrals and introductions across your contacts.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {stats.nodes} contacts · {stats.edges} relationships
        </div>
      </header>

      <div className="rounded-2xl border border-border/40 bg-white/[0.02] p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-muted-foreground gap-1">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
            >
              <option value="">All</option>
              {CONTACT_RELATIONSHIP_EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {getContactRelationshipEdgeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-muted-foreground gap-1">
            Relationship health
            <select
              value={health}
              onChange={(e) => setHealth(e.target.value)}
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
            >
              <option value="">All</option>
              {CONTACT_RELATIONSHIP_HEALTH_VALUES.map((h) => (
                <option key={h} value={h}>
                  {getContactRelationshipHealthLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-muted-foreground gap-1">
            Min deal value (paid)
            <input
              type="number"
              min={0}
              value={minDealValue}
              onChange={(e) => setMinDealValue(e.target.value)}
              placeholder="e.g. 500"
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wider text-muted-foreground gap-1">
            Search
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="name or email"
                className="w-full text-xs rounded-md border border-border bg-background pl-7 pr-2 py-1.5"
              />
            </div>
          </label>
        </div>
        {(type || health || minDealValue || search) && (
          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setType("");
                setHealth("");
                setMinDealValue("");
                setSearch("");
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <NetworkGraphView
            nodes={graph.nodes}
            edges={graph.edges}
            height={460}
            onNodeClick={(id) => router.push(`/app/crm/contacts/${id}`)}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Relationship breakdown
              </h3>
              {stats.byType.size === 0 ? (
                <p className="text-xs text-muted-foreground">No relationships match the current filters.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {Array.from(stats.byType.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([t, count]) => (
                      <li key={t} className="flex justify-between">
                        <span>{getContactRelationshipEdgeLabel(t)}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Contacts in graph
              </h3>
              {graph.nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No contacts yet — start by linking two contacts in any contact&apos;s Network tab.</p>
              ) : (
                <ul className="space-y-1 text-xs max-h-[200px] overflow-y-auto">
                  {graph.nodes.slice(0, 50).map((n) => {
                    const name = `${n.firstName ?? ""} ${n.lastName ?? ""}`.trim() || n.email || "Contact";
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => router.push(`/app/crm/contacts/${n.id}`)}
                          className="text-left hover:text-[hsl(var(--kf-accent2))]"
                        >
                          {name}
                          {n.companyName && (
                            <span className="text-muted-foreground"> · {n.companyName}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
