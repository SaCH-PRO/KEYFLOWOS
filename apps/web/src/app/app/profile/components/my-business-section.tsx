"use client";

import { useEffect, useRef, useMemo } from "react";
import {
  Building2, Clock, Users, FileText,
  AlertCircle, Sparkles as SparklesIcon, Wand2, RefreshCw,
  CheckCircle2, ArrowRight, Zap, Globe, Target,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { apiPatch, apiPost } from "@/lib/api";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import { AiFieldBadge } from "./ai-field-badge";
import { useProfileSection } from "@/hooks/use-profile-section";
import { useState } from "react";

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


const EMPTY_BIZ_INFO: BizInfo = {
  name: "",
  tagline: "",
  description: "",
  teamSize: "",
  businessHours: DEFAULT_HOURS,
};

function isBizInfoDirty(current: BizInfo, initial: BizInfo): boolean {
  return (
    current.name !== initial.name ||
    current.tagline !== initial.tagline ||
    current.description !== initial.description ||
    current.teamSize !== initial.teamSize ||
    JSON.stringify(current.businessHours) !== JSON.stringify(initial.businessHours)
  );
}

function SectionCompletion({ completed, total, impact }: { completed: number; total: number; impact: string }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed === total;
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
      style={{
        background: isComplete ? "hsl(var(--kf-success) / 0.06)" : "hsl(var(--kf-muted) / 0.06)",
        border: `1px solid ${isComplete ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-border) / 0.1)"}`,
      }}
    >
      {isComplete ? (
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
      ) : (
        <div className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold" style={{ color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-foreground))" }}>
            {completed}/{total} complete
          </span>
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)", maxWidth: "60px" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))" }} />
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{impact}</p>
      </div>
    </div>
  );
}

function FieldImpact({ text }: { text: string }) {
  return (
    <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "hsl(var(--kf-accent2) / 0.8)" }}>
      <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" />
      {text}
    </p>
  );
}

interface MyBusinessSectionProps {
  businessId: string | null;
  businessData?: {
    name?: string;
    tagline?: string | null;
    description?: string | null;
    teamSize?: string | null;
    businessHours?: BusinessHours | null;
  } | null;
  businessLoading?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
  onSaved?: (saved: Partial<BizInfo>) => void;
}

export default function MyBusinessSection({
  businessId,
  businessData,
  businessLoading,
  onDirtyChange,
  onStatus,
  onSaved,
}: MyBusinessSectionProps) {
  const { form, setForm, setInitialForm, isDirty, saving, setSaving } = useProfileSection<BizInfo>({
    initialState: EMPTY_BIZ_INFO,
    isDirtyFn: isBizInfoDirty,
    onDirtyChange,
  });

  const [generatingTagline, setGeneratingTagline] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const initializedRef = useRef(false);

  const identityCompletion = useMemo(() => {
    const fields = [form.name, form.tagline, form.description];
    return { completed: fields.filter(Boolean).length, total: fields.length };
  }, [form.name, form.tagline, form.description]);

  const teamCompletion = useMemo(() => {
    const fields = [form.teamSize];
    return { completed: fields.filter(Boolean).length, total: fields.length };
  }, [form.teamSize]);

  const hoursCompletion = useMemo(() => {
    const hasCustomHours = Object.values(form.businessHours).some(
      (d) => d.open !== "09:00" || d.close !== "17:00" || d.closed
    );
    return { completed: hasCustomHours ? 1 : 0, total: 1 };
  }, [form.businessHours]);

  useEffect(() => {
    if (!businessId || businessLoading || !businessData) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const f: BizInfo = {
      name: businessData.name || "",
      tagline: businessData.tagline || "",
      description: businessData.description || "",
      teamSize: businessData.teamSize || "",
      businessHours: businessData.businessHours || DEFAULT_HOURS,
    };
    setForm(f);
    setInitialForm(f);
  }, [businessId, businessLoading, businessData, setForm, setInitialForm]);

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    onStatus(null);
    try {
      const { error } = await apiPatch<BizInfo>(`/identity/businesses/${businessId}`, {
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
        onSaved?.({ ...form });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Network error" });
    }
    setSaving(false);
  };

  const handleAiGenerateField = async (field: "tagline" | "description") => {
    if (!businessId) return;
    const setLoading = field === "tagline" ? setGeneratingTagline : setGeneratingDesc;
    setLoading(true);
    onStatus(null);
    try {
      const res = await apiPost<{ tagline?: string; description?: string }>({
        path: `/identity/businesses/${businessId}/ai-generate-field`,
        body: {
          field,
          context: {
            name: form.name,
            tagline: form.tagline,
            description: form.description,
            teamSize: form.teamSize,
          },
        },
      });
      if (res.error) {
        onStatus({ type: "error", message: res.error || "AI generation failed" });
      } else if (res.data) {
        const val = field === "tagline" ? res.data.tagline : res.data.description;
        if (val) {
          setForm((f) => ({ ...f, [field]: val }));
          onStatus({ type: "success", message: `AI generated ${field} using your business intelligence! Review and save.` });
        }
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "AI generation failed" });
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

  if (businessLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" aria-busy="true" aria-label="Loading business info">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" aria-hidden="true" />
        Loading business info...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent2))" }} aria-hidden="true" />
        My Business
      </div>

      <AccordionGroup title="Business Details">
        <AccordionSection
          title="Business Identity"
          subtitle={`${identityCompletion.completed}/${identityCompletion.total} fields complete`}
          icon={Building2}
          accentColor="hsl(var(--kf-accent2))"
          defaultOpen
        >
          <div className="space-y-4 p-1">
            <SectionCompletion
              completed={identityCompletion.completed}
              total={identityCompletion.total}
              impact="Powers invoices, storefront, AI documents, and public pages"
            />

            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Building2 className="h-3 w-3" aria-hidden="true" />
                Business Name
                {!form.name && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Required</span>
                )}
              </div>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Your Business Name"
                style={!form.name ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <FieldImpact text="Appears on invoices, quotes, storefront, and all customer-facing pages" />
            </label>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <SparklesIcon className="h-3 w-3" aria-hidden="true" />
                  Tagline
                  <AiFieldBadge />
                  {!form.tagline && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("tagline")}
                  disabled={generatingTagline || !form.name}
                  aria-label="Generate tagline with AI"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingTagline ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3 w-3" aria-hidden="true" />}
                  {generatingTagline ? "..." : "Generate"}
                </button>
              </div>
              <Input
                value={form.tagline}
                onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                placeholder="A short tagline for your business"
                maxLength={100}
                style={!form.tagline ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <FieldImpact text="Shown on storefront hero and marketing materials" />
                <p className="text-[10px] flex-shrink-0 ml-2" aria-label={`${form.tagline.length} of 100 characters`}>{form.tagline.length}/100</p>
              </div>
            </div>

            <div className="block text-xs text-muted-foreground">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  Business Description
                  <AiFieldBadge />
                  {!form.description && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleAiGenerateField("description")}
                  disabled={generatingDesc || !form.name}
                  aria-label="Generate business description with AI"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all min-h-[44px]"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingDesc ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3 w-3" aria-hidden="true" />}
                  {generatingDesc ? "..." : "Generate"}
                </button>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe what your business does, who you serve, and what makes you unique..."
                maxLength={500}
                rows={3}
                aria-label="Business description"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent2))]/30 resize-none"
                style={!form.description ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <FieldImpact text="Improves AI documents, storefront copy, and intelligence package quality" />
                <p className="text-[10px] flex-shrink-0 ml-2" aria-label={`${form.description.length} of 500 characters`}>{form.description.length}/500</p>
              </div>
            </div>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Team & Scale"
          subtitle={`${teamCompletion.completed}/${teamCompletion.total} fields complete`}
          icon={Users}
          accentColor="hsl(var(--kf-accent1))"
        >
          <div className="p-1">
            <SectionCompletion
              completed={teamCompletion.completed}
              total={teamCompletion.total}
              impact="Powers staffing, automation, and operations recommendations"
            />
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Users className="h-3 w-3" aria-hidden="true" />
                Team Size
                {!form.teamSize && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Required</span>
                )}
              </div>
              <select
                value={form.teamSize}
                onChange={(e) => setForm((f) => ({ ...f, teamSize: e.target.value }))}
                aria-label="Team size"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
                style={!form.teamSize ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              >
                <option value="">Select team size</option>
                {TEAM_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <FieldImpact text="Tailors automation complexity, staffing guidance in Calendar, and Flows recommendations" />
            </label>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Operating Hours"
          subtitle={hoursCompletion.completed > 0 ? "Configured" : "Not configured"}
          icon={Clock}
          accentColor="hsl(var(--kf-accent2))"
        >
          <div className="space-y-2 p-1">
            <SectionCompletion
              completed={hoursCompletion.completed}
              total={hoursCompletion.total}
              impact="Controls booking availability and storefront display hours"
            />
            {DAY_LABELS.map(({ key, label }) => {
              const day = form.businessHours[key] || { open: "09:00", close: "17:00", closed: false };
              return (
                <div key={key} className="flex items-center gap-3">
                  <label className="flex items-center gap-2 w-20 text-xs font-medium cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={!day.closed}
                      onChange={(e) => updateHours(key, { closed: !e.target.checked })}
                      aria-label={`${label} open`}
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
                        aria-label={`${label} opening time`}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                      <span className="text-xs text-muted-foreground" aria-hidden="true">to</span>
                      <input
                        type="time"
                        value={day.close}
                        onChange={(e) => updateHours(key, { close: e.target.value })}
                        aria-label={`${label} closing time`}
                        className="bg-transparent border border-border rounded-lg px-2 py-1.5 text-xs text-foreground min-h-[36px]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Closed</span>
                  )}
                </div>
              );
            })}
            <FieldImpact text="Syncs with Calendar bookings, storefront hours display, and scheduling AI" />
          </div>
        </AccordionSection>
      </AccordionGroup>

      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        {isDirty && (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }} role="status">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
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
