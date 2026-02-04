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

export default function AuthLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const verified = useMemo(() => searchParams?.get("verified") === "1", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(verified ? "Email verified. Please sign in to continue." : null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    setLoading(true);
    try {
      const session = await supabaseSignIn(email, password);
      window.localStorage.setItem("kf_token", session.access_token);
      const bootstrap = await bootstrapIdentity({ email });
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
    <div className="landing">
      <h1 className="landing-title text-3xl md:text-4xl font-semibold">Sign in</h1>
      <p className="landing-tagline">Use your email and password. New here? Continue to sign up instead.</p>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 shadow-[0_0_35px_rgba(41,123,255,0.25)]"
      >
        {banner && <div className="text-xs text-emerald-300">{banner}</div>}
        {error && <div className="text-xs text-amber-400">{error}</div>}
        <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="you@example.com"
            suppressHydrationWarning
          />
        </label>
        <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="••••••••"
            suppressHydrationWarning
          />
        </label>
        <button type="submit" className="landing-button w-full disabled:opacity-70" disabled={loading}>
          {loading ? "Signing in..." : "BEGIN FLOW"}
        </button>
        
        <div className="flex items-center gap-3 my-2">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
        
        <button
          type="button"
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors border border-gray-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
        
        <div className="text-sm text-muted-foreground text-center">
          New to KeyFlowOS?{" "}
          <Link href="/auth/signup" className="text-primary hover:underline">
            Create your workspace
          </Link>
        </div>
      </form>
    </div>
  );
}
