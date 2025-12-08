"use client";

import { useEffect, useState } from "react";
import { Shield, Palette, Globe, Bell, Users, CheckCircle2 } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type ProfileSettings = {
  username: string;
  firstName: string;
  lastName: string;
  company: string;
  age: string;
  contactNumber: string;
};

type BrandSettings = {
  primaryColor: string;
  accentColor: string;
};

type NotificationSettings = {
  email: boolean;
  push: boolean;
  whatsapp: boolean;
};

type DomainSettings = {
  domain: string;
};

const PROFILE_KEY = "kf_settings_profile";
const BRAND_KEY = "kf_settings_brand";
const NOTIF_KEY = "kf_settings_notifications";
const DOMAIN_KEY = "kf_settings_domains";
const MEMBERS_KEY = "kf_settings_members";

const headersWithToken = (token?: string | null) =>
  ({
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY ?? "",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }) as Record<string, string>;

function decodeJwtSub(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized);
    const parsed = JSON.parse(decoded);
    return parsed.sub || parsed.user_id || null;
  } catch {
    return null;
  }
}

async function isUsernameAvailableSettings(username: string): Promise<boolean> {
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

export default function SettingsPage() {
  const [profile, setProfile] = useState<ProfileSettings>({
    username: "",
    firstName: "",
    lastName: "",
    company: "",
    age: "",
    contactNumber: "",
  });
  const [brand, setBrand] = useState<BrandSettings>({ primaryColor: "#4F46E5", accentColor: "#22D3EE" });
  const [notifications, setNotifications] = useState<NotificationSettings>({
    email: true,
    push: false,
    whatsapp: false,
  });
  const [domain, setDomain] = useState<DomainSettings>({ domain: "" });
  const [members, setMembers] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [profileEdit, setProfileEdit] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    const storedProfile = localStorage.getItem(PROFILE_KEY);
    const storedDraft = localStorage.getItem("kf_profile_draft");
    const storedBrand = localStorage.getItem(BRAND_KEY);
    const storedNotif = localStorage.getItem(NOTIF_KEY);
    const storedDomain = localStorage.getItem(DOMAIN_KEY);
    const storedMembers = localStorage.getItem(MEMBERS_KEY);
    const token = typeof window !== "undefined" ? window.localStorage.getItem("kf_token") : null;
    const storedEmail = typeof window !== "undefined" ? window.localStorage.getItem("kf_email") : "";
    const storedUsername = typeof window !== "undefined" ? window.localStorage.getItem("kf_username") : "";
    if (token) setAuthToken(token);
    if (token) setUserId(decodeJwtSub(token));
    if (storedEmail) setAccountEmail(storedEmail);
    if (storedProfile) setProfile(JSON.parse(storedProfile));
    else if (storedDraft) setProfile((p) => ({ ...p, ...JSON.parse(storedDraft) }));
    if (storedUsername) setProfile((p) => ({ ...p, username: storedUsername }));
    if (storedBrand) setBrand(JSON.parse(storedBrand));
    if (storedNotif) setNotifications(JSON.parse(storedNotif));
    if (storedDomain) setDomain(JSON.parse(storedDomain));
    if (storedMembers) setMembers(JSON.parse(storedMembers));
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!authToken || !userId || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      setLoadingProfile(true);
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&select=username,first_name,last_name,company,age,contact_number&limit=1`,
          {
            headers: headersWithToken(authToken),
          },
        );
        if (res.ok) {
          const data = await res.json().catch(() => []);
          if (Array.isArray(data) && data[0]) {
            const row = data[0];
            setProfile((p) => ({
              ...p,
              username: row.username ?? p.username,
              firstName: row.first_name ?? p.firstName,
              lastName: row.last_name ?? p.lastName,
              company: row.company ?? p.company,
              age: row.age ?? p.age,
              contactNumber: row.contact_number ?? p.contactNumber,
            }));
          }
        }
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: headersWithToken(authToken),
        });
        if (userRes.ok) {
          const userJson = await userRes.json().catch(() => null);
          if (userJson?.email) setAccountEmail(userJson.email);
        }
      } finally {
        setLoadingProfile(false);
      }
    };
    void fetchProfile();
  }, [authToken, userId]);

  const saveSection = async (section: "profile" | "brand" | "notifications" | "domain") => {
    if (section === "profile") {
      const uname = profile.username.trim();
      if (!uname) {
        setStatus("Username required.");
        return;
      }
      const available = await isUsernameAvailableSettings(uname);
      if (!available) {
        setStatus("Username taken. Choose another.");
        setTimeout(() => setStatus(null), 2000);
        return;
      }
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, username: uname }));
      if (authToken && userId && SUPABASE_URL && SUPABASE_ANON_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
          method: "POST",
          headers: headersWithToken(authToken),
          body: JSON.stringify({
            user_id: userId,
            username: uname,
            first_name: profile.firstName,
            last_name: profile.lastName,
            company: profile.company,
            age: profile.age,
            contact_number: profile.contactNumber,
          }),
        }).catch(() => {});
      }
    }
    if (section === "brand") localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    if (section === "notifications") localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications));
    if (section === "domain") localStorage.setItem(DOMAIN_KEY, JSON.stringify(domain));
    setStatus("Saved");
    setTimeout(() => setStatus(null), 2000);
  };

  const inviteMember = () => {
    if (!inviteEmail.trim()) return;
    const next = Array.from(new Set([inviteEmail.trim(), ...members]));
    setMembers(next);
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(next));
    setInviteEmail("");
    setStatus("Invite added (placeholder)");
    setTimeout(() => setStatus(null), 2000);
  };

  const updatePassword = async () => {
    setPasswordStatus(null);
    if (!newPassword || newPassword !== confirmPassword) {
      setPasswordStatus("Passwords do not match.");
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setPasswordStatus("Supabase env vars missing.");
      return;
    }
    if (!authToken) {
      setPasswordStatus("No session found. Please sign in again.");
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail =
          (json && typeof json === "object" && ("msg" in json || "error_description" in json || "error" in json)
            ? (json.msg as string) ||
              (json.error_description as string) ||
              (json.error as string)
            : res.statusText) || "Password update failed";
        setPasswordStatus(detail);
        return;
      }
      setPasswordStatus("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Password update failed";
      setPasswordStatus(msg);
    }
  };

  const sendResetLink = async () => {
    setPasswordStatus(null);
    if (!resetEmail.trim()) {
      setPasswordStatus("Enter your email to send reset link.");
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setPasswordStatus("Supabase env vars missing.");
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email: resetEmail.trim(), redirectTo: "http://localhost:3000/auth/login" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const detail =
          (json && typeof json === "object" && ("msg" in json || "error_description" in json || "error" in json)
            ? (json.msg as string) ||
              (json.error_description as string) ||
              (json.error as string)
            : res.statusText) || "Failed to send reset link";
        setPasswordStatus(detail);
        return;
      }
      setPasswordStatus("Reset link sent. Check your email.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to send reset link";
      setPasswordStatus(msg);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Shield className="w-5 h-5" />
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            Security
          </div>
          <div className="grid gap-3 md:grid-cols-2 text-xs text-muted-foreground">
            <div className="space-y-2">
              <div className="text-sm text-foreground">Change password</div>
              <label className="flex flex-col gap-1">
                Current password
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 pr-12 text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 text-primary text-[11px]"
                    onClick={() => setShowCurrent((p) => !p)}
                  >
                    {showCurrent ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1">
                New password
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 pr-12 text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-2 text-primary text-[11px]"
                    onClick={() => setShowNew((p) => !p)}
                  >
                    {showNew ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1">
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex justify-end">
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                  type="button"
                  onClick={updatePassword}
                >
                  Update password
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-foreground">Forgot password?</div>
              <label className="flex flex-col gap-1">
                Send reset link to email
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                  placeholder="you@example.com"
                />
              </label>
              <div className="flex justify-end">
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                  type="button"
                  onClick={sendResetLink}
                >
                  Send reset link
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                We’ll email a secure link to reset your password.
              </p>
            </div>
          </div>
          {passwordStatus && <div className="text-[11px] text-emerald-200">{passwordStatus}</div>}
        </div>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Workspace settings, brand, domains, notifications, and access.</p>
        </div>
      </div>

      {status && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {status}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Account</span>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
              <span className="text-muted-foreground">Username</span>
              <span className="text-foreground">{profile.username || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="text-foreground">{accountEmail || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
              <span className="text-muted-foreground">Password</span>
              <span className="text-foreground">••••••••</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Password is hidden for security. Use the security section to change or reset it.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Profile & workspace
          </div>
          {profileEdit ? (
            <>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">
                  Username
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.username}
                    onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  First name
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.firstName}
                    onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Last name
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.lastName}
                    onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Company
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.company}
                    onChange={(e) => setProfile((p) => ({ ...p, company: e.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Age
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.age}
                    onChange={(e) => setProfile((p) => ({ ...p, age: e.target.value }))}
                    placeholder=""
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Contact number
                  <input
                    className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                    value={profile.contactNumber}
                    onChange={(e) => setProfile((p) => ({ ...p, contactNumber: e.target.value }))}
                    placeholder=""
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/60"
                  type="button"
                  onClick={() => setProfileEdit(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                  onClick={() => void saveSection("profile").then(() => setProfileEdit(false))}
                  type="button"
                >
                  Save profile
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>Username</span>
                  <span className="text-foreground">{profile.username || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>First name</span>
                  <span className="text-foreground">{profile.firstName || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>Last name</span>
                  <span className="text-foreground">{profile.lastName || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>Company</span>
                  <span className="text-foreground">{profile.company || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>Age</span>
                  <span className="text-foreground">{profile.age || "Not set"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2">
                  <span>Contact number</span>
                  <span className="text-foreground">{profile.contactNumber || "Not set"}</span>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                  type="button"
                  onClick={() => setProfileEdit(true)}
                >
                  Edit fields
                </button>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Palette className="h-4 w-4 text-primary" />
            Brand & theme
          </div>
          <div className="grid gap-2">
            <label className="text-xs text-muted-foreground">
              Primary color
              <input
                type="color"
                className="mt-1 h-10 w-full rounded-xl border border-border/60 bg-slate-950/80"
                value={brand.primaryColor}
                onChange={(e) => setBrand((b) => ({ ...b, primaryColor: e.target.value }))}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Accent color
              <input
                type="color"
                className="mt-1 h-10 w-full rounded-xl border border-border/60 bg-slate-950/80"
                value={brand.accentColor}
                onChange={(e) => setBrand((b) => ({ ...b, accentColor: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => saveSection("brand")}
            >
              Save brand
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-primary" />
            Notifications
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifications.email}
                onChange={(e) => setNotifications((n) => ({ ...n, email: e.target.checked }))}
              />
              Email alerts
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifications.push}
                onChange={(e) => setNotifications((n) => ({ ...n, push: e.target.checked }))}
              />
              Push alerts
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifications.whatsapp}
                onChange={(e) => setNotifications((n) => ({ ...n, whatsapp: e.target.checked }))}
              />
              WhatsApp alerts
            </label>
          </div>
          <div className="flex justify-end">
            <button
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => saveSection("notifications")}
            >
              Save notifications
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4 text-primary" />
            Domains
          </div>
          <label className="text-xs text-muted-foreground">
            Primary domain
            <input
              className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
              value={domain.domain}
              onChange={(e) => setDomain({ domain: e.target.value })}
              placeholder="app.yourdomain.com"
            />
          </label>
          <div className="flex justify-end">
            <button
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => saveSection("domain")}
            >
              Save domain
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3 md:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            Access control
          </div>
          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="text-sm text-foreground">Members</div>
              <div className="rounded-xl border border-border/60 bg-slate-950/80 p-3 space-y-1">
                {members.length === 0 ? (
                  <div className="text-muted-foreground text-xs">No members yet.</div>
                ) : (
                  members.map((m) => (
                    <div key={m} className="flex items-center justify-between text-foreground">
                      <span>{m}</span>
                      <span className="rounded-full border border-border/50 px-2 py-0.5 text-[11px]">Viewer</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="text-sm text-foreground">Invite member</div>
              <input
                className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="member@email.com"
              />
              <button
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                type="button"
                onClick={inviteMember}
              >
                Send invite
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
