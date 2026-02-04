"use client";

import { useEffect, useState } from "react";
import { Settings, Shield, Building2, User, Users, CheckCircle2 } from "lucide-react";
import { Card, Button, Input } from "@keyflow/ui";
import { API_BASE, getAuthHeaders } from "@/lib/api";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Tab = "profile" | "business" | "team" | "security";

type Business = {
  id: string;
  name: string;
  slug?: string | null;
  timezone?: string | null;
  currency?: string | null;
};

type TeamMember = {
  id: string;
  role: string;
  user: { id: string; email: string; name?: string | null };
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [profileForm, setProfileForm] = useState({ name: "", email: "" });
  const [business, setBusiness] = useState<Business | null>(null);
  const [businessForm, setBusinessForm] = useState({ name: "", slug: "", timezone: "", currency: "" });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("kf_token") : null;
    if (token) setAuthToken(token);
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const bizRes = await fetch(`${API_BASE}/identity/businesses`, { headers: getAuthHeaders() });
      const bizData = await bizRes.json().catch(() => []);
      const biz = Array.isArray(bizData) && bizData.length > 0 ? bizData[0] : null;
      if (biz) {
        setBusiness(biz);
        setBusinessForm({
          name: biz.name || "",
          slug: biz.slug || "",
          timezone: biz.timezone || "America/Port_of_Spain",
          currency: biz.currency || "TTD",
        });

        const teamRes = await fetch(`${API_BASE}/identity/businesses/${biz.id}/team`, { headers: getAuthHeaders() });
        const teamData = await teamRes.json().catch(() => []);
        setTeamMembers(Array.isArray(teamData) ? teamData : []);
      }
    } catch {
      setStatus("Failed to load settings");
    }
    setLoading(false);
  }

  async function updateBusiness() {
    if (!business) return;
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/identity/businesses/${business.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(businessForm),
      });
      if (!res.ok) throw new Error("Failed to update");
      setStatus("Business settings updated");
      setBusiness((prev) => prev ? { ...prev, ...businessForm } : prev);
    } catch {
      setStatus("Failed to update business");
    }
  }

  async function inviteTeamMember() {
    if (!business || !inviteEmail.trim()) return;
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/identity/businesses/${business.id}/team`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: "MEMBER" }),
      });
      if (!res.ok) throw new Error("Failed to invite");
      const newMember = await res.json();
      setTeamMembers((prev) => [...prev, newMember]);
      setInviteEmail("");
      setStatus("Team member invited");
    } catch {
      setStatus("Failed to invite team member");
    }
  }

  async function updatePassword() {
    setStatus(null);
    if (!newPassword || newPassword !== confirmPassword) {
      setStatus("Passwords do not match");
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !authToken) {
      setStatus("Unable to update password");
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
      if (!res.ok) throw new Error("Password update failed");
      setStatus("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setStatus("Password update failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Profile, business, team, and security settings.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border/60 pb-2">
        {(["profile", "business", "team", "security"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t
                ? "bg-primary/20 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "profile" && <User className="w-4 h-4 inline mr-2" />}
            {t === "business" && <Building2 className="w-4 h-4 inline mr-2" />}
            {t === "team" && <Users className="w-4 h-4 inline mr-2" />}
            {t === "security" && <Shield className="w-4 h-4 inline mr-2" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {status && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {status}
        </div>
      )}

      {tab === "profile" && (
        <Card className="p-6 space-y-4 max-w-xl">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <User className="w-4 h-4" /> Profile Settings
          </h3>
          <div className="space-y-3">
            <Input
              label="Display Name"
              placeholder="Your name"
              value={profileForm.name}
              onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={profileForm.email}
              onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
            />
            <Button onClick={() => setStatus("Profile saved")}>Save Profile</Button>
          </div>
        </Card>
      )}

      {tab === "business" && (
        <Card className="p-6 space-y-4 max-w-xl">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Business Settings
          </h3>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-3">
              <Input
                label="Business Name"
                placeholder="My Business"
                value={businessForm.name}
                onChange={(e) => setBusinessForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                label="Booking Slug"
                placeholder="my-business"
                value={businessForm.slug}
                onChange={(e) => setBusinessForm((f) => ({ ...f, slug: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Timezone</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={businessForm.timezone}
                    onChange={(e) => setBusinessForm((f) => ({ ...f, timezone: e.target.value }))}
                  >
                    <option value="America/Port_of_Spain">Trinidad (AST)</option>
                    <option value="America/New_York">Eastern (ET)</option>
                    <option value="America/Los_Angeles">Pacific (PT)</option>
                    <option value="Europe/London">London (GMT)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Currency</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={businessForm.currency}
                    onChange={(e) => setBusinessForm((f) => ({ ...f, currency: e.target.value }))}
                  >
                    <option value="TTD">TTD (Trinidad Dollar)</option>
                    <option value="USD">USD (US Dollar)</option>
                    <option value="EUR">EUR (Euro)</option>
                    <option value="GBP">GBP (British Pound)</option>
                  </select>
                </div>
              </div>
              <Button onClick={updateBusiness}>Save Business Settings</Button>
            </div>
          )}
        </Card>
      )}

      {tab === "team" && (
        <Card className="p-6 space-y-4 max-w-xl">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4" /> Team Members
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="team@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Button onClick={inviteTeamMember}>Invite</Button>
          </div>
          {teamMembers.length === 0 ? (
            <div className="text-sm text-muted-foreground">No team members yet.</div>
          ) : (
            <div className="space-y-2">
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-900/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm">{member.user.name || member.user.email}</div>
                    <div className="text-xs text-muted-foreground">{member.user.email}</div>
                  </div>
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "security" && (
        <Card className="p-6 space-y-4 max-w-xl">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4" /> Security
          </h3>
          <div className="space-y-3">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <label className="block text-xs text-muted-foreground">
              New Password
              <div className="relative mt-1">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-12"
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
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <Button onClick={updatePassword}>Update Password</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
