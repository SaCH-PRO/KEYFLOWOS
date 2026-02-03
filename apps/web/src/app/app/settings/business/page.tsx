"use client";

import { useEffect, useState } from "react";
import { Building2, Globe, Clock, DollarSign, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiPatch, apiGet } from "@/lib/api";

type Business = {
  id: string;
  name: string;
  slug: string | null;
  timezone: string;
  currency: string;
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

export default function BusinessSettingsPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", timezone: "", currency: "" });

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
          name: res.data.name,
          slug: res.data.slug || "",
          timezone: res.data.timezone,
          currency: res.data.currency,
        });
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!business) return;
    setSaving(true);
    setStatus(null);
    const res = await apiPatch(`/identity/businesses/${business.id}`, form);
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

  return (
    <div className="space-y-6 max-w-2xl">
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
          <Building2 className="h-4 w-4 text-primary" />
          Business Information
        </div>

        <div className="space-y-4">
          <label className="block text-xs text-muted-foreground">
            Business Name
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My Business"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              Public URL Slug
            </div>
            <Input
              className="mt-1"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
              placeholder="my-business"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Your public booking page: keyflow.app/book/{form.slug || "your-slug"}
            </p>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Timezone
            </div>
            <select
              className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Default Currency
            </div>
            <select
              className="mt-1 w-full rounded-xl border border-border/60 bg-slate-950/80 px-3 py-2 text-sm"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
