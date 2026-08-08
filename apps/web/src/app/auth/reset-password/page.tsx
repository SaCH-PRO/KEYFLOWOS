"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, ArrowRight, ShieldCheck } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Status = "loading" | "ready" | "invalid" | "submitting" | "done";

function clientPasswordIssue(pw: string): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (!/[A-Za-z]/.test(pw)) return "Include at least one letter.";
  if (!/[0-9]/.test(pw)) return "Include at least one number.";
  return null;
}

/**
 * Pure helper extracted for testability + to keep the component body free
 * of imperative URL parsing. Returns a tuple describing what the recovery
 * link's URL fragment carried so the component can decide between
 * "ready", "invalid", and the error copy to display.
 */
export function parseRecoveryHash(hash: string | undefined | null):
  | { status: "ready"; token: string }
  | { status: "invalid"; error: string } {
  const raw = (hash ?? "").startsWith("#") ? (hash ?? "").slice(1) : (hash ?? "");
  const params = new URLSearchParams(raw);
  const errDesc = params.get("error_description");
  if (errDesc) {
    return { status: "invalid", error: decodeURIComponent(errDesc.replace(/\+/g, " ")) };
  }
  const token = params.get("access_token");
  const type = params.get("type");
  if (!token || type !== "recovery") {
    return {
      status: "invalid",
      error: "This reset link is invalid or has expired. Request a new one from the sign-in page.",
    };
  }
  return { status: "ready", token };
}

function ResetPasswordInner() {
  const router = useRouter();
  // Parse the recovery fragment synchronously during render so we don't
  // setState inside an effect (cascading-renders lint rule). Window may
  // not exist during SSR; guard with `typeof`.
  const initial = useMemo(
    () => (typeof window === "undefined" ? null : parseRecoveryHash(window.location.hash)),
    [],
  );
  const [status, setStatus] = useState<Status>(
    initial ? initial.status : "loading",
  );
  const [accessToken] = useState<string | null>(
    initial && initial.status === "ready" ? initial.token : null,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(
    initial && initial.status === "invalid" ? initial.error : null,
  );

  // After mount, scrub the hash from the URL so the access-token isn't
  // visible in the location bar. Pure side-effect against the URL bar,
  // no setState — belongs in useEffect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initial?.status === "ready") {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        /* ignore */
      }
    }
  }, [initial]);

  const issue = useMemo(() => (password ? clientPasswordIssue(password) : null), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);

    const localIssue = clientPasswordIssue(password);
    if (localIssue) { setError(localIssue); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("your-project")) { setError("Authentication is misconfigured. Contact support."); return; }

    setStatus("submitting");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (json?.msg || json?.error_description || json?.message || "Could not update password.") as string;
        if (/expired|invalid/i.test(msg)) {
          setError("This reset link has expired. Request a new one from the sign-in page.");
          setStatus("invalid");
        } else {
          setError(msg);
          setStatus("ready");
        }
        return;
      }
      setStatus("done");
      setTimeout(() => router.replace("/auth/login?reset=1"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setStatus("ready");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-[hsl(24_95%_53%)]/15 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-[hsl(24_95%_53%)]" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Set a new password</h1>
              <p className="text-xs text-slate-400">Choose a password you haven&apos;t used before.</p>
            </div>
          </div>

          {status === "loading" && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying reset link…
            </div>
          )}

          {status === "invalid" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error ?? "Invalid reset link."}</span>
              </div>
              <Link
                href="/auth/login"
                className="inline-flex items-center gap-1 text-sm text-[hsl(24_95%_53%)] hover:underline"
              >
                Back to sign in <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Password updated. Redirecting you to sign in…</span>
              </div>
            </div>
          )}

          {(status === "ready" || status === "submitting") && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="pw" className="block text-xs font-medium text-slate-300 mb-1.5">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="pw"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    autoFocus
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 chars, with a letter and number"
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-[hsl(24_95%_53%)]/50 focus:outline-none focus:ring-2 focus:ring-[hsl(24_95%_53%)]/20"
                    disabled={status === "submitting"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-300"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {issue && password.length > 0 && (
                  <p className="mt-1.5 text-xs text-amber-400">{issue}</p>
                )}
              </div>

              <div>
                <label htmlFor="pw2" className="block text-xs font-medium text-slate-300 mb-1.5">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    id="pw2"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-[hsl(24_95%_53%)]/50 focus:outline-none focus:ring-2 focus:ring-[hsl(24_95%_53%)]/20"
                    disabled={status === "submitting"}
                  />
                </div>
                {mismatch && <p className="mt-1.5 text-xs text-amber-400">Passwords don&apos;t match.</p>}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={status === "submitting" || Boolean(issue) || mismatch || !password || !confirm}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(24_95%_53%)] hover:bg-[hsl(24_95%_48%)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 transition"
              >
                {status === "submitting" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</>
                ) : (
                  <>Update password <ArrowRight className="h-4 w-4" /></>
                )}
              </button>

              <div className="text-center">
                <Link href="/auth/login" className="text-xs text-slate-400 hover:text-slate-200">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
