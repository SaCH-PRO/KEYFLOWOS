"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronDown,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Music2,
  Mail,
  MessageCircle,
  Globe,
  Wifi,
  WifiOff,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle,
  Lock,
  Image as ImageIcon,
  FileText,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { listChannelConnections, listChannelDestinations } from "@/lib/client";
import { apiPostSimple } from "@/lib/api";
import type { ChannelConnection, ChannelDestination } from "@/lib/client";
import type { ChannelHealthData } from "@/hooks/use-channel-health";

const OAUTH_PLATFORMS = new Set(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TWITTER", "X", "TIKTOK"]);

async function startOAuthPopup(businessId: string, platform: string): Promise<boolean> {
  const platformUpper = platform.toUpperCase() === "X" ? "TWITTER" : platform.toUpperCase();
  const res = await apiPostSimple<{ authUrl?: string; error?: string }>(
    `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platformUpper)}/oauth/start`,
    {},
  );
  if (res.error || !res.data?.authUrl) {
    toast.error(res.error || `Could not start ${platformUpper} connection. Check provider credentials in Settings.`);
    return false;
  }
  const w = 600, h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  const popup = window.open(res.data.authUrl, "kf-social-oauth", `width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    toast.error("Popup blocked. Please allow popups for this site.");
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; platform?: string; error?: string } | null;
      if (!data || (data.type !== "social-oauth-success" && data.type !== "social-oauth-error")) return;
      window.removeEventListener("message", handler);
      if (data.type === "social-oauth-success") {
        toast.success(`${platformUpper} connected`);
        resolve(true);
      } else {
        toast.error(data.error || `${platformUpper} connection failed`);
        resolve(false);
      }
    };
    window.addEventListener("message", handler);
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", handler);
        resolve(false);
      }
    }, 700);
  });
}

interface ChannelSelectorProps {
  businessId: string;
  selectedDestinations: ChannelDestination[];
  onSelectionChange: (destinations: ChannelDestination[]) => void;
  contentType?: string;
  healthData?: ChannelHealthData;
}

const PLATFORM_ICONS: Record<string, { icon: React.ElementType; color: string; label: string; capabilities: string[] }> = {
  FACEBOOK: { icon: Facebook, color: "#1877F2", label: "Facebook", capabilities: ["text", "image", "video", "link"] },
  INSTAGRAM: { icon: Instagram, color: "#E4405F", label: "Instagram", capabilities: ["image", "video", "carousel"] },
  LINKEDIN: { icon: Linkedin, color: "#0A66C2", label: "LinkedIn", capabilities: ["text", "image", "video", "link"] },
  TWITTER: { icon: Twitter, color: "#1DA1F2", label: "X (Twitter)", capabilities: ["text", "image", "video"] },
  X: { icon: Twitter, color: "#1DA1F2", label: "X (Twitter)", capabilities: ["text", "image", "video"] },
  TIKTOK: { icon: Music2, color: "#FF0050", label: "TikTok", capabilities: ["video", "image"] },
  GOOGLE: { icon: Mail, color: "#F97316", label: "Email (Gmail)", capabilities: ["text", "html", "attachments"] },
  EMAIL: { icon: Mail, color: "#F97316", label: "Email", capabilities: ["text", "html", "attachments"] },
  WHATSAPP: { icon: MessageCircle, color: "#25D366", label: "WhatsApp", capabilities: ["text", "image", "template"] },
  META: { icon: Globe, color: "#0668E1", label: "Meta", capabilities: ["text", "image", "video"] },
};

const CAPABILITY_ICONS: Record<string, React.ElementType> = {
  text: FileText,
  image: ImageIcon,
  video: Globe,
  html: FileText,
  link: Globe,
  carousel: ImageIcon,
  attachments: FileText,
  template: MessageSquare,
};

function getPlatformMeta(platform: string) {
  return PLATFORM_ICONS[platform.toUpperCase()] || { icon: Globe, color: "#94a3b8", label: platform, capabilities: ["text"] };
}

function getDisabledReason(connection: ChannelConnection): string | null {
  const health = connection.healthState || connection.healthStatus || "Connected";
  if (health === "Error" || health === "error") return "Connection error — reconnect required";
  if (health === "Expired") return "Token expired — reconnect required";
  if (health === "NeedsRefresh" || health === "degraded") return "Connection degraded — may have limited functionality";
  if (health === "MissingPermission") return "Missing permissions — reconnect to fix";
  if (connection.isActive === false) return "Connection inactive — reactivate in Studio";
  return null;
}

export function ChannelSelector({ businessId, selectedDestinations, onSelectionChange, contentType: _contentType, healthData }: ChannelSelectorProps) {
  const [localConnections, setLocalConnections] = useState<ChannelConnection[]>([]);
  const [localActiveDestinations, setLocalActiveDestinations] = useState<ChannelDestination[]>([]);
  const [localAllDestinations, setLocalAllDestinations] = useState<ChannelDestination[]>([]);
  const [localLoading, setLocalLoading] = useState(!healthData);
  const [open, setOpen] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (healthData) return;
    setLocalLoading(true);
    const [connRes, activeDestRes, allDestRes] = await Promise.all([
      listChannelConnections(businessId),
      listChannelDestinations(businessId, { activeOnly: true }),
      listChannelDestinations(businessId, {}),
    ]);
    if (connRes.data) setLocalConnections(connRes.data);
    if (activeDestRes.data) setLocalActiveDestinations(activeDestRes.data);
    if (allDestRes.data) setLocalAllDestinations(allDestRes.data);
    setLocalLoading(false);
  }, [businessId, healthData]);

  const handleConnectClick = useCallback(async (platform: string) => {
    const upper = platform.toUpperCase();
    if (upper === "WHATSAPP") {
      window.location.href = "/app/whatsapp";
      return;
    }
    if (upper === "GOOGLE" || upper === "EMAIL") {
      window.location.href = "/app/connect";
      return;
    }
    if (!OAUTH_PLATFORMS.has(upper)) {
      window.location.href = "/app/connect";
      return;
    }
    setConnectingPlatform(upper);
    const ok = await startOAuthPopup(businessId, upper);
    setConnectingPlatform(null);
    if (ok) await loadData();
  }, [businessId, loadData]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loadData hydrates local state from API on mount/businessId change
  useEffect(() => { void loadData(); }, [loadData]);

  const connections = healthData ? healthData.connections : localConnections;
  const activeDestinations = healthData ? healthData.destinations.filter((d) => d.isActive) : localActiveDestinations;
  const allDestinations = healthData ? healthData.destinations : localAllDestinations;
  const loading = healthData ? healthData.loading : localLoading;

  const PREF_KEY = `kf_default_destinations_${businessId}`;

  useEffect(() => {
    if (loading || selectedDestinations.length > 0 || activeDestinations.length === 0) return;
    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved) {
        const savedIds: string[] = JSON.parse(saved);
        const preselected = activeDestinations.filter((d) => savedIds.includes(d.id));
        if (preselected.length > 0) {
          onSelectionChange(preselected);
        }
      }
    } catch {}
  }, [loading, activeDestinations, selectedDestinations.length, PREF_KEY, onSelectionChange]);

  useEffect(() => {
    if (selectedDestinations.length > 0) {
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(selectedDestinations.map((d) => d.id)));
      } catch {}
    }
  }, [selectedDestinations, PREF_KEY]);

  const toggleDestination = (dest: ChannelDestination) => {
    if (!dest.isActive) return;
    const exists = selectedDestinations.find((d) => d.id === dest.id);
    if (exists) {
      onSelectionChange(selectedDestinations.filter((d) => d.id !== dest.id));
    } else {
      onSelectionChange([...selectedDestinations, dest]);
    }
  };

  const selectedIds = new Set(selectedDestinations.map((d) => d.id));
  const activeIds = new Set(activeDestinations.map((d) => d.id));

  const disabledConnectionIds = useMemo(() => {
    return new Set(connections.filter((c) => !!getDisabledReason(c)).map((c) => c.id));
  }, [connections]);

  const selectAll = () => {
    const selectableDests = activeDestinations.filter((d) => !disabledConnectionIds.has(d.connectionId));
    onSelectionChange([...selectableDests]);
  };

  const groupedByConnection = useMemo(() => {
    return connections.map((conn) => ({
      connection: conn,
      destinations: allDestinations.filter((d) => d.connectionId === conn.id),
      disabledReason: getDisabledReason(conn),
    })).filter((g) => g.destinations.length > 0);
  }, [connections, allDestinations]);

  const ungrouped = useMemo(() => {
    return allDestinations.filter((d) => !connections.some((c) => c.id === d.connectionId));
  }, [allDestinations, connections]);

  const notConnectedPlatforms = useMemo(() => {
    const connectedPlatforms = new Set(connections.map((c) => (c.provider || c.platform || c.providerType || "").toUpperCase()));
    return Object.entries(PLATFORM_ICONS)
      .filter(([key]) => !connectedPlatforms.has(key) && key !== "META" && key !== "EMAIL")
      .map(([key, meta]) => ({ key, ...meta }));
  }, [connections]);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : selectedDestinations.length === 0 ? (
            <span className="text-xs text-muted-foreground">Select channels to distribute...</span>
          ) : (
            <div className="flex items-center gap-1.5">
              {selectedDestinations.slice(0, 4).map((dest) => {
                const meta = getPlatformMeta(dest.platform);
                const Icon = meta.icon;
                return (
                  <div key={dest.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                    <Icon className="w-3 h-3" />
                    <span className="max-w-16 truncate">{dest.displayName}</span>
                  </div>
                );
              })}
              {selectedDestinations.length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{selectedDestinations.length - 4} more</span>
              )}
            </div>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border/30 bg-card p-3 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : allDestinations.length === 0 && notConnectedPlatforms.length > 0 ? (
                <div className="text-center py-6 space-y-2">
                  <WifiOff className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                  <p className="text-xs text-muted-foreground">No channels connected yet</p>
                  <p className="text-[10px] text-muted-foreground/60">Connect Facebook, Instagram, or Email to start distributing content</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Channels</span>
                    <div className="flex items-center gap-2">
                      {activeDestinations.length > 0 && (
                        <button onClick={selectAll} className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline">Select all</button>
                      )}
                      <button onClick={() => { void loadData(); }} className="p-1 rounded hover:bg-muted/20">
                        <RefreshCw className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>

                  {groupedByConnection.map(({ connection, destinations: dests, disabledReason }) => {
                    const connMeta = getPlatformMeta(connection.provider || connection.platform || connection.providerType || "");
                    const isConnectionDisabled = !!disabledReason;
                    return (
                      <div key={connection.id} className="space-y-1.5">
                        <div className="flex items-center gap-2 px-1">
                          <connMeta.icon className="w-3 h-3" style={{ color: isConnectionDisabled ? "#94a3b8" : connMeta.color }} />
                          <span className={`text-[10px] font-medium ${isConnectionDisabled ? "text-muted-foreground/50" : ""}`}>{connection.label || connection.displayName}</span>
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            (connection.healthState || connection.healthStatus || "Connected") === "Connected" ? "bg-emerald-400" :
                            ["NeedsRefresh", "DestinationMissing", "degraded"].includes(connection.healthState || connection.healthStatus || "") ? "bg-amber-400" :
                            "bg-red-400"
                          }`} />
                          <div className="flex items-center gap-0.5 ml-auto">
                            {connMeta.capabilities.slice(0, 3).map((cap) => {
                              const CapIcon = CAPABILITY_ICONS[cap] || Globe;
                              return <CapIcon key={cap} className="w-2.5 h-2.5 text-muted-foreground/40" title={cap} />;
                            })}
                          </div>
                        </div>
                        {disabledReason && (
                          <div className="px-1 flex items-center justify-between gap-2">
                            <p className="text-[9px] text-red-400/70 flex items-center gap-1 min-w-0">
                              <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{disabledReason}</span>
                            </p>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleConnectClick(connection.provider || connection.platform || connection.providerType || "");
                              }}
                              disabled={connectingPlatform === (connection.provider || connection.platform || connection.providerType || "").toUpperCase()}
                              className="text-[9px] font-medium text-[hsl(var(--kf-accent1))] hover:underline whitespace-nowrap disabled:opacity-50"
                            >
                              {connectingPlatform === (connection.provider || connection.platform || connection.providerType || "").toUpperCase() ? "Connecting…" : "Reconnect →"}
                            </button>
                          </div>
                        )}
                        {dests.map((dest) => {
                          const isActive = activeIds.has(dest.id);
                          const isDisabled = !isActive || isConnectionDisabled;
                          return (
                            <button
                              key={dest.id}
                              onClick={() => !isDisabled && toggleDestination(dest)}
                              disabled={isDisabled}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                                isDisabled
                                  ? "opacity-40 cursor-not-allowed"
                                  : selectedIds.has(dest.id)
                                    ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30"
                                    : "hover:bg-muted/15 border border-transparent"
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                selectedIds.has(dest.id) && !isDisabled ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"
                              }`}>
                                {selectedIds.has(dest.id) && !isDisabled && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{dest.displayName}</p>
                                <p className="text-[10px] text-muted-foreground capitalize">{(dest.destinationType || dest.platform || "").replace(/_/g, " ")}</p>
                              </div>
                              {isDisabled ? (
                                <Lock className="w-3 h-3 text-muted-foreground/40" />
                              ) : (
                                <Wifi className="w-3 h-3 text-emerald-400/60" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {ungrouped.map((dest) => {
                    const meta = getPlatformMeta(dest.platform);
                    const isActive = activeIds.has(dest.id);
                    return (
                      <button
                        key={dest.id}
                        onClick={() => toggleDestination(dest)}
                        disabled={!isActive}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                          !isActive
                            ? "opacity-40 cursor-not-allowed"
                            : selectedIds.has(dest.id)
                              ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30"
                              : "hover:bg-muted/15 border border-transparent"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          selectedIds.has(dest.id) ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"
                        }`}>
                          {selectedIds.has(dest.id) && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{dest.displayName}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{dest.platform}</p>
                        </div>
                        {isActive ? (
                          <Wifi className="w-3 h-3 text-emerald-400/60" />
                        ) : (
                          <Lock className="w-3 h-3 text-muted-foreground/40" />
                        )}
                      </button>
                    );
                  })}

                  {notConnectedPlatforms.length > 0 && (
                    <div className="pt-2 border-t border-border/20 space-y-1">
                      <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider px-1">Not Connected</span>
                      {notConnectedPlatforms.map((platform) => {
                        const Icon = platform.icon;
                        const busy = connectingPlatform === platform.key;
                        return (
                          <button
                            key={platform.key}
                            type="button"
                            onClick={() => void handleConnectClick(platform.key)}
                            disabled={busy}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/15 border border-transparent hover:border-border/30 transition-all group disabled:opacity-50 text-left"
                          >
                            <div className="w-4 h-4 rounded border border-border/40 shrink-0" />
                            <Icon className="w-3.5 h-3.5" style={{ color: platform.color }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{platform.label}</p>
                              <p className="text-[10px] text-muted-foreground">{busy ? "Opening…" : "Click to connect"}</p>
                            </div>
                            {busy ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> : <Plus className="w-3 h-3 text-muted-foreground/60 group-hover:text-[hsl(var(--kf-accent1))]" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
