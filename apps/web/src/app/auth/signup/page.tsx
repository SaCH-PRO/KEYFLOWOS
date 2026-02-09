"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function signUpWithGoogle() {
  if (!SUPABASE_URL) {
    alert("Supabase not configured");
    return;
  }
  const redirectTo = `${SITE_URL.replace(/\/$/, "")}/auth/callback`;
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.href = authUrl;
}

async function supabaseSignUp(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env vars missing");
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email,
      password,
      options: { emailRedirectTo: `${SITE_URL.replace(/\/$/, "")}/auth/login?verified=1` },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      (json && typeof json === "object" && ("error_description" in json || "msg" in json || "error" in json)
        ? (json.error_description as string) || (json.msg as string) || (json.error as string)
        : null) || res.statusText;
    throw new Error(detail || "Signup failed");
  }
  return json as { access_token?: string | null };
}

async function isUsernameAvailable(username: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !username) return true;
  const url = `${SUPABASE_URL}/rest/v1/user_profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return true;
    const data = await res.json().catch(() => []);
    return !Array.isArray(data) || data.length === 0;
  } catch {
    return true;
  }
}

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

  const passwordIssues = useMemo(() => {
    const issues: string[] = [];
    if (password.length < 8) issues.push("8+ characters");
    if (!/[A-Z]/.test(password)) issues.push("Uppercase");
    if (!/[a-z]/.test(password)) issues.push("Lowercase");
    if (!/[0-9]/.test(password)) issues.push("Number");
    return issues;
  }, [password]);

  const passwordStrength = 4 - passwordIssues.length;

  useEffect(() => {
    let cancelled = false;
    if (!username.trim()) {
      setUsernameStatus("idle");
      return;
    }
    setUsernameStatus("checking");
    const id = setTimeout(async () => {
      const available = await isUsernameAvailable(username.trim());
      if (cancelled) return;
      setUsernameStatus(available ? "available" : "taken");
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [username]);

  const canProceedStep1 = firstName.trim() && lastName.trim() && username.trim() && usernameStatus !== "taken";
  const canProceedStep2 = email.trim() && password.trim() && passwordIssues.length === 0;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step === 1) {
      if (!firstName.trim()) { setError("What's your first name?"); return; }
      if (!lastName.trim()) { setError("And your last name?"); return; }
      if (!username.trim()) { setError("Pick a unique username."); return; }
      if (usernameStatus === "taken") { setError("That username is taken."); return; }
      setError(null);
      setStep(2);
      return;
    }

    if (passwordIssues.length > 0) {
      setError("Please meet all password requirements.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const available = await isUsernameAvailable(username.trim());
      if (!available) {
        setError("That username is taken. Please choose another.");
        setStep(1);
        setLoading(false);
        return;
      }
      const session = await supabaseSignUp(email, password);
      const profileDraft = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        company: company.trim(),
        phone: phone.trim(),
      };
      window.localStorage.setItem("kf_profile_draft", JSON.stringify(profileDraft));
      window.localStorage.setItem("kf_username", username.trim());
      window.localStorage.setItem("kf_email", email.trim());
      if (session?.access_token) {
        window.localStorage.setItem("kf_token", session.access_token);
        const bootstrap = await bootstrapIdentity({
          email: email.trim(),
          username: username.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          company: company.trim(),
        });
        if (bootstrap.data?.business?.id) {
          window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
        } else if (bootstrap.error) {
          throw new Error(bootstrap.error);
        }
      }
      setPendingVerification(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Check email for verification link.";
      setError(message || "Check email for verification link.");
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setError(null);
    setResending(true);
    try {
      await supabaseSignUp(email, password);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Resend failed";
      setError(message);
    } finally {
      setResending(false);
    }
  };

  const initials = (firstName || lastName) ? `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase() : "";

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: "hsl(20 14% 4%)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, hsl(24 95% 53% / 0.15), transparent 70%)" }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, hsl(173 58% 39% / 0.1), transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ background: "radial-gradient(circle, hsl(24 95% 53% / 0.05), transparent 60%)" }} />
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
            {pendingVerification ? "Check your inbox" : step === 1 ? "Create your account" : "Almost there"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(30 10% 55%)" }}>
            {pendingVerification ? "Verify your email to get started" : step === 1 ? "Tell us about yourself" : "Set up your credentials"}
          </p>
        </div>

        {!pendingVerification && (
          <div className="flex items-center gap-2 mb-6 px-2">
            {[1, 2].map((s) => (
              <div key={s} className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(20 10% 15%)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: step >= s ? "100%" : "0%",
                    background: "linear-gradient(90deg, hsl(24 95% 53%), hsl(173 58% 39%))",
                  }}
                />
              </div>
            ))}
            <span className="text-xs font-medium ml-1" style={{ color: "hsl(30 10% 55%)" }}>
              {step}/2
            </span>
          </div>
        )}

        {pendingVerification ? (
          <div className="rounded-2xl p-6 flex flex-col gap-5 text-center" style={{ background: "hsl(20 14% 7% / 0.9)", backdropFilter: "blur(20px)", border: "1px solid hsl(20 10% 15%)" }}>
            <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "hsl(24 95% 53% / 0.1)" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="hsl(24 95% 53%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm" style={{ color: "hsl(30 10% 55%)" }}>
                We sent a verification link to
              </p>
              <p className="text-sm font-semibold mt-1" style={{ color: "hsl(24 95% 53%)" }}>{email}</p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => router.push("/auth/login")}
                className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110"
                style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
              >
                I verified — sign in
              </button>
              <button
                type="button"
                onClick={() => { setPendingVerification(false); setStep(1); }}
                className="text-sm transition-colors hover:brightness-125"
                style={{ color: "hsl(30 10% 55%)" }}
              >
                Edit info / try again
              </button>
              <button
                type="button"
                onClick={resendVerification}
                disabled={resending}
                className="text-sm transition-colors hover:brightness-125 disabled:opacity-50"
                style={{ color: "hsl(24 95% 53%)" }}
              >
                {resending ? "Resending..." : "Resend verification email"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="rounded-2xl p-6 flex flex-col gap-4" style={{ background: "hsl(20 14% 7% / 0.9)", backdropFilter: "blur(20px)", border: "1px solid hsl(20 10% 15%)" }}>
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm" style={{ background: "hsl(0 84% 60% / 0.1)", color: "hsl(0 84% 70%)", border: "1px solid hsl(0 84% 60% / 0.2)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
                {error}
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                {initials && (
                  <div className="flex justify-center mb-2">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white" style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(173 58% 39%))" }}>
                      {initials}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>First name</label>
                    <input
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                      style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                      onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                      onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                      placeholder="John"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Last name</label>
                    <input
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                      style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                      onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                      onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                      placeholder="Doe"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Username</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "hsl(30 10% 35%)" }}>@</span>
                    <input
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                      className="w-full pl-7 pr-8 py-2.5 rounded-xl text-sm outline-none transition-all"
                      style={{ background: "hsl(20 14% 4%)", border: `1px solid ${usernameStatus === "taken" ? "hsl(0 84% 60%)" : usernameStatus === "available" ? "hsl(142 72% 45%)" : "hsl(20 10% 15%)"}`, color: "hsl(30 20% 98%)" }}
                      placeholder="johndoe"
                    />
                    {usernameStatus === "checking" && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "hsl(24 95% 53%)", borderTopColor: "transparent" }} />
                    )}
                    {usernameStatus === "available" && (
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(142 72% 45%)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                    {usernameStatus === "taken" && (
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(0 84% 60%)" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    )}
                  </div>
                  {usernameStatus === "taken" && <p className="text-xs" style={{ color: "hsl(0 84% 70%)" }}>Taken — try another</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Company / brand <span style={{ color: "hsl(30 10% 35%)" }}>(optional)</span></label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                    style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                    onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                    onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                    placeholder="Acme Inc"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Phone <span style={{ color: "hsl(30 10% 35%)" }}>(optional)</span></label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
                    style={{ background: "hsl(20 14% 4%)", border: "1px solid hsl(20 10% 15%)", color: "hsl(30 20% 98%)" }}
                    onFocus={(e) => e.target.style.borderColor = "hsl(24 95% 53%)"}
                    onBlur={(e) => e.target.style.borderColor = "hsl(20 10% 15%)"}
                    placeholder="+1 868 555-1234"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canProceedStep1}
                  className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
                >
                  Continue
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 text-xs self-start transition-colors hover:brightness-125"
                  style={{ color: "hsl(30 10% 55%)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
                  Back
                </button>

                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "hsl(24 95% 53% / 0.08)", border: "1px solid hsl(24 95% 53% / 0.15)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(173 58% 39%))" }}>
                    {initials || "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "hsl(30 20% 98%)" }}>{firstName} {lastName}</p>
                    <p className="text-xs truncate" style={{ color: "hsl(30 10% 55%)" }}>@{username}{company ? ` \u00B7 ${company}` : ""}</p>
                  </div>
                </div>

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

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" style={{ color: "hsl(30 10% 55%)" }}>Password</label>
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
                      placeholder="Create a strong password"
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
                  {password.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="flex-1 h-1 rounded-full transition-all duration-300"
                            style={{
                              background: i < passwordStrength
                                ? passwordStrength <= 2 ? "hsl(0 84% 60%)" : passwordStrength === 3 ? "hsl(45 93% 47%)" : "hsl(142 72% 45%)"
                                : "hsl(20 10% 15%)",
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["8+ chars", "Uppercase", "Lowercase", "Number"].map((label, i) => {
                          const checks = [password.length >= 8, /[A-Z]/.test(password), /[a-z]/.test(password), /[0-9]/.test(password)];
                          return (
                            <span
                              key={label}
                              className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
                              style={{
                                background: checks[i] ? "hsl(142 72% 45% / 0.1)" : "hsl(20 10% 15%)",
                                color: checks[i] ? "hsl(142 72% 45%)" : "hsl(30 10% 40%)",
                                border: `1px solid ${checks[i] ? "hsl(142 72% 45% / 0.2)" : "transparent"}`,
                              }}
                            >
                              {checks[i] ? "\u2713" : ""} {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !canProceedStep2}
                  className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "linear-gradient(135deg, hsl(24 95% 53%), hsl(24 95% 45%))" }}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating account...
                    </span>
                  ) : (
                    "Create account"
                  )}
                </button>
              </div>
            )}

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px" style={{ background: "hsl(20 10% 15%)" }} />
              <span className="text-xs" style={{ color: "hsl(30 10% 35%)" }}>or</span>
              <div className="flex-1 h-px" style={{ background: "hsl(20 10% 15%)" }} />
            </div>

            <button
              type="button"
              onClick={signUpWithGoogle}
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
              Already have an account?{" "}
              <Link href="/auth/login" className="font-medium transition-colors hover:brightness-125" style={{ color: "hsl(24 95% 53%)" }}>
                Sign in
              </Link>
            </p>
          </form>
        )}

        <p className="text-center text-xs mt-6" style={{ color: "hsl(30 10% 30%)" }}>
          By signing up, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
