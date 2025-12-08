"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { bootstrapIdentity } from "@/lib/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [company, setCompany] = useState("");
  const [age, setAge] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const passwordIssues = useMemo(() => {
    const issues: string[] = [];
    if (password.length < 8) issues.push("At least 8 characters");
    if (!/[A-Z]/.test(password)) issues.push("One uppercase letter");
    if (!/[a-z]/.test(password)) issues.push("One lowercase letter");
    if (!/[0-9]/.test(password)) issues.push("One number");
    return issues;
  }, [password]);

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

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firstName.trim()) {
      setError("Please enter your first name.");
      return;
    }
    if (!lastName.trim()) {
      setError("Please enter your last name.");
      return;
    }
    if (!username.trim()) {
      setError("Please choose a unique username.");
      return;
    }
    if (passwordIssues.length > 0) {
      setError("Please satisfy the password requirements.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const available = await isUsernameAvailable(username.trim());
      if (!available) {
        setError("That username is taken. Please choose another.");
        setLoading(false);
        return;
      }
      const session = await supabaseSignUp(email, password);
      const profileDraft = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
        company: company.trim(),
        age: age.trim(),
        contactNumber: contactNumber.trim(),
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
        });
        if (bootstrap.data?.business?.id) {
          window.localStorage.setItem("kf_business_id", bootstrap.data.business.id);
        } else if (bootstrap.error) {
          throw new Error(bootstrap.error);
        }
      }
      setBanner(`Verification link sent to ${email}. Please check your inbox to continue.`);
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

  return (
    <div className="landing">
      <h1 className="landing-title text-3xl md:text-4xl font-semibold">Create your workspace</h1>
      <p className="landing-tagline">Sign up with your email and set up your profile to begin your flow.</p>
      {pendingVerification ? (
        <div className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 text-center shadow-[0_0_35px_rgba(41,123,255,0.25)]">
          <h2 className="text-xl font-semibold text-foreground">Verify your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <span className="text-primary">{email}</span>. Please check your inbox and click the link to continue.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="landing-button w-full disabled:opacity-70"
              onClick={() => router.push("/auth/login")}
            >
              I've verified — continue to sign in
            </button>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => setPendingVerification(false)}
            >
              Edit info / try again
            </button>
            <button
              type="button"
              className="text-sm text-primary hover:underline disabled:opacity-60"
              onClick={resendVerification}
              disabled={resending}
            >
              {resending ? "Resending..." : "Resend verification email"}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 shadow-[0_0_35px_rgba(41,123,255,0.25)]"
        >
          {error && <div className="text-xs text-amber-400">{error}</div>}
          {banner && <div className="text-xs text-emerald-300">{banner}</div>}
          <div className="grid gap-3">
            <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
              Username (unique)
              <input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder=""
              />
              <span className="text-[11px] text-muted-foreground">
                {usernameStatus === "checking" && "Checking availability..."}
                {usernameStatus === "available" && <span className="text-emerald-300">Available</span>}
                {usernameStatus === "taken" && <span className="text-amber-300">Taken, choose another.</span>}
                {usernameStatus === "idle" && "Letters/numbers, unique to you."}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
                First name
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder=""
            />
          </label>
          <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
            Last name
            <input
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
                  className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  placeholder=""
                />
              </label>
            </div>
            <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
              Company / brand
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder=""
              />
            </label>
            <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
              Age
              <input
                type="number"
                min="13"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder=""
              />
            </label>
            <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
              Contact number
              <input
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder=""
              />
            </label>
          </div>
          <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
            Email
            <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder=""
          />
        </label>
          <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
            Password
            <div className="relative">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 pr-12 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder=""
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute inset-y-0 right-2 flex items-center text-xs text-primary"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 space-y-1">
              <p>Password requirements:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li className={password.length >= 8 ? "text-emerald-300" : ""}>At least 8 characters</li>
                <li className={/[A-Z]/.test(password) ? "text-emerald-300" : ""}>One uppercase letter</li>
                <li className={/[a-z]/.test(password) ? "text-emerald-300" : ""}>One lowercase letter</li>
                <li className={/[0-9]/.test(password) ? "text-emerald-300" : ""}>One number</li>
              </ul>
            </div>
          </label>
          <button type="submit" className="landing-button w-full disabled:opacity-70" disabled={loading}>
            {loading ? "Creating..." : "BEGIN FLOW"}
          </button>
          <div className="text-sm text-muted-foreground text-center">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
