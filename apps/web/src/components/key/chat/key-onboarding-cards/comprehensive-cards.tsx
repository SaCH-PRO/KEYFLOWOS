"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingCardData, OnboardingStep } from "../types";
import { updateBusinessBlueprint } from "@/lib/api/business-blueprint";
import { updateBusinessProfile } from "@/lib/api/business-profile";
import { seedDemoData } from "@/lib/api/onboarding-concierge";
import {
  CardFrame,
  PrimaryButton,
  SecondaryButton,
  FieldLabel,
  TextInput,
  NumberInput,
  TextArea,
  SelectInput,
  ToggleButton,
  useBusinessId,
} from "./shared";

interface ComprehensiveCardProps {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}

const COUNTRIES = ["Trinidad & Tobago", "Jamaica", "Barbados", "Guyana", "Other Caribbean", "United States", "Canada", "United Kingdom", "Other"];
const CURRENCIES = ["TTD", "USD", "EUR", "GBP", "JMD", "BBD", "GYD"];
const ARCHETYPES = ["Maker", "Service Provider", "Retailer", "Consultant", "Creator", "Platform", "Agency", "Freelancer", "Other"];
const REVENUE_MODELS = ["Product sales", "Service fees", "Subscription", "Marketplace", "Licensing", "Advertising", "Hybrid"];
const DELIVERY_MODES = ["In-person", "Online / Digital", "Delivery", "Hybrid"];
const SERVICE_AREAS = ["Local", "National", "Regional", "Global"];
const TEAM_SIZES = ["Solo", "2-5", "6-10", "11-50", "50+"];
const ENTITY_TYPES = ["sole-proprietorship", "partnership", "limited-liability-company", "corporation", "cooperative", "non-profit"];
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"];
const COMPLIANCE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE", "NOT_APPLICABLE"];
const PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "PayPal", "Stripe", "Other"];

function isCardLoading(_card: OnboardingCardData, field: string) {
  return Boolean((_card.data?.loading as Record<string, boolean> | undefined)?.[field]);
}

// ------------------------------------------------------------------
// Profile & Identity
// ------------------------------------------------------------------
export function ProfileIdentityCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const business = (card.data?.business as Record<string, string> | undefined) ?? {};
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(business.name ?? "");
  const [email, setEmail] = useState(business.email ?? "");
  const [phone, setPhone] = useState(business.phone ?? "");
  const [country, setCountry] = useState((blueprint.identity?.country as string) ?? business.country ?? "");
  const [currency, setCurrency] = useState(business.currency ?? "TTD");
  const [industry, setIndustry] = useState((blueprint.identity?.industry as string) ?? business.industry ?? "");
  const [archetype, setArchetype] = useState((blueprint.identity?.archetype as string) ?? business.archetype ?? "");
  const [logoUrl, setLogoUrl] = useState(business.logoUrl ?? "");

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const profilePatch: Parameters<typeof updateBusinessProfile>[1] = { name };
    if (email.trim()) profilePatch.email = email.trim();
    if (phone.trim()) profilePatch.phone = phone.trim();
    if (country) profilePatch.country = country;
    if (currency) profilePatch.currency = currency;
    if (industry.trim()) profilePatch.industry = industry.trim();
    if (logoUrl.trim()) profilePatch.logoUrl = logoUrl.trim();

    const identityPatch: Record<string, string> = { name };
    if (country) identityPatch.country = country;
    if (industry.trim()) identityPatch.industry = industry.trim();
    if (archetype) identityPatch.archetype = archetype;

    const profileRes = await updateBusinessProfile(businessId, profilePatch);
    const blueprintRes = await updateBusinessBlueprint(businessId, {
      identity: identityPatch,
      ...(logoUrl.trim() ? { brand: { logoUrl: logoUrl.trim() } } : {}),
    });
    setLoading(false);
    if (profileRes.error || blueprintRes.error) {
      toast.error(profileRes.error || blueprintRes.error || "Could not save profile.");
      return;
    }
    toast.success("Profile saved");
    onAdvance?.("intake");
  };

  return (
    <CardFrame title={card.title || "Your business profile"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Business name</FieldLabel>
          <TextInput value={name} onChange={setName} placeholder="e.g. Island Glow Skincare" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Email</FieldLabel>
          <TextInput value={email} onChange={setEmail} type="email" placeholder="hello@business.com" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Phone</FieldLabel>
          <TextInput value={phone} onChange={setPhone} placeholder="+1 (868) 555-1234" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Country</FieldLabel>
          <SelectInput value={country} onChange={setCountry} options={COUNTRIES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Currency</FieldLabel>
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Industry</FieldLabel>
          <TextInput value={industry} onChange={setIndustry} placeholder="e.g. Beauty & wellness" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Archetype</FieldLabel>
          <SelectInput value={archetype} onChange={setArchetype} options={ARCHETYPES} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel helper="Optional — a public URL to your logo">Logo URL</FieldLabel>
          <TextInput value={logoUrl} onChange={setLogoUrl} placeholder="https://..." />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={!name.trim()}>
          Save profile
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("intake")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Operating Model
// ------------------------------------------------------------------
export function OperatingModelCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const operatingModel = (blueprint.operatingModel as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [revenueModel, setRevenueModel] = useState((operatingModel.revenueModel as string) ?? "");
  const [deliveryMode, setDeliveryMode] = useState((operatingModel.deliveryMode as string) ?? "");
  const [serviceArea, setServiceArea] = useState((operatingModel.serviceArea as string) ?? "");
  const [teamSize, setTeamSize] = useState((operatingModel.teamSize as string) ?? "");
  const [capacity, setCapacity] = useState((operatingModel.capacity as string) ?? "");
  const [channels, setChannels] = useState(((operatingModel.channels as string[]) ?? []).join(", "));

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const channelList = channels.split(",").map((c) => c.trim()).filter(Boolean);
    const { error } = await updateBusinessBlueprint(businessId, {
      operatingModel: {
        revenueModel,
        deliveryMode,
        serviceArea,
        teamSize,
        capacity,
        channels: channelList,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Operating model saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "How you operate"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel>Revenue model</FieldLabel>
          <SelectInput value={revenueModel} onChange={setRevenueModel} options={REVENUE_MODELS} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Delivery mode</FieldLabel>
          <SelectInput value={deliveryMode} onChange={setDeliveryMode} options={DELIVERY_MODES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Service area</FieldLabel>
          <SelectInput value={serviceArea} onChange={setServiceArea} options={SERVICE_AREAS} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Team size</FieldLabel>
          <SelectInput value={teamSize} onChange={setTeamSize} options={TEAM_SIZES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="e.g. 5 clients/week, 100 units/month">Capacity</FieldLabel>
          <TextInput value={capacity} onChange={setCapacity} placeholder="Describe your capacity" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="Comma-separated channels you sell through">Channels</FieldLabel>
          <TextInput value={channels} onChange={setChannels} placeholder="Instagram, website, WhatsApp, market" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={!revenueModel || !deliveryMode}>
          Save operating model
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Brand & Goals
// ------------------------------------------------------------------
export function BrandGoalsCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const brand = (blueprint.brand as Record<string, unknown>) ?? {};
  const goals = (blueprint.goals as Record<string, unknown>) ?? {};
  const constraints = (blueprint.constraints as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState((brand.voice as string) ?? "");
  const [tone, setTone] = useState((brand.tone as string) ?? "");
  const [valueProps, setValueProps] = useState(((brand.valueProps as string[]) ?? []).join("\n"));
  const [doNotSay, setDoNotSay] = useState(((brand.doNotSay as string[]) ?? []).join("\n"));
  const [northStar, setNorthStar] = useState((goals.northStar as string) ?? "");
  const [ninetyDayGoals, setNinetyDayGoals] = useState(((goals.ninetyDayGoals as string[]) ?? []).join("\n"));
  const [twelveMonthGoals, setTwelveMonthGoals] = useState(((goals.twelveMonthGoals as string[]) ?? []).join("\n"));
  const [budgetRange, setBudgetRange] = useState((constraints.budgetRange as string) ?? "");
  const [timeCommitment, setTimeCommitment] = useState((constraints.timeCommitment as string) ?? "");
  const [riskTolerance, setRiskTolerance] = useState((constraints.riskTolerance as string) ?? "");

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await updateBusinessBlueprint(businessId, {
      brand: {
        voice,
        tone,
        valueProps: valueProps.split("\n").map((s) => s.trim()).filter(Boolean),
        doNotSay: doNotSay.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      goals: {
        northStar,
        ninetyDayGoals: ninetyDayGoals.split("\n").map((s) => s.trim()).filter(Boolean),
        twelveMonthGoals: twelveMonthGoals.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      constraints: { budgetRange, timeCommitment, riskTolerance },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Brand & goals saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "Brand & goals"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel>Brand voice</FieldLabel>
          <SelectInput
            value={voice}
            onChange={setVoice}
            options={["Friendly", "Professional", "Bold", "Playful", "Luxury", "Casual"]}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Tone</FieldLabel>
          <TextInput value={tone} onChange={setTone} placeholder="e.g. Warm but direct" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel helper="One per line">Value propositions</FieldLabel>
          <TextArea value={valueProps} onChange={setValueProps} placeholder="What makes you different?" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel helper="One per line">Do-not-say list</FieldLabel>
          <TextArea value={doNotSay} onChange={setDoNotSay} placeholder="Words or phrases to avoid" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>North-star goal</FieldLabel>
          <TextInput value={northStar} onChange={setNorthStar} placeholder="The one thing success looks like in 12 months" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">90-day goals</FieldLabel>
          <TextArea value={ninetyDayGoals} onChange={setNinetyDayGoals} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">12-month goals</FieldLabel>
          <TextArea value={twelveMonthGoals} onChange={setTwelveMonthGoals} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Budget range</FieldLabel>
          <TextInput value={budgetRange} onChange={setBudgetRange} placeholder="e.g. $5,000 – $10,000 TTD" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Time commitment</FieldLabel>
          <TextInput value={timeCommitment} onChange={setTimeCommitment} placeholder="e.g. 20 hours/week" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Risk tolerance</FieldLabel>
          <ToggleButton
            value={riskTolerance}
            onChange={setRiskTolerance}
            options={[
              { value: "low", label: "Low — play it safe" },
              { value: "medium", label: "Medium — balanced" },
              { value: "high", label: "High — aggressive" },
            ]}
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={!voice || !northStar}>
          Save brand & goals
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Financials
// ------------------------------------------------------------------
export function FinancialsCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const financials = (blueprint.financials as Record<string, unknown>) ?? {};
  const projection = (blueprint.projectionProfile as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState((financials.currency as string) ?? "TTD");
  const [pricingModel, setPricingModel] = useState((financials.pricingModel as string) ?? "");
  const [avgTicket, setAvgTicket] = useState<number | "">((financials.avgTicket as number) ?? "");
  const [monthlyTarget, setMonthlyTarget] = useState<number | "">((financials.monthlyTarget as number) ?? "");
  const [startupCapital, setStartupCapital] = useState<number | "">((projection.startupCapital as number) ?? "");
  const [startupCosts, setStartupCosts] = useState<number | "">((projection.startupCosts as number) ?? "");
  const [monthlyFixedCosts, setMonthlyFixedCosts] = useState<number | "">((projection.monthlyFixedCosts as number) ?? "");
  const [variableCostPercent, setVariableCostPercent] = useState<number | "">((projection.variableCostPercent as number) ?? "");

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await updateBusinessBlueprint(businessId, {
      financials: {
        currency,
        pricingModel,
        avgTicket: avgTicket === "" ? undefined : avgTicket,
        monthlyTarget: monthlyTarget === "" ? undefined : monthlyTarget,
      },
      projectionProfile: {
        startupCapital: startupCapital === "" ? undefined : startupCapital,
        startupCosts: startupCosts === "" ? undefined : startupCosts,
        monthlyFixedCosts: monthlyFixedCosts === "" ? undefined : monthlyFixedCosts,
        variableCostPercent: variableCostPercent === "" ? undefined : variableCostPercent,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Financial plan saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "Financial plan"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel>Currency</FieldLabel>
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Pricing model</FieldLabel>
          <SelectInput
            value={pricingModel}
            onChange={setPricingModel}
            options={["One-time purchase", "Subscription", "Hourly rate", "Project-based", "Freemium", "Hybrid"]}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="Average sale value">Average ticket</FieldLabel>
          <NumberInput value={avgTicket} onChange={setAvgTicket} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="Monthly revenue target">Monthly target</FieldLabel>
          <NumberInput value={monthlyTarget} onChange={setMonthlyTarget} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Startup capital</FieldLabel>
          <NumberInput value={startupCapital} onChange={setStartupCapital} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Startup costs</FieldLabel>
          <NumberInput value={startupCosts} onChange={setStartupCosts} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Monthly fixed costs</FieldLabel>
          <NumberInput value={monthlyFixedCosts} onChange={setMonthlyFixedCosts} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="0–100">Variable cost %</FieldLabel>
          <NumberInput value={variableCostPercent} onChange={setVariableCostPercent} placeholder="0" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={avgTicket === "" || monthlyFixedCosts === ""}>
          Save financials
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Ownership & Legal
// ------------------------------------------------------------------
function OwnerRow({ owner, onChange, onRemove }: { owner: Record<string, string>; onChange: (o: Record<string, string>) => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <TextInput value={owner.name ?? ""} onChange={(v) => onChange({ ...owner, name: v })} placeholder="Name" />
      <TextInput value={owner.role ?? ""} onChange={(v) => onChange({ ...owner, role: v })} placeholder="Role" />
      <TextInput value={owner.share ?? ""} onChange={(v) => onChange({ ...owner, share: v })} placeholder="Share %" />
      <button type="button" onClick={onRemove} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function OwnershipLegalCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const legalProfile = (blueprint.legalProfile as Record<string, unknown>) ?? {};
  const ownershipProfile = (blueprint.ownershipProfile as Record<string, unknown>) ?? {};
  const registrationProfile = (blueprint.registrationProfile as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [entityType, setEntityType] = useState((legalProfile.recommendedEntityType as string) ?? "");
  const [hasPartners, setHasPartners] = useState<boolean>((ownershipProfile.hasPartners as boolean) ?? false);
  const [owners, setOwners] = useState<Record<string, string>[]>(
    (ownershipProfile.owners as Record<string, string>[]) ?? []
  );
  const [country, setCountry] = useState((legalProfile.country as string) ?? "");
  const [companiesRegistry, setCompaniesRegistry] = useState((registrationProfile.companiesRegistryStatus as string) ?? "NOT_STARTED");
  const [birStatus, setBirStatus] = useState((registrationProfile.birStatus as string) ?? "NOT_STARTED");
  const [vatStatus, setVatStatus] = useState((registrationProfile.vatStatus as string) ?? "NOT_STARTED");
  const [bankStatus, setBankStatus] = useState((registrationProfile.businessBankStatus as string) ?? "NOT_STARTED");

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await updateBusinessBlueprint(businessId, {
      legalProfile: { country, recommendedEntityType: entityType },
      ownershipProfile: { hasPartners, owners: hasPartners ? owners : [] },
      registrationProfile: {
        companiesRegistryStatus: companiesRegistry,
        birStatus,
        vatStatus,
        businessBankStatus: bankStatus,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Ownership & legal saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "Ownership & legal"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel>Recommended entity type</FieldLabel>
          <SelectInput
            value={entityType}
            onChange={setEntityType}
            options={ENTITY_TYPES.map((v) => ({ value: v, label: v.replace(/-/g, " ") }))}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Country of registration</FieldLabel>
          <SelectInput value={country} onChange={setCountry} options={COUNTRIES} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Do you have partners / co-founders?</FieldLabel>
          <ToggleButton
            value={hasPartners}
            onChange={setHasPartners}
            options={[
              { value: true, label: "Yes" },
              { value: false, label: "No — solo founder" },
            ]}
          />
        </div>
        {hasPartners && (
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <FieldLabel>Owners</FieldLabel>
              <button
                type="button"
                onClick={() => setOwners((prev) => [...prev, { name: "", role: "", share: "" }])}
                className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]"
              >
                <Plus className="h-3 w-3" /> Add owner
              </button>
            </div>
            <div className="space-y-2">
              {owners.map((owner, i) => (
                <OwnerRow
                  key={i}
                  owner={owner}
                  onChange={(o) => setOwners((prev) => prev.map((p, idx) => (idx === i ? o : p)))}
                  onRemove={() => setOwners((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <FieldLabel>Companies registry</FieldLabel>
          <SelectInput value={companiesRegistry} onChange={setCompaniesRegistry} options={COMPLIANCE_STATUSES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>BIR / tax ID</FieldLabel>
          <SelectInput value={birStatus} onChange={setBirStatus} options={COMPLIANCE_STATUSES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>VAT registration</FieldLabel>
          <SelectInput value={vatStatus} onChange={setVatStatus} options={COMPLIANCE_STATUSES} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Business bank account</FieldLabel>
          <SelectInput value={bankStatus} onChange={setBankStatus} options={COMPLIANCE_STATUSES} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={!entityType}>
          Save ownership & legal
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Operations
// ------------------------------------------------------------------
function WorkflowRow({ step, onChange, onRemove }: { step: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border/60 bg-background p-3 sm:grid-cols-4">
      <TextInput value={(step.name as string) ?? ""} onChange={(v) => onChange({ ...step, name: v })} placeholder="Step name" />
      <TextInput value={(step.owner as string) ?? ""} onChange={(v) => onChange({ ...step, owner: v })} placeholder="Owner" />
      <TextInput value={((step.tools as string[]) ?? []).join(", ")} onChange={(v) => onChange({ ...step, tools: v.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Tools" />
      <div className="flex items-center gap-2">
        <NumberInput value={(step.durationMin as number) ?? ""} onChange={(v) => onChange({ ...step, durationMin: v })} placeholder="Mins" />
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function OperationsCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const operationsSystem = (blueprint.operationsSystem as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<Record<string, unknown>[]>(
    (operationsSystem.coreWorkflows as Record<string, unknown>[]) ?? [{ name: "", owner: "", tools: [], durationMin: "" }]
  );
  const [dailyChecklist, setDailyChecklist] = useState(((operationsSystem.dailyChecklist as string[]) ?? []).join("\n"));
  const [weeklyChecklist, setWeeklyChecklist] = useState(((operationsSystem.weeklyChecklist as string[]) ?? []).join("\n"));

  const cleanWorkflows = () =>
    workflows
      .filter((s) => (s.name as string)?.trim())
      .map((s) => ({
        name: s.name,
        owner: s.owner,
        tools: s.tools,
        durationMin: s.durationMin === "" ? undefined : s.durationMin,
      }));

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await updateBusinessBlueprint(businessId, {
      operationsSystem: {
        coreWorkflows: cleanWorkflows(),
        dailyChecklist: dailyChecklist.split("\n").map((s) => s.trim()).filter(Boolean),
        weeklyChecklist: weeklyChecklist.split("\n").map((s) => s.trim()).filter(Boolean),
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Operations saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "Operations"}>
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <FieldLabel helper="Core workflows you run to deliver value">Workflows</FieldLabel>
            <button
              type="button"
              onClick={() => setWorkflows((prev) => [...prev, { name: "", owner: "", tools: [], durationMin: "" }])}
              className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]"
            >
              <Plus className="h-3 w-3" /> Add step
            </button>
          </div>
          <div className="space-y-2">
            {workflows.map((step, i) => (
              <WorkflowRow
                key={i}
                step={step}
                onChange={(s) => setWorkflows((prev) => prev.map((p, idx) => (idx === i ? s : p)))}
                onRemove={() => setWorkflows((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel helper="One per line">Daily checklist</FieldLabel>
            <TextArea value={dailyChecklist} onChange={setDailyChecklist} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel helper="One per line">Weekly checklist</FieldLabel>
            <TextArea value={weeklyChecklist} onChange={setWeeklyChecklist} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={cleanWorkflows().length === 0}>
          Save operations
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Market Strategy
// ------------------------------------------------------------------
export function MarketStrategyCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const customerModel = (blueprint.customerModel as Record<string, unknown>) ?? {};
  const marketProfile = (blueprint.marketProfile as Record<string, unknown>) ?? {};
  const offerArchitecture = (blueprint.offerArchitecture as Record<string, unknown>) ?? {};
  const marketingSystem = (blueprint.marketingSystem as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [idealCustomer, setIdealCustomer] = useState((customerModel.idealCustomer as string) ?? "");
  const [segments, setSegments] = useState(((customerModel.segments as string[]) ?? []).join("\n"));
  const [painPoints, setPainPoints] = useState(((customerModel.painPoints as string[]) ?? []).join("\n"));
  const [targetGeography, setTargetGeography] = useState((marketProfile.targetGeography as string) ?? "");
  const [marketCategory, setMarketCategory] = useState((marketProfile.marketCategory as string) ?? "");
  const [marketStage, setMarketStage] = useState((marketProfile.marketStage as string) ?? "");
  const [trends, setTrends] = useState(((marketProfile.trends as string[]) ?? []).join("\n"));
  const [barriers, setBarriers] = useState(((marketProfile.barriersToEntry as string[]) ?? []).join("\n"));
  const [coreOfferName, setCoreOfferName] = useState(((offerArchitecture.coreOffer as Record<string, unknown>)?.name as string) ?? "");
  const [coreOfferDescription, setCoreOfferDescription] = useState(((offerArchitecture.coreOffer as Record<string, unknown>)?.description as string) ?? "");
  const [coreOfferPrice, setCoreOfferPrice] = useState<number | "">(((offerArchitecture.coreOffer as Record<string, unknown>)?.price as number) ?? "");
  const [coreOfferRecurring, setCoreOfferRecurring] = useState<boolean>(((offerArchitecture.coreOffer as Record<string, unknown>)?.recurring as boolean) ?? false);
  const [offerLadder, setOfferLadder] = useState(((offerArchitecture.offerLadder as Record<string, unknown>[]) ?? []).map((o) => `${o.name} (${o.price})`).join("\n"));
  const [channels, setChannels] = useState(((marketingSystem.channels as Record<string, unknown>[]) ?? []).map((c) => c.channel).join(", "));
  const [launchPlan, setLaunchPlan] = useState(((marketingSystem.launchPlan as string[]) ?? []).join("\n"));

  const parseOfferLadder = (): Record<string, unknown>[] => {
    return offerLadder
      .split("\n")
      .map((line) => {
        const match = line.match(/^(.+?)\s*\((\d+)\)\s*$/);
        if (!match) return { name: line.trim(), price: 0 };
        return { name: match[1].trim(), price: Number(match[2]) };
      })
      .filter((o) => o.name);
  };

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const channelList = channels.split(",").map((c) => c.trim()).filter(Boolean).map((channel) => ({ channel, purpose: "", priority: "MEDIUM" }));
    const { error } = await updateBusinessBlueprint(businessId, {
      customerModel: {
        idealCustomer,
        segments: segments.split("\n").map((s) => s.trim()).filter(Boolean),
        painPoints: painPoints.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      marketProfile: {
        targetGeography,
        marketCategory,
        marketStage,
        trends: trends.split("\n").map((s) => s.trim()).filter(Boolean),
        barriersToEntry: barriers.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      offerArchitecture: {
        coreOffer: {
          name: coreOfferName,
          description: coreOfferDescription,
          price: coreOfferPrice === "" ? undefined : coreOfferPrice,
          recurring: coreOfferRecurring,
        },
        offerLadder: parseOfferLadder(),
      },
      marketingSystem: { channels: channelList, launchPlan: launchPlan.split("\n").map((s) => s.trim()).filter(Boolean) },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Market strategy saved");
    onAdvance?.("genesis");
  };

  return (
    <CardFrame title={card.title || "Market strategy"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Ideal customer</FieldLabel>
          <TextInput value={idealCustomer} onChange={setIdealCustomer} placeholder="Who do you serve? Be specific." />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">Customer segments</FieldLabel>
          <TextArea value={segments} onChange={setSegments} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">Pain points</FieldLabel>
          <TextArea value={painPoints} onChange={setPainPoints} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Target geography</FieldLabel>
          <TextInput value={targetGeography} onChange={setTargetGeography} placeholder="e.g. Trinidad & Tobago" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Market category</FieldLabel>
          <TextInput value={marketCategory} onChange={setMarketCategory} placeholder="e.g. Skincare" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Market stage</FieldLabel>
          <SelectInput value={marketStage} onChange={setMarketStage} options={["New", "Growing", "Mature", "Declining"]} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">Trends</FieldLabel>
          <TextArea value={trends} onChange={setTrends} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel helper="One per line">Barriers to entry</FieldLabel>
          <TextArea value={barriers} onChange={setBarriers} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Core offer</FieldLabel>
          <div className="grid gap-2 sm:grid-cols-4">
            <TextInput value={coreOfferName} onChange={setCoreOfferName} placeholder="Offer name" />
            <TextInput value={coreOfferDescription} onChange={setCoreOfferDescription} placeholder="Description" />
            <NumberInput value={coreOfferPrice} onChange={setCoreOfferPrice} placeholder="Price" />
            <ToggleButton
              value={coreOfferRecurring}
              onChange={setCoreOfferRecurring}
              options={[
                { value: true, label: "Recurring" },
                { value: false, label: "One-time" },
              ]}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line: Name (price)">Offer ladder</FieldLabel>
          <TextArea value={offerLadder} onChange={setOfferLadder} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="Comma-separated">Marketing channels</FieldLabel>
          <TextInput value={channels} onChange={setChannels} placeholder="Instagram, TikTok, email, events" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel helper="One per line">Launch plan</FieldLabel>
          <TextArea value={launchPlan} onChange={setLaunchPlan} />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading} disabled={!idealCustomer || !targetGeography || !coreOfferName}>
          Save market strategy
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Payments, Storefront & Contacts
// ------------------------------------------------------------------
export function PaymentsStorefrontContactsCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const setupStatus = (card.data?.setupStatus as Record<string, boolean> | undefined) ?? {};
  const business = (card.data?.business as Record<string, unknown> | undefined) ?? {};
  const meta = (business.metaData as Record<string, unknown> | undefined) ?? {};
  const [loading, setLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    Array.isArray(meta.paymentMethods) ? (meta.paymentMethods as string[]) : []
  );
  const [storefrontSlug, setStorefrontSlug] = useState((business.slug as string) ?? "");
  const [storeEnabled, setStoreEnabled] = useState((business.storeEnabled as boolean) ?? false);

  const togglePayment = (method: string) => {
    setPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const profilePatch: Parameters<typeof updateBusinessProfile>[1] = {
      storeEnabled,
      metaData: { ...meta, paymentMethods, paymentMethodsConfigured: paymentMethods.length > 0 },
    };
    if (storefrontSlug.trim()) profilePatch.slug = storefrontSlug.trim();

    const profileRes = await updateBusinessProfile(businessId, profilePatch);
    setLoading(false);
    if (profileRes.error) {
      toast.error(profileRes.error);
      return;
    }
    toast.success("Payments & storefront saved");
    onAdvance?.("configure");
  };

  const handleSeedContact = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await seedDemoData(businessId);
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Sample contact added");
  };

  return (
    <CardFrame title={card.title || "Payments, storefront & contacts"}>
      <div className="space-y-4">
        <div className="space-y-2">
          <FieldLabel>Payment methods you accept</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => togglePayment(method)}
                className={cn(
                  "rounded-xl border px-3 py-1.5 text-sm transition-colors",
                  paymentMethods.includes(method)
                    ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.1)] text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {method}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel>Storefront slug</FieldLabel>
            <TextInput value={storefrontSlug} onChange={setStorefrontSlug} placeholder="your-business" />
          </div>
          <div className="space-y-1.5">
            <FieldLabel>Online store</FieldLabel>
            <ToggleButton
              value={storeEnabled}
              onChange={setStoreEnabled}
              options={[
                { value: true, label: "Enabled" },
                { value: false, label: "Disabled" },
              ]}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background p-3">
          <p className="text-sm font-medium">Customer contacts</p>
          <p className="text-xs text-muted-foreground">
            {setupStatus.contacts
              ? "You have at least one contact."
              : "No contacts yet. You can add them later in the CRM or seed a sample contact now."}
          </p>
          {!setupStatus.contacts && (
            <div className="mt-2">
              <SecondaryButton onClick={handleSeedContact}>Seed sample contact</SecondaryButton>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <PrimaryButton onClick={handleSave} loading={loading}>
          Save payments & storefront
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("configure")}>Skip</SecondaryButton>
        <SecondaryButton onClick={() => onAdvance?.("template")}>Back</SecondaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Risk, Compliance & Roadmap
// ------------------------------------------------------------------
function RiskGroup({ title, items, onChange }: { title: string; items: Record<string, unknown>[]; onChange: (items: Record<string, unknown>[]) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel>{title}</FieldLabel>
        <button
          type="button"
          onClick={() => onChange([...items, { description: "", likelihood: "MEDIUM" }])}
          className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <TextInput
              value={(item.description as string) ?? ""}
              onChange={(v) => onChange(items.map((it, idx) => (idx === i ? { ...it, description: v } : it)))}
              placeholder="Risk description"
            />
            <SelectInput
              value={(item.likelihood as string) ?? "MEDIUM"}
              onChange={(v) => onChange(items.map((it, idx) => (idx === i ? { ...it, likelihood: v } : it)))}
              options={RISK_LEVELS}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComplianceGroup({ items, onChange }: { items: Record<string, unknown>[]; onChange: (items: Record<string, unknown>[]) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Compliance checklist</FieldLabel>
        <button
          type="button"
          onClick={() => onChange([...items, { title: "", status: "NOT_STARTED", priority: "MEDIUM" }])}
          className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <TextInput
              value={(item.title as string) ?? ""}
              onChange={(v) => onChange(items.map((it, idx) => (idx === i ? { ...it, title: v } : it)))}
              placeholder="Compliance item"
            />
            <SelectInput
              value={(item.status as string) ?? "NOT_STARTED"}
              onChange={(v) => onChange(items.map((it, idx) => (idx === i ? { ...it, status: v } : it)))}
              options={COMPLIANCE_STATUSES}
            />
            <SelectInput
              value={(item.priority as string) ?? "MEDIUM"}
              onChange={(v) => onChange(items.map((it, idx) => (idx === i ? { ...it, priority: v } : it)))}
              options={["LOW", "MEDIUM", "HIGH", "CRITICAL"]}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RiskComplianceRoadmapCard({ card, onAdvance }: ComprehensiveCardProps) {
  const businessId = useBusinessId();
  const blueprint = (card.data?.blueprintCtx as Record<string, Record<string, unknown>> | undefined) ?? {};
  const riskProfile = (blueprint.riskProfile as Record<string, unknown>) ?? {};
  const complianceProfile = (blueprint.complianceProfile as Record<string, unknown>) ?? {};
  const executionRoadmap = (blueprint.executionRoadmap as Record<string, unknown>) ?? {};
  const [loading, setLoading] = useState(false);
  const [financialRisks, setFinancialRisks] = useState<Record<string, unknown>[]>((riskProfile.financialRisks as Record<string, unknown>[]) ?? []);
  const [legalRisks, setLegalRisks] = useState<Record<string, unknown>[]>((riskProfile.legalRisks as Record<string, unknown>[]) ?? []);
  const [marketRisks, setMarketRisks] = useState<Record<string, unknown>[]>((riskProfile.marketRisks as Record<string, unknown>[]) ?? []);
  const [operationalRisks, setOperationalRisks] = useState<Record<string, unknown>[]>((riskProfile.operationalRisks as Record<string, unknown>[]) ?? []);
  const [founderRisks, setFounderRisks] = useState<Record<string, unknown>[]>((riskProfile.founderRisks as Record<string, unknown>[]) ?? []);
  const [mitigationPlan, setMitigationPlan] = useState(((riskProfile.mitigationPlan as string[]) ?? []).join("\n"));
  const [complianceItems, setComplianceItems] = useState<Record<string, unknown>[]>((complianceProfile.complianceItems as Record<string, unknown>[]) ?? []);
  const [today, setToday] = useState(((executionRoadmap.today as string[]) ?? []).join("\n"));
  const [sevenDayPlan, setSevenDayPlan] = useState(((executionRoadmap.sevenDayPlan as string[]) ?? []).join("\n"));
  const [thirtyDayPlan, setThirtyDayPlan] = useState(((executionRoadmap.thirtyDayPlan as string[]) ?? []).join("\n"));

  const handleSave = async () => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await updateBusinessBlueprint(businessId, {
      riskProfile: {
        financialRisks,
        legalRisks,
        marketRisks,
        operationalRisks,
        founderRisks,
        mitigationPlan: mitigationPlan.split("\n").map((s) => s.trim()).filter(Boolean),
      },
      complianceProfile: { complianceItems },
      executionRoadmap: {
        today: today.split("\n").map((s) => s.trim()).filter(Boolean),
        sevenDayPlan: sevenDayPlan.split("\n").map((s) => s.trim()).filter(Boolean),
        thirtyDayPlan: thirtyDayPlan.split("\n").map((s) => s.trim()).filter(Boolean),
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Risk, compliance & roadmap saved");
    onAdvance?.("genome");
  };

  return (
    <CardFrame title={card.title || "Risk, compliance & roadmap"}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <RiskGroup title="Financial risks" items={financialRisks} onChange={setFinancialRisks} />
          <RiskGroup title="Legal risks" items={legalRisks} onChange={setLegalRisks} />
          <RiskGroup title="Market risks" items={marketRisks} onChange={setMarketRisks} />
          <RiskGroup title="Operational risks" items={operationalRisks} onChange={setOperationalRisks} />
          <RiskGroup title="Founder risks" items={founderRisks} onChange={setFounderRisks} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel helper="One per line">Mitigation plan</FieldLabel>
          <TextArea value={mitigationPlan} onChange={setMitigationPlan} />
        </div>
        <ComplianceGroup items={complianceItems} onChange={setComplianceItems} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <FieldLabel helper="One per line">Today</FieldLabel>
            <TextArea value={today} onChange={setToday} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel helper="One per line">Next 7 days</FieldLabel>
            <TextArea value={sevenDayPlan} onChange={setSevenDayPlan} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel helper="One per line">Next 30 days</FieldLabel>
            <TextArea value={thirtyDayPlan} onChange={setThirtyDayPlan} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={handleSave} loading={loading}>
          Save risk & roadmap
        </PrimaryButton>
        <SecondaryButton onClick={() => onAdvance?.("genome")}>Skip</SecondaryButton>
      </div>
    </CardFrame>
  );
}
