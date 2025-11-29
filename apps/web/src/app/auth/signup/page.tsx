"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AuthSignup() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: wire to real signup endpoint
    setTimeout(() => {
      setLoading(false);
      router.push("/app");
    }, 500);
  };

  return (
    <div className="landing">
      <h1 className="landing-title text-3xl md:text-4xl font-semibold">Create your workspace</h1>
      <p className="landing-tagline">Sign up with your email to begin your flow.</p>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md mx-auto bg-slate-900/40 border border-primary/30 rounded-3xl p-6 flex flex-col gap-4 shadow-[0_0_35px_rgba(41,123,255,0.25)]"
      >
        <label className="flex flex-col text-left text-sm text-muted-foreground gap-1">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl bg-slate-950/80 border border-border/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="you@example.com"
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
            placeholder="Create a secure password"
          />
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
    </div>
  );
}
