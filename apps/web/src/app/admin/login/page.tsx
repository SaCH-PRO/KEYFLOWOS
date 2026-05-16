"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { apiPostSimple } from "@/lib/api";
import { cn } from "@/lib/utils";

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await apiPostSimple<LoginResponse>("/api/admin/auth/login", {
      email,
      password,
    });

    if (res.error || !res.data) {
      setError(res.error ?? "Login failed");
      setLoading(false);
      return;
    }

    // Store admin token under a dedicated key so it never collides with Supabase auth
    localStorage.setItem("kf_admin_token", res.data.accessToken);
    localStorage.setItem("kf_admin_user_cache", JSON.stringify(res.data.user));
    localStorage.setItem("kf_auth_mode", "admin");

    // Also mirror to cookie for SSR/edge middleware
    document.cookie = `kf_admin_token=${res.data.accessToken}; path=/; max-age=86400`;
    document.cookie = `kf_admin_user_cache=${encodeURIComponent(JSON.stringify(res.data.user))}; path=/; max-age=86400`;
    document.cookie = `kf_auth_mode=admin; path=/; max-age=86400`;

    router.replace("/admin");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-border/70 bg-slate-950/80 backdrop-blur-xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 rounded-3xl bg-primary/20 flex items-center justify-center shadow-glow-primary mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Owner Console</h1>
            <p className="text-sm text-muted-foreground mt-1">Super admin access</p>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                className="w-full rounded-xl border border-border/70 bg-slate-900/70 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border border-border/70 bg-slate-900/70 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "w-full rounded-xl bg-primary text-primary-foreground font-semibold py-3 px-4 transition-all",
                "hover:bg-primary/90 hover:shadow-glow-primary",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "flex items-center justify-center gap-2",
              )}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a
              href="/auth/login"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Regular user login →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
