"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Facebook, Instagram, Linkedin, Twitter, CheckCircle2, XCircle, Loader2,
  Key, Globe, AlertCircle, RefreshCw, ExternalLink, Music2, Unlink, Wifi, WifiOff,
  ChevronDown, ChevronUp, Settings2,
} from "lucide-react";
import {
  fetchSocialConnections, startSocialOAuth, connectSocialManual,
  disconnectSocial, testSocialConnection, fetchOAuthAvailability,
  SocialConnection,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const PLATFORMS = [
  {
    key: "FACEBOOK",
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Pages, posts & stories",
    gradient: "from-blue-500/15 to-sky-500/15",
    helpText: "Paste your Page Access Token and Page ID from the Facebook Developer Portal.",
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
    helpText: "Paste your LinkedIn access token and person URN (e.g. urn:li:person:abc123).",
  },
  {
    key: "TWITTER",
    name: "Twitter / X",
    icon: Twitter,
    color: "#1DA1F2",
    description: "Tweets & threads",
    gradient: "from-sky-400/15 to-blue-500/15",
    helpText: "Paste your Bearer Token from the Twitter Developer Portal.",
  },
  {
    key: "TIKTOK",
    name: "TikTok",
    icon: Music2,
    color: "#00F2EA",
    description: "Videos, photos & text posts",
    gradient: "from-cyan-400/15 to-pink-500/15",
    helpText: "Paste your TikTok access token from the TikTok Developer Portal.",
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

type TestResult = { platform: string; success: boolean; error?: string; accountName?: string };

export function ChannelsPanel() {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [manualPlatformId, setManualPlatformId] = useState("");
  const [manualAccountName, setManualAccountName] = useState("");
  const [oauthAvailability, setOauthAvailability] = useState<Record<string, boolean>>({});

  const loadConnections = useCallback(async () => {
    setLoading(true);
    const bId = getStoredBusinessId() || undefined;
    const [connRes, availRes] = await Promise.all([
      fetchSocialConnections(bId),
      fetchOAuthAvailability(bId),
    ]);
    if (connRes.data) setConnections(connRes.data);
    if (connRes.error) setError(connRes.error);
    if (availRes.data) setOauthAvailability(availRes.data);
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

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const { type, platform, connection, error: oauthError } = event.data || {};

      if (type === "social-oauth-success" && platform) {
        if (connection) {
          setConnections((prev) => {
            const idx = prev.findIndex((c) => c.platform === platform);
            if (idx >= 0) { const next = [...prev]; next[idx] = connection; return next; }
            return [...prev, connection];
          });
        } else {
          loadConnections();
        }
        const name = PLATFORMS.find((p) => p.key === platform)?.name || platform;
        setSuccess(`${name} connected successfully!`);
        setActionLoading(null);
      }

      if (type === "social-oauth-error" && platform) {
        setError(oauthError || `Failed to connect ${platform}`);
        setActionLoading(null);
      }
    }

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [loadConnections]);

  function getConnection(platform: string): SocialConnection | undefined {
    return connections.find((c) => c.platform === platform);
  }

  async function handleOAuthConnect(platform: string) {
    setActionLoading(platform);
    setError(null);
    const bId = getStoredBusinessId() || undefined;
    const { data, error: startErr } = await startSocialOAuth(platform, bId);
    if (startErr) {
      setError(startErr);
      setActionLoading(null);
      return;
    }
    if (data?.authUrl) {
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;
      const popup = window.open(
        data.authUrl,
        `social_oauth_${platform}`,
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`,
      );

      if (!popup || popup.closed) {
        window.location.href = data.authUrl;
        return;
      }

      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          setTimeout(() => {
            setActionLoading((current) => (current === platform ? null : current));
          }, 2000);
        }
      }, 500);
    } else {
      setError("Could not generate authorization URL. Please try again.");
      setActionLoading(null);
    }
  }

  async function handleTestConnection(platform: string) {
    setTestLoading(platform);
    setTestResults((prev) => ({ ...prev, [platform]: undefined as any }));
    const bId = getStoredBusinessId() || undefined;
    const { data, error: testErr } = await testSocialConnection(platform, bId);
    if (testErr) {
      setTestResults((prev) => ({ ...prev, [platform]: { platform, success: false, error: testErr } }));
    } else if (data) {
      setTestResults((prev) => ({
        ...prev,
        [platform]: {
          platform,
          success: data.success,
          error: data.error,
          accountName: data.account?.name,
        },
      }));
      if (!data.success && data.status === "EXPIRED") {
        setConnections((prev) =>
          prev.map((c) => (c.platform === platform ? { ...c, status: "EXPIRED" } : c))
        );
      }
    }
    setTestLoading(null);
  }

  async function handleManualConnect(platform: string) {
    if (!manualToken.trim()) return;
    setActionLoading(platform);
    setError(null);
    const bId = getStoredBusinessId() || undefined;
    const { data, error: connErr } = await connectSocialManual(platform, {
      token: manualToken.trim(),
      platformId: manualPlatformId.trim() || undefined,
      accountName: manualAccountName.trim() || undefined,
    }, bId);
    if (connErr) {
      setError(connErr);
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
      setExpandedPlatform(null);
      setManualToken("");
      setManualPlatformId("");
      setManualAccountName("");
      setSuccess(`${PLATFORMS.find((p) => p.key === platform)?.name || platform} connected!`);
    }
    setActionLoading(null);
  }

  async function handleDisconnect(platform: string) {
    const platformName = PLATFORMS.find((p) => p.key === platform)?.name || platform;
    if (!confirm(`Disconnect ${platformName}? You won't be able to publish to this platform until reconnected.`)) return;
    setActionLoading(platform);
    setError(null);
    const bId = getStoredBusinessId() || undefined;
    const { error: discErr } = await disconnectSocial(platform, bId);
    if (discErr) {
      setError(discErr);
    } else {
      setConnections((prev) => prev.filter((c) => c.platform !== platform));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
      setSuccess(`${platformName} disconnected.`);
    }
    setActionLoading(null);
  }

  function toggleExpand(platform: string) {
    if (expandedPlatform === platform) {
      setExpandedPlatform(null);
    } else {
      setExpandedPlatform(platform);
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
        <motion.div variants={container} className="space-y-3">
          {PLATFORMS.map((platform) => {
            const conn = getConnection(platform.key);
            const isConnected = conn?.status === "CONNECTED";
            const isExpired = conn?.status === "EXPIRED";
            const isLoading = actionLoading === platform.key;
            const isTesting = testLoading === platform.key;
            const testResult = testResults[platform.key];
            const Icon = platform.icon;
            const isExpanded = expandedPlatform === platform.key;
            const hasOAuth = oauthAvailability[platform.key] === true;

            return (
              <motion.div
                key={platform.key}
                variants={item}
                className="rounded-2xl border backdrop-blur-xl overflow-hidden transition-all"
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
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${platform.gradient}`}
                        style={{ border: `1px solid ${platform.color}30` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: platform.color }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{platform.name}</p>
                          {isConnected && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                              style={{
                                background: "hsl(150 60% 40% / 0.15)",
                                color: "hsl(150 60% 60%)",
                                border: "1px solid hsl(150 60% 40% / 0.3)",
                              }}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Connected
                            </span>
                          )}
                          {isExpired && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                              style={{
                                background: "hsl(40 80% 50% / 0.15)",
                                color: "hsl(40 80% 60%)",
                                border: "1px solid hsl(40 80% 50% / 0.3)",
                              }}
                            >
                              <XCircle className="w-3 h-3" />
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {isConnected && conn?.accountName
                            ? conn.accountName
                            : isExpired
                            ? "Token expired \u2014 reconnect to continue publishing"
                            : platform.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {(isConnected || isExpired) && (
                        <>
                          <button
                            onClick={() => handleTestConnection(platform.key)}
                            disabled={isTesting}
                            className="text-xs inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border transition-all hover:bg-[hsl(var(--kf-accent2)/0.1)]"
                            style={{
                              borderColor: "hsl(var(--kf-accent2) / 0.3)",
                              color: "hsl(var(--kf-accent2))",
                            }}
                            title="Test this connection"
                          >
                            {isTesting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Wifi className="w-3 h-3" />
                            )}
                            Test
                          </button>
                          <button
                            onClick={() => handleDisconnect(platform.key)}
                            disabled={isLoading}
                            className="text-xs inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border transition-all hover:bg-red-500/10"
                            style={{ borderColor: "hsl(0 60% 40% / 0.3)", color: "hsl(0 60% 65%)" }}
                          >
                            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                            Disconnect
                          </button>
                        </>
                      )}
                      {!isConnected && !isExpired && (
                        <>
                          {hasOAuth ? (
                            <button
                              onClick={() => handleOAuthConnect(platform.key)}
                              disabled={isLoading}
                              className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
                            >
                              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                              Connect
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleExpand(platform.key)}
                              className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
                            >
                              <Key className="w-3 h-3" />
                              Connect
                            </button>
                          )}
                        </>
                      )}
                      {(isConnected || isExpired) && (
                        <button
                          onClick={() => toggleExpand(platform.key)}
                          className="text-xs inline-flex items-center gap-1 rounded-lg px-2 py-2 border transition-all hover:bg-white/5"
                          style={{ borderColor: "hsl(var(--kf-border))", color: "hsl(var(--kf-accent1))" }}
                          title={isExpanded ? "Collapse" : "Reconnect or update token"}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  <AnimatePresence>
                    {testResult && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3"
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                          style={{
                            background: testResult.success
                              ? "hsl(150 60% 40% / 0.1)"
                              : "hsl(0 60% 40% / 0.1)",
                            border: `1px solid ${testResult.success ? "hsl(150 60% 40% / 0.25)" : "hsl(0 60% 40% / 0.25)"}`,
                            color: testResult.success
                              ? "hsl(150 60% 65%)"
                              : "hsl(0 60% 70%)",
                          }}
                        >
                          {testResult.success ? (
                            <>
                              <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
                              Connection verified
                              {testResult.accountName && (
                                <span className="text-muted-foreground ml-1">
                                  {"\u2014"} {testResult.accountName}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
                              Connection failed: {testResult.error || "Unknown error"}
                            </>
                          )}
                          <button
                            onClick={() =>
                              setTestResults((prev) => {
                                const next = { ...prev };
                                delete next[platform.key];
                                return next;
                              })
                            }
                            className="ml-auto text-[10px] hover:underline opacity-60"
                          >
                            Dismiss
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t px-4 py-4 space-y-3"
                      style={{ borderColor: "hsl(var(--kf-border) / 0.5)", background: "hsl(var(--kf-card) / 0.3)" }}
                    >
                      {hasOAuth && (isConnected || isExpired) && (
                        <button
                          onClick={() => { setExpandedPlatform(null); handleOAuthConnect(platform.key); }}
                          disabled={isLoading}
                          className="kf-btn-primary w-full text-xs inline-flex items-center justify-center gap-1.5"
                        >
                          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                          Reconnect with {platform.name}
                        </button>
                      )}

                      <div className="space-y-2">
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Key className="w-3 h-3" />
                          {hasOAuth ? "Or enter token manually:" : "Enter token manually:"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{platform.helpText}</p>

                        <div className="grid gap-2">
                          <input
                            className="kf-input w-full text-xs"
                            placeholder="Access Token *"
                            value={manualToken}
                            onChange={(e) => setManualToken(e.target.value)}
                            type="password"
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
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleManualConnect(platform.key)}
                            disabled={!manualToken.trim() || isLoading}
                            className="kf-btn-primary flex-1 text-xs inline-flex items-center justify-center gap-1.5"
                            style={{ opacity: !manualToken.trim() || isLoading ? 0.5 : 1 }}
                          >
                            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            {isConnected || isExpired ? "Update Connection" : "Save & Connect"}
                          </button>
                          <button
                            onClick={() => setExpandedPlatform(null)}
                            className="kf-btn-secondary text-xs"
                          >
                            Cancel
                          </button>
                        </div>
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
          <li>Click <strong>Connect</strong> on any platform above</li>
          <li>If OAuth is configured, sign in directly with the platform</li>
          <li>Otherwise, paste your API access token from the platform's developer portal</li>
          <li>Click <strong>Test</strong> to verify the connection is working</li>
          <li>Once connected, select platforms when composing posts to auto-publish</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-2">
          Configure OAuth credentials in{" "}
          <a href="/app/settings/connections" className="font-medium hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
            Settings &gt; Connections
          </a>{" "}
          for one-click connect
        </p>
      </motion.div>
    </motion.div>
  );
}
