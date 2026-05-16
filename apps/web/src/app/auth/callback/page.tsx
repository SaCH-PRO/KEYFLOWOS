"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";
import { setStoredToken, setStoredBusinessId } from "@/lib/workspace";

/**
 * Derive (firstName, lastName) from a Supabase OAuth user_metadata payload.
 *
 * Google supplies first-class `given_name` / `family_name` fields that we
 * always prefer when present. When only `full_name` / `name` is available
 * (some IdPs / older accounts) we fall back to a naive whitespace split
 * with the first token as the first name and the rest joined as the last.
 *
 * Extracted as a pure helper so the OAuth-callback page stays a thin
 * controller around it AND so we can unit-test the edge cases (multi-word
 * surnames, missing fields, mononyms, leading/trailing whitespace) without
 * spinning up a browser.
 */
export function deriveOAuthName(meta: Record<string, unknown> | null | undefined): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const m = (meta ?? {}) as Record<string, unknown>;
  const given = typeof m.given_name === "string" ? m.given_name.trim() : "";
  const family = typeof m.family_name === "string" ? m.family_name.trim() : "";
  const fullRaw =
    (typeof m.full_name === "string" && m.full_name.trim()) ||
    (typeof m.name === "string" && m.name.trim()) ||
    "";
  const fullName = fullRaw || [given, family].filter(Boolean).join(" ");

  if (given || family) {
    return { firstName: given, lastName: family, fullName };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "", fullName };
  if (parts.length === 1) return { firstName: parts[0], lastName: "", fullName };
  return { firstName: parts[0], lastName: parts.slice(1).join(" "), fullName };
}

type CallbackErrorKind = "generic" | "account_email_conflict";

function AuthCallbackInner() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<CallbackErrorKind>("generic");
  const [conflictEmail, setConflictEmail] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const searchParams = new URLSearchParams(window.location.search);
        const errorDescription = searchParams.get("error_description");
        
        if (errorDescription) {
          throw new Error(errorDescription);
        }
        
        if (!accessToken) {
          throw new Error("No access token received");
        }

        setStoredToken(accessToken);

        const userInfoRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            },
          }
        );
        
        if (!userInfoRes.ok) {
          throw new Error("Failed to get user info");
        }
        
        const userInfo = await userInfoRes.json();
        const email = userInfo.email;
        const avatarUrl = userInfo.user_metadata?.avatar_url || userInfo.user_metadata?.picture || "";
        const { firstName, lastName, fullName } = deriveOAuthName(userInfo.user_metadata);
        
        if (email) {
          window.localStorage.setItem("kf_email", email);
        }

        window.localStorage.setItem("kf_profile_draft", JSON.stringify({ firstName, lastName, username: "", company: "", phone: "" }));
        const bootstrap = await bootstrapIdentity({
          email,
          name: fullName,
          firstName,
          lastName,
          avatarUrl,
        });
        
        if (bootstrap.data?.business?.id) {
          setStoredBusinessId(bootstrap.data.business.id);
          if (bootstrap.data.user) {
            window.localStorage.setItem("kf_user_cache", JSON.stringify(bootstrap.data.user));
          }
          window.localStorage.setItem("kf_business_cache", JSON.stringify(bootstrap.data.business));
        } else if (bootstrap.errorCode === "account_email_conflict") {
          setConflictEmail(email ?? null);
          setErrorKind("account_email_conflict");
          setError(bootstrap.error);
          setStatus("error");
          return;
        } else if (bootstrap.error) {
          throw new Error(bootstrap.error);
        } else {
          throw new Error("Could not create workspace. Please try again.");
        }

        router.push("/app");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed";
        setErrorKind("generic");
        setError(message);
        setStatus("error");
      }
    };

    handleCallback();
  }, [router]);

  if (status === "error") {
    if (errorKind === "account_email_conflict") {
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
            <h1 className="text-2xl font-bold mb-2" style={{ color: "hsl(30 20% 98%)" }}>This email is already in use</h1>
            <div className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "hsl(20 14% 7% / 0.9)", border: "1px solid hsl(20 10% 15%)" }}>
              <p className="text-sm" style={{ color: "hsl(30 10% 75%)" }}>
                {conflictEmail ? (
                  <>An account already exists for <span style={{ color: "hsl(30 20% 98%)" }}>{conflictEmail}</span>. Try signing in with your email and password instead.</>
                ) : (
                  <>An account with this email already exists. Try signing in with your email and password instead.</>
                )}
              </p>
              <button
                onClick={() => {
                  if (conflictEmail) {
                    window.localStorage.setItem("kf_email", conflictEmail);
                  }
                  router.push("/auth/login");
                }}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110"
                style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
              >
                Sign in with email & password
              </button>
              <a
                href="mailto:support@keyflow.app?subject=Help%20signing%20in%20with%20Google"
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all hover:brightness-110"
                style={{ color: "hsl(30 20% 98%)", background: "hsl(20 10% 12%)", border: "1px solid hsl(20 10% 18%)", display: "inline-block" }}
              >
                Contact support
              </a>
            </div>
          </div>
        </div>
      );
    }

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

export default function AuthCallback() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
