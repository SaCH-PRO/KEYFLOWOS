"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Filter, RefreshCw, History, AlertCircle } from "lucide-react";
import { apiGet } from "@/lib/api";

/** Per-contact audit entry surfaced to the operator UI. */
export interface ContactAuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { type?: string; id?: string | null; label?: string | null } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ListResponse {
  entries: ContactAuditEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface AuditTabPanelProps {
  businessId?: string | null;
  contactId: string;
}

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  restored: "Restored",
  merged: "Merged",
  reassigned: "Reassigned",
  shared: "Shared",
  imported: "Imported",
  exported: "Exported",
  forget_requested: "Forget requested",
  forget_cancelled: "Forget cancelled",
  forget_purged: "Forget purged",
  bulk_updated: "Bulk updated",
  bulk_deleted: "Bulk deleted",
  note_added: "Note added",
  note_updated: "Note updated",
  note_deleted: "Note deleted",
  task_added: "Task added",
  task_updated: "Task updated",
  task_deleted: "Task deleted",
  communication_logged: "Communication logged",
};

const ACTION_OPTIONS = [
  "",
  "created",
  "updated",
  "deleted",
  "merged",
  "reassigned",
  "exported",
  "forget_requested",
  "forget_cancelled",
  "forget_purged",
  "bulk_updated",
  "bulk_deleted",
];

function formatTs(ts: string): string {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function actionTone(action: string): string {
  if (action.startsWith("forget_purged")) return "bg-red-500/10 text-red-400 border-red-500/30";
  if (action.startsWith("forget_")) return "bg-orange-500/10 text-orange-400 border-orange-500/30";
  if (action === "exported") return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  if (action === "deleted" || action === "bulk_deleted") return "bg-red-500/10 text-red-400 border-red-500/30";
  if (action === "merged") return "bg-purple-500/10 text-purple-400 border-purple-500/30";
  if (action === "created") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function AuditTabPanel({ businessId, contactId }: AuditTabPanelProps) {
  const [entries, setEntries] = useState<ContactAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [untilFilter, setUntilFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buildPath = useCallback(
    (cursorVal?: string | null) => {
      const qs = new URLSearchParams();
      if (actionFilter) qs.set("action", actionFilter);
      if (actorFilter) qs.set("actorId", actorFilter);
      if (sinceFilter) qs.set("since", new Date(sinceFilter).toISOString());
      if (untilFilter) qs.set("until", new Date(untilFilter).toISOString());
      qs.set("limit", "50");
      if (cursorVal) qs.set("cursor", cursorVal);
      return `/crm/businesses/${businessId}/contacts/${contactId}/audit?${qs.toString()}`;
    },
    [businessId, contactId, actionFilter, actorFilter, sinceFilter, untilFilter],
  );

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (!businessId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<ListResponse>(buildPath(mode === "more" ? cursor : null));
        if (res.error || !res.data) throw new Error(res.error || "Failed to load audit log");
        const data = res.data!;
        setEntries((prev) => (mode === "more" ? [...prev, ...data.entries] : data.entries));
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [businessId, buildPath, cursor],
  );

  useEffect(() => {
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, contactId, actionFilter, actorFilter, sinceFilter, untilFilter]);

  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ContactAuditEntry[] }> = [];
    for (const e of entries) {
      const day = new Date(e.createdAt).toLocaleDateString();
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [entries]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="px-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-border/50 bg-muted/20">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Filter className="w-3 h-3" /> Action
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{a ? ACTION_LABELS[a] ?? a : "All actions"}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Actor (user id)</label>
          <input
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="user_…"
            className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
          <input
            type="date"
            value={sinceFilter}
            onChange={(e) => setSinceFilter(e.target.value)}
            className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
          <input
            type="date"
            value={untilFilter}
            onChange={(e) => setUntilFilter(e.target.value)}
            className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => void load("reset")}
          className="ml-auto h-8 inline-flex items-center gap-1.5 px-3 rounded-md bg-background border border-border/60 text-xs hover:bg-muted/40"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <History className="w-8 h-8 mx-auto opacity-40" />
          <p className="text-sm">No audit entries match these filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.day} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-background/80 backdrop-blur-sm py-1">
                {g.day}
              </div>
              {g.items.map((e) => {
                const open = expanded.has(e.id);
                const actorLabel = e.actor?.label || e.actor?.id || e.actor?.type || "system";
                return (
                  <div key={e.id} className="rounded-lg border border-border/50 bg-card/30 hover:bg-card/50 transition">
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      className="w-full text-left p-3 flex items-start gap-3"
                    >
                      <div className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-medium ${actionTone(e.action)}`}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="font-medium text-foreground">{actorLabel}</span>
                          {e.entityType && e.entityType !== "contact" && (
                            <span className="text-muted-foreground">on {e.entityType}</span>
                          )}
                          {e.changedFields.length > 0 && (
                            <span className="text-muted-foreground">· {e.changedFields.length} field{e.changedFields.length === 1 ? "" : "s"}</span>
                          )}
                        </div>
                        {e.reason && <div className="text-[11px] text-muted-foreground mt-0.5">{e.reason}</div>}
                      </div>
                      <div className="shrink-0 text-[10px] text-muted-foreground/70">{formatTs(e.createdAt)}</div>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 border-t border-border/40 pt-2 text-[11px] space-y-2">
                        {e.changedFields.length > 0 && (
                          <div>
                            <div className="text-muted-foreground/70 uppercase tracking-wider text-[10px] mb-1">Changed fields</div>
                            <div className="flex flex-wrap gap-1">
                              {e.changedFields.map((f) => (
                                <span key={f} className="px-1.5 py-0.5 rounded bg-muted text-foreground">{f}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {e.before && Object.keys(e.before).length > 0 && (
                          <pre className="overflow-auto rounded bg-muted/30 p-2 text-[10px] leading-snug">
                            <span className="text-red-400">- before</span>{"\n"}{JSON.stringify(e.before, null, 2)}
                          </pre>
                        )}
                        {e.after && Object.keys(e.after).length > 0 && (
                          <pre className="overflow-auto rounded bg-muted/30 p-2 text-[10px] leading-snug">
                            <span className="text-emerald-400">+ after</span>{"\n"}{JSON.stringify(e.after, null, 2)}
                          </pre>
                        )}
                        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground/80">
                          {e.ip && <span>IP {e.ip}</span>}
                          {e.userAgent && <span className="truncate max-w-md">UA {e.userAgent}</span>}
                          {e.entityId && <span>entityId {e.entityId}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => void load("more")}
              disabled={loading}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-border/40 rounded-md disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
