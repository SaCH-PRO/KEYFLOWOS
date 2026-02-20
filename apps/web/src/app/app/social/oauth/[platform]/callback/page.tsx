"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type CallbackStatus = "processing" | "success" | "error";

export default function SocialOAuthCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("processing");
  const [message, setMessage] = useState("Completing connection...");
  const [accountName, setAccountName] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const platform = (params.platform as string || "").toUpperCase();
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description") || searchParams.get("error_reason");

    if (errorParam) {
      setStatus("error");
      setMessage(errorDesc || `Authorization was denied or cancelled for ${platform}.`);
      notifyOpener({ type: "social-oauth-error", platform, error: errorDesc || errorParam });
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received. Please try again.");
      notifyOpener({ type: "social-oauth-error", platform, error: "No code received" });
      return;
    }

    if (!state) {
      setStatus("error");
      setMessage("Missing security token. Please close this window and try connecting again.");
      notifyOpener({ type: "social-oauth-error", platform, error: "Missing OAuth state" });
      return;
    }

    const businessId = getStoredBusinessId();
    if (!businessId) {
      setStatus("error");
      setMessage("No business context found. Please close this window and try again.");
      notifyOpener({ type: "social-oauth-error", platform, error: "No business context" });
      return;
    }

    exchangeCode(businessId, platform, code, state);
  }, [params.platform, searchParams]);

  async function exchangeCode(businessId: string, platform: string, code: string, state: string) {
    try {
      setMessage(`Connecting your ${platformDisplayName(platform)} account...`);

      const res = await apiPostSimple<{ success: boolean; error?: string; connection?: any }>(
        `/social/businesses/${encodeURIComponent(businessId)}/connections/${encodeURIComponent(platform)}/oauth/callback`,
        { code, state },
      );

      if (res.error) {
        setStatus("error");
        setMessage(res.error);
        notifyOpener({ type: "social-oauth-error", platform, error: res.error });
        return;
      }

      if (res.data?.success) {
        setStatus("success");
        const name = res.data.connection?.accountName;
        setAccountName(name);
        setMessage(name ? `Connected as ${name}` : `${platformDisplayName(platform)} connected successfully!`);
        notifyOpener({ type: "social-oauth-success", platform, connection: res.data.connection });
      } else {
        setStatus("error");
        const errMsg = res.data?.error || "Failed to complete connection";
        setMessage(errMsg);
        notifyOpener({ type: "social-oauth-error", platform, error: errMsg });
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "An unexpected error occurred");
      notifyOpener({ type: "social-oauth-error", platform, error: err.message });
    }
  }

  function notifyOpener(data: Record<string, any>) {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(data, window.location.origin);
        if (data.type === "social-oauth-success") {
          setTimeout(() => window.close(), 1500);
        }
      } else {
        if (data.type === "social-oauth-success") {
          setTimeout(() => {
            window.location.href = "/app/settings/connections";
          }, 2000);
        }
      }
    } catch {
      if (data.type === "social-oauth-success") {
        setTimeout(() => {
          window.location.href = "/app/settings/connections";
        }, 2000);
      }
    }
  }

  function platformDisplayName(p: string) {
    const map: Record<string, string> = {
      FACEBOOK: "Facebook",
      INSTAGRAM: "Instagram",
      LINKEDIN: "LinkedIn",
      TWITTER: "Twitter / X",
      TIKTOK: "TikTok",
    };
    return map[p.toUpperCase()] || p;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: status === "processing"
              ? "hsl(var(--primary) / 0.1)"
              : status === "success"
              ? "hsl(150 60% 40% / 0.15)"
              : "hsl(0 60% 40% / 0.15)",
            border: `1px solid ${
              status === "processing"
                ? "hsl(var(--primary) / 0.2)"
                : status === "success"
                ? "hsl(150 60% 40% / 0.3)"
                : "hsl(0 60% 40% / 0.3)"
            }`,
          }}
        >
          {status === "processing" && <Loader2 className="h-7 w-7 animate-spin text-primary" />}
          {status === "success" && <CheckCircle2 className="h-7 w-7 text-emerald-400" />}
          {status === "error" && <XCircle className="h-7 w-7 text-red-400" />}
        </div>

        <div>
          <h2 className="text-lg font-semibold">
            {status === "processing" && "Connecting..."}
            {status === "success" && "Connected!"}
            {status === "error" && "Connection Failed"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>

        {status === "success" && (
          <p className="text-xs text-muted-foreground">This window will close automatically...</p>
        )}

        {status === "error" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {window.opener ? "You can close this window and try again." : "Redirecting to connections..."}
            </p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition"
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
