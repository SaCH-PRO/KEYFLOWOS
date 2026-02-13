"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  User, Mail, Phone, Shield, CheckCircle2, AlertCircle,
  Eye, EyeOff, Moon, Sun, Monitor, Camera, Lock, Sparkles,
} from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";
import { useTheme } from "next-themes";
import { apiGet, apiPatch, API_BASE, getAuthHeaders } from "@/lib/api";
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

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "6+ characters", pass: password.length >= 6 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(password) },
    { label: "Number", pass: /\d/.test(password) },
    { label: "Special character", pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.pass).length;
  const colors = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500"];
  const labels = ["Weak", "Fair", "Good", "Strong"];

  if (!password) return null;

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i < score ? colors[score - 1] : "bg-muted/40"
            }`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {checks.map((c) => (
          <span
            key={c.label}
            className={`text-[11px] flex items-center gap-1 transition-colors ${
              c.pass ? "text-emerald-400" : "text-muted-foreground"
            }`}
          >
            {c.pass ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-muted-foreground/40" />}
            {c.label}
          </span>
        ))}
      </div>
      {score > 0 && (
        <p className={`text-[11px] font-medium ${score >= 3 ? "text-emerald-400" : score >= 2 ? "text-amber-400" : "text-red-400"}`}>
          {labels[score - 1]} password
        </p>
      )}
    </div>
  );
}

function SkeletonProfile() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-2xl bg-muted/40" />
        <div className="space-y-2 flex-1">
          <div className="h-5 w-40 bg-muted/40 rounded-lg" />
          <div className="h-3 w-56 bg-muted/30 rounded-lg" />
        </div>
      </div>
      <div className="kf-card p-6 space-y-4">
        <div className="h-4 w-24 bg-muted/40 rounded" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-muted/30 rounded" />
              <div className="h-10 bg-muted/20 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProfileSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [initialForm, setInitialForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [form, setForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const { theme, setTheme } = useTheme();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await apiGet<IdentityMe>("/identity/me");
        if (data) {
          const f = {
            email: data.email || "",
            name: data.name || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            phone: data.phone || "",
          };
          setForm(f);
          setInitialForm(f);
          setAvatarUrl(data.avatarUrl || null);
        }
      } catch (e) {
        console.error("Failed to load profile:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setStatus(null);
    try {
      const urlRes = await fetch(`${API_BASE}/uploads/request-url`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { data } = await apiPatch<IdentityMe>("/identity/me", { avatarUrl: objectPath });
      if (data) {
        setAvatarUrl(objectPath);
        setCachedUser({ id: data.id, email: data.email, name: data.name, firstName: data.firstName, lastName: data.lastName, avatarUrl: objectPath });
        setStatus({ type: "success", message: "Avatar updated" });
      }
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    }
    setUploadingAvatar(false);
  };

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
        setInitialForm({ ...form });
        setCachedUser({
          id: data.id, email: data.email, name: data.name,
          firstName: data.firstName, lastName: data.lastName, avatarUrl: data.avatarUrl,
        });
      }
    } catch {
      setStatus({ type: "error", message: "Network error" });
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    const token = localStorage.getItem("kf_token");
    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (!passwordForm.newPassword) { setStatus({ type: "error", message: "Please enter a new password" }); return; }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setStatus({ type: "error", message: "Passwords do not match" }); return; }
    if (passwordForm.newPassword.length < 6) { setStatus({ type: "error", message: "Password must be at least 6 characters" }); return; }

    setSavingPassword(true);
    setStatus(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: passwordForm.newPassword }),
      });
      if (res.ok) {
        setStatus({ type: "success", message: "Password updated successfully" });
        setPasswordForm({ newPassword: "", confirmPassword: "" });
      } else {
        const err = await res.json();
        setStatus({ type: "error", message: err.message || "Failed to update password" });
      }
    } catch {
      setStatus({ type: "error", message: "Network error" });
    }
    setSavingPassword(false);
  };

  if (loading) return <SkeletonProfile />;

  const initials = [form.firstName, form.lastName].filter(Boolean).map((n) => n.charAt(0).toUpperCase()).join("") || form.email?.charAt(0)?.toUpperCase() || "?";
  const resolvedAvatar = avatarUrl ? (avatarUrl.startsWith("http") ? avatarUrl : `${API_BASE}${avatarUrl}`) : null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6 max-w-2xl">
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/20 text-emerald-200"
              : "border border-red-400/40 bg-red-900/20 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {status.message}
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="flex items-center gap-5">
        <div className="relative group">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-2xl font-bold overflow-hidden shadow-lg border-2 border-border/30">
            {resolvedAvatar ? (
              <img src={resolvedAvatar} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
          >
            {uploadingAvatar ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="h-5 w-5 text-white" />
            )}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{form.firstName && form.lastName ? `${form.firstName} ${form.lastName}` : form.name || "Your Profile"}</h2>
          <p className="text-sm text-muted-foreground">{form.email}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Hover over avatar to change photo</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <User className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Personal Information
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
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
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
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
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
              <Sparkles className="h-3 w-3" />
              Display Name
            </div>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Your display name"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
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

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <Mail className="h-3 w-3" />
            Email Address
          </div>
          <Input
            type="email"
            value={form.email}
            disabled
            placeholder="you@example.com"
            className="opacity-60"
          />
          <p className="text-[11px] mt-1">Managed by your authentication provider</p>
        </label>

        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          {isDirty && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              You have unsaved changes
            </p>
          )}
          <div className="ml-auto">
            <Button onClick={handleSaveProfile} disabled={saving || !isDirty}>
              {saving ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Security
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">New Password</div>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                placeholder="Enter new password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowPassword((p) => !p)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">Confirm Password</div>
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              placeholder="Confirm new password"
            />
            {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
              <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Passwords do not match
              </p>
            )}
          </label>
        </div>

        <PasswordStrength password={passwordForm.newPassword} />

        <div className="flex justify-end pt-2 border-t border-border/30">
          <Button
            onClick={handleChangePassword}
            disabled={savingPassword || !passwordForm.newPassword || passwordForm.newPassword !== passwordForm.confirmPassword}
          >
            {savingPassword ? "Updating..." : "Update Password"}
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {theme === "dark" ? (
            <Moon className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          ) : (
            <Sun className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          )}
          Appearance
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "light", icon: Sun, label: "Light" },
            { value: "dark", icon: Moon, label: "Dark" },
            { value: "system", icon: Monitor, label: "System" },
          ].map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === value
                  ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                  : "border-border/40 hover:border-border/80 bg-muted/10"
              }`}
            >
              <Icon className={`h-5 w-5 ${theme === value ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`} />
              <span className={`text-sm font-medium ${theme === value ? "text-foreground" : "text-muted-foreground"}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
