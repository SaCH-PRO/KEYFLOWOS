"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";
import { persistSessionToken } from "@/lib/session-client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type DecodedToken = {
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    avatar_url?: string;
    picture?: string;
  };
};

function decodeAccessToken(token: string): DecodedToken | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized);
    return JSON.parse(decoded) as DecodedToken;
  } catch {
    return null;
  }
}

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const errorDescription = searchParams?.get("error_description");
        
        if (errorDescription) {
          throw new Error(errorDescription);
        }
        
        if (!accessToken) {
          throw new Error("No access token received");
        }

        await persistSessionToken(accessToken);

        let userInfo: DecodedToken | null = null;
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          const userInfoRes = await fetch(
            `${SUPABASE_URL}/auth/v1/user`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: SUPABASE_ANON_KEY,
              },
            }
          );

          if (userInfoRes.ok) {
            userInfo = (await userInfoRes.json()) as DecodedToken;
          }
        }

        if (!userInfo) {
          userInfo = decodeAccessToken(accessToken);
        }

        const email = userInfo?.email;
        if (!email) {
          throw new Error("Could not determine authenticated email");
        }

        const fullName = userInfo.user_metadata?.full_name || userInfo.user_metadata?.name || "";
        const avatarUrl = userInfo.user_metadata?.avatar_url || userInfo.user_metadata?.picture || "";
        
        const nameParts = fullName.split(" ");
        const firstName = userInfo.user_metadata?.given_name || nameParts[0] || "";
        const lastName = userInfo.user_metadata?.family_name || nameParts.slice(1).join(" ") || "";
        
        if (email) {
          window.localStorage.setItem("kf_email", email);
        }

        const profileDraft = { firstName, lastName, username: "", company: "", phone: "" };
        window.localStorage.setItem("kf_profile_draft", JSON.stringify(profileDraft));

        const bootstrap = await bootstrapIdentity({
          email,
          name: fullName,
          firstName,
          lastName,
          avatarUrl,
        });
        
        if (bootstrap.data?.business?.id) {
          window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
          if (bootstrap.data.user) {
            window.localStorage.setItem("kf_user_cache", JSON.stringify(bootstrap.data.user));
          }
          window.localStorage.setItem("kf_business_cache", JSON.stringify(bootstrap.data.business));
        } else if (bootstrap.error) {
          throw new Error(bootstrap.error);
        } else {
          throw new Error("Could not create workspace. Please try again.");
        }

        router.push("/app");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setError(message);
        setStatus("error");
      }
    };

    handleCallback();
  }, [router, searchParams]);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(20 14% 4%)" }}>
        <div className="w-full max-w-md mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(173 58% 39%))" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "hsl(30 20% 98%)" }}>Authentication Error</h1>
          <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "hsl(20 14% 7% / 0.9)", border: "1px solid hsl(20 10% 15%)" }}>
            <p className="text-sm" style={{ color: "hsl(0 84% 70%)" }}>{error}</p>
            <button
              onClick={() => router.push("/auth/login")}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110"
              style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(20 14% 4%)" }}>
      <div className="w-full max-w-md mx-auto px-4 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-6" style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(173 58% 39%))" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "hsl(30 20% 98%)" }}>Signing you in...</h1>
        <div className="flex items-center justify-center gap-2 mt-4">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: "hsl(24 95% 53%)", borderTopColor: "transparent" }} />
          <span className="text-sm" style={{ color: "hsl(30 10% 55%)" }}>Setting up your workspace...</span>
        </div>
      </div>
    </div>
  );
}
