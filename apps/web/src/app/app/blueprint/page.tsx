"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Building2,
  Compass,
  DollarSign,
  Goal,
  Palette,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type {
  BlueprintData,
  BlueprintSectionDataMap,
  BlueprintSectionKey,
} from "@/lib/blueprint-types";

interface RecommendedStep {
  id: string;
  section: string;
  title: string;
  reason: string;
  href?: string;
}

const SECTION_LABELS: Record<BlueprintSectionKey, string> = {
  identity: "Identity",
  operatingModel: "Operating Model",
  goals: "Goals",
  constraints: "Constraints",
  brand: "Brand",
  customerModel: "Customer Model",
  financials: "Financials",
  intelligence: "Intelligence",
  workflowModel: "Workflow Model",
  aiPreferences: "AI Preferences",
};

function arrToCsv(value: string[] | undefined): string {
  if (!value) return "";
  return value.join(", ");
}

function csvToArr(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function FieldRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="kf-text-caption font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function TextField(props: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className="kf-input w-full px-3 py-2 kf-radius-md kf-text-body"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border))",
        color: "hsl(var(--kf-foreground))",
      }}
    />
  );
}

function TextArea(props: {
  value: string | undefined;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      rows={props.rows || 3}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className="w-full px-3 py-2 kf-radius-md kf-text-body"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border))",
        color: "hsl(var(--kf-foreground))",
      }}
    />
  );
}

function SelectField(props: {
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full px-3 py-2 kf-radius-md kf-text-body"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border))",
        color: "hsl(var(--kf-foreground))",
      }}
    >
      <option value="">—</option>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberField(props: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={typeof props.value === "number" ? props.value : ""}
      onChange={(e) => {
        const v = e.target.value;
        props.onChange(v === "" ? undefined : Number(v));
      }}
      placeholder={props.placeholder}
      className="w-full px-3 py-2 kf-radius-md kf-text-body"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border))",
        color: "hsl(var(--kf-foreground))",
      }}
    />
  );
}

function CompletenessBar({ value }: { value: number }) {
  const color =
    value >= 80
      ? "hsl(var(--kf-success, 160 70% 45%))"
      : value >= 40
        ? "hsl(var(--kf-accent1))"
        : "hsl(var(--kf-warning, 30 90% 50%))";
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between">
        <span className="kf-text-caption" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Blueprint completeness
        </span>
        <span className="kf-text-body font-semibold">{value}%</span>
      </div>
      <div
        className="w-full h-2 kf-radius-full overflow-hidden"
        style={{ background: "hsl(var(--kf-border) / 0.5)" }}
      >
        <div
          className="h-full kf-radius-full transition-all"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function BlueprintPage() {
  // Lazy initializer hydrates the businessId synchronously from localStorage on
  // first client render so we no longer need a follow-up effect to set it
  // (which previously required a `react-hooks/set-state-in-effect` disable).
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [data, setData] = useState<BlueprintData | null>(null);
  const [draft, setDraft] = useState<BlueprintData | null>(null);
  const [recs, setRecs] = useState<RecommendedStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [bp, recsResp] = await Promise.all([
      apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`),
      apiGet<{ steps: RecommendedStep[] }>(`/blueprint/businesses/${businessId}/recommendations`),
    ]);
    if (bp.data) {
      setData(bp.data);
      setDraft(bp.data);
    }
    if (recsResp.data) setRecs(recsResp.data.steps || []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // Mount-time data fetch; setState inside load() is the intended effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(data) !== JSON.stringify(draft),
    [data, draft],
  );

  function updateSection<K extends BlueprintSectionKey>(
    section: K,
    patch: Partial<BlueprintSectionDataMap[K]>,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev[section];
      return {
        ...prev,
        [section]: { ...current, ...patch },
      };
    });
  }

  const handleSave = async () => {
    if (!businessId || !draft) return;
    setSaving(true);
    const patch = {
      identity: draft.identity,
      operatingModel: draft.operatingModel,
      goals: draft.goals,
      constraints: draft.constraints,
      brand: draft.brand,
      customerModel: draft.customerModel,
      financials: draft.financials,
      intelligence: draft.intelligence,
      workflowModel: draft.workflowModel,
      aiPreferences: draft.aiPreferences,
    };
    const res = await apiPatch<BlueprintData>(`/blueprint/businesses/${businessId}`, patch);
    setSaving(false);
    if (res.error) {
      toast.error(`Could not save blueprint: ${res.error}`);
      return;
    }
    if (res.data) {
      setData(res.data);
      setDraft(res.data);
      toast.success(`Blueprint saved (${res.data.completeness}% complete)`);
      load();
    }
  };

  if (loading || !draft) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <ListPageSkeleton />
      </div>
    );
  }

  const id = draft.identity;
  const op = draft.operatingModel;
  const goals = draft.goals;
  const cons = draft.constraints;
  const brand = draft.brand;
  const cust = draft.customerModel;
  const fin = draft.financials;
  const intel = draft.intelligence;
  const wf = draft.workflowModel;
  const ai = draft.aiPreferences;

  return (
    <div className="p-6 max-w-5xl mx-auto pb-32">
      <PageHeader
        icon={Brain}
        title="Business Blueprint"
        subtitle="Your business's living operating DNA — every AI surface reads from this."
        rightSlot={
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 px-3 py-2 kf-radius-md kf-text-caption font-medium transition-opacity disabled:opacity-50"
            style={{
              background: "hsl(var(--kf-accent1))",
              color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))",
            }}
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        }
      />

      <div className="grid gap-4 mb-6 md:grid-cols-3">
        <SectionCard title="Completeness" icon={Sparkles}>
          <CompletenessBar value={draft.completeness ?? 0} />
          <p className="mt-3 kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            KEY uses every filled field to ground its recommendations. Aim for 80%+.
          </p>
        </SectionCard>

        <SectionCard title="Recommended next steps" icon={Compass} className="md:col-span-2">
          {recs.length === 0 ? (
            <p className="kf-text-caption" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              All sections look healthy. Keep the blueprint fresh as your business evolves.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recs.slice(0, 4).map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 px-3 py-2 kf-radius-md"
                  style={{ background: "hsl(var(--kf-card))" }}
                >
                  <div
                    className="w-7 h-7 kf-radius-md flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                  >
                    <Goal className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <div className="min-w-0">
                    <a
                      href={r.href || `#${r.section}`}
                      className="kf-text-body font-medium block"
                      style={{ color: "hsl(var(--kf-foreground))" }}
                    >
                      {r.title}
                    </a>
                    <p className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {r.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section id="identity">
          <SectionCard title={SECTION_LABELS.identity} icon={Building2}>
            <div className="grid gap-3">
              <FieldRow label="Business name">
                <TextField value={id.name} onChange={(v) => updateSection("identity", { name: v })} />
              </FieldRow>
              <FieldRow label="One-liner" hint="What you do, in a single sentence.">
                <TextArea
                  rows={2}
                  value={id.oneLiner}
                  onChange={(v) => updateSection("identity", { oneLiner: v })}
                />
              </FieldRow>
              <FieldRow label="Archetype">
                <SelectField
                  value={id.archetype}
                  onChange={(v) => updateSection("identity", { archetype: v })}
                  options={[
                    { value: "LOCAL_SERVICE", label: "Local service" },
                    { value: "DIGITAL_PRODUCT", label: "Digital product" },
                    { value: "AGENCY", label: "Agency" },
                    { value: "CLINIC", label: "Clinic" },
                    { value: "ECOMMERCE", label: "E-commerce" },
                    { value: "OTHER", label: "Other" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Industry">
                <TextField
                  value={id.industry}
                  onChange={(v) => updateSection("identity", { industry: v })}
                />
              </FieldRow>
              <FieldRow label="Tagline">
                <TextField
                  value={id.tagline}
                  onChange={(v) => updateSection("identity", { tagline: v })}
                />
              </FieldRow>
              <FieldRow label="Mission">
                <TextArea
                  value={id.mission}
                  onChange={(v) => updateSection("identity", { mission: v })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="operatingModel">
          <SectionCard title={SECTION_LABELS.operatingModel} icon={Compass}>
            <div className="grid gap-3">
              <FieldRow label="Revenue model">
                <SelectField
                  value={op.revenueModel}
                  onChange={(v) => updateSection("operatingModel", { revenueModel: v })}
                  options={[
                    { value: "SUBSCRIPTION", label: "Subscription" },
                    { value: "ONE_TIME", label: "One-time" },
                    { value: "RETAINER", label: "Retainer" },
                    { value: "USAGE_BASED", label: "Usage-based" },
                    { value: "MIXED", label: "Mixed" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Delivery mode">
                <SelectField
                  value={op.deliveryMode}
                  onChange={(v) => updateSection("operatingModel", { deliveryMode: v })}
                  options={[
                    { value: "IN_PERSON", label: "In person" },
                    { value: "REMOTE", label: "Remote" },
                    { value: "HYBRID", label: "Hybrid" },
                    { value: "DIGITAL", label: "Digital" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Service area">
                <TextField
                  value={op.serviceArea}
                  onChange={(v) => updateSection("operatingModel", { serviceArea: v })}
                  placeholder="e.g. Trinidad & Tobago"
                />
              </FieldRow>
              <FieldRow label="Channels" hint="Comma-separated: STOREFRONT, INSTAGRAM, WHATSAPP…">
                <TextField
                  value={arrToCsv(op.channels)}
                  onChange={(v) => updateSection("operatingModel", { channels: csvToArr(v) })}
                />
              </FieldRow>
              <FieldRow label="Team size">
                <SelectField
                  value={op.teamSize}
                  onChange={(v) => updateSection("operatingModel", { teamSize: v })}
                  options={[
                    { value: "SOLO", label: "Solo" },
                    { value: "SMALL_TEAM", label: "Small team" },
                    { value: "GROWING", label: "Growing" },
                  ]}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="goals">
          <SectionCard title={SECTION_LABELS.goals} icon={Goal}>
            <div className="grid gap-3">
              <FieldRow label="North star" hint="The single most important outcome.">
                <TextField
                  value={goals.northStar}
                  onChange={(v) => updateSection("goals", { northStar: v })}
                />
              </FieldRow>
              <FieldRow label="90-day goals" hint="One per line, comma-separated.">
                <TextArea
                  value={arrToCsv(goals.ninetyDayGoals)}
                  onChange={(v) => updateSection("goals", { ninetyDayGoals: csvToArr(v) })}
                />
              </FieldRow>
              <FieldRow label="12-month goals">
                <TextArea
                  value={arrToCsv(goals.twelveMonthGoals)}
                  onChange={(v) => updateSection("goals", { twelveMonthGoals: csvToArr(v) })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="constraints">
          <SectionCard title={SECTION_LABELS.constraints} icon={ShieldCheck}>
            <div className="grid gap-3">
              <FieldRow label="Budget range">
                <SelectField
                  value={cons.budgetRange}
                  onChange={(v) => updateSection("constraints", { budgetRange: v })}
                  options={[
                    { value: "LOW", label: "Low" },
                    { value: "MEDIUM", label: "Medium" },
                    { value: "HIGH", label: "High" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Time commitment">
                <SelectField
                  value={cons.timeCommitment}
                  onChange={(v) => updateSection("constraints", { timeCommitment: v })}
                  options={[
                    { value: "MINIMAL", label: "Minimal" },
                    { value: "PART_TIME", label: "Part-time" },
                    { value: "FULL_TIME", label: "Full-time" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Risk tolerance">
                <SelectField
                  value={cons.riskTolerance}
                  onChange={(v) => updateSection("constraints", { riskTolerance: v })}
                  options={[
                    { value: "LOW", label: "Low" },
                    { value: "MEDIUM", label: "Medium" },
                    { value: "HIGH", label: "High" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Dealbreakers" hint="What you will not do, comma-separated.">
                <TextField
                  value={arrToCsv(cons.dealbreakers)}
                  onChange={(v) => updateSection("constraints", { dealbreakers: csvToArr(v) })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="brand">
          <SectionCard title={SECTION_LABELS.brand} icon={Palette}>
            <div className="grid gap-3">
              <FieldRow label="Voice" hint="e.g. warm, expert, playful">
                <TextField value={brand.voice} onChange={(v) => updateSection("brand", { voice: v })} />
              </FieldRow>
              <FieldRow label="Tone">
                <TextField value={brand.tone} onChange={(v) => updateSection("brand", { tone: v })} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Primary color">
                  <TextField
                    value={brand.primaryColor}
                    onChange={(v) => updateSection("brand", { primaryColor: v })}
                    placeholder="#F97316"
                  />
                </FieldRow>
                <FieldRow label="Secondary color">
                  <TextField
                    value={brand.secondaryColor}
                    onChange={(v) => updateSection("brand", { secondaryColor: v })}
                    placeholder="#14B8A6"
                  />
                </FieldRow>
              </div>
              <FieldRow label="Value props" hint="Comma-separated.">
                <TextArea
                  value={arrToCsv(brand.valueProps)}
                  onChange={(v) => updateSection("brand", { valueProps: csvToArr(v) })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="customerModel">
          <SectionCard title={SECTION_LABELS.customerModel} icon={Users}>
            <div className="grid gap-3">
              <FieldRow label="Ideal customer">
                <TextArea
                  value={cust.idealCustomer}
                  onChange={(v) => updateSection("customerModel", { idealCustomer: v })}
                />
              </FieldRow>
              <FieldRow label="Segments">
                <TextField
                  value={arrToCsv(cust.segments)}
                  onChange={(v) => updateSection("customerModel", { segments: csvToArr(v) })}
                />
              </FieldRow>
              <FieldRow label="Pain points">
                <TextArea
                  value={arrToCsv(cust.painPoints)}
                  onChange={(v) => updateSection("customerModel", { painPoints: csvToArr(v) })}
                />
              </FieldRow>
              <FieldRow label="Jobs to be done">
                <TextArea
                  value={arrToCsv(cust.jobsToBeDone)}
                  onChange={(v) => updateSection("customerModel", { jobsToBeDone: csvToArr(v) })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="financials">
          <SectionCard title={SECTION_LABELS.financials} icon={DollarSign}>
            <div className="grid gap-3">
              <FieldRow label="Currency">
                <TextField
                  value={fin.currency}
                  onChange={(v) => updateSection("financials", { currency: v })}
                  placeholder="TTD"
                />
              </FieldRow>
              <FieldRow label="Pricing model">
                <SelectField
                  value={fin.pricingModel}
                  onChange={(v) => updateSection("financials", { pricingModel: v })}
                  options={[
                    { value: "FLAT", label: "Flat" },
                    { value: "TIERED", label: "Tiered" },
                    { value: "HOURLY", label: "Hourly" },
                    { value: "CUSTOM", label: "Custom" },
                  ]}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Avg ticket">
                  <NumberField
                    value={fin.avgTicket}
                    onChange={(v) => updateSection("financials", { avgTicket: v })}
                  />
                </FieldRow>
                <FieldRow label="Monthly target">
                  <NumberField
                    value={fin.monthlyTarget}
                    onChange={(v) => updateSection("financials", { monthlyTarget: v })}
                  />
                </FieldRow>
              </div>
              <FieldRow label="Cost structure">
                <TextArea
                  value={fin.costStructure}
                  onChange={(v) => updateSection("financials", { costStructure: v })}
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>

        <section id="intelligence">
          <SectionCard title={SECTION_LABELS.intelligence} icon={Brain}>
            <p className="kf-text-caption mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Auto-derived from your business activity via the unified event timeline.
            </p>
            <ul className="flex flex-col gap-1.5 kf-text-caption">
              <li>
                Top product categories:{" "}
                <span style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {arrToCsv(intel.topProductCategories) || "—"}
                </span>
              </li>
              <li>
                Top channels:{" "}
                <span style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {arrToCsv(intel.topChannels) || "—"}
                </span>
              </li>
              <li>
                Recent momentum score:{" "}
                <span style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {typeof intel.recentMomentumScore === "number"
                    ? intel.recentMomentumScore
                    : "—"}
                </span>
              </li>
              <li>
                Last inferred:{" "}
                <span style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {intel.inferredAt ? new Date(intel.inferredAt).toLocaleString() : "—"}
                </span>
              </li>
            </ul>
          </SectionCard>
        </section>

        <section id="workflowModel">
          <SectionCard title={SECTION_LABELS.workflowModel} icon={Compass}>
            <div className="grid gap-3">
              <FieldRow label="Primary workflow">
                <SelectField
                  value={wf?.primaryWorkflow}
                  onChange={(v) => updateSection("workflowModel", { primaryWorkflow: v })}
                  options={[
                    { value: "APPOINTMENT", label: "Appointment-based" },
                    { value: "PROJECT", label: "Project-based" },
                    { value: "RETAINER", label: "Retainer / Subscription" },
                    { value: "WALK_IN", label: "Walk-in / Queue" },
                    { value: "ECOMMERCE", label: "E-commerce / Self-serve" },
                    { value: "INQUIRY", label: "Custom inquiry / Quote" },
                  ]}
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "appointmentBooking", label: "Appointments" },
                  { key: "projectManagement", label: "Projects" },
                  { key: "retainerCycle", label: "Retainers" },
                  { key: "walkInQueue", label: "Walk-ins" },
                  { key: "ecommerceFulfillment", label: "E-commerce" },
                  { key: "customInquiryFlow", label: "Custom inquiry" },
                ].map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 kf-text-caption">
                    <input
                      type="checkbox"
                      checked={!!(wf as any)?.[opt.key]}
                      onChange={(e) =>
                        updateSection("workflowModel", { [opt.key]: e.target.checked })
                      }
                      className="rounded border-border"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </SectionCard>
        </section>

        <section id="aiPreferences">
          <SectionCard title={SECTION_LABELS.aiPreferences} icon={Sparkles}>
            <div className="grid gap-3">
              <FieldRow label="Autonomy level" hint="How much freedom KEY has to act on your behalf.">
                <SelectField
                  value={String(ai?.autonomyLevel ?? "")}
                  onChange={(v) => updateSection("aiPreferences", { autonomyLevel: v ? Number(v) : undefined })}
                  options={[
                    { value: "0", label: "Advisory only — suggestions, no action" },
                    { value: "1", label: "Draft mode — creates content for review" },
                    { value: "2", label: "Internal exec — low-risk actions auto-approved" },
                    { value: "3", label: "External approval — asks before external comms" },
                    { value: "4", label: "Trusted autopilot — full delegation" },
                  ]}
                />
              </FieldRow>
              <FieldRow label="AI tone">
                <TextField
                  value={ai?.tone}
                  onChange={(v) => updateSection("aiPreferences", { tone: v })}
                  placeholder="e.g. professional, warm, direct"
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 kf-text-caption">
                  <input
                    type="checkbox"
                    checked={!!ai?.notifyOnRecommendations}
                    onChange={(e) => updateSection("aiPreferences", { notifyOnRecommendations: e.target.checked })}
                    className="rounded border-border"
                  />
                  Notify on recommendations
                </label>
                <label className="flex items-center gap-2 kf-text-caption">
                  <input
                    type="checkbox"
                    checked={!!ai?.notifyOnAlerts}
                    onChange={(e) => updateSection("aiPreferences", { notifyOnAlerts: e.target.checked })}
                    className="rounded border-border"
                  />
                  Notify on alerts
                </label>
                <label className="flex items-center gap-2 kf-text-caption">
                  <input
                    type="checkbox"
                    checked={!!ai?.voiceEnabled}
                    onChange={(e) => updateSection("aiPreferences", { voiceEnabled: e.target.checked })}
                    className="rounded border-border"
                  />
                  Voice input enabled
                </label>
              </div>
              <FieldRow label="Approved actions" hint="Comma-separated list of actions KEY can auto-run.">
                <TextField
                  value={arrToCsv(ai?.approvedActions)}
                  onChange={(v) => updateSection("aiPreferences", { approvedActions: csvToArr(v) })}
                  placeholder="e.g. send_invoice_reminder, create_booking"
                />
              </FieldRow>
            </div>
          </SectionCard>
        </section>
      </div>
    </div>
  );
}
