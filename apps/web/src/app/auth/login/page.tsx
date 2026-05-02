"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Zap,
  BarChart3,
  Users,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { bootstrapIdentity } from "@/lib/client";
import { applyDevBypassToLocalStorage, isDevAuthBypassEnabled } from "@/lib/keyflow-dev-auth";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "");

async function supabaseSignIn(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase env vars missing");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) throw new Error(json?.error_description ?? json?.msg ?? "Sign in failed");
  return json as { access_token: string };
}

function signInWithGoogle() {
  if (!SUPABASE_URL) return;
  const redirectTo = `${SITE_URL.replace(/\/$/, "")}/auth/callback`;
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function supabaseResetPassword(email: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase env vars missing");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, redirectTo: `${SITE_URL.replace(/\/$/, "")}/auth/login` }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error_description ?? json?.msg ?? "Failed to send reset email");
  }
}

const FEATURES = [
  { icon: Zap, label: "AI Autopilot", desc: "80-90% operations automated" },
  { icon: BarChart3, label: "Smart Analytics", desc: "Real-time business intelligence" },
  { icon: Users, label: "Full CRM", desc: "Pipeline, contacts & engagement" },
  { icon: ShieldCheck, label: "Caribbean-Ready", desc: "TTD currency & local payments" },
];

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

  useEffect(() => {
    if (isDevAuthBypassEnabled()) {
      applyDevBypassToLocalStorage();
      router.replace("/app");
    }
  }, [router]);

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
      } finally { setLoading(false); }
      return;
    }
    setLoading(true);
    try {
      const session = await supabaseSignIn(email, password);
      window.localStorage.setItem("kf_token", session.access_token);
      const draft = JSON.parse(window.localStorage.getItem("kf_profile_draft") || "{}");
      const bootstrap = await bootstrapIdentity({
        email, firstName: draft.firstName, lastName: draft.lastName,
        phone: draft.phone, company: draft.company, username: draft.username,
      });
      if (bootstrap.data?.business?.id) {
        window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
      } else if (bootstrap.error) { throw new Error(bootstrap.error); }
      else { throw new Error("Could not create workspace. Please try again."); }
      router.push("/app");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-[hsl(20_14%_4%)] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-60 -right-60 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,hsl(24_95%_53%/0.12),transparent_70%)]" />
        <div className="absolute -bottom-60 -left-60 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,hsl(173_58%_39%/0.08),transparent_70%)]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-[radial-gradient(circle,hsl(24_95%_53%/0.04),transparent_60%)]" />
      </div>

      <div className="hidden lg:flex flex-col justify-center flex-1 relative z-10 px-12 xl:px-20">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-5.5 h-5.5 text-white" />
            </div>
            <span className="text-xl font-bold text-[hsl(30_20%_98%)]">KeyFlowOS</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-bold leading-tight mb-4">
            <span className="text-[hsl(30_20%_98%)]">Your business,</span>
            <br />
            <span className="bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)] bg-clip-text text-transparent">on autopilot.</span>
          </h2>
          <p className="text-[hsl(30_10%_55%)] text-lg max-w-md mb-10 leading-relaxed">
            The AI-powered operating system built for Caribbean entrepreneurs. Automate, grow, and scale with confidence.
          </p>

          <div className="grid grid-cols-2 gap-4 max-w-lg">
            {FEATURES.map(({ icon: Icon, label, desc }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm"
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[hsl(24_95%_53%/0.1)] flex-shrink-0">
                  <Icon className="w-4.5 h-4.5 text-[hsl(24_95%_53%)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[hsl(30_20%_98%)]">{label}</p>
                  <p className="text-xs text-[hsl(30_10%_50%)] mt-0.5">{desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="flex-1 lg:max-w-[520px] flex items-center justify-center relative z-10 px-5 py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-[400px]"
        >
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-[hsl(30_20%_98%)]">KeyFlowOS</span>
          </div>

          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-[hsl(30_20%_98%)]">
              {mode === "forgot" ? (resetSent ? "Check your inbox" : "Reset password") : "Welcome back"}
            </h1>
            <p className="text-sm mt-1.5 text-[hsl(30_10%_55%)]">
              {mode === "forgot"
                ? (resetSent ? "We sent you a password reset link" : "Enter your email to receive a reset link")
                : "Sign in to your workspace"}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {mode === "forgot" && resetSent ? (
              <motion.div
                key="reset-sent"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl p-6 flex flex-col items-center gap-5 border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl"
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[hsl(24_95%_53%/0.1)]">
                  <Mail className="w-7 h-7 text-[hsl(24_95%_53%)]" />
                </div>
                <p className="text-sm text-center text-[hsl(30_10%_55%)]">
                  If an account exists for <span className="font-semibold text-[hsl(24_95%_53%)]">{email}</span>, you will receive a password reset link.
                </p>
                <button
                  type="button"
                  onClick={() => { setMode("login"); setResetSent(false); setError(null); }}
                  className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all"
                >
                  Back to sign in
                </button>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                onSubmit={onSubmit}
                className="rounded-2xl p-6 flex flex-col gap-4 border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl"
              >
                <AnimatePresence>
                  {banner && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      {banner}
                    </motion.div>
                  )}
                  {error && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                    <input
                      required type="email" value={email} autoComplete="email"
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                {mode === "login" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Password</label>
                      <button type="button" onClick={() => { setMode("forgot"); setError(null); setBanner(null); }}
                        className="text-xs text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] transition-colors">
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                      <input
                        required type={showPassword ? "text" : "password"} value={password} autoComplete="current-password"
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-12 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                        placeholder="Enter your password"
                      />
                      <button type="button" onClick={() => setShowPassword((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(30_10%_50%)] hover:text-[hsl(30_10%_70%)] transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />{mode === "forgot" ? "Sending..." : "Signing in..."}</>
                  ) : (
                    <>{mode === "forgot" ? "Send reset link" : "Sign in"}<ArrowRight className="w-4 h-4" /></>
                  )}
                </button>

                {mode === "forgot" && (
                  <button type="button" onClick={() => { setMode("login"); setError(null); }}
                    className="flex items-center justify-center gap-1.5 text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_10%_70%)] transition-colors">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                  </button>
                )}

                {mode === "login" && (
                  <>
                    <div className="flex items-center gap-3 my-1">
                      <div className="flex-1 h-px bg-white/[0.06]" />
                      <span className="text-xs text-[hsl(30_10%_30%)]">or</span>
                      <div className="flex-1 h-px bg-white/[0.06]" />
                    </div>

                    <button type="button" onClick={signInWithGoogle}
                      className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm bg-white text-gray-700 hover:bg-gray-50 transition-all">
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Continue with Google
                    </button>

                    <p className="text-center text-sm text-[hsl(30_10%_55%)]">
                      New to KeyFlowOS?{" "}
                      <Link href="/auth/signup" className="font-medium text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] transition-colors">
                        Create your workspace
                      </Link>
                    </p>
                  </>
                )}
              </motion.form>
            )}
          </AnimatePresence>

          <p className="text-center text-xs mt-6 text-[hsl(30_10%_25%)]">
            KeyFlowOS — Your business, on autopilot.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
