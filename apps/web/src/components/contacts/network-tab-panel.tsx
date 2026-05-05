"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import {
  CONTACT_RELATIONSHIP_EDGE_TYPES,
  getContactRelationshipEdgeLabel,
} from "@keyflow/shared";
import {
  fetchContactNetwork,
  fetchContactRelationships,
  fetchContacts,
  createContactRelationship,
  deleteContactRelationship,
  type ContactRelationships,
  type NetworkGraph,
  type Contact,
} from "@/lib/client";
import { NetworkGraph as NetworkGraphView } from "./network-graph";

interface NetworkTabPanelProps {
  contactId: string;
  contactName?: string;
  businessId?: string | null;
  onNavigateToContact?: (contactId: string) => void;
}

export function NetworkTabPanel({ contactId, contactName, businessId, onNavigateToContact }: NetworkTabPanelProps) {
  const bizId = businessId || undefined;
  const [relationships, setRelationships] = useState<ContactRelationships>({ outgoing: [], incoming: [] });
  const [graph, setGraph] = useState<NetworkGraph>({ rootId: contactId, nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [linkType, setLinkType] = useState<string>("colleague_of");
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [rels, net] = await Promise.all([
      fetchContactRelationships(contactId, bizId),
      fetchContactNetwork(contactId, bizId, 2),
    ]);
    if (rels.data) setRelationships(rels.data);
    if (net.data) setGraph(net.data);
    setLoading(false);
  }, [contactId, bizId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await fetchContacts(bizId, { search: q, take: 8 });
    setResults((res.data?.contacts ?? []).filter((c: Contact) => c.id !== contactId));
    setSearching(false);
  }, [contactId, bizId]);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(searchQ), 250);
    return () => clearTimeout(timer);
  }, [searchQ, runSearch]);

  const linkContact = async (target: Contact) => {
    setSavingId(target.id);
    try {
      const { error } = await createContactRelationship({
        contactId,
        toContactId: target.id,
        type: linkType,
        businessId: bizId,
      });
      if (error) throw new Error(error);
      toast.success("Relationship added");
      setSearchQ("");
      setResults([]);
      setAdding(false);
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const removeEdge = async (edgeId: string) => {
    setSavingId(edgeId);
    try {
      const { error } = await deleteContactRelationship(edgeId, bizId);
      if (error) throw new Error(error);
      toast.success("Relationship removed");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const firstDegree = useMemo(() => {
    const seen = new Map<string, { contact: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }; types: string[]; edgeId: string; direction: "out" | "in" }>();
    for (const e of relationships.outgoing) {
      const key = e.toContact.id;
      if (!seen.has(key)) seen.set(key, { contact: e.toContact, types: [], edgeId: e.id, direction: "out" });
      seen.get(key)!.types.push(getContactRelationshipEdgeLabel(e.type));
    }
    for (const e of relationships.incoming) {
      const key = e.fromContact.id;
      if (!seen.has(key)) seen.set(key, { contact: e.fromContact, types: [], edgeId: e.id, direction: "in" });
      seen.get(key)!.types.push(getContactRelationshipEdgeLabel(e.type));
    }
    return Array.from(seen.values());
  }, [relationships]);

  const secondDegreeCount = useMemo(() => {
    const firstIds = new Set(firstDegree.map((c) => c.contact.id));
    firstIds.add(contactId);
    return graph.nodes.filter((n) => !firstIds.has(n.id)).length;
  }, [graph.nodes, firstDegree, contactId]);

  return (
    <div className="space-y-4 px-1">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            {firstDegree.length} direct · {secondDegreeCount} second-degree
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> {adding ? "Close" : "Link contact"}
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border/40 bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
              aria-label="Relationship type"
            >
              {CONTACT_RELATIONSHIP_EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {getContactRelationshipEdgeLabel(t)}
                </option>
              ))}
            </select>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search contacts to link…"
              className="flex-1 text-xs rounded-md border border-border bg-background px-2 py-1.5"
            />
          </div>
          {searching && <p className="text-[10px] text-muted-foreground">Searching…</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-border/30 max-h-[180px] overflow-y-auto">
              {results.map((r) => {
                const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.email || "Contact";
                return (
                  <li key={r.id} className="flex items-center justify-between py-1.5 text-xs">
                    <div>
                      <span className="font-medium">{name}</span>
                      {r.email && <span className="text-muted-foreground ml-2">{r.email}</span>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void linkContact(r)}
                      disabled={savingId === r.id}
                    >
                      Link
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground">
            Adding &quot;{getContactRelationshipEdgeLabel(linkType)}&quot; auto-creates the inverse so the graph stays two-way.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <NetworkGraphView
            rootId={contactId}
            nodes={graph.nodes}
            edges={graph.edges}
            height={300}
            onNodeClick={(id) => onNavigateToContact?.(id)}
          />

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Direct connections
            </h4>
            {firstDegree.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No direct connections yet for {contactName || "this contact"}.
              </p>
            )}
            <ul className="space-y-1.5">
              {firstDegree.map((c) => {
                const name = `${c.contact.firstName ?? ""} ${c.contact.lastName ?? ""}`.trim() || c.contact.email || "Contact";
                return (
                  <li
                    key={c.contact.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-md bg-white/[0.02] border border-border/30"
                  >
                    <button
                      type="button"
                      onClick={() => onNavigateToContact?.(c.contact.id)}
                      className="flex items-center gap-2 text-left flex-1 min-w-0 hover:text-[hsl(var(--kf-accent2))]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.types.join(" · ")}
                        </div>
                      </div>
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeEdge(c.edgeId)}
                      className="text-muted-foreground hover:text-red-400"
                      aria-label="Remove relationship"
                      disabled={savingId === c.edgeId}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
