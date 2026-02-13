"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Facebook, Instagram, Linkedin, Twitter, CheckCircle2, XCircle, Loader2, Link2, Unlink, Key, ChevronDown, Globe, AlertCircle } from "lucide-react";
import { fetchSocialConnections, startSocialOAuth, connectSocialManual, disconnectSocial, SocialConnection } from "@/lib/client";

const PLATFORMS = [
  {
    key: "FACEBOOK",
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Pages, posts & stories",
    gradient: "from-blue-500/15 to-sky-500/15",
  },
  {
    key: "INSTAGRAM",
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    description: "Feed posts & reels (requires image)",
    gradient: "from-pink-500/15 to-purple-500/15",
  },
  {
    key: "LINKEDIN",
    name: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    description: "Professional posts & articles",
    gradient: "from-blue-600/15 to-indigo-500/15",
  },
  {
    key: "TWITTER",
    name: "Twitter / X",
    icon: Twitter,
    color: "#000000",
    description: "Tweets & threads",
    gradient: "from-gray-500/15 to-zinc-500/15",
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
    if (data?.url) {
      window.open(data.url, "_blank", "width=600,height=700");
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
    }
    setActionLoading(null);
  }

  async function handleDisconnect(platform: string) {
    if (!confirm(`Disconnect ${platform}? You won't be able to publish to this platform until reconnected.`)) return;
    setActionLoading(platform);
    setError(null);
    const { error } = await disconnectSocial(platform);
    if (error) {
      setError(error);
    } else {
      setConnections((prev) => prev.filter((c) => c.platform !== platform));
    }
    setActionLoading(null);
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
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs"
          style={{ background: "hsl(0 60% 40% / 0.15)", borderColor: "hsl(0 60% 40% / 0.3)", color: "hsl(0 60% 70%)", border: "1px solid hsl(0 60% 40% / 0.3)" }}
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-[10px] hover:underline">Dismiss</button>
        </motion.div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <motion.div variants={container} className="grid gap-3 md:grid-cols-2">
          {PLATFORMS.map((platform) => {
            const conn = getConnection(platform.key);
            const isConnected = conn?.status === "CONNECTED";
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
                  background: isConnected ? "hsl(150 60% 40% / 0.05)" : "hsl(var(--kf-card) / 0.7)",
                  borderColor: isConnected ? "hsl(150 60% 40% / 0.25)" : "hsl(var(--kf-border))",
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
                    </div>
                    {isConnected && conn?.accountName ? (
                      <p className="text-[11px] text-muted-foreground truncate">{conn.accountName}</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{platform.description}</p>
                    )}
                  </div>
                </div>

                {isConnected ? (
                  <button
                    onClick={() => handleDisconnect(platform.key)}
                    disabled={isLoading}
                    className="w-full text-xs inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 border transition-all hover:bg-red-500/10"
                    style={{ borderColor: "hsl(0 60% 40% / 0.3)", color: "hsl(0 60% 65%)" }}
                  >
                    {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                    Disconnect
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOAuthConnect(platform.key)}
                      disabled={isLoading}
                      className="kf-btn-primary text-xs flex-1 inline-flex items-center justify-center gap-1.5"
                    >
                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      Connect
                    </button>
                    <button
                      onClick={() => setManualEntry(showManual ? null : platform.key)}
                      className="kf-btn-secondary text-xs inline-flex items-center justify-center gap-1"
                      title="Enter token manually"
                    >
                      <Key className="w-3 h-3" />
                      <ChevronDown className={`w-3 h-3 transition-transform ${showManual ? "rotate-180" : ""}`} />
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
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Access Token"
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value)}
                      />
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Platform ID (page/account ID)"
                        value={manualPlatformId}
                        onChange={(e) => setManualPlatformId(e.target.value)}
                      />
                      <input
                        className="kf-input w-full text-xs"
                        placeholder="Account Name (optional)"
                        value={manualAccountName}
                        onChange={(e) => setManualAccountName(e.target.value)}
                      />
                      <button
                        onClick={() => handleManualConnect(platform.key)}
                        disabled={!manualToken.trim() || isLoading}
                        className="kf-btn-primary w-full text-xs inline-flex items-center justify-center gap-1.5"
                        style={{ opacity: !manualToken.trim() || isLoading ? 0.5 : 1 }}
                      >
                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                        Save Token
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <motion.div variants={item} className="rounded-xl border border-dashed p-3 text-center" style={{ borderColor: "hsl(var(--kf-border))" }}>
        <p className="text-[11px] text-muted-foreground">
          Configure your platform API credentials in{" "}
          <a href="/app/settings/connections" className="font-medium hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
            Settings → Connections
          </a>{" "}
          to enable OAuth sign-in
        </p>
      </motion.div>
    </motion.div>
  );
}
