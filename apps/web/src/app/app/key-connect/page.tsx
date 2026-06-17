"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
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
  FileSpreadsheet,
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
  Settings2,
  Facebook,
  Instagram,
  Music,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { Switch } from "@/components/ui/switch";
import { ConnectorCredentialDialog } from "./components/connector-credential-dialog";
import { BankingSection } from "./components/banking-section";
import { ConnectorHealthSection } from "./components/connector-health-section";
import { ManageDrawer } from "./components/manage-drawer";
import { DriveIntakeQueue } from "./components/drive/drive-intake-queue";
import { ContactSyncSettings } from "./components/contact-sync-settings";
import { CalendarSyncSettings } from "./components/calendar-sync-settings";
import { FormsManageDrawer } from "./components/forms/forms-manage-drawer";
import { SheetsManageDrawer } from "./components/sheets/sheets-manage-drawer";
import { BusinessProfileManageDrawer } from "./components/business-profile/business-profile-manage-drawer";
import { WhatsAppManageDrawer } from "./components/whatsapp/whatsapp-manage-drawer";
import GoogleDriveBrowser from "../profile/components/google-drive-browser";
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
  | "priority"
  | "meta"
  | "google"
  | "social"
  | "messaging"
  | "storage"
  | "payments"
  | "accounting"
  | "marketing"
  | "forms"
  | "productivity"
  | "developer"
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
  isPlaceholder?: boolean;
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
  flows?: { keyInbox: boolean; temporal: boolean };
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
  facebook: Facebook,
  instagram: Instagram,
  music: Music,
};

const GROUP_LABELS: Record<ConnectorGroup, { label: string; emoji: string }> = {
  priority: { label: "Priority Connections", emoji: "★" },
  meta: { label: "Meta Business Suite", emoji: "M" },
  google: { label: "Google Suite", emoji: "G" },
  social: { label: "Social Channels", emoji: "S" },
  messaging: { label: "Messaging & Email", emoji: "@" },
  storage: { label: "Storage & Documents", emoji: "D" },
  payments: { label: "Payments & Finance", emoji: "$" },
  accounting: { label: "Accounting", emoji: "A" },
  marketing: { label: "Marketing", emoji: "E" },
  forms: { label: "Forms & Webhooks", emoji: "F" },
  productivity: { label: "Productivity", emoji: "P" },
  developer: { label: "Developer / Webhooks", emoji: "</>" },
  other: { label: "Other", emoji: "•" },
};

const GROUP_ORDER: ConnectorGroup[] = [
  "priority",
  "meta",
  "google",
  "social",
  "messaging",
  "storage",
  "payments",
  "accounting",
  "marketing",
  "forms",
  "productivity",
  "developer",
  "other",
];

const CONNECTOR_GROUP_MAP: Record<string, ConnectorGroup> = {
  google_forms: "google",
  google_contacts: "google",
  google_business_profile: "google",
  google_calendar: "google",
  google_drive: "google",
  gmail: "google",
  outlook_contacts: "google",
  outlook_calendar: "google",
  whatsapp: "messaging",
  meta_social: "meta",
  paypal: "payments",
  wipay: "payments",
  stripe: "payments",
  quickbooks: "accounting",
  xero: "accounting",
  mailchimp: "marketing",
  klaviyo: "marketing",
  linkedin: "social",
  tiktok: "social",
  twitter: "social",
  typeform: "forms",
  jotform: "forms",
  webhook_form: "developer",
  shopify: "productivity",
  slack: "productivity",
  zapier: "productivity",
};

const PRIORITY_TYPES = new Set([
  "whatsapp",
  "instagram",
  "facebook_page",
  "meta_messenger",
  "gmail",
  "google_calendar",
  "google_drive",
  "google_forms",
  "google_contacts",
  "google_business_profile",
  "tiktok",
]);

const PLACEHOLDER_TYPES = new Set(["facebook_page", "instagram", "meta_messenger"]);

const PLACEHOLDER_ENTRIES: DashboardEntry[] = [
  {
    meta: {
      type: "facebook_page",
      name: "Facebook Page",
      description:
        "Connect your Facebook business page to capture reviews, messages, and leads in Key Inbox.",
      category: "social",
      group: "meta",
      icon: "facebook",
      supportsSync: false,
      supportsWebhook: true,
      authType: "oauth2",
      connectMode: "oauth",
      isPlaceholder: true,
    },
    health: {
      status: "disconnected",
      lastSyncAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount: 0,
      syncCount: 0,
      connectedAt: null,
      connectedAccount: null,
      flows: { keyInbox: false, temporal: false },
    },
  },
  {
    meta: {
      type: "instagram",
      name: "Instagram Business",
      description: "Sync Instagram Business messages, comments, and mentions with Key Inbox.",
      category: "social",
      group: "meta",
      icon: "instagram",
      supportsSync: false,
      supportsWebhook: true,
      authType: "oauth2",
      connectMode: "oauth",
      isPlaceholder: true,
    },
    health: {
      status: "disconnected",
      lastSyncAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount: 0,
      syncCount: 0,
      connectedAt: null,
      connectedAccount: null,
      flows: { keyInbox: false, temporal: false },
    },
  },
  {
    meta: {
      type: "meta_messenger",
      name: "Messenger",
      description: "Receive and respond to Facebook Messenger conversations from Key Inbox.",
      category: "social",
      group: "meta",
      icon: "message-circle",
      supportsSync: false,
      supportsWebhook: true,
      authType: "oauth2",
      connectMode: "oauth",
      isPlaceholder: true,
    },
    health: {
      status: "disconnected",
      lastSyncAt: null,
      lastErrorAt: null,
      lastError: null,
      errorCount: 0,
      syncCount: 0,
      connectedAt: null,
      connectedAccount: null,
      flows: { keyInbox: false, temporal: false },
    },
  },
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
  const router = useRouter();
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Record<string, Record<string, boolean>>>({});
  const [configs, setConfigs] = useState<Record<string, ConnectorInboxConfig>>({});
  const [credentialDialog, setCredentialDialog] = useState<string | null>(null);
  const [manageType, setManageType] = useState<string | null>(null);

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
    const tab = searchParams.get("tab");
    if (!tab) return;
    const el = document.getElementById(tab);
    if (!el) return;
    const timeout = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-[hsl(var(--kf-accent1))]/30", "rounded-2xl");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-[hsl(var(--kf-accent1))]/30", "rounded-2xl");
      }, 2000);
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams) return;
    const drive = searchParams.get("drive");
    const calendar = searchParams.get("calendar");
    const google = searchParams.get("google");
    const social = searchParams.get("social");
    const reason = searchParams.get("reason");
    let messageShown = false;

    if (drive === "success") {
      toast.success("Google Drive connected");
      fetchDashboard();
      messageShown = true;
    } else if (drive === "error") {
      toast.error(`Google Drive connection failed: ${reason || "unknown"}`);
      messageShown = true;
    }

    if (calendar === "success") {
      toast.success("Google Calendar connected");
      fetchDashboard();
      messageShown = true;
    } else if (calendar === "error") {
      toast.error(`Google Calendar connection failed: ${reason || "unknown"}`);
      messageShown = true;
    }

    if (google === "connected") {
      toast.success("Google account connected");
      fetchDashboard();
      messageShown = true;
    } else if (google === "error") {
      toast.error(`Google connection failed: ${reason || "unknown"}`);
      messageShown = true;
    }

    if (social === "success") {
      toast.success("Social account connected");
      fetchDashboard();
      messageShown = true;
    } else if (social === "error") {
      toast.error(`Social connection failed: ${reason || "unknown"}`);
      messageShown = true;
    }

    if (messageShown) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("drive");
      next.delete("calendar");
      next.delete("google");
      next.delete("social");
      next.delete("reason");
      const qs = next.toString();
      router.replace(`/app/key-connect${qs ? `?${qs}` : ""}`, { scroll: false });
    }
  }, [searchParams, fetchDashboard, router]);

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
      // eslint-disable-next-line react-hooks/immutability -- navigate away to external OAuth provider
      window.location.href = authUrl;
      return;
    }

    if (authUrl.endsWith("/oauth/start")) {
      const start = await apiGet<{ authUrl?: string }>(authUrl);
      if (start.data?.authUrl) {
        // eslint-disable-next-line react-hooks/immutability -- continue external OAuth redirect
        window.location.href = start.data.authUrl;
      } else {
        toast.error(start.error || "Could not start OAuth flow");
      }
      return;
    }

    if (authUrl.includes("/drive/businesses/") && authUrl.endsWith("/auth-url")) {
      const driveRes = await fetchDriveAuthUrl(businessId);
      if (driveRes.data?.url) {
        // eslint-disable-next-line react-hooks/immutability -- continue external OAuth redirect
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

  const mergedEntries = useMemo(() => {
    const seen = new Set(entries.map((e) => e.meta.type));
    const merged = [...entries];
    for (const placeholder of PLACEHOLDER_ENTRIES) {
      if (!seen.has(placeholder.meta.type)) {
        merged.push(placeholder);
      }
    }
    if (!seen.has("tiktok")) {
      merged.push({
        meta: {
          type: "tiktok",
          name: "TikTok",
          description: "Sync TikTok comments, mentions, and messages with Key Inbox.",
          category: "social",
          group: "social",
          icon: "music",
          supportsSync: false,
          supportsWebhook: true,
          authType: "oauth2",
          connectMode: "oauth",
          isPlaceholder: true,
        },
        health: {
          status: "disconnected",
          lastSyncAt: null,
          lastErrorAt: null,
          lastError: null,
          errorCount: 0,
          syncCount: 0,
          connectedAt: null,
          connectedAccount: null,
          flows: { keyInbox: false, temporal: false },
        },
      });
    }
    return merged;
  }, [entries]);

  const grouped = useMemo(() => {
    const groups: Record<ConnectorGroup, DashboardEntry[]> = {
      priority: [],
      meta: [],
      google: [],
      social: [],
      messaging: [],
      storage: [],
      payments: [],
      accounting: [],
      marketing: [],
      forms: [],
      productivity: [],
      developer: [],
      other: [],
    };
    for (const entry of mergedEntries) {
      if (PRIORITY_TYPES.has(entry.meta.type)) continue;
      const group = CONNECTOR_GROUP_MAP[entry.meta.type] ?? entry.meta.group ?? "other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(entry);
    }
    return groups;
  }, [mergedEntries]);

  const priorityEntries = useMemo(
    () => mergedEntries.filter((e) => PRIORITY_TYPES.has(e.meta.type)),
    [mergedEntries],
  );

  if (!businessId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No active business — pick a workspace first.
      </div>
    );
  }

  const MANAGE_CONFIG: Record<string, { title: string; component: React.ReactNode }> = {
    google_drive: {
      title: "Google Drive",
      component: (
        <div className="space-y-6">
          <GoogleDriveBrowser businessId={businessId} />
          <DriveIntakeQueue businessId={businessId} />
        </div>
      ),
    },
    google_contacts: {
      title: "Google Contacts",
      component: <ContactSyncSettings businessId={businessId} type="google_contacts" />,
    },
    outlook_contacts: {
      title: "Outlook Contacts",
      component: <ContactSyncSettings businessId={businessId} type="outlook_contacts" />,
    },
    google_calendar: {
      title: "Google Calendar",
      component: <CalendarSyncSettings businessId={businessId} />,
    },
    google_forms: {
      title: "Google Forms",
      component: <FormsManageDrawer businessId={businessId} type="google_forms" />,
    },
    typeform: {
      title: "Typeform",
      component: <FormsManageDrawer businessId={businessId} type="typeform" />,
    },
    jotform: {
      title: "Jotform",
      component: <FormsManageDrawer businessId={businessId} type="jotform" />,
    },
    webhook_form: {
      title: "Webhook Forms",
      component: <FormsManageDrawer businessId={businessId} type="webhook_form" />,
    },
    google_sheets: {
      title: "Google Sheets",
      component: <SheetsManageDrawer businessId={businessId} />,
    },
    google_business_profile: {
      title: "Google Business Profile",
      component: <BusinessProfileManageDrawer businessId={businessId} />,
    },
    whatsapp: {
      title: "WhatsApp Business",
      component: <WhatsAppManageDrawer businessId={businessId} />,
    },
  };

  const pageHeader = (
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
  );

  const renderConnectorCard = (entry: DashboardEntry) => {
    const { meta, health } = entry;
    const status = STATUS_STYLES[health.status] ?? STATUS_STYLES.disconnected;
    const Icon = ICONS[meta.icon] ?? Plug2;
    const isConnected = health.status === "connected" || health.status === "syncing";
    const config = configs[meta.type];
    const supportsIngestion = meta.type === "google_drive";
    const isPlaceholder = meta.isPlaceholder ?? false;
    const flows = health.flows ?? { keyInbox: false, temporal: false };

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
                {isPlaceholder ? "Coming soon" : status.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{meta.description}</p>
            <p className="text-[11px] text-muted-foreground/70 truncate">
              Connected account: {health.connectedAccount || "—"}
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              Last sync {formatTimeAgo(health.lastSyncAt)}
            </p>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  flows.keyInbox
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                }`}
              >
                KEYInbox
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  flows.temporal
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                }`}
              >
                Temporal Flow
              </span>
            </div>
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
          {isPlaceholder ? (
            <Button size="sm" variant="default" disabled className="h-7 text-xs">
              Coming soon
            </Button>
          ) : isConnected ? (
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

          {!isPlaceholder && meta.supportsSync && (
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

          {!isPlaceholder && (
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
          )}

          {!isPlaceholder && meta.type === "google_drive" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setManageType("google_sheets")}
              className="h-7 text-xs"
            >
              <FileSpreadsheet className="h-3 w-3 mr-1" />
              Sheets
            </Button>
          )}

          {!isPlaceholder && MANAGE_CONFIG[meta.type] && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setManageType(meta.type)}
              className="h-7 text-xs"
            >
              <Settings2 className="h-3 w-3 mr-1" />
              Manage
            </Button>
          )}
        </div>
      </motion.div>
    );
  };

  const renderGroupSection = (group: ConnectorGroup, items: DashboardEntry[]) => {
    if (!items.length) return null;
    const meta = GROUP_LABELS[group];
    return (
      <section key={group} id={group} className="space-y-3">
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
          {items.map((entry) => renderConnectorCard(entry))}
        </div>
      </section>
    );
  };

  if (loading && entries.length === 0) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto p-4">
        {pageHeader}
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-2xl bg-muted/10 border border-border/20" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 rounded-2xl bg-muted/10 border border-border/20" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4">
      {pageHeader}

      {priorityEntries.length > 0 && renderGroupSection("priority", priorityEntries)}

      {GROUP_ORDER.map((group) => {
        if (group === "priority") return null;
        const items = grouped[group] ?? [];
        if (!items.length) return null;
        return renderGroupSection(group, items);
      })}

      <BankingSection businessId={businessId} />
      <ConnectorHealthSection businessId={businessId} />

      {manageType && (
        <ManageDrawer
          open={!!manageType}
          onClose={() => setManageType(null)}
          title={MANAGE_CONFIG[manageType]?.title ?? "Manage"}
        >
          {MANAGE_CONFIG[manageType]?.component}
        </ManageDrawer>
      )}

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
