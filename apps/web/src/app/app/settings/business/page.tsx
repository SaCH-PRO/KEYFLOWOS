"use client";

import { useEffect, useState, useRef } from "react";
import {
  Building2,
  Globe,
  Clock,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Upload,
  Camera,
  Phone,
  Mail,
  MapPin,
  Link as LinkIcon,
  Palette,
  Percent,
  Facebook,
  Instagram,
  Twitter,
  Linkedin,
  Youtube,
} from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPatch, apiGet, apiPost, getAuthHeaders, API_BASE } from "@/lib/api";

type Business = {
  id: string;
  name: string;
  slug: string | null;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  linkedin: string | null;
  tiktok: string | null;
  youtube: string | null;
  whatsapp: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  defaultTaxRate: number | null;
};

const TIMEZONES = [
  "America/Port_of_Spain",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const CURRENCIES = ["TTD", "USD", "EUR", "GBP", "CAD", "AUD"];

type FormState = {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  facebook: string;
  instagram: string;
  twitter: string;
  linkedin: string;
  tiktok: string;
  youtube: string;
  whatsapp: string;
  primaryColor: string;
  secondaryColor: string;
  defaultTaxRate: string;
};

export default function BusinessSettingsPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState<FormState>({
    name: "",
    slug: "",
    timezone: "",
    currency: "",
    logoUrl: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    facebook: "",
    instagram: "",
    twitter: "",
    linkedin: "",
    tiktok: "",
    youtube: "",
    whatsapp: "",
    primaryColor: "#F97316",
    secondaryColor: "#14B8A6",
    defaultTaxRate: "12.5",
  });
  const [activeTab, setActiveTab] = useState<"basic" | "social" | "branding">("basic");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const businessId = getStoredBusinessId();
      if (!businessId) {
        setLoading(false);
        return;
      }
      const res = await apiGet<Business>(`/identity/businesses/${businessId}`);
      if (res.data) {
        setBusiness(res.data);
        setForm({
          name: res.data.name || "",
          slug: res.data.slug || "",
          timezone: res.data.timezone || "America/Port_of_Spain",
          currency: res.data.currency || "TTD",
          logoUrl: res.data.logoUrl || "",
          address: res.data.address || "",
          phone: res.data.phone || "",
          email: res.data.email || "",
          website: res.data.website || "",
          facebook: res.data.facebook || "",
          instagram: res.data.instagram || "",
          twitter: res.data.twitter || "",
          linkedin: res.data.linkedin || "",
          tiktok: res.data.tiktok || "",
          youtube: res.data.youtube || "",
          whatsapp: res.data.whatsapp || "",
          primaryColor: res.data.primaryColor || "#F97316",
          secondaryColor: res.data.secondaryColor || "#14B8A6",
          defaultTaxRate: (res.data.defaultTaxRate ?? 12.5).toString(),
        });
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatus(null);
    
    try {
      const urlRes = await fetch(`${API_BASE}/uploads/request-url`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
      });
      
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      
      const { uploadURL, objectPath } = await urlRes.json();
      
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      
      if (!uploadRes.ok) throw new Error("Failed to upload file");
      
      setForm((f) => ({ ...f, logoUrl: objectPath }));
      setStatus({ type: "success", message: "Logo uploaded successfully" });
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!business) return;
    setSaving(true);
    setStatus(null);
    
    const payload = {
      ...form,
      defaultTaxRate: form.defaultTaxRate ? parseFloat(form.defaultTaxRate) : null,
    };
    
    const res = await apiPatch(`/identity/businesses/${business.id}`, payload);
    setSaving(false);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      setStatus({ type: "success", message: "Business settings saved" });
      if (res.data) setBusiness(res.data as Business);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  if (!business) {
    return <div className="text-muted-foreground">No business found. Please set up your workspace first.</div>;
  }

  const logoUrl = form.logoUrl ? `${API_BASE}${form.logoUrl}` : null;

  return (
    <div className="space-y-6 max-w-3xl">
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

      <Card className="p-6">
        <div className="flex items-center gap-6 mb-6">
          <div className="relative">
            <div className="w-24 h-24 rounded-2xl bg-slate-800 border border-border/60 flex items-center justify-center overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Business logo" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{form.name || "Your Business"}</h2>
            <p className="text-sm text-muted-foreground">Click the camera icon to upload your logo</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b border-border/40">
          {[
            { key: "basic", label: "Basic Info", icon: Building2 },
            { key: "social", label: "Social Media", icon: Globe },
            { key: "branding", label: "Branding", icon: Palette },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "basic" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Building2 className="h-3 w-3" />
                  Business Name
                </div>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My Business"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Globe className="h-3 w-3" />
                  Public URL Slug
                </div>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="my-business"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Mail className="h-3 w-3" />
                  Business Email
                </div>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="contact@mybusiness.com"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Phone className="h-3 w-3" />
                  Business Phone
                </div>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 (868) 555-0123"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <LinkIcon className="h-3 w-3" />
                  Website
                </div>
                <Input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  placeholder="https://mybusiness.com"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Phone className="h-3 w-3" />
                  WhatsApp Number
                </div>
                <Input
                  type="tel"
                  value={form.whatsapp}
                  onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="+1 (868) 555-0123"
                />
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1 mb-1">
                <MapPin className="h-3 w-3" />
                Business Address
              </div>
              <textarea
                className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm min-h-[80px] resize-none"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="123 Main Street, Port of Spain, Trinidad"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Clock className="h-3 w-3" />
                  Timezone
                </div>
                <select
                  className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                  value={form.timezone}
                  onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <DollarSign className="h-3 w-3" />
                  Default Currency
                </div>
                <select
                  className="w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {activeTab === "social" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">
              Connect your social media accounts to display them on your public booking page and invoices.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Facebook className="h-3 w-3" />
                  Facebook
                </div>
                <Input
                  value={form.facebook}
                  onChange={(e) => setForm((f) => ({ ...f, facebook: e.target.value }))}
                  placeholder="facebook.com/yourbusiness"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Instagram className="h-3 w-3" />
                  Instagram
                </div>
                <Input
                  value={form.instagram}
                  onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
                  placeholder="@yourbusiness"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Twitter className="h-3 w-3" />
                  Twitter / X
                </div>
                <Input
                  value={form.twitter}
                  onChange={(e) => setForm((f) => ({ ...f, twitter: e.target.value }))}
                  placeholder="@yourbusiness"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Linkedin className="h-3 w-3" />
                  LinkedIn
                </div>
                <Input
                  value={form.linkedin}
                  onChange={(e) => setForm((f) => ({ ...f, linkedin: e.target.value }))}
                  placeholder="linkedin.com/company/yourbusiness"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                  </svg>
                  TikTok
                </div>
                <Input
                  value={form.tiktok}
                  onChange={(e) => setForm((f) => ({ ...f, tiktok: e.target.value }))}
                  placeholder="@yourbusiness"
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <Youtube className="h-3 w-3" />
                  YouTube
                </div>
                <Input
                  value={form.youtube}
                  onChange={(e) => setForm((f) => ({ ...f, youtube: e.target.value }))}
                  placeholder="youtube.com/@yourbusiness"
                />
              </label>
            </div>
          </div>
        )}

        {activeTab === "branding" && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Customize your brand colors and default tax rate for invoices.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-2">
                  <Palette className="h-3 w-3" />
                  Primary Brand Color
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    className="w-12 h-12 rounded-xl border border-border/60 cursor-pointer"
                  />
                  <Input
                    value={form.primaryColor}
                    onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                    placeholder="#F97316"
                    className="flex-1"
                  />
                </div>
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-2">
                  <Palette className="h-3 w-3" />
                  Secondary Brand Color
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    className="w-12 h-12 rounded-xl border border-border/60 cursor-pointer"
                  />
                  <Input
                    value={form.secondaryColor}
                    onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
                    placeholder="#14B8A6"
                    className="flex-1"
                  />
                </div>
              </label>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-border/40">
              <h3 className="text-sm font-medium mb-3">Preview</h3>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: form.primaryColor }}
                >
                  {form.name?.charAt(0) || "K"}
                </div>
                <div>
                  <div className="font-semibold" style={{ color: form.primaryColor }}>
                    {form.name || "Your Business"}
                  </div>
                  <div className="text-sm" style={{ color: form.secondaryColor }}>
                    Professional Services
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border/40 pt-6">
              <h3 className="text-sm font-medium mb-4">Invoice Defaults</h3>
              <label className="block text-xs text-muted-foreground max-w-xs">
                <div className="flex items-center gap-1 mb-1">
                  <Percent className="h-3 w-3" />
                  Default Tax Rate (%)
                </div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.defaultTaxRate}
                  onChange={(e) => setForm((f) => ({ ...f, defaultTaxRate: e.target.value }))}
                  placeholder="12.5"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  This rate will be applied by default when creating new invoices.
                </p>
              </label>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-6 mt-6 border-t border-border/40">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
