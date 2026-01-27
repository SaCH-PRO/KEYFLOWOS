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
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      <div className="pointer-events-none absolute -left-32 top-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(244,140,69,0.18),transparent_70%)] blur-2xl" />
      <div className="pointer-events-none absolute -right-24 top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(255,120,92,0.14),transparent_70%)] blur-3xl" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 lg:flex-row lg:items-center">
        <div className="flex-1 space-y-6">
          <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
            <span className="h-6 w-6 rounded-2xl bg-primary/15 border border-primary/40" />
            Back to home
          </Link>
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-muted-foreground">
              KeyFlowOS
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight">
              Welcome back.
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-xl">
              Sign in to your workspace and keep the flow moving — bookings, revenue, and client signals in one place.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Adaptive CRM", "Real-time insights", "Automations", "Instant payments"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_14px_rgba(244,140,69,0.45)]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-md lg:max-w-sm">
          <div className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[var(--kf-shadow)] backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Sign in</h2>
                <p className="text-xs text-muted-foreground">Continue with your KeyFlowOS account.</p>
              </div>
              <div className="h-10 w-10 rounded-2xl border border-border/60 bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                KF
              </div>
            </div>

            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              {banner && (
                <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200" aria-live="polite">
                  {banner}
                </div>
              )}
              {error && (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200" aria-live="polite">
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
        </div>
      </div>
    </div>
  );
}
