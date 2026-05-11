"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Save, RefreshCw, CheckCircle2, Circle } from "lucide-react";
import { apiGet, apiPatch, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";

interface BlueprintRecord {
  id: string;
  businessId: string;
  schemaVersion: number;
  identity: Record<string, unknown>;
  operatingModel: Record<string, unknown>;
  goals: Record<string, unknown>;
  constraints: Record<string, unknown>;
  brand: Record<string, unknown>;
  customerModel: Record<string, unknown>;
  financials: Record<string, unknown>;
  intelligence: Record<string, unknown>;
  completeness: number;
  createdAt: string;
  updatedAt: string;
}

interface SetupStep {
  id: string;
  label: string;
  blueprintSection: string;
  weight: number;
  done: boolean;
  hint?: string;
}

type SectionKey =
  | "identity"
  | "operatingModel"
  | "goals"
  | "constraints"
  | "brand"
  | "customerModel"
  | "financials";

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "tags" | "color";
  hint?: string;
}

const SECTION_DEFS: Array<{ key: SectionKey; title: string; subtitle: string; fields: FieldDef[] }> = [
  {
    key: "identity",
    title: "Identity & story",
    subtitle: "Who you are and what you stand for. KEY uses this to ground every recommendation.",
    fields: [
      { key: "name", label: "Business name", type: "text" },
      { key: "tagline", label: "Tagline", type: "text" },
      { key: "missionStatement", label: "Mission", type: "textarea" },
      { key: "visionStatement", label: "Vision", type: "textarea" },
      { key: "story", label: "Origin story", type: "textarea" },
      { key: "archetype", label: "Archetype", type: "text", hint: "e.g. LOCAL_SERVICE, AGENCY, ECOMMERCE" },
      { key: "industry", label: "Industry", type: "text" },
      { key: "country", label: "Country", type: "text" },
      { key: "languagesServed", label: "Languages served", type: "tags" },
    ],
  },
  {
    key: "operatingModel",
    title: "Operating model",
    subtitle: "How you actually deliver and get paid. Used by the storefront builder and pricing AI.",
    fields: [
      { key: "revenueModel", label: "Revenue model", type: "text", hint: "SUBSCRIPTION, ONE_TIME, RETAINER, USAGE_BASED" },
      { key: "deliveryMethod", label: "Delivery method", type: "text", hint: "IN_PERSON, ONLINE, HYBRID" },
      { key: "fulfillmentStyle", label: "Fulfillment style", type: "text" },
      { key: "teamSize", label: "Team size", type: "text", hint: "SOLO, SMALL_TEAM, GROWING" },
      { key: "timeCommitment", label: "Time commitment", type: "text" },
      { key: "weeklyHours", label: "Weekly hours available", type: "number" },
      { key: "pricingModel", label: "Pricing model", type: "text" },
      { key: "paymentTerms", label: "Payment terms", type: "text" },
      { key: "leadTime", label: "Lead time", type: "text" },
    ],
  },
  {
    key: "goals",
    title: "Goals & targets",
    subtitle: "What success looks like over the next horizon.",
    fields: [
      { key: "primaryGoal", label: "Primary goal", type: "text" },
      { key: "northStarMetric", label: "North star metric", type: "text" },
      { key: "horizonMonths", label: "Horizon (months)", type: "number" },
      { key: "revenueTarget", label: "Revenue target (TTD)", type: "number" },
      { key: "newCustomersTarget", label: "New customers target", type: "number" },
      { key: "focusAreas", label: "Focus areas", type: "tags" },
    ],
  },
  {
    key: "customerModel",
    title: "Customer model",
    subtitle: "Who you serve and how they find you.",
    fields: [
      { key: "targetSegments", label: "Target segments", type: "tags" },
      { key: "demographics", label: "Demographics", type: "textarea" },
      { key: "painPoints", label: "Pain points", type: "tags" },
      { key: "buyingTriggers", label: "Buying triggers", type: "tags" },
      { key: "acquisitionChannels", label: "Acquisition channels", type: "tags" },
      { key: "lifetimeValueTtd", label: "Lifetime value (TTD)", type: "number" },
      { key: "repeatRatePct", label: "Repeat rate (%)", type: "number" },
      { key: "referralPropensity", label: "Referral propensity", type: "text" },
    ],
  },
  {
    key: "brand",
    title: "Brand & voice",
    subtitle: "How you sound and feel. Used by every AI copy surface.",
    fields: [
      { key: "primaryColor", label: "Primary color", type: "color" },
      { key: "secondaryColor", label: "Secondary color", type: "color" },
      { key: "accentColor", label: "Accent color", type: "color" },
      { key: "voice", label: "Brand voice", type: "text", hint: "e.g. friendly, expert, playful" },
      { key: "tone", label: "Tone", type: "text" },
      { key: "keywords", label: "Brand keywords", type: "tags" },
      { key: "positioningStatement", label: "Positioning statement", type: "textarea" },
      { key: "doNotSay", label: "Do not say", type: "tags" },
      { key: "referenceBrands", label: "Reference brands", type: "tags" },
    ],
  },
  {
    key: "financials",
    title: "Financial shape",
    subtitle: "The financial reality KEY plans inside.",
    fields: [
      { key: "avgMargin", label: "Average margin (%)", type: "number" },
      { key: "runwayMonths", label: "Runway (months)", type: "number" },
      { key: "cashPositionTier", label: "Cash position", type: "text", hint: "TIGHT, COMFORTABLE, STRONG" },
      { key: "costStructure", label: "Cost structure", type: "tags" },
      { key: "processorMix", label: "Processor mix", type: "tags" },
    ],
  },
  {
    key: "constraints",
    title: "Constraints & boundaries",
    subtitle: "What's off-limits and what KEY should respect.",
    fields: [
      { key: "budgetCeiling", label: "Budget ceiling (TTD)", type: "number" },
      { key: "timeAvailable", label: "Time available", type: "text" },
      { key: "regulatoryFlags", label: "Regulatory flags", type: "tags" },
      { key: "geographic", label: "Geographic constraints", type: "tags" },
      { key: "doNotDoList", label: "Do not do", type: "tags" },
      { key: "complianceNotes", label: "Compliance notes", type: "textarea" },
    ],
  },
];

export default function BlueprintPage() {
  // Initialise from localStorage lazily so we avoid the
  // react-hooks/set-state-in-effect lint trap.
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [blueprint, setBlueprint] = useState<BlueprintRecord | null>(null);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SectionKey, Record<string, unknown>>>>({});

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [bpRes, stepsRes] = await Promise.all([
        apiGet<{ blueprint: BlueprintRecord }>(`/blueprint/businesses/${businessId}`),
        apiGet<{ steps: SetupStep[] }>(`/blueprint/businesses/${businessId}/setup-steps`),
      ]);
      if (cancelled) return;
      if (bpRes.data?.blueprint) {
        setBlueprint(bpRes.data.blueprint);
        setDraft({});
      }
      if (stepsRes.data?.steps) setSteps(stepsRes.data.steps);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const merged = useMemo(() => {
    if (!blueprint) return null;
    const out: Record<SectionKey, Record<string, unknown>> = {
      identity: { ...blueprint.identity, ...(draft.identity ?? {}) },
      operatingModel: { ...blueprint.operatingModel, ...(draft.operatingModel ?? {}) },
      goals: { ...blueprint.goals, ...(draft.goals ?? {}) },
      constraints: { ...blueprint.constraints, ...(draft.constraints ?? {}) },
      brand: { ...blueprint.brand, ...(draft.brand ?? {}) },
      customerModel: { ...blueprint.customerModel, ...(draft.customerModel ?? {}) },
      financials: { ...blueprint.financials, ...(draft.financials ?? {}) },
    };
    return out;
  }, [blueprint, draft]);

  const isDirty = useMemo(
    () => Object.values(draft).some((s) => s && Object.keys(s).length > 0),
    [draft],
  );

  function setField(section: SectionKey, key: string, value: unknown) {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...(prev[section] ?? {}), [key]: value },
    }));
  }

  async function save() {
    if (!businessId || !isDirty) return;
    setSaving(true);
    // JSON.stringify drops `undefined` but keeps `null` — we rely on this
    // so the backend treats null as "clear this field" and undefined as
    // "leave alone". Stringify with a replacer that hands through nulls.
    const payload = JSON.parse(JSON.stringify(draft));
    const res = await apiPatch<{ blueprint: BlueprintRecord }>(
      `/blueprint/businesses/${businessId}`,
      payload,
    );
    if (res.data?.blueprint) {
      setBlueprint(res.data.blueprint);
      setDraft({});
      setSavedAt(new Date().toISOString());
      // Refresh steps after save
      const stepsRes = await apiGet<{ steps: SetupStep[] }>(
        `/blueprint/businesses/${businessId}/setup-steps`,
      );
      if (stepsRes.data?.steps) setSteps(stepsRes.data.steps);
    }
    setSaving(false);
  }

  async function refresh() {
    if (!businessId) return;
    setSaving(true);
    await apiPostSimple(`/blueprint/businesses/${businessId}/infer-from-events`, {});
    const bpRes = await apiGet<{ blueprint: BlueprintRecord }>(`/blueprint/businesses/${businessId}`);
    if (bpRes.data?.blueprint) setBlueprint(bpRes.data.blueprint);
    setSaving(false);
  }

  if (loading || !blueprint || !merged) {
    return (
      <WorkspaceShell icon={Sparkles} iconColor="#F97316" title="Business Blueprint" subtitle="Your operating DNA">
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="h-6 w-6 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={Sparkles}
      iconColor="#F97316"
      title="Business Blueprint"
      subtitle="Your operating DNA — KEY, the storefront, and every AI surface read from this."
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-6">
        <div className="space-y-6 min-w-0">
          {SECTION_DEFS.map((section) => (
            <SectionCard
              key={section.key}
              title={section.title}
              subtitle={section.subtitle}
              fields={section.fields}
              values={merged[section.key]}
              onChange={(k, v) => setField(section.key, k, v)}
            />
          ))}
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-500" />
              <h3 className="text-sm font-semibold">Completeness</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold">{blueprint.completeness}%</div>
                <div className="text-xs text-muted-foreground">
                  {steps.filter((s) => s.done).length}/{steps.length} sections complete
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all"
                  style={{ width: `${blueprint.completeness}%` }}
                />
              </div>
            </div>

            <button
              onClick={save}
              disabled={!isDirty || saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-foreground text-background disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : isDirty ? "Save changes" : savedAt ? "Saved" : "No changes"}
            </button>
            <button
              onClick={refresh}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
              title="Re-run AI inference from your business events (timeline ledger)."
            >
              <RefreshCw className="h-3 w-3" />
              Refresh from events
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold">Recommended next steps</h3>
            <div className="space-y-2">
              {steps.map((step) => (
                <div key={step.id} className="flex items-start gap-2 text-xs">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className={step.done ? "text-muted-foreground line-through" : "font-medium"}>
                      {step.label}
                    </div>
                    {step.hint && !step.done && (
                      <div className="text-muted-foreground mt-0.5 text-[11px]">{step.hint}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {Boolean((blueprint.intelligence as { aiSummary?: string }).aiSummary) && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
              <h3 className="text-sm font-semibold">AI summary</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {(blueprint.intelligence as { aiSummary?: string }).aiSummary}
              </p>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function SectionCard({
  title,
  subtitle,
  fields,
  values,
  onChange,
}: {
  title: string;
  subtitle: string;
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => onChange(f.key, v)}
          />
        ))}
      </div>
    </section>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const baseClass =
    "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30";
  const wide = field.type === "textarea" || field.type === "tags";

  return (
    <div className={wide ? "md:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
      {field.type === "text" && (
        <input
          type="text"
          className={baseClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      )}
      {field.type === "textarea" && (
        <textarea
          className={baseClass}
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      )}
      {field.type === "number" && (
        <input
          type="number"
          className={baseClass}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      )}
      {field.type === "color" && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
            value={(value as string) ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            type="text"
            className={baseClass}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            placeholder="#F97316"
          />
        </div>
      )}
      {field.type === "tags" && (
        <input
          type="text"
          className={baseClass}
          value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
          onChange={(e) => {
            const parts = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            // Send explicit null when the operator clears the field so
            // the backend knows to delete it rather than ignore it.
            onChange(parts.length > 0 ? parts : null);
          }}
          placeholder="comma, separated"
        />
      )}
      {field.hint && <p className="text-[10px] text-muted-foreground/70">{field.hint}</p>}
    </div>
  );
}
