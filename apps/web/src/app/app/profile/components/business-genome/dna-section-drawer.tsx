"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { updateDnaSection, type DnaSectionKey, type DnaSectionScore } from "@/lib/api/business-genome";
import type { BlueprintData, BlueprintSectionKey } from "@/lib/blueprint-types";

interface DnaSectionDrawerProps {
  section: DnaSectionScore;
  onClose: () => void;
  onUpdate: () => void;
}

const SECTION_FIELDS: Record<DnaSectionKey, string[]> = {
  founder: ["founderName", "background", "skills", "weeklyAvailabilityHours"],
  vision: ["mission", "vision", "values", "voice", "tone", "valueProps"],
  business: [
    "name",
    "archetype",
    "industry",
    "revenueModel",
    "deliveryMode",
    "serviceArea",
    "teamSize",
    "northStar",
    "budgetRange",
    "timeCommitment",
    "riskTolerance",
    "primaryWorkflow",
    "autonomyLevel",
    "reportingCadence",
  ],
  market: ["idealCustomer", "segments", "painPoints", "targetGeography", "marketCategory", "demandSignals"],
  financial: [
    "currency",
    "pricingModel",
    "avgTicket",
    "monthlyTarget",
    "startupCapital",
    "monthlyFixedCosts",
    "variableCostPercent",
  ],
  legal: [
    "country",
    "recommendedEntityType",
    "regulatedIndustry",
    "businessNameStatus",
    "companiesRegistryStatus",
    "vatStatus",
    "taxIdStatus",
    "hasPartners",
    "owners",
    "complianceItems",
  ],
  operations: ["coreWorkflows", "fulfillmentProcess"],
  sales: ["salesChannels", "pipelineStages"],
  marketing: ["channels", "launchPlan"],
  growth: ["today", "sevenDayPlan", "thirtyDayPlan"],
  technology: ["primaryWorkflow", "autonomyLevel", "outreachStyle", "reportingCadence"],
  risk: ["financialRisks", "legalRisks", "marketRisks", "operationalRisks", "founderRisks", "mitigationPlan"],
};

const FIELD_SOURCES: Record<string, BlueprintSectionKey[]> = {
  founderName: ["founderProfile"],
  background: ["founderProfile"],
  skills: ["founderProfile"],
  weeklyAvailabilityHours: ["founderProfile"],
  mission: ["identity"],
  vision: ["identity"],
  values: ["identity"],
  voice: ["brand"],
  tone: ["brand"],
  valueProps: ["brand"],
  name: ["identity"],
  archetype: ["identity"],
  industry: ["identity"],
  revenueModel: ["operatingModel"],
  deliveryMode: ["operatingModel"],
  serviceArea: ["operatingModel"],
  teamSize: ["operatingModel"],
  northStar: ["goals"],
  budgetRange: ["constraints"],
  timeCommitment: ["constraints"],
  riskTolerance: ["constraints"],
  primaryWorkflow: ["workflowModel"],
  autonomyLevel: ["aiPreferences"],
  outreachStyle: ["aiPreferences"],
  reportingCadence: ["aiPreferences"],
  idealCustomer: ["customerModel"],
  segments: ["customerModel"],
  painPoints: ["customerModel"],
  targetGeography: ["marketProfile"],
  marketCategory: ["marketProfile"],
  demandSignals: ["marketProfile"],
  currency: ["financials"],
  pricingModel: ["financials"],
  avgTicket: ["financials"],
  monthlyTarget: ["financials"],
  startupCapital: ["projectionProfile"],
  monthlyFixedCosts: ["projectionProfile"],
  variableCostPercent: ["projectionProfile"],
  recommendedEntityType: ["legalProfile"],
  regulatedIndustry: ["legalProfile"],
  businessNameStatus: ["registrationProfile"],
  companiesRegistryStatus: ["registrationProfile"],
  vatStatus: ["registrationProfile", "taxProfile"],
  taxIdStatus: ["taxProfile"],
  hasPartners: ["ownershipProfile"],
  owners: ["ownershipProfile"],
  complianceItems: ["complianceProfile"],
  coreWorkflows: ["operationsSystem"],
  fulfillmentProcess: ["operationsSystem"],
  salesChannels: ["salesSystem"],
  pipelineStages: ["salesSystem"],
  channels: ["marketingSystem"],
  launchPlan: ["marketingSystem"],
  today: ["executionRoadmap"],
  sevenDayPlan: ["executionRoadmap"],
  thirtyDayPlan: ["executionRoadmap"],
  financialRisks: ["riskProfile"],
  legalRisks: ["riskProfile"],
  marketRisks: ["riskProfile"],
  operationalRisks: ["riskProfile"],
  founderRisks: ["riskProfile"],
  mitigationPlan: ["riskProfile"],
};

const KNOWN_NUMBER_FIELDS = new Set([
  "weeklyAvailabilityHours",
  "avgTicket",
  "monthlyTarget",
  "startupCapital",
  "monthlyFixedCosts",
  "variableCostPercent",
]);

const KNOWN_ARRAY_FIELDS = new Set([
  "skills",
  "valueProps",
  "segments",
  "painPoints",
  "values",
  "demandSignals",
  "coreWorkflows",
  "fulfillmentProcess",
  "salesChannels",
  "pipelineStages",
  "channels",
  "launchPlan",
  "today",
  "sevenDayPlan",
  "thirtyDayPlan",
  "financialRisks",
  "legalRisks",
  "marketRisks",
  "operationalRisks",
  "founderRisks",
  "mitigationPlan",
]);

function getFieldValue(blueprint: BlueprintData | null, field: string): unknown {
  if (!blueprint) return undefined;
  const sources = FIELD_SOURCES[field] || [];
  for (const source of sources) {
    const section = ((blueprint as unknown) as Record<string, unknown>)[source] as
      | Record<string, unknown>
      | undefined;
    if (section && field in section) {
      return section[field];
    }
  }
  return undefined;
}

function valueToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function coerceValue(field: string, raw: string, original: unknown): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;

  if (original !== undefined && original !== null) {
    if (typeof original === "boolean") return trimmed === "true";
    if (typeof original === "number") return Number(trimmed);
    if (Array.isArray(original)) return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (KNOWN_NUMBER_FIELDS.has(field)) return Number(trimmed);
  if (KNOWN_ARRAY_FIELDS.has(field)) return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (field === "hasPartners" || field === "regulatedIndustry") return trimmed === "true";

  return trimmed;
}

function fieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

export function DnaSectionDrawer({ section, onClose, onUpdate }: DnaSectionDrawerProps) {
  const businessId = getStoredBusinessId();
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const fields = SECTION_FIELDS[section.key] || [];

  useEffect(() => {
    if (!businessId) return;
    apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`).then(({ data }) => {
      setBlueprint(data);
      if (data) {
        const initial: Record<string, string> = {};
        for (const field of fields) {
          initial[field] = valueToString(getFieldValue(data, field));
        }
        setForm(initial);
      }
      setLoading(false);
    });
  }, [businessId, section.key, fields]);

  const handleChange = (field: string, raw: string) => {
    setForm((prev) => ({ ...prev, [field]: raw }));
  };

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);

    const data: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = form[field];
      const original = blueprint ? getFieldValue(blueprint, field) : undefined;
      const coerced = coerceValue(field, raw, original);
      if (coerced !== undefined) {
        data[field] = coerced;
      }
    }

    const { error } = await updateDnaSection(businessId, section.key, data);
    setSaving(false);

    if (error) {
      // eslint-disable-next-line no-alert
      alert(`Failed to save: ${error}`);
      return;
    }

    onUpdate();
    onClose();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading current values...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Edit the fields that make up {section.label}. Empty fields will be left unchanged.
      </p>

      {fields.map((field) => {
        const original = blueprint ? getFieldValue(blueprint, field) : undefined;
        const isBoolean = typeof original === "boolean" || field === "hasPartners" || field === "regulatedIndustry";
        const isArray = Array.isArray(original) || KNOWN_ARRAY_FIELDS.has(field);

        return (
          <div key={field} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{fieldLabel(field)}</label>
            {isBoolean ? (
              <select
                value={form[field] || "false"}
                onChange={(e) => handleChange(field, e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : isArray ? (
              <textarea
                value={form[field] || ""}
                onChange={(e) => handleChange(field, e.target.value)}
                rows={2}
                placeholder="Comma-separated values"
                className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
              />
            ) : (
              <input
                type={KNOWN_NUMBER_FIELDS.has(field) ? "number" : "text"}
                value={form[field] || ""}
                onChange={(e) => handleChange(field, e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
              />
            )}
          </div>
        );
      })}

      <div className="pt-4 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
          style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save {section.label}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
