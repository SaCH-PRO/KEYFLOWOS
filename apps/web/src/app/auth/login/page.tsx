"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "");

async function supabaseSignIn(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env vars missing");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description ?? json?.msg ?? "Sign in failed");
  }
  return json as { access_token: string };
}

function signInWithGoogle() {
  if (!SUPABASE_URL) {
    alert("Supabase not configured");
    return;
  }
  const redirectTo = `${SITE_URL.replace(/\/$/, "")}/auth/callback`;
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.href = authUrl;
}

async function supabaseResetPassword(email: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env vars missing");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email,
      redirectTo: `${SITE_URL.replace(/\/$/, "")}/auth/login`,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error_description ?? json?.msg ?? "Failed to send reset email");
  }
}

export default function AuthLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const verified = useMemo(() => searchParams?.get("verified") === "1", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(verified ? "Email verified! Sign in to continue." : null);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBanner(null);

    if (mode === "forgot") {
      if (!email.trim()) { setError("Enter your email address."); return; }
      setLoading(true);
      try {
        await supabaseResetPassword(email.trim());
        setResetSent(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send reset email");
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const session = await supabaseSignIn(email, password);
      window.localStorage.setItem("kf_token", session.access_token);
      const draft = JSON.parse(window.localStorage.getItem("kf_profile_draft") || "{}");
      const bootstrap = await bootstrapIdentity({
        email,
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
        company: draft.company,
        username: draft.username,
      });
      if (bootstrap.data?.business?.id) {
        window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
      } else if (bootstrap.error) {
        throw new Error(bootstrap.error);
      } else {
        throw new Error("Could not create workspace. Please try again.");
      }
      router.push("/app");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: "hsl(20 14% 4%)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, hsl(24 95% 53% / 0.15), transparent 70%)" }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, hsl(173 58% 39% / 0.1), transparent 70%)" }} />
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(173 58% 39%))" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(30 20% 98%)" }}>
            {mode === "forgot" ? (resetSent ? "Check your inbox" : "Reset password") : "Welcome back"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(30 10% 55%)" }}>
            {mode === "forgot"
              ? (resetSent ? "We sent you a password reset link" : "Enter your email to receive a reset link")
              : "Sign in to your KeyFlowOS workspace"
            }
          </p>
        </div>

        {mode === "forgot" && resetSent ? (
          <div className="rounded-2xl p-6 flex flex-col gap-5 text-center" style={{ background: "hsl(20 14% 7% / 0.9)", backdropFilter: "blur(20px)", border: "1px solid hsl(20 10% 15%)" }}>
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "hsl(24 95% 53% / 0.1)" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="hsl(24 95% 53%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "hsl(30 10% 55%)" }}>
              If an account exists for <span className="font-semibold" style={{ color: "hsl(24 95% 53%)" }}>{email}</span>, you will receive a password reset link.
            </p>
            <button
              type="button"
              onClick={() => { setMode("login"); setResetSent(false); setError(null); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110"
              style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "hsl(20 14% 7% / 0.9)", backdropFilter: "blur(20px)", border: "1px solid hsl(20 10% 15%)" }}>
            {banner && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ background: "hsl(142 72% 45% / 0.1)", color: "hsl(142 72% 55%)", border: "1px solid hsl(142 72% 45% / 0.2)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                {banner}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ background: "hsl(0 84% 60% / 0.1)", color: "hsl(0 84% 70%)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                placeholder="you@example.com"
              />
            </div>

            {mode === "login" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Password</label>
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setError(null); setBanner(null); }}
                    className="text-xs transition-colors hover:brightness-125"
                    style={{ color: "hsl(24 95% 53%)" }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-12 rounded-xl text-sm outline-none transition-all"
                    style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                    onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                    onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute inset-y-0 right-3 flex items-center text-xs transition-colors"
                    style={{ color: "hsl(30 10% 55%)" }}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {mode === "forgot" ? "Sending..." : "Signing in..."}
                </span>
              ) : (
                mode === "forgot" ? "Send reset link" : "Sign in"
              )}
            </button>

            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="text-sm text-center transition-colors hover:brightness-125"
                style={{ color: "hsl(30 10% 55%)" }}
              >
                Back to sign in
              </button>
            )}

            {mode === "login" && (
              <>
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px" style={{ background: "hsl(20 10% 15%)" }} />
                  <span className="text-xs" style={{ color: "hsl(30 10% 35%)" }}>or</span>
                  <div className="flex-1 h-px" style={{ background: "hsl(20 10% 15%)" }} />
                </div>

                <button
                  type="button"
                  onClick={signInWithGoogle}
                  className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all hover:brightness-95"
                  style={{ background: "white", color: "#374151" }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                <p className="text-center text-sm" style={{ color: "hsl(30 10% 55%)" }}>
                  New to KeyFlowOS?{" "}
                  <Link href="/auth/signup" className="font-medium transition-colors hover:brightness-125" style={{ color: "hsl(24 95% 53%)" }}>
                    Create your workspace
                  </Link>
                </p>
              </>
            )}
          </form>
        )}

        <p className="text-center text-xs mt-6" style={{ color: "hsl(30 10% 30%)" }}>
          KeyFlowOS — Your business, on autopilot.
        </p>
      </div>
    </div>
  );
}
