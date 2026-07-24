"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Circle, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingCardData, OnboardingStep } from "./types";
import { useKeyChatActions } from "./use-key-chat-actions";
import { GenomeChatStep } from "@/app/app/onboarding/components/genome-chat-step";
import {
  analyzeIdea,
  submitAnswers as submitGenesisAnswers,
  getReadiness,
  generateRoadmap,
} from "@/lib/api/business-genesis";
import type {
  GenesisIdeaAnalysis,
  GenesisQuestion,
  GenesisReadinessScore,
  GenesisActionPlan,
} from "@/lib/blueprint-types";
import {
  fetchConciergeTemplates,
  fetchConciergeTemplatePreview,
  autoConfigureFromTemplate,
  markOnboardingComplete,
} from "@/lib/api/onboarding-concierge";
import type { ConciergeTemplate, TemplatePreview, OnboardingState } from "@/lib/api/onboarding-concierge";
import {
  CardFrame,
  PrimaryButton,
  SecondaryButton,
  useBusinessId,
} from "./key-onboarding-cards/shared";
import {
  ProfileIdentityCard,
  OperatingModelCard,
  BrandGoalsCard,
  FinancialsCard,
  OwnershipLegalCard,
  OperationsCard,
  MarketStrategyCard,
  PaymentsStorefrontContactsCard,
  RiskComplianceRoadmapCard,
} from "./key-onboarding-cards/comprehensive-cards";

interface KeyOnboardingCardProps {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}

const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "intake",
  "template",
  "configure",
  "complete",
];

function getPreviousStep(step: OnboardingStep): OnboardingStep | null {
  const idx = ONBOARDING_STEP_ORDER.indexOf(step);
  return idx > 0 ? ONBOARDING_STEP_ORDER[idx - 1] : null;
}

function BackButton({
  step,
  onAdvance,
}: {
  step: OnboardingStep;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const prev = getPreviousStep(step);
  if (!prev || !onAdvance) return null;
  return (
    <SecondaryButton onClick={() => onAdvance(prev)}>
      Back
    </SecondaryButton>
  );
}

export function KeyOnboardingCard({ card, onAdvance }: KeyOnboardingCardProps) {
  switch (card.type) {
    case "welcome":
      return <WelcomeCard card={card} onAdvance={onAdvance} />;
    case "genesis-idea":
      return <GenesisIdeaCard card={card} onAdvance={onAdvance} />;
    case "genesis-questions":
      return <GenesisQuestionsCard card={card} onAdvance={onAdvance} />;
    case "readiness-dashboard":
      return <ReadinessDashboardCard card={card} onAdvance={onAdvance} />;
    case "template-picker":
      return <TemplatePickerCard card={card} onAdvance={onAdvance} />;
    case "genome-check":
      return <GenomeCheckCard card={card} onAdvance={onAdvance} />;
    case "completion-gate":
      return <CompletionGateCard card={card} onAdvance={onAdvance} />;
    case "profile-identity":
      return <ProfileIdentityCard card={card} onAdvance={onAdvance} />;
    case "operating-model":
      return <OperatingModelCard card={card} onAdvance={onAdvance} />;
    case "brand-goals":
      return <BrandGoalsCard card={card} onAdvance={onAdvance} />;
    case "financials":
      return <FinancialsCard card={card} onAdvance={onAdvance} />;
    case "ownership-legal":
      return <OwnershipLegalCard card={card} onAdvance={onAdvance} />;
    case "operations":
      return <OperationsCard card={card} onAdvance={onAdvance} />;
    case "market-strategy":
      return <MarketStrategyCard card={card} onAdvance={onAdvance} />;
    case "payments-storefront-contacts":
      return <PaymentsStorefrontContactsCard card={card} onAdvance={onAdvance} />;
    case "risk-compliance-roadmap":
      return <RiskComplianceRoadmapCard card={card} onAdvance={onAdvance} />;
    default:
      return null;
  }
}

// ------------------------------------------------------------------
// Welcome
// ------------------------------------------------------------------
function WelcomeCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  return (
    <CardFrame title={card.title || "Welcome to KeyFlowOS"}>
      <p className="text-sm text-muted-foreground">
        I&apos;m KEY, your AI co-founder. I&apos;ll ask a few questions, set up your account, and
        have you ready to operate in minutes.
      </p>
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={() => onAdvance?.("intake")}>
          Start talking to KEY
          <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Genesis Idea
// ------------------------------------------------------------------
function GenesisIdeaCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const businessId = useBusinessId();
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<GenesisIdeaAnalysis | null>(
    (card.data?.analysis as GenesisIdeaAnalysis) ?? null
  );

  const handleAnalyze = async () => {
    if (!businessId || !idea.trim()) return;
    setLoading(true);
    const { data, error } = await analyzeIdea(businessId, idea.trim());
    setLoading(false);
    if (error || !data) {
      toast.error(error || "Could not analyze your idea. You can fill the details manually.");
      return;
    }
    setAnalysis(data);
  };

  const startManual = () => {
    if (!idea.trim()) return;
    setAnalysis({
      summary: idea.trim(),
      extracted: {
        identity: {
          oneLiner: idea.trim(),
        },
      },
      readiness: { overall: 0, legal: 0, finance: 0, market: 0, operations: 0, compliance: 0, blockers: [] },
      suggestedEntityType: "UNKNOWN",
      nextQuestions: [],
    });
  };

  const handleConfirm = async (answers: Record<string, unknown>) => {
    if (!businessId) return;
    setLoading(true);
    const { error } = await submitGenesisAnswers(businessId, answers);
    setLoading(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Business idea saved");
    onAdvance?.("template");
  };

  return (
    <CardFrame title={card.title || "Tell me about your business idea"}>
      {!analysis ? (
        <div className="space-y-3">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="What does your business do? Who do you serve? How do you make money?"
            className="min-h-[100px] w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            <PrimaryButton onClick={handleAnalyze} loading={loading} disabled={!idea.trim()}>
              Analyze idea
            </PrimaryButton>
            <SecondaryButton onClick={startManual} disabled={!idea.trim()}>
              Fill details manually
            </SecondaryButton>
            <BackButton step="intake" onAdvance={onAdvance} />
          </div>
        </div>
      ) : (
        <GenesisIdeaPreview
          analysis={analysis}
          initialIdea={idea}
          onBack={() => setAnalysis(null)}
          onConfirm={handleConfirm}
          onAdvance={onAdvance}
          loading={loading}
        />
      )}
    </CardFrame>
  );
}

function GenesisIdeaPreview({
  analysis,
  initialIdea,
  onBack,
  onConfirm,
  onAdvance,
  loading,
}: {
  analysis: GenesisIdeaAnalysis;
  initialIdea: string;
  onBack: () => void;
  onConfirm: (answers: Record<string, unknown>) => Promise<void>;
  onAdvance?: (step: OnboardingStep) => void;
  loading: boolean;
}) {
  const extracted = analysis.extracted ?? {};
  const identity = extracted.identity ?? {};
  const founder = extracted.founderProfile ?? {};
  const goals = extracted.goals ?? {};
  const constraints = extracted.constraints ?? {};
  const market = extracted.marketProfile ?? {};
  const operating = extracted.operatingModel ?? {};
  const customer = extracted.customerModel ?? {};
  const financials = extracted.financials ?? {};

  const [fields, setFields] = useState<Record<string, string>>(() => ({
    businessName: stringify(identity.name),
    businessIntent: stringify(identity.oneLiner) || initialIdea,
    archetype: stringify(identity.archetype),
    industry: stringify(identity.industry),
    country: stringify(identity.country),
    currency: stringify(financials.currency) || "USD",
    revenueModel: stringify(operating.revenueModel),
    deliveryMode: stringify(operating.deliveryMode),
    idealCustomer: stringify(customer.idealCustomer),
    segments: arrayStringify(customer.segments),
    painPoints: arrayStringify(customer.painPoints),
    targetGeography: stringify(market.targetGeography),
    marketCategory: stringify(market.marketCategory),
    marketStage: stringify(market.marketStage),
    northStar: stringify(goals.northStar),
    budgetRange: stringify(constraints.budgetRange),
    timeCommitment: stringify(constraints.timeCommitment),
    riskTolerance: stringify(constraints.riskTolerance),
    founderName: stringify(founder.founderName),
    weeklyAvailabilityHours: numberStringify(founder.weeklyAvailabilityHours),
    avgTicket: numberStringify(financials.avgTicket),
    pricingModel: stringify(financials.pricingModel),
  }));

  const update = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    const answers: Record<string, unknown> = {
      businessName: fields.businessName.trim() || undefined,
      businessIntent: fields.businessIntent.trim() || undefined,
      archetype: fields.archetype.trim() || undefined,
      industry: fields.industry.trim() || undefined,
      country: fields.country.trim() || undefined,
      currency: fields.currency.trim() || undefined,
      revenueModel: fields.revenueModel.trim() || undefined,
      deliveryMode: fields.deliveryMode.trim() || undefined,
      idealCustomer: fields.idealCustomer.trim() || undefined,
      segments: splitArray(fields.segments),
      painPoints: splitArray(fields.painPoints),
      targetGeography: fields.targetGeography.trim() || undefined,
      marketCategory: fields.marketCategory.trim() || undefined,
      marketStage: fields.marketStage.trim() || undefined,
      northStar: fields.northStar.trim() || undefined,
      budgetRange: fields.budgetRange.trim() || undefined,
      timeCommitment: fields.timeCommitment.trim() || undefined,
      riskTolerance: fields.riskTolerance.trim() || undefined,
      founderName: fields.founderName.trim() || undefined,
      weeklyAvailabilityHours: numeric(fields.weeklyAvailabilityHours),
      avgTicket: numeric(fields.avgTicket),
      pricingModel: fields.pricingModel.trim() || undefined,
    };

    // Drop undefined values so the server DTO / patch ignores them.
    Object.keys(answers).forEach((k) => {
      if (answers[k] === undefined) delete answers[k];
    });

    void onConfirm(answers);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Summary</p>
        <p className="text-sm text-muted-foreground">{analysis.summary}</p>
      </div>
      {analysis.suggestedEntityType && analysis.suggestedEntityType !== "UNKNOWN" && (
        <p className="text-sm">
          <span className="font-medium">Suggested entity:</span>{" "}
          {String(analysis.suggestedEntityType)}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Review and edit the details below. KEY uses them to build your blueprint and choose a
        concierge template.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Business name" value={fields.businessName} onChange={(v) => update("businessName", v)} />
        <Field label="Country" value={fields.country} onChange={(v) => update("country", v)} />
        <Field label="Industry" value={fields.industry} onChange={(v) => update("industry", v)} />
        <Field label="Archetype" value={fields.archetype} onChange={(v) => update("archetype", v)} />
        <Field label="Currency" value={fields.currency} onChange={(v) => update("currency", v)} />
        <Field label="Revenue model" value={fields.revenueModel} onChange={(v) => update("revenueModel", v)} />
        <Field label="Delivery mode" value={fields.deliveryMode} onChange={(v) => update("deliveryMode", v)} />
        <Field label="Target geography" value={fields.targetGeography} onChange={(v) => update("targetGeography", v)} />
        <Field label="Market category" value={fields.marketCategory} onChange={(v) => update("marketCategory", v)} />
        <Field label="Market stage" value={fields.marketStage} onChange={(v) => update("marketStage", v)} />
        <Field label="Budget range" value={fields.budgetRange} onChange={(v) => update("budgetRange", v)} />
        <Field label="Time commitment" value={fields.timeCommitment} onChange={(v) => update("timeCommitment", v)} />
        <Field label="Risk tolerance" value={fields.riskTolerance} onChange={(v) => update("riskTolerance", v)} />
        <Field label="Founder name" value={fields.founderName} onChange={(v) => update("founderName", v)} />
        <Field label="Weekly availability (hrs)" value={fields.weeklyAvailabilityHours} onChange={(v) => update("weeklyAvailabilityHours", v)} inputMode="numeric" />
        <Field label="Average ticket / price" value={fields.avgTicket} onChange={(v) => update("avgTicket", v)} inputMode="numeric" />
        <Field label="Pricing model" value={fields.pricingModel} onChange={(v) => update("pricingModel", v)} />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Field label="North star goal" value={fields.northStar} onChange={(v) => update("northStar", v)} />
        <Field label="Ideal customer" value={fields.idealCustomer} onChange={(v) => update("idealCustomer", v)} />
        <Field
          label="Customer segments (comma separated)"
          value={fields.segments}
          onChange={(v) => update("segments", v)}
        />
        <Field
          label="Pain points (comma separated)"
          value={fields.painPoints}
          onChange={(v) => update("painPoints", v)}
        />
        <Field
          label="What you’re building"
          value={fields.businessIntent}
          onChange={(v) => update("businessIntent", v)}
          textarea
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <PrimaryButton onClick={handleSubmit} loading={loading}>
          Looks right, save it
        </PrimaryButton>
        <SecondaryButton onClick={onBack}>Edit idea</SecondaryButton>
        <BackButton step="intake" onAdvance={onAdvance} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const className =
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className={cn(className, "min-h-[60px]")} />
      ) : (
        <input
          type={inputMode === "numeric" ? "number" : "text"}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={className}
        />
      )}
    </label>
  );
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function arrayStringify(value: unknown): string {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
  return "";
}

function numberStringify(value: unknown): string {
  if (typeof value === "number") return String(value);
  return "";
}

function splitArray(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numeric(raw: string): number | undefined {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// ------------------------------------------------------------------
// Genesis Questions
// ------------------------------------------------------------------
function GenesisQuestionsCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const businessId = useBusinessId();
  const initialQuestions = useMemo<GenesisQuestion[]>(() => {
    return Array.isArray(card.data?.questions) ? (card.data?.questions as GenesisQuestion[]) : [];
  }, [card.data]);
  const [questions, setQuestions] = useState<GenesisQuestion[]>(initialQuestions);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuestions.length > 0 || !businessId) return;
    let mounted = true;
    import("@/lib/api/business-genesis").then(({ getNextQuestions }) => {
      void getNextQuestions(businessId, 3).then(({ data }) => {
        if (mounted && data) setQuestions(data);
      });
    });
    return () => {
      mounted = false;
    };
  }, [businessId, initialQuestions.length]);

  const handleSubmit = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await submitGenesisAnswers(businessId, answers);
    setLoading(false);
    if (error || !data) {
      toast.error(error || "Could not save answers.");
      return;
    }
    toast.success("Answers saved");
    if (data.nextQuestions.length > 0) {
      setQuestions(data.nextQuestions);
      setAnswers({});
    } else {
      onAdvance?.("genesis");
    }
  };

  if (questions.length === 0) {
    return (
      <CardFrame title={card.title || "A few quick questions"}>
        <p className="text-sm text-muted-foreground">No more questions right now.</p>
        <div className="mt-3">
          <PrimaryButton onClick={() => onAdvance?.("genesis")}>Continue</PrimaryButton>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame title={card.title || "A few quick questions"}>
      <div className="space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <label className="text-sm font-medium">{q.label}</label>
            {q.helper && <p className="text-xs text-muted-foreground">{q.helper}</p>}
            {q.type === "textarea" ? (
              <textarea
                value={String(answers[q.field] ?? "")}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
                className="min-h-[80px] w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : q.type === "select" && q.options ? (
              <select
                value={String(answers[q.field] ?? "")}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Choose one</option>
                {q.options.map((opt) => {
                  const optionValue = typeof opt === "string" ? opt : opt.value;
                  const optionLabel = typeof opt === "string" ? opt : opt.label;
                  return (
                    <option key={optionValue} value={optionValue}>
                      {optionLabel}
                    </option>
                  );
                })}
              </select>
            ) : q.type === "boolean" ? (
              <div className="flex gap-3">
                {["Yes", "No"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswers((a) => ({ ...a, [q.field]: opt === "Yes" }))}
                    className={cn(
                      "rounded-xl border px-3 py-1.5 text-sm",
                      (answers[q.field] === true && opt === "Yes") ||
                        (answers[q.field] === false && opt === "No")
                        ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.1)] text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type={q.type === "number" || q.type === "currency" ? "number" : "text"}
                value={String(answers[q.field] ?? "")}
                onChange={(e) =>
                  setAnswers((a) => ({
                    ...a,
                    [q.field]:
                      q.type === "number" || q.type === "currency"
                        ? Number(e.target.value)
                        : e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <PrimaryButton onClick={handleSubmit} loading={loading}>
            Save answers
          </PrimaryButton>
          <SecondaryButton onClick={() => onAdvance?.("genesis")}>Skip</SecondaryButton>
        </div>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Readiness Dashboard
// ------------------------------------------------------------------
function ReadinessDashboardCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const businessId = useBusinessId();
  const initialReadiness = card.data?.readiness as GenesisReadinessScore | undefined;
  const [readiness, setReadiness] = useState<GenesisReadinessScore | undefined>(initialReadiness);
  const [plan, setPlan] = useState<GenesisActionPlan | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialReadiness || !businessId) return;
    void getReadiness(businessId).then(({ data }) => {
      if (data) setReadiness(data);
    });
  }, [businessId, initialReadiness]);

  const handleGenerateRoadmap = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await generateRoadmap(businessId);
    setLoading(false);
    if (error || !data) {
      toast.error(error || "Could not generate roadmap.");
      return;
    }
    setPlan(data);
  };

  const handleAcceptDisclaimer = async () => {
    if (!businessId) return;
    const { error } = await submitGenesisAnswers(businessId, {
      "legalProfile.disclaimerAcceptedAt": new Date().toISOString(),
    });
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Disclaimer accepted");
  };

  const scores = [
    { key: "legal", label: "Legal" },
    { key: "finance", label: "Finance" },
    { key: "market", label: "Market" },
    { key: "operations", label: "Operations" },
    { key: "compliance", label: "Compliance" },
  ] as const;

  return (
    <CardFrame title={card.title || "Your readiness dashboard"}>
      <div className="space-y-4">
        {readiness ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Overall readiness</span>
              <span className="text-sm font-bold">{readiness.overall}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[hsl(var(--kf-accent1))]"
                style={{ width: `${readiness.overall}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scores.map((s) => (
                <div key={s.key} className="rounded-xl border border-border/50 bg-background p-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-lg font-semibold">{readiness[s.key]}%</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading readiness…
          </div>
        )}

        {plan ? (
          <div className="rounded-xl border border-border/50 bg-background p-3">
            <p className="text-sm font-medium">Action plan</p>
            <ul className="mt-2 space-y-1">
              {plan.roadmap.slice(0, 5).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <PrimaryButton onClick={handleGenerateRoadmap} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            Generate roadmap
          </PrimaryButton>
        )}

        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={handleAcceptDisclaimer}>Accept legal disclaimer</SecondaryButton>
          <PrimaryButton onClick={() => onAdvance?.("template")}>Continue to setup</PrimaryButton>
        </div>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Template Picker
// ------------------------------------------------------------------
function TemplatePickerCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const businessId = useBusinessId();
  const [templates, setTemplates] = useState<ConciergeTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    fetchConciergeTemplates(businessId)
      .then(({ data, error: apiError }) => {
        if (apiError) {
          setError(apiError);
          return;
        }
        if (data?.templates) setTemplates(data.templates);
      })
      .catch(() => setError("Could not load templates."));
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !selected) return;
    fetchConciergeTemplatePreview(businessId, selected)
      .then(({ data, error: apiError }) => {
        setLoading(false);
        if (apiError) {
          setError(apiError);
          return;
        }
        if (data) setPreview(data);
      })
      .catch(() => {
        setLoading(false);
        setError("Could not load template preview.");
      });
  }, [businessId, selected]);

  const handleSelect = (id: string) => {
    setSelected(id);
    setLoading(true);
    setError(null);
    setPreview(null);
  };

  const handleConfirm = async () => {
    if (!businessId || !selected) return;
    setConfiguring(true);
    const { data, error } = await autoConfigureFromTemplate(businessId, selected, {
      createProducts: true,
      setBusinessHours: true,
      setPaymentMethods: true,
      configureStorefront: true,
    });
    setConfiguring(false);
    if (error || !data) {
      toast.error(error || "Auto-configuration failed.");
      return;
    }
    toast.success(`Configured ${data.templateLabel}`);
    onAdvance?.("configure");
  };

  return (
    <CardFrame title={card.title || "Pick an industry template"}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t.id)}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm transition-colors",
                selected === t.id
                  ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1)/0.1)] text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
          </div>
        )}

        {preview && (
          <div className="space-y-2 rounded-xl border border-border/50 bg-background p-3">
            <p className="text-sm font-medium">{preview.label} preview</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• {preview.products.length} products/services</li>
              <li>• Business hours preset</li>
              <li>• Payment recommendations</li>
            </ul>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={handleConfirm} loading={configuring} disabled={!selected}>
            Use this template
          </PrimaryButton>
          <SecondaryButton onClick={() => onAdvance?.("configure")}>Skip</SecondaryButton>
          <BackButton step="template" onAdvance={onAdvance} />
        </div>
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Genome Check
// ------------------------------------------------------------------
function GenomeCheckCard({
  card,
  onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const { sendMessage } = useKeyChatActions();

  return (
    <CardFrame title={card.title || "Complete your Business Genome"}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Answer a few quick questions so KEY can finish your Business Genome.
          Once all three pillars are at 50% or higher, you can launch.
        </p>
        <GenomeChatStep
          className="h-[420px] rounded-xl border border-border/40"
          onComplete={() => {
            // Ask the orchestrator for the next card (should be completion-gate).
            void sendMessage("Next step");
          }}
        />
      </div>
    </CardFrame>
  );
}

// ------------------------------------------------------------------
// Completion Gate
// ------------------------------------------------------------------
function CompletionGateCard({
  card,
  onAdvance: _onAdvance,
}: {
  card: OnboardingCardData;
  onAdvance?: (step: OnboardingStep) => void;
}) {
  const router = useRouter();
  const businessId = useBusinessId();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGenomeChat, setShowGenomeChat] = useState(false);

  const loadState = useCallback(() => {
    if (!businessId) return;
    setError(null);
    void import("@/lib/api/onboarding-concierge").then(({ fetchOnboardingState }) => {
      fetchOnboardingState(businessId)
        .then(({ data, error: apiError }) => {
          if (apiError) {
            setError(apiError);
            return;
          }
          if (data) setState(data);
        })
        .catch(() => setError("Could not load onboarding state."));
    });
  }, [businessId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleComplete = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await markOnboardingComplete(businessId);
    setLoading(false);
    if (error || !data) {
      // Most common cause: the three-pillar genome minimum isn't met. Give
      // the user a way back to the genome chat instead of a dead end.
      toast.error(error || "Could not complete onboarding.");
      setShowGenomeChat(true);
      return;
    }
    toast.success("Onboarding complete! 🎉");
    if (data.complete) {
      // markOnboardingComplete already persisted step="complete" server-side;
      // advancing through saveStep would 400 by design. Just celebrate + go.
      window.setTimeout(() => {
        router.push("/app/command-center");
      }, 1500);
    }
  };

  const status = (state?.setupStatus as Record<string, boolean> | undefined) ?? {};
  const steps = [
    { key: "profile", label: "Business profile" },
    { key: "products", label: "Products/services" },
    { key: "businessHours", label: "Business hours" },
    { key: "payments", label: "Payment methods" },
    { key: "storefront", label: "Online storefront" },
    { key: "contacts", label: "Customer contacts" },
    { key: "legalProfile", label: "Legal profile" },
    { key: "registrationPlan", label: "Registration plan" },
    { key: "financeModel", label: "Financial model" },
    { key: "marketStrategy", label: "Market strategy" },
    { key: "operationsPlan", label: "Operations plan" },
    { key: "complianceChecklist", label: "Compliance checklist" },
  ];

  return (
    <CardFrame title={card.title || "You’re ready to launch"}>
      <div className="space-y-3">
        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
            <button onClick={loadState} className="ml-2 underline">
              Retry
            </button>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {state?.threePillarMet
            ? "Your Business Genome meets the three-pillar minimum. You can finish onboarding now."
            : "Complete the remaining items to finish onboarding."}
        </p>
        <div className="grid gap-2">
          {steps.map((s) => {
            const done = Boolean(status[s.key]);
            return (
              <div
                key={s.key}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  done ? "border-emerald-500/20 bg-emerald-500/5" : "border-border bg-background"
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                {s.label}
              </div>
            );
          })}
        </div>

        {state && !state.threePillarMet && !showGenomeChat && (
          <button
            type="button"
            onClick={() => setShowGenomeChat(true)}
            className="w-full rounded-xl border border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5 px-3 py-2 text-sm font-medium text-[hsl(var(--kf-accent1))] transition-colors hover:bg-[hsl(var(--kf-accent1))]/10"
          >
            Continue genome setup with KEY
          </button>
        )}

        {showGenomeChat && (
          <GenomeChatStep
            className="h-[420px] rounded-xl border border-border/40"
            onComplete={() => {
              setShowGenomeChat(false);
              loadState();
            }}
          />
        )}

        <PrimaryButton onClick={handleComplete} loading={loading} disabled={!state?.threePillarMet}>
          Finish onboarding
        </PrimaryButton>
      </div>
    </CardFrame>
  );
}
