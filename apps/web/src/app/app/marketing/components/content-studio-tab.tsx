"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wifi, WifiOff, Shield, ShieldAlert, ShieldCheck, ShieldX,
  RefreshCw, Loader2, ChevronDown, ChevronRight, Plus, Trash2,
  Facebook, Instagram, Mail, MessageCircle, Globe, ExternalLink,
  Check, X, AlertCircle, Settings, Power, PowerOff, Eye,
  FileText, Image as ImageIcon, Video, Clock, Zap, Link2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createChannelConnection,
  deleteChannelConnection,
  toggleChannelDestination,
  updateChannelConnection,
  syncChannelConnectionsFromSocial,
  startSocialOAuth,
  disconnectSocial,
  testSocialConnection,
} from "@/lib/client";
import type { ChannelConnection, ChannelDestination, SocialConnection } from "@/lib/client";
import {
  useChannelHealth,
  HEALTH_BG_COLORS,
  type ChannelHealthData,
  type EnrichedConnection,
  type HealthState,
} from "@/hooks/use-channel-health";

interface ContentStudioTabProps {
  businessId: string;
  sharedHealth?: ChannelHealthData;
}

const PROVIDER_META: Record<string, { icon: React.ElementType; color: string; label: string; description: string }> = {
  META: { icon: Globe, color: "#0668E1", label: "Meta (Facebook + Instagram)", description: "Publish to Facebook Pages and Instagram Business accounts" },
  FACEBOOK: { icon: Facebook, color: "#1877F2", label: "Facebook", description: "Post to your Facebook Page" },
  INSTAGRAM: { icon: Instagram, color: "#E4405F", label: "Instagram", description: "Post to your Instagram Business account" },
  GOOGLE: { icon: Mail, color: "#F97316", label: "Email (Gmail)", description: "Send email campaigns via Gmail" },
  EMAIL: { icon: Mail, color: "#F97316", label: "Email", description: "Send email campaigns" },
  WHATSAPP: { icon: MessageCircle, color: "#25D366", label: "WhatsApp", description: "Send messages via WhatsApp Business" },
};

const CAPABILITY_META: Record<string, { icon: React.ElementType; label: string }> = {
  supports_text_post: { icon: FileText, label: "Text" },
  supports_image_post: { icon: ImageIcon, label: "Image" },
  supports_video_post: { icon: Video, label: "Video" },
  supports_campaign_email: { icon: Mail, label: "Email" },
  supports_scheduled: { icon: Clock, label: "Scheduled" },
  text: { icon: FileText, label: "Text" },
  image: { icon: ImageIcon, label: "Image" },
  video: { icon: Video, label: "Video" },
  html: { icon: FileText, label: "HTML" },
  link: { icon: Link2, label: "Links" },
  carousel: { icon: ImageIcon, label: "Carousel" },
  attachments: { icon: FileText, label: "Attachments" },
  template: { icon: FileText, label: "Templates" },
};

function getProviderMeta(provider: string) {
  return PROVIDER_META[provider.toUpperCase()] || { icon: Globe, color: "#94a3b8", label: provider, description: "" };
}

function HealthBadge({ state, size = "sm" }: { state: string; size?: "sm" | "md" }) {
  const bgColor = HEALTH_BG_COLORS[state] || "bg-muted-foreground";
  const labels: Record<string, string> = {
    Connected: "Connected",
    NeedsRefresh: "Needs Refresh",
    Expired: "Expired",
    MissingPermission: "Missing Permission",
    DestinationMissing: "No Destinations",
    Disabled: "Disabled",
    Error: "Error",
  };
  const label = labels[state] || state;
  const textColors: Record<string, string> = {
    Connected: "text-emerald-400",
    NeedsRefresh: "text-amber-400",
    Expired: "text-red-400",
    MissingPermission: "text-red-400",
    DestinationMissing: "text-amber-400",
    Disabled: "text-muted-foreground",
    Error: "text-red-400",
  };
  const textColor = textColors[state] || "text-muted-foreground";
  const bgBadge: Record<string, string> = {
    Connected: "bg-emerald-500/10 border-emerald-500/20",
    NeedsRefresh: "bg-amber-500/10 border-amber-500/20",
    Expired: "bg-red-500/10 border-red-500/20",
    MissingPermission: "bg-red-500/10 border-red-500/20",
    DestinationMissing: "bg-amber-500/10 border-amber-500/20",
    Disabled: "bg-muted/20 border-border/30",
    Error: "bg-red-500/10 border-red-500/20",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${bgBadge[state] || "bg-muted/20 border-border/30"} ${size === "md" ? "text-xs" : "text-[10px]"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${bgColor}`} />
      <span className={`font-medium ${textColor}`}>{label}</span>
    </span>
  );
}

function HealthSummaryStrip({ summary, connections, refreshing, onRunHealthChecks }: {
  summary: { total: number; healthy: number; needsAttention: number; expired: number; totalDestinations: number; activeDestinations: number } | null;
  connections: EnrichedConnection[];
  refreshing: boolean;
  onRunHealthChecks: () => void;
}) {
  if (!summary) return null;

  const stats = [
    { label: "Connected", value: summary.total, color: "text-foreground", icon: Wifi },
    { label: "Healthy", value: summary.healthy, color: "text-emerald-400", icon: ShieldCheck },
    { label: "Needs Attention", value: summary.needsAttention, color: "text-amber-400", icon: ShieldAlert },
    { label: "Expired", value: summary.expired, color: "text-red-400", icon: ShieldX },
  ];

  return (
    <div className="rounded-xl border border-border/30 bg-card p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          <span className="text-xs font-semibold">Channel Health</span>
        </div>
        <button
          onClick={onRunHealthChecks}
          disabled={refreshing || connections.length === 0}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Checking..." : "Check Health"}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <stat.icon className={`w-3 h-3 ${stat.color}`} />
              <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/20 text-[10px] text-muted-foreground">
        <span>{summary.totalDestinations} destination{summary.totalDestinations !== 1 ? "s" : ""} total</span>
        <span className="text-muted-foreground/30">|</span>
        <span className="text-emerald-400">{summary.activeDestinations} active</span>
        {summary.totalDestinations - summary.activeDestinations > 0 && (
          <>
            <span className="text-muted-foreground/30">|</span>
            <span className="text-amber-400">{summary.totalDestinations - summary.activeDestinations} inactive</span>
          </>
        )}
      </div>
    </div>
  );
}

function DestinationCard({ dest, onToggle }: { dest: ChannelDestination; onToggle: (id: string, active: boolean) => void }) {
  const [toggling, setToggling] = useState(false);
  const capabilities = dest.capabilities ?? [];

  const handleToggle = async () => {
    setToggling(true);
    await onToggle(dest.id, !dest.isActive);
    setToggling(false);
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
      dest.isActive ? "border-border/30 bg-muted/5" : "border-border/20 bg-muted/5 opacity-60"
    }`}>
      {dest.avatarUrl ? (
        <img src={dest.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-border/30" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-muted/30 border border-border/30 flex items-center justify-center">
          <Globe className="w-4 h-4 text-muted-foreground/50" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium truncate">{dest.displayName || "Unnamed"}</p>
          {dest.isActive ? (
            <Wifi className="w-3 h-3 text-emerald-400/60 shrink-0" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          )}
        </div>
        <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
          {(dest.platform || dest.destinationType || "").replace(/_/g, " ").toLowerCase()}
        </p>
        {capabilities.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {capabilities.slice(0, 5).map((cap: string) => {
              const meta = CAPABILITY_META[cap];
              const Icon = meta?.icon || Zap;
              return (
                <span key={cap} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-muted/30 text-muted-foreground" title={meta?.label || cap}>
                  <Icon className="w-2.5 h-2.5" />
                  {meta?.label || cap}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <button
        onClick={handleToggle}
        disabled={toggling}
        className={`p-1.5 rounded-md transition-colors ${
          dest.isActive
            ? "text-emerald-400 hover:bg-emerald-500/10"
            : "text-muted-foreground/40 hover:bg-muted/20"
        }`}
        title={dest.isActive ? "Deactivate" : "Activate"}
      >
        {toggling ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : dest.isActive ? (
          <Power className="w-3.5 h-3.5" />
        ) : (
          <PowerOff className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

function ConnectionCard({
  connection,
  businessId,
  onHealthCheck,
  onDisconnect,
  onReconnect,
  onToggleDestination,
}: {
  connection: EnrichedConnection;
  businessId: string;
  onHealthCheck: (id: string) => void;
  onDisconnect: (id: string) => void;
  onReconnect: (provider: string) => void;
  onToggleDestination: (destId: string, active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const provider = connection.provider || connection.platform || connection.providerType || "";
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;
  const dests = connection.enrichedDestinations ?? connection.destinations ?? [];
  const needsReconnect = connection.healthState === "Expired" || connection.healthState === "NeedsRefresh" || connection.healthState === "MissingPermission" || connection.healthState === "Error";

  const handleHealthCheck = async () => {
    setChecking(true);
    await onHealthCheck(connection.id);
    setChecking(false);
  };

  const handleDisconnect = () => {
    onDisconnect(connection.id);
    setConfirmDisconnect(false);
  };

  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/10 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
          <Icon className="w-5 h-5" style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{connection.label || connection.displayName || meta.label}</span>
            <HealthBadge state={connection.healthState} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {dests.length} destination{dests.length !== 1 ? "s" : ""}
            </span>
            {connection.lastCheckedAt && (
              <>
                <span className="text-[10px] text-muted-foreground/30">·</span>
                <span className="text-[10px] text-muted-foreground">
                  Checked {new Date(connection.lastCheckedAt).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {connection.healthMessage && (
        <div className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-t border-border/20 ${
          connection.healthState === "Connected" ? "text-emerald-400 bg-emerald-500/5" :
          connection.healthState === "NeedsRefresh" ? "text-amber-400 bg-amber-500/5" :
          "text-red-400 bg-red-500/5"
        }`}>
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="flex-1">{connection.healthMessage}</span>
          {needsReconnect && (
            <button
              onClick={(e) => { e.stopPropagation(); onReconnect(provider); }}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 transition-colors shrink-0"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-border/20 pt-2">
              {dests.length > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Destinations</span>
                  {dests.map((dest: ChannelDestination) => (
                    <DestinationCard key={dest.id} dest={dest} onToggle={onToggleDestination} />
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center">
                  <WifiOff className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground">No destinations configured</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                <button
                  onClick={handleHealthCheck}
                  disabled={checking}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors border border-border/30"
                >
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Check Health
                </button>
                {needsReconnect && (
                  <button
                    onClick={() => onReconnect(provider)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors border border-[hsl(var(--kf-accent1))]/30"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Reconnect
                  </button>
                )}
                {confirmDisconnect ? (
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-[10px] text-red-400">Disconnect?</span>
                    <button onClick={handleDisconnect} className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">Yes</button>
                    <button onClick={() => setConfirmDisconnect(false)} className="px-2 py-1 rounded text-[10px] font-medium bg-muted/20 text-muted-foreground hover:bg-muted/30 transition-colors">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDisconnect(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                  >
                    <Trash2 className="w-3 h-3" />
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConnectNewChannel({ businessId, oauthAvailability, onConnected }: {
  businessId: string;
  oauthAvailability: Record<string, boolean>;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const channels = [
    { key: "FACEBOOK", icon: Facebook, color: "#1877F2", label: "Facebook Page", description: "Connect your Facebook Page for social publishing" },
    { key: "INSTAGRAM", icon: Instagram, color: "#E4405F", label: "Instagram Business", description: "Connect your Instagram Business account" },
    { key: "EMAIL", icon: Mail, color: "#F97316", label: "Email Sender", description: "Set up email sending for campaigns" },
  ];

  const handleConnect = async (platform: string) => {
    if (!businessId) {
      toast.error("Business not loaded yet. Please try again.");
      return;
    }
    if (platform === "EMAIL") {
      setConnecting("EMAIL");
      try {
        const res = await createChannelConnection({
          provider: "EMAIL",
          label: "Email Sender",
        }, businessId);
        if (res.data) {
          toast.success("Email channel added. Configure your sender identity below.");
          onConnected();
        } else {
          toast.error(res.error || "Failed to create email channel");
        }
      } finally {
        setConnecting(null);
        setOpen(false);
      }
      return;
    }

    setConnecting(platform);
    try {
      const res = await startSocialOAuth(platform, businessId);
      if (res.data?.authUrl) {
        const popup = window.open(res.data.authUrl, `oauth_${platform}`, "width=600,height=700,scrollbars=yes");
        if (!popup) {
          toast.error("Pop-up blocked. Please allow pop-ups and try again.");
          setConnecting(null);
          return;
        }
        const checkInterval = setInterval(async () => {
          if (popup.closed) {
            clearInterval(checkInterval);
            await syncChannelConnectionsFromSocial(businessId);
            setConnecting(null);
            onConnected();
          }
        }, 1000);
      } else {
        toast.error(res.error || "Failed to start OAuth flow");
        setConnecting(null);
      }
    } catch {
      toast.error("Failed to connect channel");
      setConnecting(null);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-[hsl(var(--kf-accent1))]/5 transition-all w-full"
      >
        <Plus className="w-4 h-4" />
        Connect New Channel
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 mt-2">
              {channels.map((ch) => {
                const ChIcon = ch.icon;
                const isAvailable = ch.key === "EMAIL" || oauthAvailability[ch.key];
                return (
                  <button
                    key={ch.key}
                    onClick={() => handleConnect(ch.key)}
                    disabled={!isAvailable || connecting === ch.key}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      isAvailable
                        ? "border-border/30 hover:bg-muted/10 hover:border-[hsl(var(--kf-accent1))]/20"
                        : "border-border/20 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${ch.color}15` }}>
                      {connecting === ch.key ? (
                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: ch.color }} />
                      ) : (
                        <ChIcon className="w-4 h-4" style={{ color: ch.color }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{ch.label}</p>
                      <p className="text-[10px] text-muted-foreground">{ch.description}</p>
                    </div>
                    {isAvailable ? (
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40" />
                    ) : (
                      <span className="text-[9px] text-muted-foreground/50">No credentials</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmailSenderSetup({ businessId, connections, onRefresh }: {
  businessId: string;
  connections: EnrichedConnection[];
  onRefresh: () => void;
}) {
  const emailConnections = connections.filter((c) => {
    const provider = (c.provider || c.platform || c.providerType || "").toUpperCase();
    return provider === "EMAIL" || provider === "GOOGLE";
  });

  if (emailConnections.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <span className="text-xs font-semibold">Email Sender</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Configure your sender identity for email campaigns. This is the name and email address recipients will see.
      </p>
      {emailConnections.map((conn) => (
        <EmailSenderForm key={conn.id} connection={conn} businessId={businessId} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function EmailSenderForm({ connection, businessId, onRefresh }: {
  connection: EnrichedConnection;
  businessId: string;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState(connection.label || "");
  const [accountEmail, setAccountEmail] = useState(connection.accountEmail || "");

  const handleSave = async () => {
    if (!label.trim()) {
      toast.error("From Name is required");
      return;
    }
    if (!accountEmail.trim() || !accountEmail.includes("@")) {
      toast.error("A valid From Email is required");
      return;
    }
    setSaving(true);
    const res = await updateChannelConnection(connection.id, { label: label.trim(), accountEmail: accountEmail.trim() }, businessId);
    if (res.data) {
      toast.success("Sender identity updated");
      setEditing(false);
      onRefresh();
    } else {
      toast.error(res.error || "Failed to update sender identity");
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setLabel(connection.label || "");
    setAccountEmail(connection.accountEmail || "");
    setEditing(false);
  };

  return (
    <div className="rounded-lg border border-border/20 bg-muted/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        <span className="text-xs font-medium">{connection.label || connection.displayName || "Email Sender"}</span>
        <HealthBadge state={connection.healthState} />
        {!editing && (
          <button onClick={() => setEditing(true)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">From Name</label>
          {editing ? (
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Your Business Name"
              className="w-full text-xs text-foreground px-2 py-1.5 rounded-md bg-muted/10 border border-border/30 focus:border-[hsl(var(--kf-accent1))]/50 focus:outline-none transition-colors"
            />
          ) : (
            <div className="text-xs text-foreground px-2 py-1.5 rounded-md bg-muted/20 border border-border/20">
              {connection.label || "Not set"}
            </div>
          )}
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">From Email</label>
          {editing ? (
            <input
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full text-xs text-foreground px-2 py-1.5 rounded-md bg-muted/10 border border-border/30 focus:border-[hsl(var(--kf-accent1))]/50 focus:outline-none transition-colors"
            />
          ) : (
            <div className="text-xs text-foreground px-2 py-1.5 rounded-md bg-muted/20 border border-border/20">
              {connection.accountEmail || "Not configured"}
            </div>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 transition-colors"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Save
          </button>
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        </div>
      ) : (
        <p className="text-[9px] text-muted-foreground/60">
          Click the settings icon to edit your sender identity.
        </p>
      )}
    </div>
  );
}

function SocialConnectionsSection({ socialConnections, businessId, onRefresh }: {
  socialConnections: SocialConnection[];
  businessId: string;
  onRefresh: () => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  if (socialConnections.length === 0) return null;

  const handleTest = async (platform: string) => {
    setTesting(platform);
    const res = await testSocialConnection(platform, businessId);
    if (res.data?.success) {
      toast.success(`${platform} connection verified`);
    } else {
      toast.error(res.data?.error || `${platform} connection test failed`);
    }
    setTesting(null);
  };

  const handleDisconnect = async (platform: string) => {
    setDisconnecting(platform);
    await disconnectSocial(platform, businessId);
    toast.success(`${platform} disconnected`);
    setConfirmDisconnect(null);
    setDisconnecting(null);
    onRefresh();
  };

  return (
    <div className="rounded-xl border border-border/30 bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-semibold">Social Connections</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{socialConnections.length} connected</span>
      </div>
      <div className="space-y-2">
        {socialConnections.map((conn) => {
          const provMeta = PROVIDER_META[conn.platform.toUpperCase()] || { icon: Globe, color: "#94a3b8", label: conn.platform };
          const ProvIcon = provMeta.icon;
          const isExpired = conn.status === "EXPIRED" || conn.status === "ERROR";
          return (
            <div key={conn.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
              isExpired ? "border-red-500/20 bg-red-500/5" : "border-border/30 bg-muted/5"
            }`}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${provMeta.color}15` }}>
                <ProvIcon className="w-4 h-4" style={{ color: provMeta.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{conn.accountName || conn.platform}</span>
                  <HealthBadge state={isExpired ? "Expired" : "Connected"} />
                </div>
                {conn.expiresAt && (
                  <p className="text-[9px] text-muted-foreground mt-0.5">
                    Expires {new Date(conn.expiresAt).toLocaleDateString("en-TT", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTest(conn.platform)}
                  disabled={testing === conn.platform}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  title="Test connection"
                >
                  {testing === conn.platform ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                </button>
                {confirmDisconnect === conn.platform ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleDisconnect(conn.platform)} disabled={disconnecting === conn.platform} className="p-1 rounded text-[10px] bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                      {disconnecting === conn.platform ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </button>
                    <button onClick={() => setConfirmDisconnect(null)} className="p-1 rounded text-[10px] bg-muted/20 text-muted-foreground hover:bg-muted/30 transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDisconnect(conn.platform)}
                    className="p-1.5 rounded-md text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Disconnect"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ContentStudioTab({ businessId, sharedHealth }: ContentStudioTabProps) {
  const localHealth = useChannelHealth(sharedHealth ? "" : businessId);
  const health = sharedHealth || localHealth;

  const handleDisconnect = useCallback(async (connectionId: string) => {
    if (!businessId) return;
    const res = await deleteChannelConnection(connectionId, businessId);
    if (res.data?.deleted) {
      toast.success("Channel disconnected");
      await health.refresh();
    } else {
      toast.error(res.error || "Failed to disconnect");
    }
  }, [businessId, health]);

  const handleToggleDestination = useCallback(async (destId: string, isActive: boolean) => {
    if (!businessId) return;
    const res = await toggleChannelDestination(destId, isActive, businessId);
    if (res.data) {
      toast.success(isActive ? "Destination activated" : "Destination deactivated");
      await health.refresh();
    } else {
      toast.error(res.error || "Failed to toggle destination");
    }
  }, [businessId, health]);

  const handleHealthCheck = useCallback(async (connectionId: string) => {
    try {
      await health.runHealthCheckForConnection(connectionId);
      toast.success("Health check complete");
    } catch {
      toast.error("Health check failed");
    }
  }, [health]);

  const handleRunAllHealthChecks = useCallback(async () => {
    const conns = health.connections;
    if (conns.length === 0) return;
    toast.info(`Checking health for ${conns.length} connection${conns.length !== 1 ? "s" : ""}...`);
    const results = await Promise.allSettled(conns.map((c) => health.runHealthCheckForConnection(c.id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      toast.warning(`Health checks complete — ${failed} of ${conns.length} failed`);
    } else {
      toast.success("All health checks complete");
    }
  }, [health]);

  const handleReconnect = useCallback(async (provider: string) => {
    if (!businessId) return;
    try {
      const res = await startSocialOAuth(provider, businessId);
      if (res.data?.authUrl) {
        const popup = window.open(res.data.authUrl, `oauth_reconnect_${provider}`, "width=600,height=700,scrollbars=yes");
        if (!popup) {
          toast.error("Pop-up blocked. Please allow pop-ups and try again.");
          return;
        }
        toast.info("Complete re-authentication in the popup window...");
        const checkInterval = setInterval(async () => {
          if (popup.closed) {
            clearInterval(checkInterval);
            await syncChannelConnectionsFromSocial(businessId);
            await health.refresh();
            toast.success("Reconnection flow completed — channels synced");
          }
        }, 1000);
      } else {
        toast.error(res.error || "Failed to start reconnection");
      }
    } catch {
      toast.error("Failed to start reconnection flow");
    }
  }, [businessId, health]);

  if (health.loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/30 bg-card p-6 animate-pulse">
          <div className="h-4 bg-muted/30 rounded w-32 mb-4" />
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-muted/20 rounded" />
            ))}
          </div>
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border/30 bg-card p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/30" />
              <div className="flex-1">
                <div className="h-3 bg-muted/30 rounded w-24 mb-2" />
                <div className="h-2 bg-muted/20 rounded w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HealthSummaryStrip
        summary={health.summary}
        connections={health.connections}
        refreshing={health.refreshing}
        onRunHealthChecks={handleRunAllHealthChecks}
      />

      {health.connections.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1">Communication Channels</span>
          {health.connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              businessId={businessId}
              onHealthCheck={handleHealthCheck}
              onDisconnect={handleDisconnect}
              onReconnect={handleReconnect}
              onToggleDestination={handleToggleDestination}
            />
          ))}
        </div>
      )}

      <SocialConnectionsSection
        socialConnections={health.socialConnections}
        businessId={businessId}
        onRefresh={health.refresh}
      />

      <EmailSenderSetup
        businessId={businessId}
        connections={health.connections}
        onRefresh={health.refresh}
      />

      <ConnectNewChannel
        businessId={businessId}
        oauthAvailability={health.oauthAvailability}
        onConnected={health.refresh}
      />

      {health.connections.length === 0 && health.socialConnections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-muted/10 border border-border/50 flex items-center justify-center mb-4">
            <Wifi className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No Channels Connected</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
            Connect your social media accounts or set up email to start publishing content across channels.
          </p>
        </div>
      )}
    </div>
  );
}
