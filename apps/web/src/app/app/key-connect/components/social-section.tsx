"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Music,
  Plug,
  Unlink,
  Loader2,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import {
  fetchSocialConnections,
  startSocialOAuth,
  disconnectSocial,
  testSocialConnection,
  type SocialConnection,
} from "@/lib/client";

interface SocialSectionProps {
  businessId: string;
}

const PLATFORMS: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "facebook", label: "Facebook", icon: Facebook },
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin },
  { key: "twitter", label: "X / Twitter", icon: Twitter },
  { key: "tiktok", label: "TikTok", icon: Music },
];

async function startOAuthPopup(businessId: string, platform: string): Promise<boolean> {
  const platformUpper = platform.toUpperCase() === "X" ? "TWITTER" : platform.toUpperCase();
  const res = await startSocialOAuth(platformUpper, businessId);
  if (res.error || !res.data?.authUrl) {
    toast.error(res.error || `Could not start ${platformUpper} connection. Check provider credentials in Settings.`);
    return false;
  }
  const w = 600;
  const h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  const popup = window.open(
    res.data.authUrl,
    "kf-social-oauth",
    `width=${w},height=${h},left=${left},top=${top}`,
  );
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

export function SocialSection({ businessId }: SocialSectionProps) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [busy, setBusy] = useState<Record<string, Record<string, boolean>>>({});

  const load = useCallback(async () => {
    const res = await fetchSocialConnections(businessId);
    if (res.data) {
      setConnections(Array.isArray(res.data) ? res.data : []);
    }
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration of social connection list on mount
    load();
  }, [load]);

  const setBusyFor = (key: string, action: string, value: boolean) => {
    setBusy((prev) => ({ ...prev, [key]: { ...prev[key], [action]: value } }));
  };

  const handleConnect = async (platform: string) => {
    setBusyFor(platform, "connect", true);
    const ok = await startOAuthPopup(businessId, platform);
    setBusyFor(platform, "connect", false);
    if (ok) await load();
  };

  const handleDisconnect = async (platform: string) => {
    if (!window.confirm(`Disconnect ${platform}?`)) return;
    setBusyFor(platform, "disconnect", true);
    const res = await disconnectSocial(platform, businessId);
    setBusyFor(platform, "disconnect", false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`${platform} disconnected`);
      await load();
    }
  };

  const handleTest = async (platform: string) => {
    setBusyFor(platform, "test", true);
    const res = await testSocialConnection(platform, businessId);
    setBusyFor(platform, "test", false);
    if (res.error) {
      toast.error(res.error);
    } else if (res.data?.success) {
      toast.success(`${platform} test OK${res.data.account?.name ? ` — ${res.data.account.name}` : ""}`);
    } else {
      toast.error(res.data?.error || `${platform} test failed`);
    }
  };

  return (
    <section className="space-y-3" id="social">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 border border-border/40 flex items-center justify-center text-[11px] font-bold">
          S
        </div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Social</h3>
        <span className="text-[10px] text-muted-foreground/60">
          {connections.filter((c) => c.status === "CONNECTED").length}/{PLATFORMS.length} connected
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PLATFORMS.map((platform) => {
          const conn = connections.find(
            (c) => c.platform.toLowerCase() === platform.key ||
              (platform.key === "twitter" && c.platform.toLowerCase() === "x"),
          );
          const isConnected = conn?.status === "CONNECTED";
          const Icon = platform.icon;
          return (
            <div
              key={platform.key}
              className="rounded-2xl border border-border/40 bg-card p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold truncate">{platform.label}</h4>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                        isConnected
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                      }`}
                    >
                      {isConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  {conn?.accountName && (
                    <p className="text-[11px] text-muted-foreground/70 truncate">{conn.accountName}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isConnected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDisconnect(platform.key)}
                    disabled={busy[platform.key]?.disconnect}
                    className="h-7 text-xs"
                  >
                    {busy[platform.key]?.disconnect ? (
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
                    onClick={() => handleConnect(platform.key)}
                    disabled={busy[platform.key]?.connect}
                    className="h-7 text-xs"
                  >
                    {busy[platform.key]?.connect ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Plug className="h-3 w-3 mr-1" />
                    )}
                    Connect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTest(platform.key)}
                  disabled={busy[platform.key]?.test}
                  className="h-7 text-xs"
                >
                  {busy[platform.key]?.test ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Activity className="h-3 w-3 mr-1" />
                  )}
                  Test
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
