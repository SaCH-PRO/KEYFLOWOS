"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plug,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Activity,
  Unlink,
  ZapOff,
  Zap,
  ChevronRight,
  ExternalLink,
  PlayCircle,
  ShieldCheck,
  Mail,
  Calendar,
  HardDrive,
  FileText,
  Users,
  Building2,
  Map as MapIcon,
  MessageCircle,
  Share2,
  CreditCard,
  Wallet,
  Plug2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { ConnectorCredentialDialog } from "./ConnectorCredentialDialog";

type ConnectorGroup = "google" | "social" | "payments" | "messaging" | "accounting" | "marketing" | "forms" | "other";

interface ConnectorMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  group?: ConnectorGroup;
  icon: string;
  supportsSync: boolean;
  supportsWebhook?: boolean;
  authType?: string;
  externalUrl?: string;
  connectMode?: "dialog" | "oauth" | "webhook" | "external";
  oauthStartPath?: string;
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
  metadata?: {
    calendarId?: string | null;
    syncDirection?: "push" | "pull" | "two_way" | "disabled";
    syncEnabled?: boolean;
    openConflicts?: number;
    [key: string]: unknown;
  };
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
  accounting: { label: "Accounting", emoji: "A", gradient: "from-indigo-500/20 to-violet-500/20" },
  marketing: { label: "Marketing", emoji: "E", gradient: "from-fuchsia-500/20 to-rose-500/20" },
  forms: { label: "Forms & Webhooks", emoji: "F", gradient: "from-amber-500/20 to-orange-500/20" },
  other: { label: "Other", emoji: "•", gradient: "from-zinc-500/20 to-zinc-600/20" },
};

const GROUP_ORDER: ConnectorGroup[] = ["google", "social", "messaging", "payments", "accounting", "marketing", "forms", "other"];

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
  onSmoke,
  onReconnect,
  onDisconnect,
  onActivity,
  onCredentials,
  busy,
  testResult,
  smokeResult,
}: {
  entry: DashboardEntry;
  onSync: (type: string) => void;
  onTest: (type: string) => void;
  onSmoke: (type: string) => void;
  onReconnect: (type: string) => void;
  onDisconnect: (type: string) => void;
  onActivity: (type: string) => void;
  onCredentials: (type: string) => void;
  busy: { sync?: boolean; test?: boolean; smoke?: boolean; reconnect?: boolean; disconnect?: boolean };
  testResult?: { success: boolean; error?: string; account?: string };
  smokeResult?: { success: boolean; error?: string; action?: string; account?: string; detail?: string };
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
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
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
              {entry.meta.type === "google_calendar" && entry.health.metadata?.syncDirection && (
                <Link
                  href="/app/connect/calendar"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  title="Manage calendar sync"
                >
                  <Calendar className="h-3 w-3" />
                  {entry.health.metadata.syncDirection === "two_way"
                    ? "Two-way"
                    : entry.health.metadata.syncDirection === "push"
                      ? "Push only"
                      : entry.health.metadata.syncDirection === "pull"
                        ? "Pull only"
                        : "Paused"}
                </Link>
              )}
              {entry.meta.type === "google_calendar" &&
                typeof entry.health.metadata?.openConflicts === "number" &&
                entry.health.metadata.openConflicts > 0 && (
                  <Link
                    href="/app/connect/calendar"
                    className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {entry.health.metadata.openConflicts} conflict
                    {entry.health.metadata.openConflicts === 1 ? "" : "s"}
                  </Link>
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
            {smokeResult && (
              <p
                className={`text-[11px] mt-1 ${
                  smokeResult.success ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {smokeResult.success
                  ? `Live ✓ ${smokeResult.action ?? "Round-trip OK"}${
                      smokeResult.account ? ` — ${smokeResult.account}` : ""
                    }${smokeResult.detail ? ` • ${smokeResult.detail}` : ""}`
                  : `Live ✗ ${smokeResult.error}`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/30">
        {entry.meta.externalUrl && (
          <a
            href={entry.meta.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Provider
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onSmoke(entry.meta.type)}
          disabled={busy.smoke}
          className="h-7 px-2 text-xs"
          title="Run a real round-trip API call against the provider"
        >
          {busy.smoke ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <PlayCircle className="h-3 w-3 mr-1" />
          )}
          Try it live
        </Button>
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
            {(entry.meta.connectMode === "dialog" || entry.meta.connectMode === "webhook") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCredentials(entry.meta.type)}
                className="h-7 px-2 text-xs"
              >
                <Plug className="h-3 w-3 mr-1" />
                {entry.meta.connectMode === "webhook" ? "Webhook URL" : "Manage credentials"}
              </Button>
            ) : (
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
            )}
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
            onClick={() =>
              entry.meta.connectMode === "dialog" || entry.meta.connectMode === "webhook"
                ? onCredentials(entry.meta.type)
                : onReconnect(entry.meta.type)
            }
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
  const [busy, setBusy] = useState<Record<string, { sync?: boolean; test?: boolean; smoke?: boolean; reconnect?: boolean; disconnect?: boolean }>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string; account?: string }>>({});
  const [smokeResults, setSmokeResults] = useState<
    Record<string, { success: boolean; error?: string; action?: string; account?: string; detail?: string }>
  >({});
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [activityOpen, setActivityOpen] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLive, setActivityLive] = useState(false);
  const [activityDegraded, setActivityDegraded] = useState(false);
  const activityPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityAbortRef = useRef<AbortController | null>(null);
  const activityNewIdsRef = useRef<Set<string>>(new Set());
  const activityLatestAtRef = useRef<string | null>(null);
  const activityHighlightTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [activityHighlightIds, setActivityHighlightIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ open: boolean; message: string; action: () => void }>({
    open: false,
    message: "",
    action: () => {},
  });
  const [credentialDialog, setCredentialDialog] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
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

  const handleSmoke = async (type: string) => {
    if (!businessId) return;
    setBusyFor(type, "smoke", true);
    const res = await apiPostSimple<{
      success: boolean;
      error?: string;
      action?: string;
      account?: string;
      detail?: string;
    }>(`/connectors/businesses/${businessId}/smoke/${type}`, {});
    if (res.error) {
      const errMsg = res.error;
      setSmokeResults((p) => ({ ...p, [type]: { success: false, error: errMsg } }));
      toast.error(`Live test failed: ${errMsg}`);
    } else if (res.data) {
      const data = res.data;
      setSmokeResults((p) => ({ ...p, [type]: data }));
      if (data.success) {
        toast.success(`Live ✓ ${data.action ?? "Round-trip OK"}${data.account ? ` — ${data.account}` : ""}`);
      } else {
        toast.error(`Live ✗ ${data.error ?? "Unknown error"}`);
      }
    }
    setBusyFor(type, "smoke", false);
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
      // Backend may return either:
      //   1. An absolute provider URL (https://...) — redirect directly.
      //   2. A relative backend endpoint that needs to be POSTed (e.g. social oauth/start) —
      //      call it server-side, then redirect to the live provider URL it returns.
      const authUrl = res.data.authUrl;
      if (/^https?:\/\//i.test(authUrl)) {
        window.location.href = authUrl;
        return;
      }
      if (authUrl.endsWith("/oauth/start")) {
        const start = await apiPostSimple<{ authUrl?: string }>(authUrl, {});
        if (start.error || !start.data?.authUrl) {
          toast.error(start.error || "Could not start OAuth flow");
        } else {
          window.location.href = start.data.authUrl;
          return;
        }
      } else {
        toast.error("Reconnect returned an unsupported URL");
      }
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

  const clearHighlightTimers = useCallback(() => {
    for (const t of activityHighlightTimersRef.current) clearTimeout(t);
    activityHighlightTimersRef.current.clear();
  }, []);

  const stopActivityPolling = useCallback(() => {
    if (activityPollRef.current) {
      clearInterval(activityPollRef.current);
      activityPollRef.current = null;
    }
    if (activityAbortRef.current) {
      activityAbortRef.current.abort();
      activityAbortRef.current = null;
    }
    clearHighlightTimers();
    setActivityLive(false);
    setActivityDegraded(false);
  }, [clearHighlightTimers]);

  const closeActivity = useCallback(() => {
    stopActivityPolling();
    setActivityOpen(null);
    setActivityLog([]);
    setActivityHighlightIds(new Set());
    activityNewIdsRef.current = new Set();
    activityLatestAtRef.current = null;
  }, [stopActivityPolling]);

  const handleActivity = (type: string) => {
    if (!businessId) return;
    stopActivityPolling();
    setActivityOpen(type);
    setActivityLog([]);
    setActivityHighlightIds(new Set());
    activityNewIdsRef.current = new Set();
    activityLatestAtRef.current = null;
    setActivityLoading(true);
    setActivityDegraded(false);
  };

  // Polling effect: while activity modal is open, fetch the latest entries
  // every ~3s and merge in any new ones (deduped by id) without disturbing
  // scroll position. Cleans up on close, type change, and unmount.
  useEffect(() => {
    if (!activityOpen || !businessId) return;
    const type = activityOpen;
    let cancelled = false;

    let inFlight = false;
    let consecutiveFailures = 0;

    const fetchOnce = async (initial: boolean) => {
      if (cancelled) return;
      // Skip overlapping ticks rather than canceling the in-flight request —
      // on slow networks aborting every prior poll can starve the UI of
      // updates. Initial open always runs.
      if (!initial && inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      activityAbortRef.current = controller;
      // For incremental polls, only ask for entries at-or-after the latest
      // createdAt we've already shown (server uses `gte`, we de-dupe by id).
      // The initial request fetches the last 25.
      const sinceParam =
        !initial && activityLatestAtRef.current
          ? `&since=${encodeURIComponent(activityLatestAtRef.current)}`
          : "";
      const res = await apiGet<ActivityEntry[]>(
        `/connectors/businesses/${businessId}/activity?type=${type}&limit=25${sinceParam}`,
        { signal: controller.signal },
      ).finally(() => {
        inFlight = false;
      });
      if (cancelled) return;
      if (res.error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) setActivityDegraded(true);
        if (initial) setActivityLoading(false);
        return;
      }
      consecutiveFailures = 0;
      setActivityDegraded(false);
      if (res.data) {
        const incoming = res.data;
        if (initial) {
          setActivityLog(incoming);
          if (incoming.length > 0) {
            activityLatestAtRef.current = incoming[0].createdAt;
          }
        } else if (incoming.length > 0) {
          setActivityLog((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const fresh = incoming.filter((r) => !seen.has(r.id));
            if (fresh.length === 0) return prev;
            const newIds = fresh.map((r) => r.id);
            activityNewIdsRef.current = new Set([
              ...activityNewIdsRef.current,
              ...newIds,
            ]);
            setActivityHighlightIds(new Set(activityNewIdsRef.current));
            // Clear highlight after a short window — track the timer so we
            // can cancel it if the modal closes / unmounts in the meantime.
            const timer = setTimeout(() => {
              activityHighlightTimersRef.current.delete(timer);
              for (const id of newIds) activityNewIdsRef.current.delete(id);
              setActivityHighlightIds(new Set(activityNewIdsRef.current));
            }, 3000);
            activityHighlightTimersRef.current.add(timer);
            // Merge & re-sort by createdAt desc, cap at 25
            const merged = [...fresh, ...prev]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
              )
              .slice(0, 25);
            activityLatestAtRef.current = merged[0]?.createdAt ?? activityLatestAtRef.current;
            return merged;
          });
        }
      }
      if (initial) setActivityLoading(false);
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setActivityLive(true);
    void fetchOnce(true);
    activityPollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchOnce(false);
    }, 3000);

    return () => {
      cancelled = true;
      stopActivityPolling();
    };
  }, [activityOpen, businessId, stopActivityPolling]);

  // Belt-and-suspenders: stop polling if the component unmounts.
  useEffect(() => {
    return () => stopActivityPolling();
  }, [stopActivityPolling]);

  const grouped = entries.reduce<Record<ConnectorGroup, DashboardEntry[]>>(
    (acc, e) => {
      const group = (e.meta.group ?? "other") as ConnectorGroup;
      if (!acc[group]) acc[group] = [];
      acc[group].push(e);
      return acc;
    },
    { google: [], social: [], payments: [], messaging: [], accounting: [], marketing: [], forms: [], other: [] },
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

      {/* Quick links to first-class screens */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        {[
          {
            href: "/app/connect/drive",
            icon: HardDrive,
            title: "Drive browser",
            desc: "Files & folders",
            tone: "from-blue-500/15 to-emerald-500/15 text-blue-200",
          },
          {
            href: "/app/connect/sheets",
            icon: FileText,
            title: "Sheets-as-source",
            desc: "Live data sync",
            tone: "from-emerald-500/15 to-teal-500/15 text-emerald-200",
          },
          {
            href: "/app/connect/forms",
            icon: FileText,
            title: "Forms",
            desc: "Browse responses",
            tone: "from-purple-500/15 to-blue-500/15 text-purple-200",
          },
          {
            href: "/app/connect/contacts",
            icon: Users,
            title: "Contacts sync",
            desc: "Pull Google People",
            tone: "from-emerald-500/15 to-teal-500/15 text-emerald-200",
          },
          {
            href: "/app/connect/calendar",
            icon: Calendar,
            title: "Calendar sync",
            desc: "Direction & conflicts",
            tone: "from-blue-500/15 to-indigo-500/15 text-blue-200",
          },
          {
            href: "/app/social",
            icon: Share2,
            title: "Social Composer",
            desc: "Post & schedule",
            tone: "from-pink-500/15 to-purple-500/15 text-pink-200",
          },
          {
            href: "/app/connect/business-profile",
            icon: Building2,
            title: "Business Profile",
            desc: "Reviews & posts",
            tone: "from-amber-500/15 to-orange-500/15 text-amber-200",
          },
        ].map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className={`rounded-2xl border border-border/40 p-3 bg-gradient-to-br ${tile.tone} hover:border-border/70 transition-all flex items-center gap-3 group`}
            >
              <div className="h-9 w-9 rounded-xl bg-background/40 border border-border/30 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">{tile.title}</div>
                <div className="text-[11px] text-muted-foreground truncate">{tile.desc}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
            </Link>
          );
        })}
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
                  smokeResult={smokeResults[entry.meta.type]}
                  onSync={handleSync}
                  onTest={handleTest}
                  onSmoke={handleSmoke}
                  onReconnect={handleReconnect}
                  onDisconnect={handleDisconnect}
                  onActivity={handleActivity}
                  onCredentials={(t) => setCredentialDialog(t)}
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
            onClick={closeActivity}
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
                  {activityLive && !activityLoading && (
                    activityDegraded ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30"
                        title="Live refresh failed — retrying"
                      >
                        <span className="relative inline-flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
                        </span>
                        Reconnecting
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        title="Refreshing every few seconds"
                      >
                        <span className="relative inline-flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                        Live
                      </span>
                    )
                  )}
                </div>
                <button
                  onClick={closeActivity}
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
                    <motion.div
                      key={row.id}
                      initial={
                        activityHighlightIds.has(row.id)
                          ? { opacity: 0, y: -6 }
                          : false
                      }
                      animate={{ opacity: 1, y: 0 }}
                      className={`text-xs p-3 rounded-lg border transition-colors ${
                        activityHighlightIds.has(row.id)
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-border/30 bg-muted/10"
                      }`}
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
                    </motion.div>
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

      {businessId && credentialDialog && (
        <ConnectorCredentialDialog
          businessId={businessId}
          type={credentialDialog}
          open={!!credentialDialog}
          onClose={() => setCredentialDialog(null)}
          onSaved={fetchDashboard}
        />
      )}
    </div>
  );
}
