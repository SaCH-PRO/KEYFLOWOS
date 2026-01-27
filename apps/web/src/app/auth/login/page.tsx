"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { bootstrapIdentity, setActiveBusinessId } from "@/lib/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
        setActiveBusinessId(bootstrap.data.business.id);
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
      <div className="w-full max-w-md space-y-4">
        <Link href="/" className="text-xs text-primary hover:underline">
          Back to home
        </Link>
      </div>
      <h1 className="landing-title text-3xl md:text-4xl font-semibold">Sign in</h1>
      <p className="landing-tagline">Use your email and password. New here? Continue to sign up instead.</p>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md mx-auto bg-card border border-border rounded-3xl p-5 sm:p-6 flex flex-col gap-4 shadow-[var(--kf-shadow)]"
      >
        {banner && (
          <div className="text-xs text-emerald-300" aria-live="polite">
            {banner}
          </div>
        )}
        {error && (
          <div className="text-xs text-amber-400" aria-live="polite">
            {error}
          </div>
        )}
        <label className="flex flex-col text-left text-sm text-foreground gap-1">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            className="rounded-2xl bg-muted border border-border/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            placeholder="you@example.com"
            suppressHydrationWarning
          />
        </label>
        <label className="flex flex-col text-left text-sm text-foreground gap-1">
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="rounded-2xl bg-muted border border-border/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            placeholder="••••••••"
            suppressHydrationWarning
          />
        </label>
        <button type="submit" className="landing-button w-full disabled:opacity-70" disabled={loading}>
          {loading ? "Signing in..." : "BEGIN FLOW"}
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
