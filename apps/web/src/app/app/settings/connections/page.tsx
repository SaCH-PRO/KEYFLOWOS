"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, CheckCircle2, Loader2, AlertCircle, Link2, Zap,
  Facebook, Instagram, Linkedin, Twitter, Music2, Wifi, WifiOff,
  Key, Unlink, ExternalLink, ChevronDown, ChevronUp, Mail, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button, Badge } from "@keyflow/ui";
import { apiGet, apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchSocialConnections, connectSocialManual, disconnectSocial,
  testSocialConnection, startSocialOAuth, fetchOAuthAvailability,
  SocialConnection,
} from "@/lib/client";

type CalendarStatus = { connected: boolean; email?: string };
type GmailStatus = { connected: boolean; email: string | null };

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

const SOCIAL_PLATFORMS = [
  {
    key: "FACEBOOK",
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Publish posts and stories to your Facebook Page",
    gradient: "from-blue-500/15 to-sky-500/15",
    helpText: "Paste your Page Access Token and Page ID from the Facebook Developer Portal.",
  },
  {
    key: "INSTAGRAM",
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    description: "Schedule and publish feed posts and reels",
    gradient: "from-pink-500/15 to-purple-500/15",
    helpText: "Requires an Instagram Business/Creator account linked to a Facebook Page.",
  },
  {
    key: "LINKEDIN",
    name: "LinkedIn",
    icon: Linkedin,
    color: "#0A66C2",
    description: "Share professional posts and articles",
    gradient: "from-blue-600/15 to-indigo-500/15",
    helpText: "Paste your LinkedIn access token and person URN (e.g. urn:li:person:abc123).",
  },
  {
    key: "TWITTER",
    name: "Twitter / X",
    icon: Twitter,
    color: "#1DA1F2",
    description: "Post tweets and threads to your account",
    gradient: "from-sky-400/15 to-blue-500/15",
    helpText: "Paste your Bearer Token from the Twitter Developer Portal.",
  },
  {
    key: "TIKTOK",
    name: "TikTok",
    icon: Music2,
    color: "#00F2EA",
    description: "Publish videos, photos and text posts",
    gradient: "from-cyan-400/15 to-pink-500/15",
    helpText: "Paste your TikTok access token from the TikTok Developer Portal.",
  },
];

type TestResult = { success: boolean; error?: string; accountName?: string };

function SkeletonConnections() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 rounded-xl border border-border/30 bg-muted/10" />
      ))}
    </div>
  );
}

export default function ConnectionsSettingsPage() {
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailDisconnecting, setGmailDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [socialLoading, setSocialLoading] = useState(true);
  const [socialActionLoading, setSocialActionLoading] = useState<string | null>(null);
  const [socialTestLoading, setSocialTestLoading] = useState<string | null>(null);
  const [socialTestResults, setSocialTestResults] = useState<Record<string, TestResult>>({});
  const [expandedSocial, setExpandedSocial] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [manualPlatformId, setManualPlatformId] = useState("");
  const [manualAccountName, setManualAccountName] = useState("");
  const [oauthAvailability, setOauthAvailability] = useState<Record<string, boolean>>({});
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void; message: string}>({open: false, action: () => {}, message: ""});

  const oauthPopupRef = useRef<Window | null>(null);
  const businessId = getStoredBusinessId();

  const fetchCalendarStatus = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const [calRes, gmailRes] = await Promise.all([
      apiGet<CalendarStatus>(`/bookings/businesses/${businessId}/calendar/status`),
      apiGet<GmailStatus>(`/commerce/businesses/${businessId}/gmail/status`),
    ]);
    if (calRes.data) setCalendarStatus(calRes.data);
    if (gmailRes.data) setGmailStatus(gmailRes.data);
    setLoading(false);
  }, [businessId]);

  const fetchSocial = useCallback(async () => {
    setSocialLoading(true);
    const bId = getStoredBusinessId() || undefined;
    const [connRes, availRes] = await Promise.all([
      fetchSocialConnections(bId),
      fetchOAuthAvailability(bId),
    ]);
    if (connRes.data) setSocialConnections(connRes.data);
    if (availRes.data) setOauthAvailability(availRes.data);
    setSocialLoading(false);
  }, []);

  useEffect(() => { fetchCalendarStatus(); fetchSocial(); }, [fetchCalendarStatus, fetchSocial]);

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
          setSocialConnections((prev) => {
            const idx = prev.findIndex((c) => c.platform === platform);
            if (idx >= 0) { const next = [...prev]; next[idx] = connection; return next; }
            return [...prev, connection];
          });
        } else {
          fetchSocial();
        }
        const name = SOCIAL_PLATFORMS.find((p) => p.key === platform)?.name || platform;
        setSuccess(`${name} connected successfully!`);
        setSocialActionLoading(null);
        try { localStorage.setItem("social-connection-changed", Date.now().toString()); } catch {}
      }

      if (type === "social-oauth-error" && platform) {
        setError(oauthError || `Failed to connect ${platform}`);
        setSocialActionLoading(null);
      }
    }

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [fetchSocial]);

  const handleConnect = async () => {
    if (!businessId) return;
    setConnecting(true);
    setError(null);
    const res = await apiGet<{ url: string }>(`/bookings/businesses/${businessId}/calendar/auth-url`);
    if (res.error) { setError(res.error); toast.error(res.error); setConnecting(false); return; }
    if (res.data?.url) window.location.href = res.data.url;
  };

  const handleDisconnect = async () => {
    if (!businessId) return;
    setDisconnecting(true);
    setError(null);
    const res = await apiPostSimple<{ success: boolean }>(`/bookings/businesses/${businessId}/calendar/disconnect`, {});
    if (res.error) {
      setError(res.error);
      toast.error(res.error);
    } else {
      setCalendarStatus({ connected: false });
      toast.success("Google Calendar disconnected");
    }
    setDisconnecting(false);
  };

  const handleGmailConnect = async () => {
    if (!businessId) return;
    setGmailConnecting(true);
    setError(null);
    const res = await apiGet<{ url: string }>(`/commerce/businesses/${businessId}/gmail/auth-url`);
    if (res.error) { setError(res.error); toast.error(res.error); setGmailConnecting(false); return; }
    if (res.data?.url) window.location.href = res.data.url;
  };

  const handleGmailDisconnect = async () => {
    if (!businessId) return;
    setGmailDisconnecting(true);
    setError(null);
    const res = await apiDelete<{ success: boolean }>(`/commerce/businesses/${businessId}/gmail`);
    if (res.error) {
      setError(res.error);
      toast.error(res.error);
    } else {
      setGmailStatus({ connected: false, email: null });
      setSuccess("Gmail disconnected.");
      toast.success("Gmail disconnected");
    }
    setGmailDisconnecting(false);
  };

  function getSocialConnection(platform: string) {
    return socialConnections.find((c) => c.platform === platform);
  }

  async function handleSocialOAuthConnect(platform: string) {
    setSocialActionLoading(platform);
    setError(null);
    const bId = getStoredBusinessId() || undefined;
    const { data, error: startError } = await startSocialOAuth(platform, bId);
    if (startError) {
      setError(startError);
      setSocialActionLoading(null);
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

      oauthPopupRef.current = popup;

      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          setTimeout(() => {
            setSocialActionLoading((current) => (current === platform ? null : current));
          }, 2000);
        }
      }, 500);
    } else {
      setError("Could not generate authorization URL. Please try again.");
      setSocialActionLoading(null);
    }
  }

  async function handleSocialTest(platform: string) {
    setSocialTestLoading(platform);
    const bId = getStoredBusinessId() || undefined;
    const { data, error: testError } = await testSocialConnection(platform, bId);
    if (testError) {
      setSocialTestResults((prev) => ({ ...prev, [platform]: { success: false, error: testError } }));
    } else if (data) {
      setSocialTestResults((prev) => ({
        ...prev,
        [platform]: { success: data.success, error: data.error, accountName: data.account?.name },
      }));
      if (!data.success && data.status === "EXPIRED") {
        setSocialConnections((prev) =>
          prev.map((c) => (c.platform === platform ? { ...c, status: "EXPIRED" } : c))
        );
      }
    }
    setSocialTestLoading(null);
  }

  async function handleSocialManualConnect(platform: string) {
    if (!manualToken.trim()) return;
    setSocialActionLoading(platform);
    const bId = getStoredBusinessId() || undefined;
    const { data, error: connError } = await connectSocialManual(platform, {
      token: manualToken.trim(),
      platformId: manualPlatformId.trim() || undefined,
      accountName: manualAccountName.trim() || undefined,
    }, bId);
    if (connError) {
      setError(connError);
      toast.error(connError);
    } else if (data) {
      setSocialConnections((prev) => {
        const idx = prev.findIndex((c) => c.platform === platform);
        if (idx >= 0) { const next = [...prev]; next[idx] = data; return next; }
        return [...prev, data];
      });
      setExpandedSocial(null);
      setManualToken(""); setManualPlatformId(""); setManualAccountName("");
      const platformName = SOCIAL_PLATFORMS.find((p) => p.key === platform)?.name;
      setSuccess(`${platformName} connected!`);
      toast.success(`${platformName} connected!`);
      try { localStorage.setItem("social-connection-changed", Date.now().toString()); } catch {}
    }
    setSocialActionLoading(null);
  }

  async function handleSocialDisconnect(platform: string) {
    const name = SOCIAL_PLATFORMS.find((p) => p.key === platform)?.name || platform;
    setConfirmState({
      open: true,
      message: `Disconnect ${name}?`,
      action: async () => {
        setSocialActionLoading(platform);
        const bId = getStoredBusinessId() || undefined;
        const { error: discError } = await disconnectSocial(platform, bId);
        if (discError) { setError(discError); toast.error(discError); }
        else {
          setSocialConnections((prev) => prev.filter((c) => c.platform !== platform));
          setSocialTestResults((prev) => { const n = { ...prev }; delete n[platform]; return n; });
          setSuccess(`${name} disconnected.`);
          toast.success(`${name} disconnected`);
          try { localStorage.setItem("social-connection-changed", Date.now().toString()); } catch {}
        }
        setSocialActionLoading(null);
      },
    });
  }

  function toggleSocialExpand(platform: string) {
    if (expandedSocial === platform) setExpandedSocial(null);
    else {
      setExpandedSocial(platform);
      setManualToken(""); setManualPlatformId(""); setManualAccountName("");
    }
  }

  if (loading && socialLoading) return <SkeletonConnections />;

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-6 max-w-2xl"
    >
      <motion.div variants={fadeUp}>
        <p className="text-sm text-muted-foreground">
          Connect your accounts to unlock automations and streamline your workflow.
        </p>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-900/20 border border-red-500/20 text-red-300 text-sm"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-xs hover:underline">Dismiss</button>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm"
            style={{ background: "hsl(150 60% 40% / 0.15)", color: "hsl(150 60% 70%)", border: "1px solid hsl(150 60% 40% / 0.3)" }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={fadeUp}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="h-3 w-3" /> Google Services
        </h3>

        <div className={`rounded-xl border p-4 transition-all ${
          calendarStatus?.connected
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-border/40"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-sky-500/20 border border-blue-500/20 flex items-center justify-center">
                <Calendar className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Google Calendar</span>
                  {calendarStatus?.connected && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {calendarStatus?.connected && calendarStatus.email
                    ? calendarStatus.email
                    : "Sync bookings with your Google Calendar automatically"}
                </p>
              </div>
            </div>
            {calendarStatus?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                aria-label="Disconnect Google Calendar"
              >
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
                aria-label="Connect Google Calendar"
              >
                {connecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Connect
              </Button>
            )}
          </div>
        </div>

        <div className={`rounded-xl border p-4 transition-all mt-2 ${
          gmailStatus?.connected
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-border/40"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/20 border border-red-500/20 flex items-center justify-center">
                <Mail className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Gmail</span>
                  {gmailStatus?.connected && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {gmailStatus?.connected && gmailStatus.email
                    ? gmailStatus.email
                    : "Send quotes and invoices directly from your business email"}
                </p>
              </div>
            </div>
            {gmailStatus?.connected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGmailDisconnect}
                disabled={gmailDisconnecting}
                aria-label="Disconnect Gmail"
              >
                {gmailDisconnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleGmailConnect}
                disabled={gmailConnecting}
                aria-label="Connect Gmail"
              >
                {gmailConnecting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                Connect
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Link2 className="h-3 w-3" /> Social Media Channels
        </h3>

        <div className="space-y-2">
          {socialLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            SOCIAL_PLATFORMS.map((platform) => {
              const conn = getSocialConnection(platform.key);
              const isConnected = conn?.status === "CONNECTED";
              const isExpired = conn?.status === "EXPIRED";
              const isActionLoading = socialActionLoading === platform.key;
              const isTesting = socialTestLoading === platform.key;
              const testResult = socialTestResults[platform.key];
              const Icon = platform.icon;
              const isExpanded = expandedSocial === platform.key;
              const hasOAuth = oauthAvailability[platform.key] === true;

              return (
                <div
                  key={platform.key}
                  className={`rounded-xl border p-4 transition-all ${
                    isConnected
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : isExpired
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-11 w-11 rounded-xl bg-gradient-to-br ${platform.gradient} border flex items-center justify-center`}
                        style={{ borderColor: `${platform.color}30` }}
                      >
                        <Icon className="h-5 w-5" style={{ color: platform.color }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{platform.name}</span>
                          {isConnected && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <CheckCircle2 className="h-3 w-3" />
                              Connected
                            </span>
                          )}
                          {isExpired && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {isConnected && conn?.accountName ? conn.accountName : platform.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(isConnected || isExpired) && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSocialTest(platform.key)}
                            disabled={isTesting}
                          >
                            {isTesting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Wifi className="h-3 w-3 mr-1.5" />}
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSocialDisconnect(platform.key)}
                            disabled={isActionLoading}
                            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                          >
                            {isActionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Unlink className="h-3 w-3 mr-1.5" />}
                            Disconnect
                          </Button>
                        </>
                      )}
                      {!isConnected && !isExpired && (
                        <>
                          {hasOAuth ? (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleSocialOAuthConnect(platform.key)}
                              disabled={isActionLoading}
                            >
                              {isActionLoading ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                              ) : (
                                <ExternalLink className="h-3 w-3 mr-1.5" />
                              )}
                              Connect
                            </Button>
                          ) : (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => toggleSocialExpand(platform.key)}
                            >
                              <Key className="h-3 w-3 mr-1.5" />
                              Connect
                            </Button>
                          )}
                        </>
                      )}
                      {(isConnected || isExpired) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleSocialExpand(platform.key)}
                          title={hasOAuth ? "Reconnect or enter token manually" : "Update token"}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  <AnimatePresence>
                    {testResult && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 space-y-2"
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                          style={{
                            background: testResult.success ? "hsl(150 60% 40% / 0.1)" : "hsl(0 60% 40% / 0.1)",
                            border: `1px solid ${testResult.success ? "hsl(150 60% 40% / 0.25)" : "hsl(0 60% 40% / 0.25)"}`,
                            color: testResult.success ? "hsl(150 60% 65%)" : "hsl(0 60% 70%)",
                          }}
                        >
                          {testResult.success ? (
                            <>
                              <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
                              Connection verified{testResult.accountName && ` \u2014 ${testResult.accountName}`}
                            </>
                          ) : (
                            <>
                              <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
                              Failed: {testResult.error || "Unknown error"}
                            </>
                          )}
                        </div>
                        {!testResult.success && (
                          <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[11px] text-muted-foreground space-y-1">
                            <p className="font-medium text-foreground/70">Troubleshooting:</p>
                            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground/80">
                              <li>Verify your access token has not expired</li>
                              <li>Check that the token has the required permissions/scopes</li>
                              <li>For page tokens, ensure the page is published and accessible</li>
                              <li>Try disconnecting and reconnecting the account</li>
                            </ul>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-border/30 space-y-3"
                      >
                        {hasOAuth && (isConnected || isExpired) && (
                          <Button
                            variant="default"
                            size="sm"
                            className="w-full"
                            onClick={() => { setExpandedSocial(null); handleSocialOAuthConnect(platform.key); }}
                            disabled={isActionLoading}
                          >
                            {isActionLoading ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                            ) : (
                              <ExternalLink className="h-3 w-3 mr-1.5" />
                            )}
                            Reconnect with {platform.name}
                          </Button>
                        )}

                        <div className="space-y-2">
                          <button
                            onClick={() => toggleSocialExpand(expandedSocial === `${platform.key}_manual` ? platform.key : `${platform.key}_manual`)}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition w-full"
                          >
                            <Key className="h-3 w-3" />
                            <span>Advanced: Enter token manually</span>
                            <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${expandedSocial === `${platform.key}_manual` ? "rotate-180" : ""}`} />
                          </button>

                          <div className="space-y-2">
                            <p className="text-[11px] text-muted-foreground">{platform.helpText}</p>
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
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleSocialManualConnect(platform.key)}
                              disabled={!manualToken.trim() || isActionLoading}
                              className="w-full"
                            >
                              {isActionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3 w-3 mr-1.5" />}
                              {isConnected || isExpired ? "Update Connection" : "Save & Connect"}
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}

          {!socialLoading && !Object.values(oauthAvailability).some(Boolean) && (
            <div className="mt-3 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs text-amber-300/80">
                <AlertCircle className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                No social platform OAuth apps configured. Add platform credentials as environment variables
                (e.g. FACEBOOK_APP_ID, TWITTER_CLIENT_ID) for one-click connect, or use manual token entry above.
              </p>
            </div>
          )}
        </div>
      </motion.div>
      <ConfirmDialog
        open={confirmState.open}
        title="Disconnect"
        message={confirmState.message}
        confirmLabel="Disconnect"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}, message: ""}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}, message: ""})}
      />
    </motion.div>
  );
}
