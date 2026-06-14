"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Plug,
  Loader2,
  RefreshCw,
  Unlink,
  Activity,
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
  Inbox,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { Switch } from "@/components/ui/switch";
import { ConnectorCredentialDialog } from "../connect/ConnectorCredentialDialog";
import {
  authenticateConnector,
  disconnectConnector,
  syncConnector,
  syncGoogleDrive,
  testConnector,
  fetchDriveAuthUrl,
  fetchConnectorInboxConfig,
  updateConnectorInboxConfig,
  type ConnectorInboxConfig,
} from "@/lib/api/key-connect";

type ConnectorGroup =
  | "google"
  | "social"
  | "payments"
  | "messaging"
  | "accounting"
  | "marketing"
  | "forms"
  | "other";

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
  errorMessage?: string | null;
  syncCount: number;
  connectedAt: string | null;
  connectedAccount: string | null;
}

interface DashboardEntry {
  meta: ConnectorMeta;
  health: ConnectorHealth;
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

const GROUP_LABELS: Record<ConnectorGroup, { label: string; emoji: string }> = {
  google: { label: "Google Workspace", emoji: "G" },
  social: { label: "Social", emoji: "S" },
  payments: { label: "Payments", emoji: "P" },
  messaging: { label: "Messaging", emoji: "M" },
  accounting: { label: "Accounting", emoji: "A" },
  marketing: { label: "Marketing", emoji: "E" },
  forms: { label: "Forms & Webhooks", emoji: "F" },
  other: { label: "Other", emoji: "•" },
};

const GROUP_ORDER: ConnectorGroup[] = [
  "google",
  "social",
  "messaging",
  "payments",
  "accounting",
  "marketing",
  "forms",
  "other",
];

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

export default function KeyConnectPage() {
  const businessId = getStoredBusinessId();
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, Record<string, boolean>>>({});
  const [configs, setConfigs] = useState<Record<string, ConnectorInboxConfig>>({});
  const [credentialDialog, setCredentialDialog] = useState<string | null>(null);

  const setBusyFor = (type: string, action: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [type]: { ...prev[type], [action]: value } }));
  };

  const fetchDashboard = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await apiGet<DashboardEntry[]>(`/connectors/businesses/${encodeURIComponent(businessId)}/dashboard`);
    if (res.data) {
      setEntries(res.data);
    }
    setLoading(false);
  }, [businessId]);

  const loadInboxConfig = useCallback(
    async (type: string) => {
      if (!businessId || configs[type]) return;
      const res = await fetchConnectorInboxConfig(businessId, type);
      if (res.data) {
        setConfigs((prev) => ({ ...prev, [type]: res.data! }));
      }
    },
    [businessId, configs],
  );

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!searchParams) return;
    const drive = searchParams.get("drive");
    const reason = searchParams.get("reason");
    if (drive === "success") {
      toast.success("Google Drive connected");
      fetchDashboard();
    } else if (drive === "error") {
      toast.error(`Google Drive connection failed: ${reason || "unknown"}`);
    }
    if (drive) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams, fetchDashboard]);

  const handleConnect = async (entry: DashboardEntry) => {
    if (!businessId) return;
    const { meta } = entry;

    if (meta.connectMode === "dialog" || meta.connectMode === "webhook") {
      setCredentialDialog(meta.type);
      return;
    }

    setBusyFor(meta.type, "connect", true);
    const res = await authenticateConnector(businessId, meta.type);
    setBusyFor(meta.type, "connect", false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    if (res.data?.connected) {
      toast.success(`${meta.name} is already connected`);
      fetchDashboard();
      return;
    }

    const authUrl = res.data?.authUrl;
    if (!authUrl) {
      toast.error("No authorization URL returned");
      return;
    }

    if (/^https?:\/\//i.test(authUrl)) {
      window.location.href = authUrl;
      return;
    }

    if (authUrl.endsWith("/oauth/start")) {
      const start = await apiGet<{ authUrl?: string }>(authUrl);
      if (start.data?.authUrl) {
        window.location.href = start.data.authUrl;
      } else {
        toast.error(start.error || "Could not start OAuth flow");
      }
      return;
    }

    if (authUrl.includes("/drive/businesses/") && authUrl.endsWith("/auth-url")) {
      const driveRes = await fetchDriveAuthUrl(businessId);
      if (driveRes.data?.url) {
        window.location.href = driveRes.data.url;
      } else {
        toast.error(driveRes.error || "Could not get Google Drive auth URL");
      }
      return;
    }

    toast.error("Unsupported authorization URL");
  };

  const handleDisconnect = async (type: string, name: string) => {
    if (!businessId) return;
    setBusyFor(type, "disconnect", true);
    const res = await disconnectConnector(businessId, type);
    setBusyFor(type, "disconnect", false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`${name} disconnected`);
      fetchDashboard();
    }
  };

  const handleSync = async (type: string, name: string) => {
    if (!businessId) return;
    setBusyFor(type, "sync", true);

    const res =
      type === "google_drive"
        ? await syncGoogleDrive(businessId)
        : await syncConnector(businessId, type);

    setBusyFor(type, "sync", false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`${name} synced`);
      fetchDashboard();
    }
  };

  const handleTest = async (type: string, name: string) => {
    if (!businessId) return;
    setBusyFor(type, "test", true);
    const res = await testConnector(businessId, type);
    setBusyFor(type, "test", false);
    if (res.error) {
      toast.error(res.error);
    } else if (res.data?.success) {
      toast.success(`Test OK${res.data.account ? ` — ${res.data.account}` : ""}`);
    } else {
      toast.error(res.data?.error || `${name} test failed`);
    }
  };

  const toggleIngestion = async (type: string, enabled: boolean) => {
    if (!businessId) return;
    setConfigs((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? { autoApproveThreshold: null, createContactsAutomatically: true }), intakeEnabled: enabled },
    }));
    const res = await updateConnectorInboxConfig(businessId, type, { intakeEnabled: enabled });
    if (res.error) {
      toast.error(res.error);
      fetchDashboard();
    } else {
      toast.success(`${enabled ? "Enabled" : "Disabled"} intake for ${type}`);
    }
  };

  const updateThreshold = async (type: string, value: number | null) => {
    if (!businessId) return;
    setConfigs((prev) => ({
      ...prev,
      [type]: { ...(prev[type] ?? { intakeEnabled: false, createContactsAutomatically: true }), autoApproveThreshold: value },
    }));
    const res = await updateConnectorInboxConfig(businessId, type, { autoApproveThreshold: value });
    if (res.error) {
      toast.error(res.error);
    }
  };

  const grouped = entries.reduce<Record<ConnectorGroup, DashboardEntry[]>>((acc, e) => {
    const group = (e.meta.group ?? "other") as ConnectorGroup;
    if (!acc[group]) acc[group] = [];
    acc[group].push(e);
    return acc;
  }, { google: [], social: [], payments: [], messaging: [], accounting: [], marketing: [], forms: [], other: [] });

  if (!businessId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No active business — pick a workspace first.
      </div>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto p-4 animate-pulse">
        <div className="h-24 rounded-2xl bg-muted/10 border border-border/20" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 rounded-2xl bg-muted/10 border border-border/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <Plug className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Key Connect</h1>
          <p className="text-sm text-muted-foreground">
            Connect the services that feed into Key Inbox.
          </p>
        </div>
        <div className="flex-1" />
        <Link
          href="/app/key-inbox"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--kf-accent1))] hover:underline"
        >
          <Inbox className="w-3.5 h-3.5" /> Open Key Inbox
        </Link>
      </motion.div>

      {GROUP_ORDER.map((group) => {
        const items = grouped[group] ?? [];
        if (!items.length) return null;
        const meta = GROUP_LABELS[group];
        return (
          <section key={group} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 border border-border/40 flex items-center justify-center text-[11px] font-bold">
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
              {items.map((entry) => {
                const { meta, health } = entry;
                const status = STATUS_STYLES[health.status] ?? STATUS_STYLES.disconnected;
                const Icon = ICONS[meta.icon] ?? Plug2;
                const isConnected = health.status === "connected" || health.status === "syncing";
                const config = configs[meta.type];
                const supportsIngestion = meta.type === "google_drive";

                if (supportsIngestion && isConnected && config === undefined) {
                  loadInboxConfig(meta.type);
                }

                return (
                  <motion.div
                    key={meta.type}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-border/40 bg-card p-4 space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center shrink-0">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold truncate">{meta.name}</h4>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${status.bg} ${status.text} ${status.border}`}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{meta.description}</p>
                        {health.connectedAccount && (
                          <p className="text-[11px] text-muted-foreground/70 truncate">
                            {health.connectedAccount}
                          </p>
                        )}
                        {health.lastSyncAt && (
                          <p className="text-[10px] text-muted-foreground/50">
                            Last sync {formatTimeAgo(health.lastSyncAt)}
                          </p>
                        )}
                        {health.errorMessage && (
                          <p className="text-[11px] text-red-400 truncate">{health.errorMessage}</p>
                        )}
                      </div>
                      {meta.externalUrl && (
                        <a
                          href={meta.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          title="Open service"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>

                    {supportsIngestion && isConnected && (
                      <div className="rounded-xl border border-border/30 bg-muted/20 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-3.5 w-3.5 text-[hsl(var(--kf-accent1))]" />
                            <span className="text-xs font-medium">Send items to Key Inbox</span>
                          </div>
                          <Switch
                            checked={config?.intakeEnabled ?? false}
                            onCheckedChange={(checked) => toggleIngestion(meta.type, checked)}
                          />
                        </div>
                        {config?.intakeEnabled && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>Auto-approve threshold</span>
                              <span>{config.autoApproveThreshold ?? "Off"}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={config.autoApproveThreshold ?? 0}
                              onChange={(e) => updateThreshold(meta.type, parseFloat(e.target.value) || null)}
                              className="w-full accent-[hsl(var(--kf-accent1))]"
                            />
                            <p className="text-[10px] text-muted-foreground/60">
                              Confidence above this value will auto-execute. Set to 0 to disable.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {isConnected ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDisconnect(meta.type, meta.name)}
                          disabled={busy[meta.type]?.disconnect}
                          className="h-7 text-xs"
                        >
                          {busy[meta.type]?.disconnect ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Unlink className="h-3 w-3 mr-1" />
                          )}
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleConnect(entry)}
                          disabled={busy[meta.type]?.connect}
                          className="h-7 text-xs"
                        >
                          {busy[meta.type]?.connect ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Plug className="h-3 w-3 mr-1" />
                          )}
                          Connect
                        </Button>
                      )}

                      {meta.supportsSync && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSync(meta.type, meta.name)}
                          disabled={busy[meta.type]?.sync}
                          className="h-7 text-xs"
                        >
                          {busy[meta.type]?.sync ? (
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
                        onClick={() => handleTest(meta.type, meta.name)}
                        disabled={busy[meta.type]?.test}
                        className="h-7 text-xs"
                      >
                        {busy[meta.type]?.test ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Activity className="h-3 w-3 mr-1" />
                        )}
                        Test
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        );
      })}

      {credentialDialog && (
        <ConnectorCredentialDialog
          businessId={businessId}
          type={credentialDialog}
          open={!!credentialDialog}
          onClose={() => setCredentialDialog(null)}
          onSaved={() => {
            setCredentialDialog(null);
            fetchDashboard();
          }}
        />
      )}
    </div>
  );
}
