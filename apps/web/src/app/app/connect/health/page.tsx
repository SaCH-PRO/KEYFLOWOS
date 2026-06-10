"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  HeartPulse,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unlink,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge, Card, Table } from "@keyflow/ui";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPostSimple } from "@/lib/api";
import {
  fetchConnectorStatuses,
  fetchConnectorActivity,
  fetchNeedsAttention,
  runHealthCheck,
  type ConnectorStatusSummary,
  type ConnectorActivityLogEntry,
} from "@/lib/api/connectors";

const STATUS_ORDER: Record<string, number> = {
  error: 0,
  expired: 1,
  syncing: 2,
  connected: 3,
  disconnected: 4,
};

const STATUS_BADGE_TONE: Record<string, "success" | "warning" | "danger" | "default"> = {
  connected: "success",
  syncing: "success",
  error: "danger",
  expired: "warning",
  disconnected: "default",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  syncing: "Syncing",
  error: "Error",
  expired: "Re-auth needed",
  disconnected: "Not connected",
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isWithin24h(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 24 * 60 * 60 * 1000;
}

function redirectTo(url: string) {
  window.location.href = url;
}

export default function ConnectHealthPage() {
  const businessId = getStoredBusinessId();
  const [statuses, setStatuses] = useState<ConnectorStatusSummary[]>([]);
  const [activity, setActivity] = useState<ConnectorActivityLogEntry[]>([]);
  const [needsAttention, setNeedsAttention] = useState<{ count: number }>({ count: 0 });
  const [loading, setLoading] = useState(true);
  const [runningCheck, setRunningCheck] = useState(false);
  const [busy, setBusy] = useState<Record<string, { test?: boolean; reconnect?: boolean; disconnect?: boolean }>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [statusRes, activityRes, attentionRes] = await Promise.all([
      fetchConnectorStatuses(businessId),
      fetchConnectorActivity(businessId, 20),
      fetchNeedsAttention(businessId),
    ]);
    if (statusRes.data) setStatuses(statusRes.data);
    if (activityRes.data) setActivity(activityRes.data);
    if (attentionRes.data) setNeedsAttention(attentionRes.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of server data into local state
    load();
  }, [load]);

  const sortedStatuses = useMemo(() => {
    return [...statuses].sort((a, b) => {
      const ao = STATUS_ORDER[a.status] ?? 99;
      const bo = STATUS_ORDER[b.status] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [statuses]);

  const stats = useMemo(() => {
    const connected = statuses.filter((s) => s.status === "connected" || s.status === "syncing").length;
    const needsAttn = needsAttention.count;
    const disconnected = statuses.filter((s) => s.status === "disconnected").length;
    const errors24h = activity.filter((a) => a.status === "failure" && isWithin24h(a.createdAt)).length;
    return { connected, needsAttn, disconnected, errors24h };
  }, [statuses, needsAttention, activity]);

  const handleRunHealthCheck = async () => {
    if (!businessId) return;
    setRunningCheck(true);
    const res = await runHealthCheck(businessId);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`Health check complete — ${res.data?.checked ?? 0} checked, ${res.data?.alerts ?? 0} alerts`);
    }
    await load();
    setRunningCheck(false);
  };

  const handleTest = useCallback(async (type: string) => {
    if (!businessId) return;
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], test: true } }));
    const res = await apiPostSimple<{ success: boolean; error?: string; account?: string }>(
      `/connectors/businesses/${businessId}/test/${type}`,
      {},
    );
    if (res.error) {
      setTestResults((p) => ({ ...p, [type]: { success: false, error: res.error ?? undefined } }));
    } else if (res.data) {
      setTestResults((p) => ({ ...p, [type]: res.data! }));
    }
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], test: false } }));
  }, [businessId]);

  const handleReconnect = useCallback(async (type: string) => {
    if (!businessId) return;
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], reconnect: true } }));
    const res = await apiPostSimple<{ connected: boolean; authUrl?: string }>(
      `/connectors/businesses/${businessId}/reconnect/${type}`,
      {},
    );
    if (res.error) {
      toast.error(res.error);
    } else if (res.data?.authUrl) {
      redirectTo(res.data.authUrl);
      return;
    } else if (res.data?.connected) {
      toast.success("Reconnected");
    }
    await load();
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], reconnect: false } }));
  }, [businessId, load]);

  const handleDisconnect = useCallback(async (type: string) => {
    if (!businessId) return;
    const name = statuses.find((s) => s.type === type)?.name ?? type;
    if (!window.confirm(`Disconnect ${name}? You'll need to re-authorize to use it again.`)) return;
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], disconnect: true } }));
    const res = await apiPostSimple(`/connectors/businesses/${businessId}/disconnect/${type}`, {});
    if (res.error) toast.error(res.error);
    else toast.success(`${name} disconnected`);
    await load();
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], disconnect: false } }));
  }, [businessId, load, statuses]);

  const tableRows = sortedStatuses.map((s: ConnectorStatusSummary) => {
    const tone = STATUS_BADGE_TONE[s.status] ?? "default";
    const testResult = testResults[s.type];
    return [
      <div key={`name-${s.type}`} className="flex items-center gap-2">
        <span className="font-medium">{s.name}</span>
        {s.connectedAccount && (
          <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
            {s.connectedAccount}
          </span>
        )}
      </div>,
      <Badge key={`status-${s.type}`} tone={tone} className="text-[10px] px-2 py-0.5">
        {STATUS_LABEL[s.status] ?? s.status}
      </Badge>,
      <span key={`sync-${s.type}`} className="text-[11px] text-muted-foreground">
        {s.status === "connected" || s.status === "syncing" ? "Active" : "—"}
      </span>,
      <span key={`err-${s.type}`} className="text-[11px]">
        {testResult ? (
          <span className={testResult.success ? "text-emerald-400" : "text-red-400"}>
            {testResult.success ? "OK" : testResult.error}
          </span>
        ) : (
          "—"
        )}
      </span>,
      <div key={`actions-${s.type}`} className="flex items-center gap-1">
        {s.status !== "disconnected" && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => handleTest(s.type)}
            disabled={busy[s.type]?.test}
            title="Validate the stored credential"
          >
            {busy[s.type]?.test ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            Test
          </Button>
        )}
        {s.status === "disconnected" ? (
          <Button
            size="xs"
            variant="default"
            onClick={() => handleReconnect(s.type)}
            disabled={busy[s.type]?.reconnect}
          >
            {busy[s.type]?.reconnect ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
            Connect
          </Button>
        ) : (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => handleReconnect(s.type)}
            disabled={busy[s.type]?.reconnect}
          >
            {busy[s.type]?.reconnect ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Reconnect
          </Button>
        )}
        {s.status !== "disconnected" && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => handleDisconnect(s.type)}
            disabled={busy[s.type]?.disconnect}
            className="text-red-400 hover:text-red-300"
          >
            {busy[s.type]?.disconnect ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
            Disconnect
          </Button>
        )}
      </div>,
    ];
  });

  const activityColor = (entry: ConnectorActivityLogEntry) => {
    if (entry.status === "failure") return "border-red-500/30 bg-red-500/10 text-red-400";
    if (entry.action === "sync") return "border-blue-500/30 bg-blue-500/10 text-blue-400";
    if (entry.status === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    return "border-border/30 bg-muted/10 text-muted-foreground";
  };

  const activityIcon = (entry: ConnectorActivityLogEntry) => {
    if (entry.status === "failure") return <XCircle className="h-3.5 w-3.5" />;
    if (entry.action === "sync") return <RefreshCw className="h-3.5 w-3.5" />;
    if (entry.status === "success") return <CheckCircle2 className="h-3.5 w-3.5" />;
    return <Activity className="h-3.5 w-3.5" />;
  };

  return (
    <WorkspaceShell
      icon={HeartPulse}
      title="Integration Health"
      subtitle="Monitor connector status, errors, and recent activity"
      headerRight={
        <Button
          size="sm"
          variant="default"
          onClick={handleRunHealthCheck}
          disabled={runningCheck || !businessId}
        >
          {runningCheck ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Zap className="h-4 w-4 mr-1.5" />}
          Run Health Check
        </Button>
      }
    >
      <div className="space-y-6 max-w-6xl mx-auto p-4 md:p-6">
        <Link
          href="/app/connect"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Connect hub
        </Link>

        {/* Health Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card variant="glass" padding="md">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.connected}</div>
                <div className="text-xs text-muted-foreground">Connected</div>
              </div>
            </div>
          </Card>

          <Card variant="glass" padding="md">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.needsAttn}</div>
                <div className="text-xs text-muted-foreground">Needs Attention</div>
              </div>
            </div>
          </Card>

          <Card variant="glass" padding="md">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center">
                <Plug className="h-5 w-5 text-zinc-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.disconnected}</div>
                <div className="text-xs text-muted-foreground">Disconnected</div>
              </div>
            </div>
          </Card>

          <Card variant="glass" padding="md">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.errors24h}</div>
                <div className="text-xs text-muted-foreground">Errors (24h)</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Connector Status Table */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Connector Status
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-16 border border-border/40 rounded-2xl bg-card/40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : statuses.length === 0 ? (
            <div className="text-center py-16 border border-border/40 rounded-2xl bg-card/40">
              <Plug className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No connectors found.</p>
            </div>
          ) : (
            <Table
              headers={["Connector", "Status", "Last sync", "Test result", "Actions"]}
              rows={tableRows}
            />
          )}
        </section>

        {/* Activity Timeline */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Activity
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-16 border border-border/40 rounded-2xl bg-card/40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activity.length === 0 ? (
            <div className="text-center py-16 border border-border/40 rounded-2xl bg-card/40">
              <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activity.map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${activityColor(entry)}`}
                >
                  <div className="mt-0.5 shrink-0">{activityIcon(entry)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {entry.connectorType}
                        <span className="opacity-70 mx-1">•</span>
                        {entry.action}
                      </span>
                      <span className="text-[10px] opacity-70 shrink-0">
                        {formatTimeAgo(entry.createdAt)}
                      </span>
                    </div>
                    {entry.message && (
                      <p className="mt-0.5 opacity-80 truncate">{entry.message}</p>
                    )}
                    {(entry.itemsAffected !== null || entry.durationMs !== null) && (
                      <div className="flex gap-3 text-[10px] opacity-60 mt-1">
                        {entry.itemsAffected !== null && <span>{entry.itemsAffected} items</span>}
                        {entry.durationMs !== null && <span>{entry.durationMs}ms</span>}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}
