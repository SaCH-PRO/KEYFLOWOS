"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { Send } from "lucide-react";
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

  const inputClass =
    "w-full border-b border-slate-300 bg-transparent px-0 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none";

  return (
    <div className="min-h-screen bg-[#d1d1d1] text-slate-900 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <Link href="/" className="inline-flex items-center gap-2 hover:text-slate-900">
            <span className="h-5 w-5 rounded-full border border-slate-300 bg-white/80" />
            Back to home
          </Link>
          <span className="uppercase tracking-[0.3em]">KeyFlowOS</span>
        </div>

        <div className="mt-8 overflow-hidden rounded-[34px] bg-white shadow-[0_35px_80px_rgba(15,23,42,0.25)]">
          <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[0.45fr_0.55fr]">
            <div className="relative flex flex-col items-center justify-between gap-6 bg-[linear-gradient(160deg,#1d5a96,#2f78b6)] px-8 py-10 text-white">
              <div className="absolute inset-y-0 right-0 hidden w-10 translate-x-1/2 rounded-full bg-white md:block" />
              <div className="text-center space-y-2">
                <p className="text-sm opacity-80">Hello,</p>
                <p className="text-2xl font-semibold">welcome to!</p>
              </div>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
                  <Send className="h-7 w-7" />
                </div>
                <div className="text-lg font-semibold tracking-wide">KeyFlowOS</div>
                <p className="text-xs text-white/70 max-w-[220px]">
                  Your workspace for bookings, revenue, and customer flow.
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.32em]">Sign in ▸</div>
            </div>

            <div className="flex flex-col justify-center px-8 py-10">
              <div className="text-center">
                <h1 className="text-xl font-semibold">Sign in to your account</h1>
                <p className="mt-2 text-sm text-slate-500">Use your email and password to continue.</p>
              </div>

              <form onSubmit={onSubmit} className="mt-8 space-y-5">
                {banner && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700" aria-live="polite">
                    {banner}
                  </div>
                )}
                {error && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700" aria-live="polite">
                    {error}
                  </div>
                )}
                <label className="block text-sm text-slate-600">
                  Email Address
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    className={inputClass}
                    placeholder="Enter your email"
                    suppressHydrationWarning
                  />
                </label>
                <label className="block text-sm text-slate-600">
                  Password
                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className={inputClass}
                    placeholder="Enter your password"
                    suppressHydrationWarning
                  />
                </label>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="h-3 w-3 accent-blue-600" />
                    Remember me
                  </label>
                  <Link href="/auth/signup" className="text-blue-600 hover:underline">
                    Create account
                  </Link>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    disabled={loading}
                  >
                    {loading ? "Signing in..." : "Sign In"}
                  </button>
                  <Link
                    href="/auth/signup"
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(29,90,150,0.35)]"
                  >
                    Sign Up
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
