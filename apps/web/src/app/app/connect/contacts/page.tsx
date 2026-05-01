"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ConnectorHealth {
  status: "connected" | "disconnected" | "error" | "expired" | "syncing";
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  errorCount: number;
  syncCount: number;
  connectedAt: string | null;
  connectedAccount: string | null;
}

interface DashboardEntry {
  meta: { type: string; name: string };
  health: ConnectorHealth;
}

interface SyncResult {
  imported: number;
  updated: number;
}

interface ActivityEntry {
  id: string;
  action: string;
  status: string;
  message: string | null;
  itemsAffected: number | null;
  durationMs: number | null;
  createdAt: string;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ConnectContactsPage() {
  const businessId = getStoredBusinessId();
  const [entry, setEntry] = useState<DashboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [dashRes, actRes] = await Promise.all([
      apiGet<DashboardEntry[]>(
        `/connectors/businesses/${businessId}/dashboard`,
      ),
      apiGet<ActivityEntry[]>(
        `/connectors/businesses/${businessId}/activity?type=google_contacts&limit=15`,
      ),
    ]);
    if (dashRes.data) {
      const found = dashRes.data.find((e) => e.meta.type === "google_contacts");
      setEntry(found ?? null);
    }
    if (actRes.data) {
      setActivity(actRes.data);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSync = async () => {
    if (!businessId) return;
    setSyncing(true);
    setLastResult(null);
    const res = await apiPostSimple<SyncResult>(
      `/connect/businesses/${businessId}/contacts/sync`,
      {},
    );
    setSyncing(false);
    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      setLastResult(res.data);
      toast.success(
        `Synced — ${res.data.imported} imported, ${res.data.updated} updated`,
      );
      await load();
    }
  };

  const isConnected =
    entry?.health.status === "connected" || entry?.health.status === "syncing";

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <Link
        href="/app/connect"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to KeyFlow Connect
      </Link>
      <PageHeader
        icon={Users}
        title="Google Contacts sync"
        subtitle="Pull people from your Google account into your KeyFlow contacts. Re-runs are incremental."
        rightSlot={
          <Link
            href="https://contacts.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 px-2 py-1 rounded-lg"
          >
            <ExternalLink className="h-3 w-3" />
            Open Google Contacts
          </Link>
        }
      />

      {loading ? (
        <div className="h-44 rounded-2xl bg-muted/10 border border-border/20 animate-pulse" />
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {entry?.meta.name ?? "Google Contacts"}
                  </h3>
                  {isConnected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      <AlertCircle className="h-2.5 w-2.5" />
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {entry?.health.connectedAccount ?? "Connect Google to enable sync."}
                </p>
                <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
                  <span>
                    Last sync:{" "}
                    <span className="text-foreground">
                      {formatTimeAgo(entry?.health.lastSyncAt ?? null)}
                    </span>
                  </span>
                  <span>
                    Sync runs:{" "}
                    <span className="text-foreground">
                      {entry?.health.syncCount ?? 0}
                    </span>
                  </span>
                  {(entry?.health.errorCount ?? 0) > 0 && (
                    <span className="text-red-400">
                      {entry?.health.errorCount} errors
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button
              onClick={handleSync}
              disabled={syncing || !isConnected}
              className="shrink-0"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync now
            </Button>
          </div>

          {lastResult && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              Imported <strong>{lastResult.imported}</strong> new contact
              {lastResult.imported === 1 ? "" : "s"} and updated{" "}
              <strong>{lastResult.updated}</strong>.
            </div>
          )}

          {!isConnected && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start justify-between gap-3">
              <span>
                Connect a Google account first — head over to KeyFlow Connect to
                authorise Contacts access.
              </span>
              <Link
                href="/app/connect"
                className="text-amber-200 underline shrink-0"
              >
                Connect
              </Link>
            </div>
          )}

          {entry?.health.lastError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <strong>Last error:</strong> {entry.health.lastError}
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Recent syncs
        </h3>
        {activity.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 border border-dashed border-border/40 rounded-xl">
            No sync history yet.
          </div>
        ) : (
          <div className="space-y-2">
            {activity.map((row) => (
              <div
                key={row.id}
                className="text-xs p-3 rounded-xl border border-border/30 bg-muted/10"
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      row.status === "success"
                        ? "text-emerald-400"
                        : row.status === "error"
                          ? "text-red-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {row.action}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimeAgo(row.createdAt)}
                  </span>
                </div>
                {row.message && (
                  <p className="text-muted-foreground">{row.message}</p>
                )}
                <div className="flex gap-3 text-[10px] text-muted-foreground/70 mt-1">
                  {row.itemsAffected !== null && (
                    <span>{row.itemsAffected} items</span>
                  )}
                  {row.durationMs !== null && <span>{row.durationMs}ms</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
