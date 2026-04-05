"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Mail, Phone, Shield, CheckCircle2, AlertCircle,
  Eye, EyeOff, Moon, Sun, Monitor, Camera, Lock, Sparkles,
  Briefcase, MapPin, Tag, Heart, FileText, ChevronRight,
  Wand2, RefreshCw, X, Scale, DollarSign, Palette, Building2,
} from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";
import { useTheme } from "next-themes";
import { apiGet, apiPatch, API_BASE, getAuthHeaders } from "@/lib/api";
import { setCachedUser, getStoredBusinessId } from "@/lib/workspace";
import {
  generateAiProfile,
  fetchDocumentGuidance,
  type DocumentRecommendation,
} from "@/lib/client";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

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

interface BusinessProfile {
  id: string;
  name: string;
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  skills: string[];
  businessStage?: string | null;
  interests: string[];
  profileCompleteness: number;
  city?: string | null;
  country?: string | null;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
}

const BUSINESS_STAGES = [
  { value: "IDEA", label: "Idea Stage" },
  { value: "STARTUP", label: "Startup" },
  { value: "GROWTH", label: "Growth" },
  { value: "ESTABLISHED", label: "Established" },
  { value: "SCALING", label: "Scaling" },
];

const INDUSTRY_OPTIONS = [
  "Technology", "Healthcare", "Finance", "Education", "Retail",
  "Food & Beverage", "Creative & Design", "Consulting", "Real Estate",
  "Fitness & Wellness", "Tourism & Hospitality", "Agriculture",
  "Construction", "Manufacturing", "Media & Entertainment",
  "Non-Profit", "Professional Services", "E-commerce", "Other",
];

const CATEGORY_CONFIG: Record<string, { icon: typeof Scale; color: string; bg: string }> = {
  Legal: { icon: Scale, color: "text-blue-400", bg: "bg-blue-500/15" },
  Financial: { icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/15" },
  Creative: { icon: Palette, color: "text-purple-400", bg: "bg-purple-500/15" },
  Constitutional: { icon: Building2, color: "text-amber-400", bg: "bg-amber-500/15" },
};

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

function ProfileCompletenessRing({ percentage }: { percentage: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage >= 80 ? "hsl(var(--kf-accent1))" : percentage >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" opacity="0.3" />
        <circle
          cx="50" cy="50" r={radius} fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold">{percentage}%</span>
        <span className="text-[9px] text-muted-foreground">Complete</span>
      </div>
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
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [initialForm, setInitialForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [form, setForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const { theme, setTheme } = useTheme();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);

  const [bizForm, setBizForm] = useState<{
    headline: string;
    bio: string;
    industry: string;
    skills: string[];
    businessStage: string;
    interests: string[];
    city: string;
    country: string;
  }>({
    headline: "", bio: "", industry: "", skills: [], businessStage: "",
    interests: [], city: "", country: "",
  });
  const [initialBizForm, setInitialBizForm] = useState(bizForm);
  const [profileCompleteness, setProfileCompleteness] = useState(0);
  const [skillInput, setSkillInput] = useState("");
  const [interestInput, setInterestInput] = useState("");
  const [recommendations, setRecommendations] = useState<DocumentRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const isBizDirty = JSON.stringify(bizForm) !== JSON.stringify(initialBizForm);
  const hasUnsavedChanges = useMemo(() => isDirty || isBizDirty, [isDirty, isBizDirty]);
  useUnsavedChanges(hasUnsavedChanges);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

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

  useEffect(() => {
    if (!businessId) return;
    const loadBusiness = async () => {
      try {
        const { data } = await apiGet<BusinessProfile>(`/identity/businesses/${businessId}`);
        if (data) {
          const bf = {
            headline: data.headline || "",
            bio: data.bio || "",
            industry: data.industry || "",
            skills: data.skills || [],
            businessStage: data.businessStage || "",
            interests: data.interests || [],
            city: data.city || "",
            country: data.country || "",
          };
          setBizForm(bf);
          setInitialBizForm(bf);
          setProfileCompleteness(data.profileCompleteness || 0);
        }
      } catch {}
    };
    loadBusiness();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    setLoadingRecs(true);
    fetchDocumentGuidance(businessId)
      .then((res) => {
        if (res.data?.recommendations) setRecommendations(res.data.recommendations);
      })
      .catch(() => {})
      .finally(() => setLoadingRecs(false));
  }, [businessId]);

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

  const handleSaveBusinessProfile = async () => {
    if (!businessId) return;
    setSavingBusiness(true);
    setStatus(null);
    try {
      const { data, error } = await apiPatch<BusinessProfile>(`/identity/businesses/${businessId}`, bizForm);
      if (error) {
        setStatus({ type: "error", message: error });
      } else if (data) {
        setStatus({ type: "success", message: "Professional profile updated" });
        setInitialBizForm({ ...bizForm });
        setProfileCompleteness(data.profileCompleteness || 0);
        fetchDocumentGuidance(businessId)
          .then((res) => {
            if (res.data?.recommendations) setRecommendations(res.data.recommendations);
          })
          .catch(() => {});
      }
    } catch {
      setStatus({ type: "error", message: "Network error" });
    }
    setSavingBusiness(false);
  };

  const handleGenerateProfile = async () => {
    if (!businessId) return;
    setGeneratingProfile(true);
    setStatus(null);
    try {
      const res = await generateAiProfile(businessId, {
        name: form.name || `${form.firstName} ${form.lastName}`.trim(),
        industry: bizForm.industry,
        skills: bizForm.skills,
        businessStage: bizForm.businessStage,
        description: bizForm.bio,
      });
      if (res.data) {
        setBizForm((f) => ({
          ...f,
          headline: res.data!.headline || f.headline,
          bio: res.data!.bio || f.bio,
        }));
        setStatus({ type: "success", message: "AI profile generated! Review and save your changes." });
      } else {
        setStatus({ type: "error", message: res.error || "Failed to generate profile" });
      }
    } catch {
      setStatus({ type: "error", message: "Failed to generate profile" });
    }
    setGeneratingProfile(false);
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

  const addSkill = () => {
    const skill = skillInput.trim();
    if (skill && !bizForm.skills.includes(skill)) {
      setBizForm((f) => ({ ...f, skills: [...f.skills, skill] }));
    }
    setSkillInput("");
  };

  const removeSkill = (skill: string) => {
    setBizForm((f) => ({ ...f, skills: f.skills.filter((s) => s !== skill) }));
  };

  const addInterest = () => {
    const interest = interestInput.trim();
    if (interest && !bizForm.interests.includes(interest)) {
      setBizForm((f) => ({ ...f, interests: [...f.interests, interest] }));
    }
    setInterestInput("");
  };

  const removeInterest = (interest: string) => {
    setBizForm((f) => ({ ...f, interests: f.interests.filter((i) => i !== interest) }));
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto">
      <SkeletonProfile />
    </div>
  );

  const initials = [form.firstName, form.lastName].filter(Boolean).map((n) => n.charAt(0).toUpperCase()).join("") || form.email?.charAt(0)?.toUpperCase() || "?";
  const resolvedAvatar = avatarUrl ? (avatarUrl.startsWith("http") ? avatarUrl : `${API_BASE}${avatarUrl}`) : null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6 max-w-2xl mx-auto">
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div
          className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg"
        >
          <User className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information, professional identity, and security</p>
        </div>
      </motion.div>
      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
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
      </AnimatePresence>

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
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{form.firstName && form.lastName ? `${form.firstName} ${form.lastName}` : form.name || "Your Profile"}</h2>
          {bizForm.headline && <p className="text-sm text-muted-foreground truncate">{bizForm.headline}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{form.email}</p>
        </div>
        <ProfileCompletenessRing percentage={profileCompleteness} />
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Briefcase className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Professional Profile
          </div>
          <button
            onClick={handleGenerateProfile}
            disabled={generatingProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 hover:from-[hsl(var(--kf-accent1))]/30 hover:to-[hsl(var(--kf-accent2))]/30 text-[hsl(var(--kf-accent1))] transition-all border border-[hsl(var(--kf-accent1))]/20"
          >
            {generatingProfile ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {generatingProfile ? "Generating..." : "Generate with AI"}
          </button>
        </div>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <Sparkles className="h-3 w-3" />
            Professional Headline
          </div>
          <Input
            value={bizForm.headline}
            onChange={(e) => setBizForm((f) => ({ ...f, headline: e.target.value }))}
            placeholder="e.g., Caribbean Tech Entrepreneur | Building SaaS for SMBs"
            maxLength={120}
          />
          <p className="text-[10px] mt-1 text-right">{bizForm.headline.length}/120</p>
        </label>

        <label className="block text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 mb-1.5 font-medium">
            <FileText className="h-3 w-3" />
            Bio
          </div>
          <textarea
            value={bizForm.bio}
            onChange={(e) => setBizForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="Tell the community about yourself and your business..."
            maxLength={500}
            rows={3}
            className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 resize-none"
          />
          <p className="text-[10px] mt-1 text-right">{bizForm.bio.length}/500</p>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
              <Briefcase className="h-3 w-3" />
              Industry
            </div>
            <select
              value={bizForm.industry}
              onChange={(e) => setBizForm((f) => ({ ...f, industry: e.target.value }))}
              className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30"
            >
              <option value="">Select industry</option>
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
              <Shield className="h-3 w-3" />
              Business Stage
            </div>
            <select
              value={bizForm.businessStage}
              onChange={(e) => setBizForm((f) => ({ ...f, businessStage: e.target.value }))}
              className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30"
            >
              <option value="">Select stage</option>
              {BUSINESS_STAGES.map((stage) => (
                <option key={stage.value} value={stage.value}>{stage.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Tag className="h-3 w-3" />
            Skills & Expertise
          </div>
          <div className="flex gap-2">
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
              placeholder="Add a skill and press Enter"
              className="flex-1"
            />
            <Button onClick={addSkill} disabled={!skillInput.trim()} className="px-3">
              Add
            </Button>
          </div>
          {bizForm.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {bizForm.skills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium">
                  {skill}
                  <button onClick={() => removeSkill(skill)} className="hover:text-red-400 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
              <MapPin className="h-3 w-3" />
              City
            </div>
            <Input
              value={bizForm.city}
              onChange={(e) => setBizForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="Port of Spain"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1.5 font-medium">
              <MapPin className="h-3 w-3" />
              Country
            </div>
            <Input
              value={bizForm.country}
              onChange={(e) => setBizForm((f) => ({ ...f, country: e.target.value }))}
              placeholder="Trinidad & Tobago"
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Heart className="h-3 w-3" />
            Interests
          </div>
          <div className="flex gap-2">
            <Input
              value={interestInput}
              onChange={(e) => setInterestInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }}
              placeholder="Add an interest and press Enter"
              className="flex-1"
            />
            <Button onClick={addInterest} disabled={!interestInput.trim()} className="px-3">
              Add
            </Button>
          </div>
          {bizForm.interests.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {bizForm.interests.map((interest) => (
                <span key={interest} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 text-xs font-medium">
                  {interest}
                  <button onClick={() => removeInterest(interest)} className="hover:text-red-400 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          {isBizDirty && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              You have unsaved changes
            </p>
          )}
          <div className="ml-auto">
            <Button onClick={handleSaveBusinessProfile} disabled={savingBusiness || !isBizDirty}>
              {savingBusiness ? "Saving..." : "Save Professional Profile"}
            </Button>
          </div>
        </div>
      </motion.div>

      {recommendations.length > 0 && (
        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Recommended Documents
          </div>
          <p className="text-xs text-muted-foreground">
            Based on your industry, business stage, and location, here are documents you should consider.
          </p>

          <div className="space-y-2">
            {(["Legal", "Financial", "Creative", "Constitutional"] as const).map((category) => {
              const catRecs = recommendations.filter((r) => r.category === category);
              if (catRecs.length === 0) return null;
              const config = CATEGORY_CONFIG[category];
              const CatIcon = config.icon;
              return (
                <div key={category} className="space-y-1.5">
                  <div className={`flex items-center gap-2 text-xs font-semibold ${config.color}`}>
                    <CatIcon className="w-3.5 h-3.5" />
                    {category}
                  </div>
                  {catRecs.map((rec) => (
                    <div key={rec.title} className={`flex items-start gap-3 p-3 rounded-xl ${config.bg} border border-white/5`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">{rec.title}</p>
                          {rec.priority === "high" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500/20 text-red-400">
                              Priority
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rec.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

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
