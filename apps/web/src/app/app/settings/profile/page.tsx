"use client";

import { useEffect, useState } from "react";
import { User, Mail, Phone, Shield, CheckCircle2, AlertCircle, Eye, EyeOff, Moon, Sun } from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";
import { useTheme } from "next-themes";
import { apiGet, apiPatch } from "@/lib/api";
import { setCachedUser } from "@/lib/workspace";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
}

export default function ProfileSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await apiGet<IdentityMe>("/identity/me");
        if (error) {
          console.error("Failed to load profile:", error);
        } else if (data) {
          setForm({
            email: data.email || "",
            name: data.name || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            phone: data.phone || "",
          });
        }
      } catch (e) {
        console.error("Failed to load profile:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setStatus(null);

    try {
      const { data, error } = await apiPatch<IdentityMe>("/identity/me", {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        name: form.name,
      });

      if (error) {
        setStatus({ type: "error", message: error });
      } else if (data) {
        setStatus({ type: "success", message: "Profile updated" });
        setCachedUser({
          id: data.id,
          email: data.email,
          name: data.name,
          firstName: data.firstName,
          lastName: data.lastName,
          avatarUrl: data.avatarUrl,
        });
      }
    } catch (e) {
      setStatus({ type: "error", message: "Network error" });
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    const token = localStorage.getItem("kf_token");
    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    if (!passwordForm.newPassword) {
      setStatus({ type: "error", message: "Please enter a new password" });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setStatus({ type: "error", message: "Passwords do not match" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setStatus({ type: "error", message: "Password must be at least 6 characters" });
      return;
    }

    setSavingPassword(true);
    setStatus(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: passwordForm.newPassword }),
      });

      if (res.ok) {
        setStatus({ type: "success", message: "Password updated successfully" });
        setPasswordForm({ newPassword: "", confirmPassword: "" });
      } else {
        const err = await res.json();
        setStatus({ type: "error", message: err.message || "Failed to update password" });
      }
    } catch (e) {
      setStatus({ type: "error", message: "Network error" });
    }
    setSavingPassword(false);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <User className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Profile & Security</h1>
          <p className="text-sm text-muted-foreground">Your personal account settings</p>
        </div>
      </div>

      {status && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/30 text-emerald-200"
              : "border border-red-400/40 bg-red-900/30 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <User className="h-4 w-4 text-primary" />
          Your Profile
        </div>

        <div className="space-y-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <Mail className="h-3 w-3" />
              Email
            </div>
            <Input
              type="email"
              value={form.email}
              disabled
              placeholder="you@example.com"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Email cannot be changed here.</p>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <User className="h-3 w-3" />
              First Name
            </div>
            <Input
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="John"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <User className="h-3 w-3" />
              Last Name
            </div>
            <Input
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="Doe"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <User className="h-3 w-3" />
              Display Name
            </div>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Your name"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <Phone className="h-3 w-3" />
              Phone Number
            </div>
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+1 868 123 4567"
            />
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-primary" />
          Change Password
        </div>

        <div className="space-y-4">
          <label className="block text-xs text-muted-foreground">
            <div className="mb-1">New Password</div>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                placeholder="Enter new password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((p) => !p)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="mb-1">Confirm New Password</div>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              placeholder="Confirm new password"
            />
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleChangePassword} disabled={savingPassword}>
            {savingPassword ? "Updating..." : "Update Password"}
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {theme === "dark" ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
          Appearance
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Theme Mode</p>
            <p className="text-xs text-muted-foreground">Choose how the app looks for you</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setTheme("light")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                theme === "light"
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/15"
              }`}
            >
              <Sun className="h-4 w-4 inline mr-2" />
              Light
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                theme === "dark"
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/15"
              }`}
            >
              <Moon className="h-4 w-4 inline mr-2" />
              Dark
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
