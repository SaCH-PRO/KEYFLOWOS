"use client";

import { useState, useEffect } from "react";
import {
  Building2, Clock, Users, Globe, FileText,
  AlertCircle, Sparkles as SparklesIcon, Wand2, RefreshCw,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import { AiFieldBadge } from "./ai-field-badge";

const TEAM_SIZE_OPTIONS = [
  { value: "SOLO", label: "Solo / Just me" },
  { value: "SMALL_TEAM", label: "Small Team (2-5)" },
  { value: "GROWING", label: "Growing (6-15)" },
  { value: "MEDIUM", label: "Medium (16-50)" },
  { value: "LARGE", label: "Large (50+)" },
];

const DAY_LABELS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

type DaySchedule = { open: string; close: string; closed: boolean };
type BusinessHours = Record<string, DaySchedule>;

const DEFAULT_HOURS: BusinessHours = Object.fromEntries(
  DAY_LABELS.map(({ key }) => [
    key,
    { open: "09:00", close: "17:00", closed: key === "sunday" || key === "saturday" },
  ])
);

interface BizInfo {
  name: string;
  tagline: string;
  description: string;
  teamSize: string;
  businessHours: BusinessHours;
}

interface BusinessData {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  teamSize?: string | null;
  businessHours?: BusinessHours | null;
}

interface MyBusinessSectionProps {
  businessId: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
  onAiGenerate?: (field: string) => void;
}

export default function MyBusinessSection({
  businessId,
  onDirtyChange,
  onStatus,
  onAiGenerate,
}: MyBusinessSectionProps) {
  const [form, setForm] = useState<BizInfo>({
    name: "",
    tagline: "",
    description: "",
    teamSize: "",
    businessHours: DEFAULT_HOURS,
  });
  const [initialForm, setInitialForm] = useState<BizInfo>(form);
  const [saving, setSaving] = useState(false);
  const [generatingTagline, setGeneratingTagline] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const isDirty =
    form.name !== initialForm.name ||
    form.tagline !== initialForm.tagline ||
    form.description !== initialForm.description ||
    form.teamSize !== initialForm.teamSize ||
    JSON.stringify(form.businessHours) !== JSON.stringify(initialForm.businessHours);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      try {
        const { data } = await apiGet<BusinessData>(`/identity/businesses/${businessId}`);
        if (data) {
          const f: BizInfo = {
            name: data.name || "",
            tagline: data.tagline || "",
            description: data.description || "",
            teamSize: data.teamSize || "",
            businessHours: data.businessHours || DEFAULT_HOURS,
          };
          setForm(f);
          setInitialForm(f);
        }
      } catch {}
    };
    load();
  }, [businessId]);

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    onStatus(null);
    try {
      const { error } = await apiPatch<BusinessData>(`/identity/businesses/${businessId}`, {
        name: form.name,
        tagline: form.tagline,
        description: form.description,
        teamSize: form.teamSize,
        businessHours: form.businessHours,
      });
      if (error) {
        onStatus({ type: "error", message: error });
      } else {
        onStatus({ type: "success", message: "Business info updated" });
        setInitialForm({ ...form });
      }
    } catch {
      onStatus({ type: "error", message: "Network error" });
    }
    setSaving(false);
  };

  const handleAiGenerateField = async (field: "tagline" | "description") => {
    if (!businessId) return;
    const setLoading = field === "tagline" ? setGeneratingTagline : setGeneratingDesc;
    setLoading(true);
    onStatus(null);
    try {
      const res = await apiPatch<{ tagline?: string; description?: string }>(`/identity/businesses/${businessId}/ai-generate-field`, {
        field,
        context: {
          name: form.name,
          tagline: form.tagline,
          description: form.description,
          teamSize: form.teamSize,
        },
      });
      if (res.error) {
        onAiGenerate?.(field);
        onStatus({ type: "error", message: res.error || "AI generation failed" });
      } else if (res.data) {
        const val = field === "tagline" ? res.data.tagline : res.data.description;
        if (val) {
          setForm((f) => ({ ...f, [field]: val }));
          onStatus({ type: "success", message: `AI generated ${field} using your business intelligence! Review and save.` });
        }
      }
    } catch {
      onStatus({ type: "error", message: "AI generation failed" });
    }
    setLoading(false);
  };

  const updateHours = (day: string, updates: Partial<DaySchedule>) => {
    setForm((f) => ({
      ...f,
      businessHours: {
        ...f.businessHours,
        [day]: { ...f.businessHours[day], ...updates },
      },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        My Business
      </div>

      <AccordionGroup title="Business Details">
        <AccordionSection
          title="Business Identity"
          subtitle="Your business name and how you describe it"
          icon={Building2}
          accentColor="hsl(var(--kf-accent2))"
          defaultOpen
        >
          <div className="space-y-4 p-1">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Building2 className="h-3 w-3" />
                Business Name
              </div>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Your Business Name"
              />
              <p className="text-[10px] mt-1 opacity-60">Appears on invoices, storefront, and all customer-facing pages</p>
            </label>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <SparklesIcon className="h-3 w-3" />
                  Tagline
                  <AiFieldBadge />
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("tagline")}
                  disabled={generatingTagline || !form.name}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingTagline ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {generatingTagline ? "..." : "Generate"}
                </button>
              </div>
              <Input
                value={form.tagline}
                onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                placeholder="A short tagline for your business"
                maxLength={100}
              />
              <div className="flex justify-between mt-1">
                <p className="text-[10px] opacity-60">Shown on your storefront hero section</p>
                <p className="text-[10px]">{form.tagline.length}/100</p>
              </div>
            </div>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <FileText className="h-3 w-3" />
                  Business Description
                  <AiFieldBadge />
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("description")}
                  disabled={generatingDesc || !form.name}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingDesc ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {generatingDesc ? "..." : "Generate"}
                </button>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe what your business does, who you serve, and what makes you unique..."
                maxLength={500}
                rows={3}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent2))]/30 resize-none"
              />
              <div className="flex justify-between mt-1">
                <p className="text-[10px] opacity-60">Used on your storefront and in AI-powered recommendations</p>
                <p className="text-[10px]">{form.description.length}/500</p>
              </div>
            </div>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Team & Scale"
          subtitle="How big is your operation"
          icon={Users}
          accentColor="hsl(var(--kf-accent1))"
        >
          <div className="p-1">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Users className="h-3 w-3" />
                Team Size
              </div>
              <select
                value={form.teamSize}
                onChange={(e) => setForm((f) => ({ ...f, teamSize: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
              >
                <option value="">Select team size</option>
                {TEAM_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-[10px] mt-1 opacity-60">Helps tailor automation recommendations for your scale</p>
            </label>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Operating Hours"
          subtitle="When your business is open"
          icon={Clock}
          accentColor="hsl(var(--kf-accent2))"
        >
          <div className="space-y-2 p-1">
            {DAY_LABELS.map(({ key, label }) => {
              const day = form.businessHours[key] || { open: "09:00", close: "17:00", closed: false };
              return (
                <div key={key} className="flex items-center gap-3">
                  <label className="flex items-center gap-2 w-20 text-xs font-medium cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={!day.closed}
                      onChange={(e) => updateHours(key, { closed: !e.target.checked })}
                      className="w-4 h-4 rounded accent-[hsl(var(--kf-accent2))]"
                    />
                    {label}
                  </label>
                  {!day.closed ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={day.open}
                        onChange={(e) => updateHours(key, { open: e.target.value })}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) => updateHours(key, { close: e.target.value })}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Closed</span>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground opacity-60 pt-1">Controls booking availability and storefront display</p>
          </div>
        </AccordionSection>
      </AccordionGroup>

      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        {isDirty && (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
            <AlertCircle className="h-3 w-3" />
            You have unsaved changes
          </p>
        )}
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={saving || !isDirty} className="min-h-[44px]">
            {saving ? "Saving..." : "Save Business Info"}
          </Button>
        </div>
      </div>
    </div>
  );
}
