"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  AlertCircle,
  User,
  AtSign,
  Building2,
  Phone,
  CheckCircle2,
  Loader2,
  X,
  Zap,
  BarChart3,
  Users,
  ShieldCheck,
} from "lucide-react";
import { bootstrapIdentity } from "@/lib/client";
import { persistSessionToken } from "@/lib/session-client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSiteUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function signUpWithGoogle() {
  if (!SUPABASE_URL) return;
  const redirectTo = `${getSiteUrl().replace(/\/$/, "")}/auth/callback`;
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function supabaseSignUp(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase env vars missing");
  const siteUrl = getSiteUrl();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, options: { emailRedirectTo: `${siteUrl.replace(/\/$/, "")}/auth/login?verified=1` } }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json && typeof json === "object" && ("error_description" in json || "msg" in json || "error" in json)
      ? (json.error_description as string) || (json.msg as string) || (json.error as string) : null) || res.statusText;
    throw new Error(detail || "Signup failed");
  }
  return json as { access_token?: string | null };
}

async function isUsernameAvailable(username: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !username) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return true;
    const data = await res.json().catch(() => []);
    return !Array.isArray(data) || data.length === 0;
  } catch { return true; }
}

const FEATURES = [
  { icon: Zap, label: "AI Autopilot", desc: "80-90% operations automated" },
  { icon: BarChart3, label: "Smart Analytics", desc: "Real-time business intelligence" },
  { icon: Users, label: "Full CRM", desc: "Pipeline, contacts & engagement" },
  { icon: ShieldCheck, label: "Caribbean-Ready", desc: "TTD currency & local payments" },
];

const PW_RULES = [
  { label: "8+ chars", test: (p: string) => p.length >= 8 },
  { label: "Uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /[0-9]/.test(p) },
];

export default function AuthSignup() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const passwordChecks = useMemo(() => PW_RULES.map((r) => r.test(password)), [password]);
  const passwordStrength = passwordChecks.filter(Boolean).length;
  const passwordValid = passwordChecks.every(Boolean);

  useEffect(() => {
    let cancelled = false;
    if (!username.trim()) { setUsernameStatus("idle"); return; }
    setUsernameStatus("checking");
    const id = setTimeout(async () => {
      const available = await isUsernameAvailable(username.trim());
      if (!cancelled) setUsernameStatus(available ? "available" : "taken");
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [username]);

  const canProceedStep1 = firstName.trim() && lastName.trim() && username.trim() && usernameStatus !== "taken";
  const canProceedStep2 = email.trim() && password.trim() && passwordValid;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step === 1) {
      if (!firstName.trim()) { setError("What's your first name?"); return; }
      if (!lastName.trim()) { setError("And your last name?"); return; }
      if (!username.trim()) { setError("Pick a unique username."); return; }
      if (usernameStatus === "taken") { setError("That username is taken."); return; }
      setError(null); setStep(2); return;
    }
    if (!passwordValid) { setError("Please meet all password requirements."); return; }
    setError(null); setLoading(true);
    try {
      const available = await isUsernameAvailable(username.trim());
      if (!available) { setError("That username is taken. Please choose another."); setStep(1); setLoading(false); return; }
      const session = await supabaseSignUp(email, password);
      const profileDraft = { firstName: firstName.trim(), lastName: lastName.trim(), username: username.trim(), company: company.trim(), phone: phone.trim() };
      window.localStorage.setItem("kf_profile_draft", JSON.stringify(profileDraft));
      window.localStorage.setItem("kf_username", username.trim());
      window.localStorage.setItem("kf_email", email.trim());
      if (session?.access_token) {
        await persistSessionToken(session.access_token);
        const bootstrap = await bootstrapIdentity({
          email: email.trim(), username: username.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          firstName: firstName.trim(), lastName: lastName.trim(),
          phone: phone.trim(), company: company.trim(),
        });
        if (bootstrap.data?.business?.id) window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
        else if (bootstrap.error) throw new Error(bootstrap.error);
      }
      setPendingVerification(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Check email for verification link.");
    } finally { setLoading(false); }
  };

  const resendVerification = async () => {
    setError(null); setResending(true);
    try { await supabaseSignUp(email, password); }
    catch (error: unknown) { setError(error instanceof Error ? error.message : "Resend failed"); }
    finally { setResending(false); }
  };

  const initials = (firstName || lastName) ? `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase() : "";

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
            <span className="text-[hsl(30_20%_98%)]">Start building</span>
            <br />
            <span className="bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)] bg-clip-text text-transparent">your empire.</span>
          </h2>
          <p className="text-[hsl(30_10%_55%)] text-lg max-w-md mb-10 leading-relaxed">
            Join Caribbean entrepreneurs automating their businesses with AI. Set up takes less than 2 minutes.
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

          <div className="text-center mb-5">
            <h1 className="text-2xl font-bold text-[hsl(30_20%_98%)]">
              {pendingVerification ? "Check your inbox" : step === 1 ? "Create your account" : "Almost there"}
            </h1>
            <p className="text-sm mt-1.5 text-[hsl(30_10%_55%)]">
              {pendingVerification ? "Verify your email to get started" : step === 1 ? "Tell us about yourself" : "Set up your credentials"}
            </p>
          </div>

          {!pendingVerification && (
            <div className="flex items-center gap-2 mb-5 px-1">
              {[1, 2].map((s) => (
                <div key={s} className="flex-1 h-1 rounded-full overflow-hidden bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]"
                    initial={{ width: "0%" }}
                    animate={{ width: step >= s ? "100%" : "0%" }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              ))}
              <span className="text-xs font-medium text-[hsl(30_10%_50%)] ml-1 tabular-nums">{step}/2</span>
            </div>
          )}

          <AnimatePresence mode="wait">
            {pendingVerification ? (
              <motion.div
                key="verify"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl p-6 flex flex-col items-center gap-5 border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl"
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[hsl(24_95%_53%/0.1)]">
                  <Mail className="w-7 h-7 text-[hsl(24_95%_53%)]" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-[hsl(30_10%_55%)]">We sent a verification link to</p>
                  <p className="text-sm font-semibold mt-1 text-[hsl(24_95%_53%)]">{email}</p>
                </div>
                <div className="flex flex-col gap-3 w-full">
                  <button type="button" onClick={() => router.push("/auth/login")}
                    className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all flex items-center justify-center gap-2">
                    I verified — sign in <ArrowRight className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => { setPendingVerification(false); setStep(1); }}
                    className="text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_10%_70%)] transition-colors">
                    Edit info / try again
                  </button>
                  <button type="button" onClick={resendVerification} disabled={resending}
                    className="text-sm text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                    {resending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Resending...</> : "Resend verification email"}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.form
                key={`step-${step}`}
                initial={{ opacity: 0, x: step === 2 ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: step === 2 ? -20 : 20 }}
                transition={{ duration: 0.25 }}
                onSubmit={onSubmit}
                className="rounded-2xl p-6 flex flex-col gap-4 border border-white/[0.08] bg-white/[0.03] backdrop-blur-2xl"
              >
                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1">{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {step === 1 && (
                  <>
                    {initials && (
                      <div className="flex justify-center mb-1">
                        <motion.div
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]"
                        >
                          {initials}
                        </motion.div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[hsl(30_10%_55%)]">First name</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                          <input required value={firstName} onChange={(e) => setFirstName(e.target.value)}
                            className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                            placeholder="John" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Last name</label>
                        <input required value={lastName} onChange={(e) => setLastName(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                          placeholder="Doe" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Username</label>
                      <div className="relative">
                        <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                        <input required value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                          className={`w-full pl-10 pr-9 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)] ${
                            usernameStatus === "taken" ? "border border-red-500/50 focus:border-red-500/50" :
                            usernameStatus === "available" ? "border border-emerald-500/50 focus:border-emerald-500/50" :
                            "border border-white/[0.08] focus:border-[hsl(24_95%_53%/0.5)]"
                          }`}
                          placeholder="johndoe" />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          {usernameStatus === "checking" && <Loader2 className="w-4 h-4 text-[hsl(24_95%_53%)] animate-spin" />}
                          {usernameStatus === "available" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                          {usernameStatus === "taken" && <X className="w-4 h-4 text-red-400" />}
                        </div>
                      </div>
                      {usernameStatus === "taken" && <p className="text-xs text-red-400">Taken — try another</p>}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Company / brand <span className="text-[hsl(30_10%_30%)]">(optional)</span></label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                        <input value={company} onChange={(e) => setCompany(e.target.value)}
                          className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                          placeholder="Acme Inc" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Phone <span className="text-[hsl(30_10%_30%)]">(optional)</span></label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                        <input value={phone} onChange={(e) => setPhone(e.target.value)}
                          className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                          placeholder="+1 868 555-1234" />
                      </div>
                    </div>

                    <button type="submit" disabled={!canProceedStep1}
                      className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </>
                )}

                {step === 2 && (
                  <>
                    <button type="button" onClick={() => setStep(1)}
                      className="flex items-center gap-1.5 text-xs text-[hsl(30_10%_55%)] hover:text-[hsl(30_10%_70%)] transition-colors self-start">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>

                    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-[hsl(24_95%_53%/0.06)] border border-[hsl(24_95%_53%/0.12)]">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
                        {initials || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[hsl(30_20%_98%)] truncate">{firstName} {lastName}</p>
                        <p className="text-xs text-[hsl(30_10%_50%)] truncate">@{username}{company ? ` \u00B7 ${company}` : ""}</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                        <input required type="email" value={email} autoComplete="email"
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                          placeholder="you@example.com" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[hsl(30_10%_55%)]">Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(30_10%_35%)]" />
                        <input required type={showPassword ? "text" : "password"} value={password} autoComplete="new-password"
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-10 pr-12 py-2.5 rounded-xl text-sm outline-none transition-all bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
                          placeholder="Create a strong password" />
                        <button type="button" onClick={() => setShowPassword((p) => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(30_10%_50%)] hover:text-[hsl(30_10%_70%)] transition-colors">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {password.length > 0 && (
                        <div className="flex flex-col gap-2 mt-1">
                          <div className="flex gap-1">
                            {[0, 1, 2, 3].map((i) => (
                              <div key={i} className="flex-1 h-1 rounded-full transition-all duration-300"
                                style={{ background: i < passwordStrength
                                  ? passwordStrength <= 2 ? "hsl(0 84% 60%)" : passwordStrength === 3 ? "hsl(45 93% 47%)" : "hsl(142 72% 45%)"
                                  : "hsl(20 10% 15%)" }} />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {PW_RULES.map((rule, i) => (
                              <span key={rule.label}
                                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors border ${
                                  passwordChecks[i]
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-white/[0.03] text-[hsl(30_10%_40%)] border-white/[0.06]"
                                }`}>
                                {passwordChecks[i] ? "\u2713" : ""} {rule.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <button type="submit" disabled={loading || !canProceedStep2}
                      className="w-full py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
                      {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</> : <>Create account <ArrowRight className="w-4 h-4" /></>}
                    </button>
                  </>
                )}

                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-xs text-[hsl(30_10%_30%)]">or</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                <button type="button" onClick={signUpWithGoogle}
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
                  Already have an account?{" "}
                  <Link href="/auth/login" className="font-medium text-[hsl(24_95%_53%)] hover:text-[hsl(24_95%_63%)] transition-colors">
                    Sign in
                  </Link>
                </p>
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
