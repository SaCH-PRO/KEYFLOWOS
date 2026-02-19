"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Facebook, Instagram, Linkedin, Twitter, CheckCircle2, XCircle, Loader2, Link2, Unlink, Key, ChevronDown, Globe, AlertCircle, RefreshCw, ExternalLink, Music2 } from "lucide-react";
import { fetchSocialConnections, startSocialOAuth, completeSocialOAuth, connectSocialManual, disconnectSocial, SocialConnection } from "@/lib/client";

const PLATFORMS = [
  {
    key: "FACEBOOK",
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Pages, posts & stories",
    gradient: "from-blue-500/15 to-sky-500/15",
    helpText: "Requires a Facebook Page. Enter your Page Access Token and Page ID.",
  },
  {
    key: "INSTAGRAM",
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    description: "Feed posts & reels",
    gradient: "from-pink-500/15 to-purple-500/15",
    helpText: "Requires an Instagram Business/Creator account linked to a Facebook Page.",
  },
  {
    key: "LINKEDIN",
    name: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    description: "Professional posts & articles",
    gradient: "from-blue-600/15 to-indigo-500/15",
    helpText: "Enter your LinkedIn access token and your person URN (e.g., urn:li:person:abc123).",
  },
  {
    key: "TWITTER",
    name: "Twitter / X",
    icon: Twitter,
    color: "#1DA1F2",
    description: "Tweets & threads",
    gradient: "from-sky-400/15 to-blue-500/15",
    helpText: "Enter your Bearer Token from the Twitter Developer Portal.",
  },
  {
    key: "TIKTOK",
    name: "TikTok",
    icon: Music2,
    color: "#00F2EA",
    description: "Videos, photos & text posts",
    gradient: "from-cyan-400/15 to-pink-500/15",
    helpText: "Connect via OAuth or enter your TikTok access token.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export function ChannelsPanel() {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [manualPlatformId, setManualPlatformId] = useState("");
  const [manualAccountName, setManualAccountName] = useState("");

  const loadConnections = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchSocialConnections();
    if (data) setConnections(data);
    if (error) setError(error);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  function getConnection(platform: string): SocialConnection | undefined {
    return connections.find((c) => c.platform === platform);
  }

  async function handleOAuthConnect(platform: string) {
    setActionLoading(platform);
    setError(null);
    const { data, error } = await startSocialOAuth(platform);
    if (error) {
      setError(error);
      setActionLoading(null);
      return;
    }
    if (data?.authUrl) {
      window.open(data.authUrl, "_blank", "width=600,height=700");
    }
    setActionLoading(null);
  }

  async function handleManualConnect(platform: string) {
    if (!manualToken.trim()) return;
    setActionLoading(platform);
    setError(null);
    const { data, error } = await connectSocialManual(platform, {
      token: manualToken.trim(),
      platformId: manualPlatformId.trim() || undefined,
      accountName: manualAccountName.trim() || undefined,
    });
    if (error) {
      setError(error);
    } else if (data) {
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.platform === platform);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = data;
          return next;
        }
        return [...prev, data];
      });
      setManualEntry(null);
      setManualToken("");
      setManualPlatformId("");
      setManualAccountName("");
      setSuccess(`${platform.charAt(0) + platform.slice(1).toLowerCase()} connected successfully!`);
    }
    setActionLoading(null);
  }

  async function handleDisconnect(platform: string) {
    const platformName = PLATFORMS.find((p) => p.key === platform)?.name || platform;
    if (!confirm(`Disconnect ${platformName}? You won't be able to publish to this platform until reconnected.`)) return;
    setActionLoading(platform);
    setError(null);
    const { error } = await disconnectSocial(platform);
    if (error) {
      setError(error);
    } else {
      setConnections((prev) => prev.filter((c) => c.platform !== platform));
      setSuccess(`${platformName} disconnected.`);
    }
    setActionLoading(null);
  }

  function openManualEntry(platform: string) {
    if (manualEntry === platform) {
      setManualEntry(null);
    } else {
      setManualEntry(platform);
      setManualToken("");
      setManualPlatformId("");
      setManualAccountName("");
    }
  }

  const connectedCount = connections.filter((c) => c.status === "CONNECTED").length;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Connected Channels</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Link your social accounts to publish posts directly from KeyFlowOS
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connectedCount > 0 && (
            <span
              className="text-[10px] px-2.5 py-1 rounded-full font-medium"
              style={{
                background: "hsl(150 60% 40% / 0.15)",
                color: "hsl(150 60% 60%)",
                border: "1px solid hsl(150 60% 40% / 0.3)",
              }}
            >
              {connectedCount} connected
            </span>
          )}
          <button
            onClick={() => loadConnections()}
            disabled={loading}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs"
            style={{ background: "hsl(0 60% 40% / 0.15)", color: "hsl(0 60% 70%)", border: "1px solid hsl(0 60% 40% / 0.3)" }}
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-[10px] hover:underline">Dismiss</button>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs"
            style={{ background: "hsl(150 60% 40% / 0.15)", color: "hsl(150 60% 70%)", border: "1px solid hsl(150 60% 40% / 0.3)" }}
          >
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <motion.div variants={container} className="grid gap-3 md:grid-cols-2">
          {PLATFORMS.map((platform) => {
            const conn = getConnection(platform.key);
            const isConnected = conn?.status === "CONNECTED";
            const isExpired = conn?.status === "EXPIRED";
            const isLoading = actionLoading === platform.key;
            const Icon = platform.icon;
            const showManual = manualEntry === platform.key;

            return (
              <motion.div
                key={platform.key}
                variants={item}
                whileHover={{ scale: 1.01, y: -1 }}
                className="rounded-2xl border backdrop-blur-xl p-4 space-y-3 transition-all"
                style={{
                  background: isConnected
                    ? "hsl(150 60% 40% / 0.05)"
                    : isExpired
                    ? "hsl(40 80% 50% / 0.05)"
                    : "hsl(var(--kf-card) / 0.7)",
                  borderColor: isConnected
                    ? "hsl(150 60% 40% / 0.25)"
                    : isExpired
                    ? "hsl(40 80% 50% / 0.25)"
                    : "hsl(var(--kf-border))",
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${platform.gradient}`}
                    style={{ border: `1px solid ${platform.color}30` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: platform.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{platform.name}</p>
                      {isConnected && (
                        <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(150 60% 50%)" }} />
                      )}
                      {isExpired && (
                        <XCircle className="w-3.5 h-3.5" style={{ color: "hsl(40 80% 50%)" }} />
                      )}
                    </div>
                    {isConnected && conn?.accountName ? (
                      <p className="text-[11px] text-muted-foreground truncate">{conn.accountName}</p>
                    ) : isExpired ? (
                      <p className="text-[11px]" style={{ color: "hsl(40 80% 60%)" }}>Token expired — reconnect to continue publishing</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{platform.description}</p>
                    )}
                  </div>
                </div>

                {isConnected ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openManualEntry(platform.key)}
                      className="flex-1 text-xs inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 border transition-all hover:bg-[hsl(var(--kf-accent1)/0.1)]"
                      style={{ borderColor: "hsl(var(--kf-accent1) / 0.3)", color: "hsl(var(--kf-accent1))" }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      Update Token
                    </button>
                    <button
                      onClick={() => handleDisconnect(platform.key)}
                      disabled={isLoading}
                      className="text-xs inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 border transition-all hover:bg-red-500/10"
                      style={{ borderColor: "hsl(0 60% 40% / 0.3)", color: "hsl(0 60% 65%)" }}
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openManualEntry(platform.key)}
                      className="kf-btn-primary text-xs flex-1 inline-flex items-center justify-center gap-1.5"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                      Connect with Token
                    </button>
                    <button
                      onClick={() => handleOAuthConnect(platform.key)}
                      disabled={isLoading}
                      className="kf-btn-secondary text-xs inline-flex items-center justify-center gap-1.5"
                      title="Connect via OAuth (requires API credentials in Settings)"
                    >
                      <ExternalLink className="w-3 h-3" />
                      OAuth
                    </button>
                  </div>
                )}

                <AnimatePresence>
                  {showManual && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 pt-1"
                    >
                      <p className="text-[10px] text-muted-foreground">{platform.helpText}</p>
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Access Token *"
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                        autoFocus
                      />
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Platform ID (page ID, person URN, etc.)"
                        value={manualPlatformId}
                        onChange={(e) => setManualPlatformId(e.target.value)}
                      />
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Display Name (optional)"
                        value={manualAccountName}
                        onChange={(e) => setManualAccountName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleManualConnect(platform.key)}
                          disabled={!manualToken.trim() || isLoading}
                          className="kf-btn-primary flex-1 text-xs inline-flex items-center justify-center gap-1.5"
                          style={{ opacity: !manualToken.trim() || isLoading ? 0.5 : 1 }}
                        >
                          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          {isConnected ? "Update Connection" : "Save & Connect"}
                        </button>
                        <button
                          onClick={() => setManualEntry(null)}
                          className="kf-btn-secondary text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <motion.div variants={item} className="rounded-xl border border-dashed p-4 space-y-2" style={{ borderColor: "hsl(var(--kf-border))" }}>
        <p className="text-xs font-medium">How to connect your accounts:</p>
        <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Click <strong>Connect with Token</strong> on any platform above</li>
          <li>Paste your API access token from the platform's developer portal</li>
          <li>Add your page/account ID to target the right account</li>
          <li>Once connected, select platforms when composing posts to auto-publish</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-2">
          For OAuth, configure your API credentials in{" "}
          <a href="/app/settings" className="font-medium hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
            Settings
          </a>
        </p>
      </motion.div>
    </motion.div>
  );
}
