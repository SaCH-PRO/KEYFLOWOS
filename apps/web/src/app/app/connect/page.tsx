"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plug, CheckCircle2, AlertCircle, Loader2, RefreshCw, Activity,
  Unlink, ZapOff, Zap, ChevronRight, ExternalLink, ShieldCheck,
  Mail, Calendar, HardDrive, FileText, Users, Building2, Map as MapIcon,
  MessageCircle, Share2, CreditCard, Wallet, Plug2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type ConnectorGroup = "google" | "social" | "payments" | "messaging" | "other";

interface ConnectorMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  group?: ConnectorGroup;
  icon: string;
  supportsSync: boolean;
  authType?: string;
  externalUrl?: string;
}

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
  meta: ConnectorMeta;
  health: ConnectorHealth;
}

interface ActivityEntry {
  id: string;
  connectorType: string;
  action: string;
  status: string;
  message: string | null;
  itemsAffected: number | null;
  durationMs: number | null;
  createdAt: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  mail: Mail,
  calendar: Calendar,
  "hard-drive": HardDrive,
  "file-text": FileText,
  users: Users,
  building: Building2,
  map: MapIcon,
  "message-circle": MessageCircle,
  "share-2": Share2,
  "credit-card": CreditCard,
  wallet: Wallet,
  plug: Plug2,
};

const GROUP_LABELS: Record<ConnectorGroup, { label: string; emoji: string; gradient: string }> = {
  google: { label: "Google Workspace", emoji: "G", gradient: "from-blue-500/20 to-red-500/20" },
  social: { label: "Social", emoji: "S", gradient: "from-pink-500/20 to-purple-500/20" },
  payments: { label: "Payments", emoji: "P", gradient: "from-emerald-500/20 to-teal-500/20" },
  messaging: { label: "Messaging", emoji: "M", gradient: "from-cyan-500/20 to-blue-500/20" },
  other: { label: "Other", emoji: "•", gradient: "from-zinc-500/20 to-zinc-600/20" },
};

const GROUP_ORDER: ConnectorGroup[] = ["google", "social", "messaging", "payments", "other"];

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  connected: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30", label: "Connected" },
  disconnected: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30", label: "Not connected" },
  error: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", label: "Error" },
  expired: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", label: "Re-auth needed" },
  syncing: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", label: "Syncing" },
};

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

function ConnectorCard({
  entry,
  onSync,
  onTest,
  onReconnect,
  onDisconnect,
  onActivity,
  busy,
  testResult,
}: {
  entry: DashboardEntry;
  onSync: (type: string) => void;
  onTest: (type: string) => void;
  onReconnect: (type: string) => void;
  onDisconnect: (type: string) => void;
  onActivity: (type: string) => void;
  busy: { sync?: boolean; test?: boolean; reconnect?: boolean; disconnect?: boolean };
  testResult?: { success: boolean; error?: string; account?: string };
}) {
  const Icon = ICONS[entry.meta.icon] ?? Plug2;
  const statusStyle = STATUS_STYLES[entry.health.status] ?? STATUS_STYLES.disconnected;
  const isConnected = entry.health.status === "connected" || entry.health.status === "syncing";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-4 transition-all ${
        isConnected ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-border/40 bg-card/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-muted/40 to-muted/10 border border-border/30 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-medium truncate">{entry.meta.name}</h4>
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border}`}
              >
                {entry.health.status === "syncing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {entry.health.status === "connected" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {(entry.health.status === "error" || entry.health.status === "expired") && (
                  <AlertCircle className="h-2.5 w-2.5" />
                )}
                {statusStyle.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.meta.description}</p>
            {entry.health.connectedAccount && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                {entry.health.connectedAccount}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {entry.meta.supportsSync && (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  {formatTimeAgo(entry.health.lastSyncAt)}
                </span>
              )}
              {entry.health.errorCount > 0 && (
                <span className="inline-flex items-center gap-1 text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {entry.health.errorCount} errs
                </span>
              )}
            </div>
            {testResult && (
              <p
                className={`text-[11px] mt-1.5 ${
                  testResult.success ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {testResult.success
                  ? `OK${testResult.account ? ` — ${testResult.account}` : ""}`
                  : testResult.error}
              </p>
            )}
          </div>
        </div>

        {entry.meta.externalUrl && (
          <a
            href={entry.meta.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Open ${entry.meta.name}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/30">
        {isConnected ? (
          <>
            {entry.meta.supportsSync && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onSync(entry.meta.type)}
                disabled={busy.sync}
                className="h-7 px-2 text-xs"
              >
                {busy.sync ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Sync now
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onTest(entry.meta.type)}
              disabled={busy.test}
              className="h-7 px-2 text-xs"
            >
              {busy.test ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <ShieldCheck className="h-3 w-3 mr-1" />
              )}
              Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onActivity(entry.meta.type)}
              className="h-7 px-2 text-xs"
            >
              <Activity className="h-3 w-3 mr-1" />
              Activity
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReconnect(entry.meta.type)}
              disabled={busy.reconnect}
              className="h-7 px-2 text-xs"
            >
              {busy.reconnect ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Plug className="h-3 w-3 mr-1" />
              )}
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDisconnect(entry.meta.type)}
              disabled={busy.disconnect}
              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
            >
              <Unlink className="h-3 w-3 mr-1" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="default"
            onClick={() => onReconnect(entry.meta.type)}
            disabled={busy.reconnect}
            className="h-7 px-3 text-xs"
          >
            {busy.reconnect ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plug className="h-3 w-3 mr-1" />}
            Connect
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export default function KeyFlowConnectPage() {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, { sync?: boolean; test?: boolean; reconnect?: boolean; disconnect?: boolean }>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string; account?: string }>>({});
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [activityOpen, setActivityOpen] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ open: boolean; message: string; action: () => void }>({
    open: false,
    message: "",
    action: () => {},
  });

  const businessId = getStoredBusinessId();

  const fetchDashboard = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiGet<DashboardEntry[]>(`/connectors/businesses/${businessId}/dashboard`);
    if (res.data) setEntries(res.data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Surface success / error from Google unified OAuth callback.
  useEffect(() => {
    const status = searchParams.get("google");
    if (status === "connected") {
      const services = searchParams.get("services");
      const email = searchParams.get("email");
      toast.success(
        `Google account connected${email ? ` (${email})` : ""}${
          services ? ` — ${services.split(",").length} services enabled` : ""
        }`,
      );
      fetchDashboard();
    } else if (status === "error") {
      const reason = searchParams.get("reason") || "Connection failed";
      toast.error(`Google connection failed: ${reason}`);
    }
  }, [searchParams, fetchDashboard]);

  const setBusyFor = (type: string, key: keyof typeof busy[string], val: boolean) => {
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], [key]: val } }));
  };

  const handleConnectGoogle = async () => {
    if (!businessId) return;
    setGoogleConnecting(true);
    const res = await apiPostSimple<{ authUrl: string }>(
      `/connect/google-suite/businesses/${businessId}/auth-url`,
      {},
    );
    if (res.error) {
      toast.error(res.error);
      setGoogleConnecting(false);
      return;
    }
    if (res.data?.authUrl) {
      window.location.href = res.data.authUrl;
    } else {
      setGoogleConnecting(false);
    }
  };

  const handleSync = async (type: string) => {
    if (!businessId) return;
    setBusyFor(type, "sync", true);
    const res = await apiPostSimple(`/connectors/businesses/${businessId}/sync/${type}`, {});
    if (res.error) toast.error(res.error);
    else toast.success("Sync completed");
    await fetchDashboard();
    setBusyFor(type, "sync", false);
  };

  const handleTest = async (type: string) => {
    if (!businessId) return;
    setBusyFor(type, "test", true);
    const res = await apiPostSimple<{ success: boolean; error?: string; account?: string }>(
      `/connectors/businesses/${businessId}/test/${type}`,
      {},
    );
    if (res.error) {
      const errMsg = res.error;
      setTestResults((p) => ({ ...p, [type]: { success: false, error: errMsg } }));
    } else if (res.data) {
      const data = res.data;
      setTestResults((p) => ({ ...p, [type]: data }));
    }
    setBusyFor(type, "test", false);
  };

  const handleReconnect = async (type: string) => {
    if (!businessId) return;
    setBusyFor(type, "reconnect", true);
    const res = await apiPostSimple<{ connected: boolean; authUrl?: string }>(
      `/connectors/businesses/${businessId}/reconnect/${type}`,
      {},
    );
    if (res.error) {
      toast.error(res.error);
    } else if (res.data?.authUrl) {
      window.location.href = res.data.authUrl;
      return;
    } else if (res.data?.connected) {
      toast.success("Reconnected");
    } else {
      toast.error("Could not reconnect — try the unified Google flow above");
    }
    await fetchDashboard();
    setBusyFor(type, "reconnect", false);
  };

  const handleDisconnect = (type: string) => {
    const name = entries.find((e) => e.meta.type === type)?.meta.name ?? type;
    setConfirm({
      open: true,
      message: `Disconnect ${name}? You'll need to re-authorize to use it again.`,
      action: async () => {
        if (!businessId) return;
        setBusyFor(type, "disconnect", true);
        const res = await apiPostSimple(`/connectors/businesses/${businessId}/disconnect/${type}`, {});
        if (res.error) toast.error(res.error);
        else toast.success(`${name} disconnected`);
        await fetchDashboard();
        setBusyFor(type, "disconnect", false);
      },
    });
  };

  const handleActivity = async (type: string) => {
    if (!businessId) return;
    setActivityOpen(type);
    setActivityLoading(true);
    const res = await apiGet<ActivityEntry[]>(
      `/connectors/businesses/${businessId}/activity?type=${type}&limit=25`,
    );
    if (res.data) setActivityLog(res.data);
    setActivityLoading(false);
  };

  const grouped = entries.reduce<Record<ConnectorGroup, DashboardEntry[]>>(
    (acc, e) => {
      const group = (e.meta.group ?? "other") as ConnectorGroup;
      if (!acc[group]) acc[group] = [];
      acc[group].push(e);
      return acc;
    },
    { google: [], social: [], payments: [], messaging: [], other: [] },
  );

  const googleConnectedCount = grouped.google.filter(
    (e) => e.health.status === "connected" || e.health.status === "syncing",
  ).length;

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto animate-pulse">
        <div className="h-32 rounded-2xl bg-muted/10 border border-border/20" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-muted/10 border border-border/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <Plug className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">KeyFlow Connect</h1>
          <p className="text-sm text-muted-foreground">
            Your hub for every external service that powers your workspace.
          </p>
        </div>
      </motion.div>

      {/* Unified Google connect CTA */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 p-5 bg-gradient-to-br from-blue-500/10 via-red-500/5 to-yellow-500/10"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4" />
              <h3 className="text-sm font-semibold">Connect your Google account</h3>
              {googleConnectedCount > 0 && (
                <Badge tone="success" className="text-[10px]">
                  {googleConnectedCount} active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              One sign-in unlocks Gmail, Calendar, Drive, Docs, Sheets, Forms, Contacts,
              Business Profile, and Maps. You can revoke individual services any time.
            </p>
          </div>
          <Button
            onClick={handleConnectGoogle}
            disabled={googleConnecting || !businessId}
            className="shrink-0"
          >
            {googleConnecting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plug className="h-4 w-4 mr-2" />
            )}
            {googleConnectedCount > 0 ? "Re-authorize Google" : "Connect Google account"}
          </Button>
        </div>
      </motion.div>

      {GROUP_ORDER.map((group) => {
        const items = grouped[group] ?? [];
        if (!items.length) return null;
        const meta = GROUP_LABELS[group];
        return (
          <section key={group} className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={`h-7 w-7 rounded-lg bg-gradient-to-br ${meta.gradient} border border-border/40 flex items-center justify-center text-[11px] font-bold`}
              >
                {meta.emoji}
              </div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {meta.label}
              </h3>
              <span className="text-[10px] text-muted-foreground/60">
                {items.filter((i) => i.health.status === "connected").length}/{items.length} connected
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((entry) => (
                <ConnectorCard
                  key={entry.meta.type}
                  entry={entry}
                  busy={busy[entry.meta.type] ?? {}}
                  testResult={testResults[entry.meta.type]}
                  onSync={handleSync}
                  onTest={handleTest}
                  onReconnect={handleReconnect}
                  onDisconnect={handleDisconnect}
                  onActivity={handleActivity}
                />
              ))}
            </div>
          </section>
        );
      })}

      <AnimatePresence>
        {activityOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
            onClick={() => setActivityOpen(null)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl bg-background border border-border/40 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  <h3 className="text-sm font-semibold">Activity log — {activityOpen}</h3>
                </div>
                <button
                  onClick={() => setActivityOpen(null)}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  Close
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {activityLoading ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                    Loading…
                  </div>
                ) : activityLog.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    <ZapOff className="h-5 w-5 inline-block mr-2 opacity-50" />
                    No activity recorded yet.
                  </div>
                ) : (
                  activityLog.map((row) => (
                    <div
                      key={row.id}
                      className="text-xs p-3 rounded-lg border border-border/30 bg-muted/10"
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
                          <ChevronRight className="h-3 w-3" />
                          {row.action}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTimeAgo(row.createdAt)}
                        </span>
                      </div>
                      {row.message && <p className="text-muted-foreground">{row.message}</p>}
                      {(row.itemsAffected !== null || row.durationMs !== null) && (
                        <div className="flex gap-3 text-[10px] text-muted-foreground/70 mt-1">
                          {row.itemsAffected !== null && <span>{row.itemsAffected} items</span>}
                          {row.durationMs !== null && <span>{row.durationMs}ms</span>}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirm.open}
        title="Disconnect connector"
        message={confirm.message}
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => {
          confirm.action();
          setConfirm((p) => ({ ...p, open: false }));
        }}
        onCancel={() => setConfirm((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
