"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type CallbackStatus = "processing" | "success" | "error";

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  TWITTER: "Twitter / X",
  TIKTOK: "TikTok",
};

function platformDisplayName(p: string) {
  return PLATFORM_DISPLAY_NAMES[p.toUpperCase()] || p;
}

interface OAuthMessage {
  type: "social-oauth-success" | "social-oauth-error";
  platform: string;
  connection?: { id?: string; accountName?: string | null; [key: string]: unknown };
  error?: string;
}

function notifyOpener(data: OAuthMessage) {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, window.location.origin);
      if (data.type === "social-oauth-success") {
        setTimeout(() => window.close(), 1500);
      }
    } else {
      if (data.type === "social-oauth-success") {
        setTimeout(() => {
          window.location.assign("/app/key-connect?tab=social");
        }, 2000);
      }
    }
  } catch {
    if (data.type === "social-oauth-success") {
      setTimeout(() => {
        window.location.assign("/app/key-connect?tab=social");
      }, 2000);
    }
  }
}

async function exchangeCode(
  businessId: string,
  platform: string,
  code: string,
  state: string,
  setStatus: (s: CallbackStatus) => void,
  setMessage: (m: string) => void,
) {
  try {
    setMessage(`Connecting your ${platformDisplayName(platform)} account...`);

    const res = await apiPostSimple<{ success: boolean; error?: string; connection?: OAuthMessage["connection"] }>(
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
      setMessage(name ? `Connected as ${name}` : `${platformDisplayName(platform)} connected successfully!`);
      notifyOpener({ type: "social-oauth-success", platform, connection: res.data.connection });
    } else {
      setStatus("error");
      const errMsg = res.data?.error || "Failed to complete connection";
      setMessage(errMsg);
      notifyOpener({ type: "social-oauth-error", platform, error: errMsg });
    }
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "An unexpected error occurred";
    setStatus("error");
    setMessage(errMessage);
    notifyOpener({ type: "social-oauth-error", platform, error: errMessage });
  }
}

export default function SocialOAuthCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("processing");
  const [message, setMessage] = useState("Completing connection...");
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
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

    void exchangeCode(businessId, platform, code, state, setStatus, setMessage);
  }, [params.platform, searchParams]);

  return (
    <div className="h-full flex items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        {status === "processing" && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-[hsl(var(--kf-accent1))] mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Connecting...</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Connected!</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground/60">This window will close automatically.</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-10 h-10 text-red-500 mx-auto" />
            <h1 className="text-lg font-semibold text-foreground">Connection Failed</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={() => window.close()}
              className="text-xs text-[hsl(var(--kf-accent1))] hover:underline"
            >
              Close window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
