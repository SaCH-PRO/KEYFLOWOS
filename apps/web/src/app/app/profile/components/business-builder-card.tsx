"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb, Rocket, Settings, TrendingUp, ChevronRight,
  Sparkles, Target, DollarSign, Users, BarChart3,
  FileText, Calendar, ShoppingBag, Megaphone,
  CheckCircle2, ArrowRight, Zap, Brain, Loader2,
  X, ArrowLeft, ChevronDown, AlertTriangle, Shield,
  Globe, Briefcase, Flag, Send, Pencil, Save, ExternalLink,
  Plus, FolderOpen, Download, Mail, Printer, HardDrive,
} from "lucide-react";
import { apiGet, apiPost, apiPostSimple, apiPut } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type ProgressKey =
  | "hasProfile" | "hasServices" | "hasStore" | "storeEnabled"
  | "hasDocs" | "hasContacts" | "hasBookings" | "hasInvoices"
  | "hasExpenses" | "hasProjects" | "hasSequences" | "hasRecurring"
  | "hasCampaigns" | "hasReports" | "hasAI" | "hasAutomations";

interface PhaseAction {
  label: string;
  description: string;
  icon: React.ElementType;
  route: string;
  doneKey: ProgressKey;
}

interface Phase {
  id: string;
  label: string;
  tagline: string;
  icon: React.ElementType;
  colorVar: string;
  actions: PhaseAction[];
}

interface BusinessModelCanvas {
  valueProposition: string;
  customerSegments: string;
  channels: string;
  customerRelationships: string;
  revenueStreams: string;
  keyResources: string;
  keyActivities: string;
  keyPartnerships: string;
  costStructure: string;
}

interface RoadmapPhase {
  phase: string;
  timeline: string;
  objectives: string[];
  milestones: string[];
  estimatedCost: string;
}

interface ActionItem {
  priority: "HIGH" | "MEDIUM" | "LOW";
  action: string;
  category: string;
  timeframe: string;
  details: string;
  module?: string;
}

interface Risk {
  risk: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  likelihood?: "HIGH" | "MEDIUM" | "LOW";
  category?: string;
  mitigation: string;
  contingency?: string;
}

interface FinancialOutlook {
  startupCosts: string;
  monthlyBurn: string;
  breakEvenTimeline: string;
  yearOneRevenue: string;
  keyMetrics: string[];
  fundingStrategy: string;
  cashFlowProjection: string;
}

interface LegalCompliance {
  businessStructure: string;
  registrations: string[];
  taxObligations: string;
  contracts: string[];
  insuranceNeeds: string[];
  complianceChecklist: string[];
}

interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

interface CompetitiveAnalysis {
  swot: SwotAnalysis;
  competitorLandscape: string;
  differentiators: string[];
  marketEntry: string;
}

interface UnitEconomics {
  customerAcquisitionCost: string;
  lifetimeValue: string;
  ltvCacRatio: string;
  averageRevenue: string;
  grossMargin: string;
  contributionMargin: string;
  paybackPeriod: string;
  breakEvenUnits: string;
}

interface GeneratedModel {
  summary: string;
  canvas: BusinessModelCanvas;
  legalCompliance: LegalCompliance;
  competitiveAnalysis: CompetitiveAnalysis;
  unitEconomics: UnitEconomics;
  roadmap: RoadmapPhase[];
  actionPlan: ActionItem[];
  financialOutlook: FinancialOutlook;
  risks: Risk[];
  recommendedDocuments: string[];
}

interface IntakeForm {
  businessIdea: string;
  targetMarket: string;
  valueProposition: string;
  revenueModel: string;
  goals: string;
  stage: string;
  challenges: string;
  budget: string;
  timeline: string;
  teamSize: string;
  location: string;
  legalStructure: string;
}

interface ServerPlan {
  id: string;
  version: number;
  name: string;
  status: string;
  intake: IntakeForm;
  model: GeneratedModel;
  createdAt: string;
}

const DOCUMENT_SLUG_NAMES: Record<string, string> = {
  "company-description": "Company Description",
  "registration-record": "Registration Record",
  "owner-register": "Owner & Director Register",
  "license-register": "License & Permit Register",
  "invoice-template": "Invoice Template",
  "tax-calendar": "Tax Calendar",
  "chart-of-accounts": "Chart of Accounts",
  "financial-statement": "Financial Statement",
  "budget-template": "Budget Template",
  "receipt-template": "Receipt Template",
  "expense-report": "Expense Report",
  "proposal-template": "Proposal Template",
  "service-agreement": "Service Agreement",
  "payment-terms": "Payment Terms",
  "pricing-sheet": "Pricing Sheet",
  "client-onboarding": "Client Onboarding",
  "refund-policy": "Refund Policy",
  "company-tagline": "Company Tagline",
  "founder-bio": "Founder Bio",
  "company-profile": "Company Profile",
  "elevator-pitch": "Elevator Pitch",
  "mission-vision": "Mission & Vision",
  "tone-guide": "Tone Guide",
  "sales-one-pager": "Sales One-Pager",
  "faq-document": "FAQ Document",
  "sop": "Standard Operating Procedure",
  "approval-matrix": "Approval Matrix",
  "business-continuity": "Business Continuity Plan",
  "meeting-agenda": "Meeting Agenda",
  "project-handoff": "Project Handoff",
  "communication-plan": "Communication Plan",
  "offer-letter": "Offer Letter",
  "employee-handbook": "Employee Handbook",
  "nda-employee": "Employee NDA",
  "job-description": "Job Description",
  "contractor-agreement": "Contractor Agreement",
  "contractor-sow": "Contractor SOW",
  "contractor-ip": "Contractor IP Agreement",
  "privacy-policy": "Privacy Policy",
  "data-handling": "Data Handling Policy",
  "cookie-policy": "Cookie Policy",
  "website-terms": "Website Terms",
  "ecommerce-terms": "E-Commerce Terms",
};

const MODULE_ROUTES: Record<string, string> = {
  projects: "/app/projects",
  bookings: "/app/bookings",
  commerce: "/app/commerce",
  marketing: "/app/marketing",
  expenses: "/app/expenses",
  contacts: "/app/contacts",
  store: "/app/store",
  documents: "/app/profile?tab=documents",
  reports: "/app/reports",
};

const INTAKE_STEPS = [
  { id: "idea", label: "Business Idea", icon: Lightbulb, field: "businessIdea" as const, placeholder: "Describe your business idea in detail — what product or service will you offer?", hint: "Be specific about what you're building. E.g. 'A mobile car detailing service targeting luxury car owners in Port of Spain'" },
  { id: "market", label: "Target Market", icon: Users, field: "targetMarket" as const, placeholder: "Who are your ideal customers? What demographics, behaviors, or needs define them?", hint: "Think demographics (age, income, location), psychographics (values, lifestyle), and buying behavior. E.g. 'Young professionals aged 25-40 in Trinidad who value convenience and premium service'" },
  { id: "value", label: "Value Proposition", icon: Sparkles, field: "valueProposition" as const, placeholder: "What unique value do you bring? Why would customers choose you over alternatives?", hint: "Focus on your unfair advantage — what problem you solve better than anyone else, and why competitors can't easily copy you" },
  { id: "revenue", label: "Revenue Model", icon: DollarSign, field: "revenueModel" as const, placeholder: "How will you make money? Include pricing strategy and expected price points.", hint: "E.g. 'Per-service pricing ($500-2000 TTD per detail) + monthly subscription plans ($800 TTD/mo) for regular customers'" },
  { id: "budget", label: "Budget & Funding", icon: BarChart3, field: "budget" as const, placeholder: "What's your available startup capital? Are you self-funding, seeking a loan, or looking for investors?", hint: "Be honest about your financial starting point. E.g. '$50,000 TTD personal savings + considering NEDCO small business loan'" },
  { id: "team", label: "Team & Resources", icon: Users, field: "teamSize" as const, placeholder: "Who's on your team? What skills do you have, and what do you need to hire for?", hint: "E.g. 'Just me (marketing background) — will need a developer and an operations person within 6 months'" },
  { id: "location", label: "Location & Market", icon: Globe, field: "location" as const, placeholder: "Where will you operate? What's your primary market geography?", hint: "E.g. 'Based in Port of Spain, serving all of Trinidad initially, expanding to Tobago and Caribbean islands within Year 2'" },
  { id: "goals", label: "Goals & Vision", icon: Flag, field: "goals" as const, placeholder: "What are your 6-month and 12-month goals? Where do you see this business in 3 years?", hint: "Include revenue targets, customer milestones, hiring plans, or expansion goals. Be ambitious but realistic." },
  { id: "challenges", label: "Challenges", icon: AlertTriangle, field: "challenges" as const, placeholder: "What obstacles or concerns do you foresee? What keeps you up at night about this venture?", hint: "Common Caribbean challenges: import costs, forex limitations, finding skilled staff, seasonal fluctuations, competition from established players" },
];

const STAGE_OPTIONS = [
  { value: "IDEA", label: "Just an Idea", description: "I'm still thinking through the concept" },
  { value: "PLANNING", label: "Planning", description: "I'm researching and laying groundwork" },
  { value: "STARTUP", label: "Early Startup", description: "I've started but haven't launched yet" },
  { value: "LAUNCHED", label: "Launched", description: "I'm live and getting first customers" },
  { value: "GROWING", label: "Growing", description: "I have traction and want to scale" },
];

const LEGAL_STRUCTURE_OPTIONS = [
  { value: "SOLE_TRADER", label: "Sole Trader", description: "Simplest structure — you and the business are one entity" },
  { value: "PARTNERSHIP", label: "Partnership", description: "Two or more owners sharing profits and liability" },
  { value: "LLC", label: "Limited Liability Company", description: "Separate legal entity protecting personal assets" },
  { value: "LIMITED", label: "Limited Company", description: "Formal corporate structure with shareholders and directors" },
  { value: "UNSURE", label: "Not Sure Yet", description: "I'd like the AI to recommend the best structure" },
];

const TIMELINE_OPTIONS = [
  { value: "ASAP", label: "Ready to Launch", description: "Within the next 1-2 months" },
  { value: "3_MONTHS", label: "3 Months", description: "Building foundations over the next quarter" },
  { value: "6_MONTHS", label: "6 Months", description: "Taking time to plan and prepare properly" },
  { value: "12_MONTHS", label: "12+ Months", description: "Long-term planning before launch" },
];

const CANVAS_LABELS: { key: keyof BusinessModelCanvas; label: string; icon: React.ElementType; colorVar: string }[] = [
  { key: "valueProposition", label: "Value Proposition", icon: Sparkles, colorVar: "--kf-accent1" },
  { key: "customerSegments", label: "Customer Segments", icon: Users, colorVar: "--kf-accent2" },
  { key: "channels", label: "Channels", icon: Globe, colorVar: "--kf-info" },
  { key: "customerRelationships", label: "Customer Relationships", icon: Users, colorVar: "--kf-success" },
  { key: "revenueStreams", label: "Revenue Streams", icon: DollarSign, colorVar: "--kf-accent1" },
  { key: "keyResources", label: "Key Resources", icon: Briefcase, colorVar: "--kf-accent2" },
  { key: "keyActivities", label: "Key Activities", icon: Zap, colorVar: "--kf-info" },
  { key: "keyPartnerships", label: "Key Partnerships", icon: Users, colorVar: "--kf-success" },
  { key: "costStructure", label: "Cost Structure", icon: BarChart3, colorVar: "--kf-warning" },
];

const PROGRESS_PHASES: Phase[] = [
  {
    id: "conceptualise", label: "Conceptualise", tagline: "Define your vision and foundation", icon: Lightbulb, colorVar: "--kf-accent2",
    actions: [
      { label: "Business Profile", description: "Define your name, industry, and stage", icon: Target, route: "/app/profile", doneKey: "hasProfile" },
      { label: "Service Catalog", description: "Create your offerings and pricing", icon: ShoppingBag, route: "/app/bookings", doneKey: "hasServices" },
      { label: "Brand Identity", description: "Logo, colors, and storefront design", icon: Sparkles, route: "/app/store", doneKey: "hasStore" },
      { label: "Business Documents", description: "Generate contracts, policies, and plans", icon: FileText, route: "/app/profile?tab=documents", doneKey: "hasDocs" },
    ],
  },
  {
    id: "execute", label: "Execute", tagline: "Launch and start serving customers", icon: Rocket, colorVar: "--kf-accent1",
    actions: [
      { label: "Go Live", description: "Publish your storefront to the world", icon: Zap, route: "/app/store", doneKey: "storeEnabled" },
      { label: "First Contact", description: "Add or import your first customers", icon: Users, route: "/app/contacts", doneKey: "hasContacts" },
      { label: "First Booking", description: "Accept your first appointment or order", icon: Calendar, route: "/app/bookings", doneKey: "hasBookings" },
      { label: "Payment Setup", description: "Configure how you get paid", icon: DollarSign, route: "/app/commerce", doneKey: "hasInvoices" },
    ],
  },
  {
    id: "maintain", label: "Maintain", tagline: "Streamline your daily operations", icon: Settings, colorVar: "--kf-info",
    actions: [
      { label: "Expense Tracking", description: "Monitor and categorize spending", icon: BarChart3, route: "/app/expenses", doneKey: "hasExpenses" },
      { label: "Recurring Revenue", description: "Set up subscriptions and billing", icon: DollarSign, route: "/app/commerce", doneKey: "hasRecurring" },
      { label: "Project Management", description: "Track tasks and deliverables", icon: Target, route: "/app/projects", doneKey: "hasProjects" },
    ],
  },
  {
    id: "profit", label: "Profit & Scale", tagline: "Grow revenue and expand reach", icon: TrendingUp, colorVar: "--kf-success",
    actions: [
      { label: "Marketing Campaigns", description: "Email campaigns and lead capture", icon: Megaphone, route: "/app/marketing", doneKey: "hasCampaigns" },
      { label: "Revenue Reports", description: "Track income, expenses, and margins", icon: BarChart3, route: "/app/reports", doneKey: "hasReports" },
      { label: "AI Insights", description: "Get recommendations to grow faster", icon: Brain, route: "/app", doneKey: "hasAI" },
    ],
  },
];

function safeArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function validateModel(raw: unknown): GeneratedModel {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const canvas = (m.canvas && typeof m.canvas === "object" ? m.canvas : {}) as Record<string, string>;
  const fin = (m.financialOutlook && typeof m.financialOutlook === "object" ? m.financialOutlook : {}) as Record<string, unknown>;
  const legal = (m.legalCompliance && typeof m.legalCompliance === "object" ? m.legalCompliance : {}) as Record<string, unknown>;
  const comp = (m.competitiveAnalysis && typeof m.competitiveAnalysis === "object" ? m.competitiveAnalysis : {}) as Record<string, unknown>;
  const swotRaw = (comp.swot && typeof comp.swot === "object" ? comp.swot : {}) as Record<string, unknown>;
  const unit = (m.unitEconomics && typeof m.unitEconomics === "object" ? m.unitEconomics : {}) as Record<string, unknown>;
  const s = (v: unknown, f = "") => typeof v === "string" ? v : f;
  const a = (v: unknown) => Array.isArray(v) ? v : [];

  return {
    summary: s(m.summary),
    canvas: {
      valueProposition: canvas.valueProposition || "",
      customerSegments: canvas.customerSegments || "",
      channels: canvas.channels || "",
      customerRelationships: canvas.customerRelationships || "",
      revenueStreams: canvas.revenueStreams || "",
      keyResources: canvas.keyResources || "",
      keyActivities: canvas.keyActivities || "",
      keyPartnerships: canvas.keyPartnerships || "",
      costStructure: canvas.costStructure || "",
    },
    legalCompliance: {
      businessStructure: s(legal.businessStructure, "Consult a local attorney"),
      registrations: a(legal.registrations),
      taxObligations: s(legal.taxObligations, "Consult BIR for specific obligations"),
      contracts: a(legal.contracts),
      insuranceNeeds: a(legal.insuranceNeeds),
      complianceChecklist: a(legal.complianceChecklist),
    },
    competitiveAnalysis: {
      swot: {
        strengths: a(swotRaw.strengths),
        weaknesses: a(swotRaw.weaknesses),
        opportunities: a(swotRaw.opportunities),
        threats: a(swotRaw.threats),
      },
      competitorLandscape: s(comp.competitorLandscape),
      differentiators: a(comp.differentiators),
      marketEntry: s(comp.marketEntry),
    },
    unitEconomics: {
      customerAcquisitionCost: s(unit.customerAcquisitionCost, "Not estimated"),
      lifetimeValue: s(unit.lifetimeValue, "Not estimated"),
      ltvCacRatio: s(unit.ltvCacRatio, "Not estimated"),
      averageRevenue: s(unit.averageRevenue, "Not estimated"),
      grossMargin: s(unit.grossMargin, "Not estimated"),
      contributionMargin: s(unit.contributionMargin, "Not estimated"),
      paybackPeriod: s(unit.paybackPeriod, "Not estimated"),
      breakEvenUnits: s(unit.breakEvenUnits, "Not estimated"),
    },
    roadmap: a(m.roadmap),
    actionPlan: a(m.actionPlan),
    financialOutlook: {
      startupCosts: s(fin.startupCosts, "Not estimated"),
      monthlyBurn: s(fin.monthlyBurn, "Not estimated"),
      breakEvenTimeline: s(fin.breakEvenTimeline, "Not estimated"),
      yearOneRevenue: s(fin.yearOneRevenue, "Not estimated"),
      keyMetrics: a(fin.keyMetrics),
      fundingStrategy: s(fin.fundingStrategy),
      cashFlowProjection: s(fin.cashFlowProjection),
    },
    risks: a(m.risks),
    recommendedDocuments: a(m.recommendedDocuments),
  };
}

function useBusinessProgress(businessId: string | null) {
  const [progress, setProgress] = useState<Record<ProgressKey, boolean> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    const settle = <T,>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> =>
      p.then((v) => ({ ok: true as const, value: v })).catch(() => ({ ok: false as const }));

    Promise.all([
      settle(apiGet<Record<string, unknown>>(`/identity/businesses/${businessId}`)),
      settle(apiGet<unknown[]>(`/bookings/businesses/${businessId}/services`)),
      settle(apiGet<unknown[]>(`/crm/businesses/${businessId}/contacts?limit=1`)),
      settle(apiGet<unknown[]>(`/commerce/businesses/${businessId}/invoices?limit=1`)),
      settle(apiGet<unknown[]>(`/documents/businesses/${businessId}/instances`)),
      settle(apiGet<unknown[]>(`/expenses/businesses/${businessId}?limit=1`)),
      settle(apiGet<unknown[]>(`/projects/businesses/${businessId}?limit=1`)),
      settle(apiGet<unknown[]>(`/bookings/businesses/${businessId}?limit=1`)),
      settle(apiGet<unknown[]>(`/businesses/${businessId}/campaigns?limit=1`)),
      settle(apiGet<Record<string, unknown>>(`/commerce/businesses/${businessId}/recurring-invoices?limit=1`)),
    ]).then(([bizRes, servicesRes, contactsRes, invoicesRes, docsRes, expensesRes, projectsRes, bookingsRes, campaignsRes, recurringRes]) => {
      const biz = bizRes.ok ? (bizRes.value.data as Record<string, unknown> | null) : null;
      const hasRecurringData = recurringRes.ok && recurringRes.value.data;
      const recurringArr = hasRecurringData ? safeArray(
        Array.isArray(recurringRes.value.data) ? recurringRes.value.data : (recurringRes.value.data as Record<string, unknown>)?.invoices
      ) : [];
      setProgress({
        hasProfile: !!(biz?.name && biz?.industry),
        hasServices: safeArray(servicesRes.ok ? servicesRes.value.data : []).length > 0,
        hasStore: !!biz?.storeEnabled,
        storeEnabled: !!biz?.storeEnabled,
        hasDocs: safeArray(docsRes.ok ? docsRes.value.data : []).length > 0,
        hasContacts: safeArray(contactsRes.ok ? contactsRes.value.data : []).length > 0,
        hasBookings: safeArray(bookingsRes.ok ? bookingsRes.value.data : []).length > 0,
        hasInvoices: safeArray(invoicesRes.ok ? invoicesRes.value.data : []).length > 0,
        hasExpenses: safeArray(expensesRes.ok ? expensesRes.value.data : []).length > 0,
        hasProjects: safeArray(projectsRes.ok ? projectsRes.value.data : []).length > 0,
        hasSequences: false,
        hasRecurring: recurringArr.length > 0,
        hasCampaigns: safeArray(campaignsRes.ok ? campaignsRes.value.data : []).length > 0,
        hasReports: safeArray(invoicesRes.ok ? invoicesRes.value.data : []).length > 0 || safeArray(expensesRes.ok ? expensesRes.value.data : []).length > 0,
        hasAI: safeArray(docsRes.ok ? docsRes.value.data : []).length > 0 || safeArray(contactsRes.ok ? contactsRes.value.data : []).length > 0,
        hasAutomations: false,
      });
      setLoading(false);
    });
  }, [businessId]);

  return { progress, loading };
}

type ViewMode = "overview" | "intake" | "results";
type ResultTab = "canvas" | "legal" | "swot" | "financials" | "roadmap" | "actions" | "risks";

export default function BusinessBuilderCard() {
  const router = useRouter();
  const businessId = typeof window !== "undefined" ? getStoredBusinessId() : null;
  const { progress, loading: progressLoading } = useBusinessProgress(businessId);

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [intakeStep, setIntakeStep] = useState(0);
  const [intakeForm, setIntakeForm] = useState<IntakeForm>({
    businessIdea: "", targetMarket: "", valueProposition: "",
    revenueModel: "", goals: "", stage: "", challenges: "",
    budget: "", timeline: "", teamSize: "", location: "", legalStructure: "",
  });
  const [formPreFilled, setFormPreFilled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedModel, setGeneratedModel] = useState<GeneratedModel | null>(null);
  const [serverPlanId, setServerPlanId] = useState<string | null>(null);
  const [planVersion, setPlanVersion] = useState<number>(0);
  const [resultTab, setResultTab] = useState<ResultTab>("canvas");
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverLoaded, setServerLoaded] = useState(false);

  useEffect(() => {
    if (!businessId || serverLoaded) return;
    apiGet<{ plan: ServerPlan | null }>(`/ai/businesses/${businessId}/ai/business-plan`)
      .then(({ data }) => {
        if (data?.plan) {
          const validModel = validateModel(data.plan.model);
          setGeneratedModel(validModel);
          setServerPlanId(data.plan.id);
          setPlanVersion(data.plan.version);
          if (data.plan.intake) {
            setIntakeForm(data.plan.intake);
            setFormPreFilled(true);
          }
        }
        setServerLoaded(true);
      })
      .catch((err) => {
        console.error("Failed to load business plan:", err);
        setServerLoaded(true);
      });
  }, [businessId, serverLoaded]);

  useEffect(() => {
    if (!businessId || formPreFilled || !serverLoaded) return;
    apiGet<Record<string, unknown>>(`/identity/businesses/${businessId}`)
      .then(({ data }) => {
        if (!data) return;
        const biz = data as Record<string, string | undefined>;

        const ideaParts: string[] = [];
        if (biz.businessIntent) ideaParts.push(biz.businessIntent);
        else {
          if (biz.name) ideaParts.push(biz.name);
          if (biz.industry) ideaParts.push(`in the ${biz.industry.replace(/_/g, " ").toLowerCase()} industry`);
          if (biz.description) ideaParts.push(`— ${biz.description}`);
          else if (biz.tagline) ideaParts.push(`— ${biz.tagline}`);
        }

        const stageMap: Record<string, string> = {
          IDEA: "IDEA", STARTUP: "STARTUP", GROWTH: "GROWING",
          ESTABLISHED: "LAUNCHED", SCALING: "GROWING",
        };

        const ideaText = ideaParts.join(" ");
        const hasAnyData = ideaText || biz.tagline || biz.revenueModel || biz.businessStage;

        if (hasAnyData) {
          setIntakeForm((prev) => ({
            ...prev,
            businessIdea: prev.businessIdea || ideaText,
            targetMarket: prev.targetMarket || "",
            valueProposition: prev.valueProposition || (biz.tagline || ""),
            revenueModel: prev.revenueModel || (biz.revenueModel?.replace(/_/g, " ") || ""),
            goals: prev.goals || "",
            stage: prev.stage || (stageMap[biz.businessStage || ""] || ""),
            challenges: prev.challenges || "",
            location: prev.location || (biz.city ? `${biz.city}${biz.country ? `, ${biz.country}` : ""}` : ""),
          }));
          setFormPreFilled(true);
        }
      })
      .catch((err) => {
        console.error("Failed to pre-fill business form:", err);
      });
  }, [businessId, formPreFilled, serverLoaded]);

  const handleGenerate = async () => {
    if (!businessId || !intakeForm.businessIdea.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await apiPost<{ success: boolean; model: GeneratedModel; error?: string }>({
        path: `/ai/businesses/${businessId}/ai/business-model`,
        body: intakeForm,
      });
      if (res.data?.success && res.data.model) {
        const validModel = validateModel(res.data.model);
        setGeneratedModel(validModel);
        setPlanVersion((v) => v + 1);
        setViewMode("results");
        apiGet<{ plan: ServerPlan | null }>(`/ai/businesses/${businessId}/ai/business-plan`)
          .then(({ data }) => { if (data?.plan) setServerPlanId(data.plan.id); })
          .catch((err) => {
            console.error("Failed to fetch generated plan id:", err);
          });
      } else {
        setError(res.data?.error || res.error || "Failed to generate. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setGenerating(false);
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveEdit = async (updatedModel: GeneratedModel) => {
    setGeneratedModel(updatedModel);
    setSaveError(null);
    if (serverPlanId && businessId) {
      try {
        await apiPut(`/ai/businesses/${businessId}/ai/business-plan/${serverPlanId}`, { model: updatedModel });
      } catch {
        setSaveError("Changes saved locally but failed to sync to server.");
        setTimeout(() => setSaveError(null), 4000);
      }
    }
  };

  const getPhaseProgress = useCallback((phase: Phase) => {
    if (!progress) return { done: 0, total: phase.actions.length, pct: 0 };
    const done = phase.actions.filter((a) => progress[a.doneKey]).length;
    return { done, total: phase.actions.length, pct: Math.round((done / phase.actions.length) * 100) };
  }, [progress]);

  const totalDone = PROGRESS_PHASES.reduce((acc, p) => acc + getPhaseProgress(p).done, 0);
  const totalActions = PROGRESS_PHASES.reduce((acc, p) => acc + p.actions.length, 0);
  const overallPct = Math.round((totalDone / totalActions) * 100);

  if (viewMode === "intake") {
    return <IntakeWizard
      step={intakeStep}
      form={intakeForm}
      prefilled={formPreFilled}
      generating={generating}
      error={error}
      onFormChange={setIntakeForm}
      onStepChange={setIntakeStep}
      onGenerate={handleGenerate}
      onBack={() => { setViewMode("overview"); setIntakeStep(0); }}
    />;
  }

  if (viewMode === "results" && generatedModel) {
    return <ResultsPanel
      model={generatedModel}
      tab={resultTab}
      version={planVersion}
      businessId={businessId}
      saveError={saveError}
      onTabChange={setResultTab}
      onBack={() => setViewMode("overview")}
      onRegenerate={() => { setViewMode("intake"); setIntakeStep(0); }}
      onSaveEdit={handleSaveEdit}
    />;
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}>
      <div className="p-5 relative overflow-hidden" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.06))" }}>
        <div className="absolute top-0 right-0 w-48 h-48 opacity-[0.03]" style={{ background: "radial-gradient(circle, hsl(var(--kf-accent1)), transparent 70%)" }} />
        <div className="flex items-start gap-4 relative">
          <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", boxShadow: "0 4px 12px hsl(var(--kf-accent1) / 0.3)" }}>
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[hsl(var(--kf-foreground))]">Business Builder</h3>
            <p className="text-xs text-[hsl(var(--kf-muted-foreground))] mt-0.5">From idea to profit — your AI-powered business command center</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {progressLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-[hsl(var(--kf-muted-foreground))]" />
            ) : (
              <>
                <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{overallPct}%</span>
                <span className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">{totalDone}/{totalActions} complete</span>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {PROGRESS_PHASES.map((phase, i) => {
            const { pct } = getPhaseProgress(phase);
            const activePhaseIndex = PROGRESS_PHASES.findIndex((p) => getPhaseProgress(p).pct < 100);
            const isActive = i === (activePhaseIndex >= 0 ? activePhaseIndex : PROGRESS_PHASES.length - 1);
            return (
              <div key={phase.id} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
                  <motion.div className="h-full rounded-full" style={{ background: `hsl(var(${phase.colorVar}))` }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, delay: i * 0.1 }} />
                </div>
                <div className="flex items-center gap-1">
                  {isActive && <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: `hsl(var(${phase.colorVar}))` }} />}
                  <span className={`text-[9px] font-medium ${isActive ? "" : "text-[hsl(var(--kf-muted-foreground))]"}`} style={isActive ? { color: `hsl(var(${phase.colorVar}))` } : undefined}>{phase.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-4 space-y-3" style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.1)" }}>
        <button
          onClick={() => setViewMode("intake")}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left group min-h-[56px] hover:scale-[1.01]"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.06))", border: "1px solid hsl(var(--kf-accent1) / 0.2)" }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
            <Brain className="w-4.5 h-4.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-[hsl(var(--kf-foreground))]">
              {generatedModel ? "Rebuild Business Model" : "Generate Business Model"}
            </span>
            <p className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">
              AI-powered business canvas, roadmap, and action plan
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))] group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
        </button>

        {generatedModel && (
          <button
            onClick={() => setViewMode("results")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left group min-h-[48px]"
            style={{ background: "hsl(var(--kf-success) / 0.06)", border: "1px solid hsl(var(--kf-success) / 0.15)" }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-success) / 0.12)" }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[hsl(var(--kf-foreground))]">View Business Plan</span>
              <p className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">
                {planVersion > 0 ? `v${planVersion} · ` : ""}{generatedModel.summary?.slice(0, 55)}...
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))]" />
          </button>
        )}
      </div>

      <div className="divide-y" style={{ borderColor: "hsl(var(--kf-border) / 0.1)" }}>
        {PROGRESS_PHASES.map((phase) => {
          const PhaseIcon = phase.icon;
          const { done, total, pct } = getPhaseProgress(phase);
          const isExpanded = expandedPhase === phase.id;
          const isComplete = pct === 100;
          return (
            <div key={phase.id}>
              <button onClick={() => setExpandedPhase(isExpanded ? null : phase.id)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[hsl(var(--kf-muted)/0.06)] transition-colors text-left min-h-[48px]">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isComplete ? `hsl(var(${phase.colorVar}) / 0.1)` : "hsl(var(--kf-muted) / 0.1)", border: `1px solid ${isComplete ? `hsl(var(${phase.colorVar}) / 0.2)` : "hsl(var(--kf-border) / 0.15)"}` }}>
                  {isComplete ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: `hsl(var(${phase.colorVar}))` }} /> : <PhaseIcon className="w-3.5 h-3.5" style={{ color: `hsl(var(${phase.colorVar}))` }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[hsl(var(--kf-foreground))]">{phase.label}</span>
                  <span className="text-[10px] text-[hsl(var(--kf-muted-foreground))] ml-2">{phase.tagline}</span>
                </div>
                <span className="text-[11px] font-medium text-[hsl(var(--kf-muted-foreground))]">{done}/{total}</span>
                <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--kf-muted-foreground))] transition-transform" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }} />
              </button>
              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="px-5 pb-3 space-y-1">
                      {phase.actions.map((action) => {
                        const ActionIcon = action.icon;
                        const isDone = progress ? progress[action.doneKey] : false;
                        return (
                          <button key={action.label} onClick={() => router.push(action.route)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[hsl(var(--kf-muted)/0.08)] transition-all text-left group min-h-[40px]" style={{ border: isDone ? `1px solid hsl(var(${phase.colorVar}) / 0.15)` : "1px solid transparent", background: isDone ? `hsl(var(${phase.colorVar}) / 0.04)` : "transparent" }}>
                            <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: isDone ? `hsl(var(${phase.colorVar}) / 0.1)` : "hsl(var(--kf-muted) / 0.08)" }}>
                              {isDone ? <CheckCircle2 className="w-3 h-3" style={{ color: `hsl(var(${phase.colorVar}))` }} /> : <ActionIcon className="w-3 h-3 text-[hsl(var(--kf-muted-foreground))]" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-xs font-medium ${isDone ? "text-[hsl(var(--kf-muted-foreground))]" : "text-[hsl(var(--kf-foreground))]"}`}>{action.label}</span>
                              <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">{action.description}</p>
                            </div>
                            <ArrowRight className="w-3 h-3 text-[hsl(var(--kf-muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionStep({ options, value, onChange, prompt }: {
  options: { value: string; label: string; description: string }[];
  value: string;
  onChange: (v: string) => void;
  prompt: string;
}) {
  return (
    <motion.div key="selection" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
      <p className="text-xs text-[hsl(var(--kf-muted-foreground))]">{prompt}</p>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all min-h-[48px]"
            style={{
              background: value === opt.value ? "hsl(var(--kf-accent1) / 0.08)" : "transparent",
              border: `1px solid ${value === opt.value ? "hsl(var(--kf-accent1) / 0.3)" : "hsl(var(--kf-border) / 0.15)"}`,
            }}
          >
            <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: `2px solid ${value === opt.value ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground) / 0.4)"}` }}>
              {value === opt.value && <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} />}
            </div>
            <div>
              <span className="text-sm font-medium text-[hsl(var(--kf-foreground))]">{opt.label}</span>
              <p className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">{opt.description}</p>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

const SELECTION_STEPS = [
  { id: "stage", label: "Business Stage", field: "stage" as const, options: STAGE_OPTIONS, prompt: "Where are you in your business journey?" },
  { id: "timeline", label: "Launch Timeline", field: "timeline" as const, options: TIMELINE_OPTIONS, prompt: "When do you plan to launch or reach your next milestone?" },
  { id: "legalStructure", label: "Legal Structure", field: "legalStructure" as const, options: LEGAL_STRUCTURE_OPTIONS, prompt: "What legal structure are you considering for your business?" },
];

function IntakeWizard({ step, form, prefilled, generating, error, onFormChange, onStepChange, onGenerate, onBack }: {
  step: number;
  form: IntakeForm;
  prefilled: boolean;
  generating: boolean;
  error: string | null;
  onFormChange: (f: IntakeForm) => void;
  onStepChange: (s: number) => void;
  onGenerate: () => void;
  onBack: () => void;
}) {
  const totalSteps = INTAKE_STEPS.length + SELECTION_STEPS.length;
  const isSelectionPhase = step >= INTAKE_STEPS.length;
  const selectionIdx = step - INTAKE_STEPS.length;
  const isLastStep = step === totalSteps - 1;
  const currentTextStep = INTAKE_STEPS[step];
  const currentSelectionStep = isSelectionPhase ? SELECTION_STEPS[selectionIdx] : null;

  const canProceed = step === 0
    ? form.businessIdea.trim().length > 10
    : true;

  const handleNext = () => {
    if (isLastStep) {
      onGenerate();
    } else {
      onStepChange(step + 1);
    }
  };

  const stepLabel = isSelectionPhase && currentSelectionStep ? currentSelectionStep.label : currentTextStep?.label || "";

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}>
      <div className="p-4 flex items-center gap-3" style={{ borderBottom: "1px solid hsl(var(--kf-border) / 0.15)" }}>
        <button onClick={step > 0 ? () => onStepChange(step - 1) : onBack} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[hsl(var(--kf-muted)/0.1)] transition-colors">
          <ArrowLeft className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))]" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[hsl(var(--kf-foreground))]">{stepLabel}</h3>
          <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">Step {step + 1} of {totalSteps}</p>
        </div>
        <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[hsl(var(--kf-muted)/0.1)] transition-colors">
          <X className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))]" />
        </button>
      </div>

      <div className="px-4 pt-2 pb-1 flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.15)" }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: i < step ? "100%" : i === step ? "50%" : "0%", background: "hsl(var(--kf-accent1))" }} />
          </div>
        ))}
      </div>

      <div className="p-5">
        <AnimatePresence mode="wait">
          {isSelectionPhase && currentSelectionStep ? (
            <SelectionStep
              key={currentSelectionStep.id}
              options={currentSelectionStep.options}
              value={form[currentSelectionStep.field]}
              onChange={(v) => onFormChange({ ...form, [currentSelectionStep.field]: v })}
              prompt={currentSelectionStep.prompt}
            />
          ) : currentTextStep ? (
            <motion.div key={currentTextStep.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              <p className="text-xs text-[hsl(var(--kf-muted-foreground))]">{currentTextStep.hint}</p>
              {form[currentTextStep.field].trim() && prefilled && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "hsl(var(--kf-accent2) / 0.08)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}>
                  <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>Pre-filled from your business profile — edit as needed</span>
                </div>
              )}
              <textarea
                value={form[currentTextStep.field]}
                onChange={(e) => onFormChange({ ...form, [currentTextStep.field]: e.target.value })}
                placeholder={currentTextStep.placeholder}
                rows={5}
                className="w-full resize-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 transition-all placeholder:text-[hsl(var(--kf-muted-foreground)/0.5)]"
                style={{
                  background: "hsl(var(--kf-muted) / 0.08)",
                  border: "1px solid hsl(var(--kf-border) / 0.2)",
                  color: "hsl(var(--kf-foreground))",
                }}
              />
              {step > 0 && !form[currentTextStep.field].trim() && (
                <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))] italic">This field is optional — skip it if you&apos;re unsure</p>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(var(--kf-error) / 0.08)", border: "1px solid hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }}>
            {error}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {step > 0 && !isSelectionPhase && (
            <button
              onClick={() => onStepChange(step + 1)}
              className="px-4 py-2.5 rounded-xl text-xs font-medium transition-colors min-h-[40px]"
              style={{ color: "hsl(var(--kf-muted-foreground))", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              Skip
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={!canProceed || generating}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all min-h-[40px] disabled:opacity-50"
            style={{ background: canProceed ? "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" : "hsl(var(--kf-muted) / 0.3)" }}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating your business plan...</span>
              </>
            ) : isLastStep ? (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Generate Business Plan</span>
              </>
            ) : (
              <>
                <span>{step === 0 ? "Continue" : "Next"}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const RESULT_TABS: { id: ResultTab; label: string; icon: React.ElementType }[] = [
  { id: "canvas", label: "Canvas", icon: BarChart3 },
  { id: "legal", label: "Legal", icon: Shield },
  { id: "swot", label: "SWOT", icon: Target },
  { id: "financials", label: "Financials", icon: DollarSign },
  { id: "roadmap", label: "Roadmap", icon: Flag },
  { id: "actions", label: "Actions", icon: Zap },
  { id: "risks", label: "Risks", icon: AlertTriangle },
];

function modelToSections(model: GeneratedModel): Array<{ sectionName: string; content: string }> {
  const sections: Array<{ sectionName: string; content: string }> = [];

  sections.push({ sectionName: "Executive Summary", content: model.summary });

  const canvasLabels: Record<string, string> = {
    valueProposition: "Value Proposition", customerSegments: "Customer Segments",
    channels: "Channels", customerRelationships: "Customer Relationships",
    revenueStreams: "Revenue Streams", keyResources: "Key Resources",
    keyActivities: "Key Activities", keyPartnerships: "Key Partnerships",
    costStructure: "Cost Structure",
  };
  const canvasContent = Object.entries(model.canvas)
    .map(([k, v]) => `${canvasLabels[k] || k}: ${v}`)
    .join("\n\n");
  sections.push({ sectionName: "Business Model Canvas", content: canvasContent });

  if (model.legalCompliance) {
    const lc = model.legalCompliance;
    const legalLines = [
      `Business Structure: ${lc.businessStructure}`,
      `\nTax Obligations: ${lc.taxObligations}`,
    ];
    if (lc.registrations?.length) legalLines.push(`\nRequired Registrations:\n${lc.registrations.map((r) => `  • ${r}`).join("\n")}`);
    if (lc.contracts?.length) legalLines.push(`\nEssential Contracts:\n${lc.contracts.map((c) => `  • ${c}`).join("\n")}`);
    if (lc.insuranceNeeds?.length) legalLines.push(`\nInsurance Needs:\n${lc.insuranceNeeds.map((i) => `  • ${i}`).join("\n")}`);
    if (lc.complianceChecklist?.length) legalLines.push(`\nCompliance Checklist:\n${lc.complianceChecklist.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`);
    sections.push({ sectionName: "Legal & Compliance", content: legalLines.join("\n") });
  }

  if (model.competitiveAnalysis) {
    const ca = model.competitiveAnalysis;
    const compLines: string[] = [];
    if (ca.swot) {
      compLines.push("SWOT Analysis:");
      if (ca.swot.strengths?.length) compLines.push(`  Strengths:\n${ca.swot.strengths.map((s) => `    • ${s}`).join("\n")}`);
      if (ca.swot.weaknesses?.length) compLines.push(`  Weaknesses:\n${ca.swot.weaknesses.map((w) => `    • ${w}`).join("\n")}`);
      if (ca.swot.opportunities?.length) compLines.push(`  Opportunities:\n${ca.swot.opportunities.map((o) => `    • ${o}`).join("\n")}`);
      if (ca.swot.threats?.length) compLines.push(`  Threats:\n${ca.swot.threats.map((t) => `    • ${t}`).join("\n")}`);
    }
    if (ca.competitorLandscape) compLines.push(`\nCompetitor Landscape: ${ca.competitorLandscape}`);
    if (ca.differentiators?.length) compLines.push(`\nDifferentiators:\n${ca.differentiators.map((d) => `  • ${d}`).join("\n")}`);
    if (ca.marketEntry) compLines.push(`\nMarket Entry Strategy: ${ca.marketEntry}`);
    sections.push({ sectionName: "Competitive Analysis", content: compLines.join("\n") });
  }

  if (model.unitEconomics) {
    const ue = model.unitEconomics;
    const ueLines = [
      `Customer Acquisition Cost (CAC): ${ue.customerAcquisitionCost}`,
      `Lifetime Value (LTV): ${ue.lifetimeValue}`,
      `LTV:CAC Ratio: ${ue.ltvCacRatio}`,
      `Average Revenue Per User: ${ue.averageRevenue}`,
      `Gross Margin: ${ue.grossMargin}`,
      `Contribution Margin: ${ue.contributionMargin}`,
      `Payback Period: ${ue.paybackPeriod}`,
      `Break-Even Units: ${ue.breakEvenUnits}`,
    ];
    sections.push({ sectionName: "Unit Economics", content: ueLines.join("\n") });
  }

  if (model.roadmap?.length > 0) {
    const roadmapContent = model.roadmap.map((p, i) => {
      const lines = [`Phase ${i + 1}: ${p.phase} (${p.timeline})`];
      if (p.estimatedCost) lines.push(`Budget: ${p.estimatedCost}`);
      if (p.objectives?.length) lines.push(`Objectives:\n${p.objectives.map((o) => `  • ${o}`).join("\n")}`);
      if (p.milestones?.length) lines.push(`Milestones:\n${p.milestones.map((m) => `  ✓ ${m}`).join("\n")}`);
      return lines.join("\n");
    }).join("\n\n");
    sections.push({ sectionName: "Execution Roadmap", content: roadmapContent });
  }

  if (model.actionPlan?.length > 0) {
    const actionsContent = model.actionPlan.map((a, i) =>
      `${i + 1}. [${a.priority}] ${a.action}\n   Category: ${a.category} · Timeframe: ${a.timeframe}\n   ${a.details}`
    ).join("\n\n");
    sections.push({ sectionName: "Action Plan", content: actionsContent });
  }

  if (model.financialOutlook) {
    const f = model.financialOutlook;
    const finLines = [
      `Startup Costs: ${f.startupCosts}`,
      `Monthly Burn: ${f.monthlyBurn}`,
      `Break-Even Timeline: ${f.breakEvenTimeline}`,
      `Year One Revenue: ${f.yearOneRevenue}`,
    ];
    if (f.fundingStrategy) finLines.push(`\nFunding Strategy: ${f.fundingStrategy}`);
    if (f.cashFlowProjection) finLines.push(`\nCash Flow Projection: ${f.cashFlowProjection}`);
    if (f.keyMetrics?.length) finLines.push(`\nKey Metrics:\n${f.keyMetrics.map((m) => `  • ${m}`).join("\n")}`);
    sections.push({ sectionName: "Financial Outlook", content: finLines.join("\n") });
  }

  if (model.risks?.length > 0) {
    const risksContent = model.risks.map((r, i) => {
      const lines = [`${i + 1}. ${r.risk} [Impact: ${r.impact}${r.likelihood ? ` | Likelihood: ${r.likelihood}` : ""}${r.category ? ` | ${r.category}` : ""}]`];
      lines.push(`   Mitigation: ${r.mitigation}`);
      if (r.contingency) lines.push(`   Contingency: ${r.contingency}`);
      return lines.join("\n");
    }).join("\n\n");
    sections.push({ sectionName: "Risk Assessment", content: risksContent });
  }

  return sections;
}

function modelToPayload(model: GeneratedModel, version: number) {
  return {
    title: "Business Plan",
    sections: modelToSections(model),
    documentType: "Business Plan",
    category: "Business Strategy",
    version,
  };
}

function ResultsPanel({ model, tab, version, businessId, saveError, onTabChange, onBack, onRegenerate, onSaveEdit }: {
  model: GeneratedModel;
  tab: ResultTab;
  version: number;
  businessId: string | null;
  saveError: string | null;
  onTabChange: (t: ResultTab) => void;
  onBack: () => void;
  onRegenerate: () => void;
  onSaveEdit: (m: GeneratedModel) => void;
}) {
  const router = useRouter();
  const [exportLoading, setExportLoading] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setExportMsg({ type, text });
    setTimeout(() => setExportMsg(null), 4000);
  };

  const handleDownloadPlan = () => {
    const sections = modelToSections(model);
    const text = [
      "BUSINESS PLAN",
      `Version ${version || 1}`,
      `Generated by KeyflowOS · ${new Date().toLocaleDateString()}`,
      "",
      "═".repeat(60),
      "",
      ...sections.flatMap((s) => [
        s.sectionName.toUpperCase(),
        "─".repeat(40),
        s.content,
        "",
      ]),
      "═".repeat(60),
      "This business plan was generated by KeyflowOS Business Builder",
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Business_Plan_v${version || 1}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMsg("success", "Business plan downloaded");
  };

  const handleEmailPlan = async () => {
    if (!businessId) return;
    setExportLoading("email");
    const payload = modelToPayload(model, version || 1);
    const res = await apiPostSimple<{ sent: boolean; reason?: string }>(
      `/drive/businesses/${businessId}/email-content`,
      payload,
    );
    if (res.data?.sent) {
      showMsg("success", "Business plan emailed to your inbox");
    } else {
      showMsg("error", res.data?.reason || res.error || "Failed to send email. Make sure Gmail is connected.");
    }
    setExportLoading(null);
  };

  const handleSaveToDrive = async () => {
    if (!businessId) return;
    setExportLoading("drive");
    const payload = modelToPayload(model, version || 1);
    const res = await apiPostSimple<{ fileId: string; webViewLink: string }>(
      `/drive/businesses/${businessId}/save-document`,
      payload,
    );
    if (res.data) {
      showMsg("success", "Business plan saved to Google Drive");
    } else {
      showMsg("error", res.error || "Failed to save. Make sure Drive is connected.");
    }
    setExportLoading(null);
  };

  const handlePrintPlan = async () => {
    if (!businessId) return;
    setExportLoading("print");
    const payload = modelToPayload(model, version || 1);
    const res = await apiPostSimple<{ html: string }>(
      `/drive/businesses/${businessId}/export-html`,
      payload,
    );
    if (res.data?.html) {
      const printWindow = window.open("", "_blank", "width=800,height=600");
      if (printWindow) {
        printWindow.document.write(res.data.html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
      }
    } else {
      showMsg("error", "Failed to generate print view");
    }
    setExportLoading(null);
  };

  const handleDocumentClick = (slug: string) => {
    router.push(`/app/profile?tab=documents&generate=${slug}`);
  };

  const exportActions = [
    { id: "download", label: "Download", icon: Download, handler: handleDownloadPlan },
    { id: "email", label: "Email", icon: Mail, handler: handleEmailPlan },
    { id: "drive", label: "Drive", icon: HardDrive, handler: handleSaveToDrive },
    { id: "print", label: "Print", icon: Printer, handler: handlePrintPlan },
  ];

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}>
      <div className="p-4 flex items-center gap-3" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.06))", borderBottom: "1px solid hsl(var(--kf-border) / 0.15)" }}>
        <button onClick={onBack} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[hsl(var(--kf-muted)/0.1)] transition-colors">
          <ArrowLeft className="w-4 h-4 text-[hsl(var(--kf-muted-foreground))]" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[hsl(var(--kf-foreground))]">Your Business Model</h3>
          <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">
            {version > 0 ? `Version ${version} · ` : ""}AI-generated strategy and execution plan
          </p>
        </div>
        <div className="flex items-center gap-1">
          {exportActions.map((ea) => {
            const EIcon = ea.icon;
            const isLoading = exportLoading === ea.id;
            return (
              <button
                key={ea.id}
                onClick={ea.handler}
                disabled={!!exportLoading}
                title={ea.label}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] disabled:opacity-40"
                style={{ color: "hsl(var(--kf-muted-foreground))" }}
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EIcon className="w-3.5 h-3.5" />}
              </button>
            );
          })}
          <div className="w-px h-4 mx-1" style={{ background: "hsl(var(--kf-border) / 0.2)" }} />
          <button onClick={onRegenerate} className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors" style={{ color: "hsl(var(--kf-accent1))", border: "1px solid hsl(var(--kf-accent1) / 0.2)" }}>
            Regenerate
          </button>
        </div>
      </div>

      {exportMsg && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{
          background: exportMsg.type === "success" ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)",
          border: `1px solid ${exportMsg.type === "success" ? "hsl(var(--kf-success) / 0.2)" : "hsl(var(--kf-error) / 0.2)"}`,
          color: exportMsg.type === "success" ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
        }}>
          {exportMsg.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
          {exportMsg.text}
        </div>
      )}

      <div className="p-4" style={{ borderBottom: "1px solid hsl(var(--kf-border) / 0.1)" }}>
        <p className="text-sm text-[hsl(var(--kf-foreground))] leading-relaxed">{model.summary}</p>
      </div>

      {saveError && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(var(--kf-warning) / 0.08)", border: "1px solid hsl(var(--kf-warning) / 0.2)", color: "hsl(var(--kf-warning))" }}>
          {saveError}
        </div>
      )}

      <div className="flex gap-0.5 p-1.5 mx-3 mt-3 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.1)" }}>
        {RESULT_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => onTabChange(t.id)} className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-[11px] font-medium transition-all" style={{ background: isActive ? "hsl(var(--kf-card))" : "transparent", color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))", boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none" }}>
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait">
          {tab === "canvas" && <CanvasView key="canvas" canvas={model.canvas} model={model} onSaveEdit={onSaveEdit} />}
          {tab === "legal" && <LegalView key="legal" legal={model.legalCompliance} />}
          {tab === "swot" && <SWOTView key="swot" analysis={model.competitiveAnalysis} economics={model.unitEconomics} />}
          {tab === "financials" && <FinancialsView key="financials" outlook={model.financialOutlook} />}
          {tab === "roadmap" && <RoadmapView key="roadmap" roadmap={model.roadmap} />}
          {tab === "actions" && <ActionsView key="actions" actions={model.actionPlan} businessId={businessId} />}
          {tab === "risks" && <RisksView key="risks" risks={model.risks} />}
        </AnimatePresence>
      </div>

      {model.recommendedDocuments?.length > 0 && (
        <div className="px-4 pb-4">
          <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-accent2) / 0.06)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-xs font-semibold text-[hsl(var(--kf-foreground))]">Recommended Documents</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {model.recommendedDocuments.map((slug) => {
                const name = DOCUMENT_SLUG_NAMES[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <button
                    key={slug}
                    onClick={() => handleDocumentClick(slug)}
                    className="text-[10px] px-2 py-1 rounded-md font-medium flex items-center gap-1 transition-all hover:scale-105"
                    style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                  >
                    <Plus className="w-2.5 h-2.5" />
                    {name}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => router.push("/app/profile?tab=documents")}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-white transition-all min-h-[36px]"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent2)), hsl(var(--kf-accent1)))" }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              View All Documents
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CanvasView({ canvas, model, onSaveEdit }: { canvas: BusinessModelCanvas; model: GeneratedModel; onSaveEdit: (m: GeneratedModel) => void }) {
  const [editingKey, setEditingKey] = useState<keyof BusinessModelCanvas | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (key: keyof BusinessModelCanvas) => {
    setEditingKey(key);
    setEditValue(canvas[key]);
  };

  const saveEdit = () => {
    if (!editingKey) return;
    const updatedCanvas = { ...canvas, [editingKey]: editValue };
    onSaveEdit({ ...model, canvas: updatedCanvas });
    setEditingKey(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-2 gap-2">
      {CANVAS_LABELS.map(({ key, label, icon: Icon, colorVar }) => (
        <div key={key} className={`rounded-xl p-3 group relative ${key === "valueProposition" ? "col-span-2" : ""}`} style={{ background: `hsl(var(${colorVar}) / 0.04)`, border: `1px solid hsl(var(${colorVar}) / 0.12)` }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Icon className="w-3 h-3" style={{ color: `hsl(var(${colorVar}))` }} />
            <span className="text-[10px] font-semibold" style={{ color: `hsl(var(${colorVar}))` }}>{label}</span>
            {editingKey !== key && (
              <button onClick={() => startEdit(key)} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[hsl(var(--kf-muted)/0.15)]">
                <Pencil className="w-2.5 h-2.5 text-[hsl(var(--kf-muted-foreground))]" />
              </button>
            )}
          </div>
          {editingKey === key ? (
            <div className="space-y-2">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg px-3 py-2 text-[11px] focus:outline-none focus:ring-1"
                style={{ background: "hsl(var(--kf-muted) / 0.1)", border: "1px solid hsl(var(--kf-border) / 0.2)", color: "hsl(var(--kf-foreground))" }}
                autoFocus
              />
              <div className="flex gap-1.5 justify-end">
                <button onClick={cancelEdit} className="px-2 py-1 rounded text-[10px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Cancel</button>
                <button onClick={saveEdit} className="px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1" style={{ background: `hsl(var(${colorVar}) / 0.15)`, color: `hsl(var(${colorVar}))` }}>
                  <Save className="w-2.5 h-2.5" />Save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[hsl(var(--kf-foreground))] leading-relaxed">{canvas[key]}</p>
          )}
        </div>
      ))}
    </motion.div>
  );
}

function RoadmapView({ roadmap }: { roadmap: RoadmapPhase[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      {roadmap.map((phase, i) => (
        <div key={i} className="relative pl-6">
          {i < roadmap.length - 1 && <div className="absolute left-[9px] top-6 bottom-0 w-px" style={{ background: "hsl(var(--kf-accent1) / 0.2)" }} />}
          <div className="absolute left-0 top-1 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: "hsl(var(--kf-accent1))" }}>{i + 1}</div>
          <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.06)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[hsl(var(--kf-foreground))]">{phase.phase}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>{phase.timeline}</span>
            </div>
            {phase.estimatedCost && <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))] mb-2">Budget: {phase.estimatedCost}</p>}
            <div className="space-y-1">
              {phase.objectives?.map((obj, j) => (
                <div key={j} className="flex items-start gap-1.5">
                  <Target className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{obj}</span>
                </div>
              ))}
              {phase.milestones?.map((m, j) => (
                <div key={`m-${j}`} className="flex items-start gap-1.5">
                  <Flag className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                  <span className="text-[11px] text-[hsl(var(--kf-muted-foreground))]">{m}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function ActionsView({ actions, businessId }: { actions: ActionItem[]; businessId: string | null }) {
  const router = useRouter();
  const [creatingTask, setCreatingTask] = useState<number | null>(null);
  const [createdTasks, setCreatedTasks] = useState<Set<number>>(new Set());
  const [taskError, setTaskError] = useState<string | null>(null);

  const priorityColor = (p: string) => p === "HIGH" ? "--kf-error" : p === "MEDIUM" ? "--kf-warning" : "--kf-success";

  const handleCreateTask = async (action: ActionItem, idx: number) => {
    if (!businessId) return;
    setCreatingTask(idx);
    try {
      const projRes = await apiGet<{ id: string }[]>(`/projects/businesses/${businessId}?limit=1`);
      let projectId: string | null = null;
      if (projRes.data && Array.isArray(projRes.data) && projRes.data.length > 0) {
        projectId = projRes.data[0].id;
      } else {
        const newProj = await apiPost<{ id: string }>({
          path: `/projects/businesses/${businessId}`,
          body: { name: "Business Builder Actions", description: "Tasks generated from your AI business plan" },
        });
        projectId = newProj.data?.id ?? null;
      }
      if (projectId) {
        await apiPost({
          path: `/projects/businesses/${businessId}/projects/${projectId}/tasks`,
          body: {
            title: action.action,
            description: `${action.details}\n\nCategory: ${action.category}\nTimeframe: ${action.timeframe}\nPriority: ${action.priority}`,
            priority: action.priority,
            status: "TODO",
          },
        });
        setCreatedTasks((prev) => new Set(prev).add(idx));
      }
    } catch {
      setTaskError("Failed to create task. Please try again.");
      setTimeout(() => setTaskError(null), 4000);
    }
    setCreatingTask(null);
  };

  const handleGoToModule = (mod: string) => {
    const route = MODULE_ROUTES[mod];
    if (route) router.push(route);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1.5">
      {taskError && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(var(--kf-error) / 0.08)", border: "1px solid hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }}>
          {taskError}
        </div>
      )}
      {actions.map((action, i) => (
        <div key={i} className="rounded-xl px-3 py-2.5" style={{ background: "hsl(var(--kf-muted) / 0.04)", border: "1px solid hsl(var(--kf-border) / 0.1)" }}>
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1 flex-shrink-0 mt-0.5">
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `hsl(var(${priorityColor(action.priority)}) / 0.12)`, color: `hsl(var(${priorityColor(action.priority)}))` }}>{action.priority}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-[hsl(var(--kf-foreground))]">{action.action}</span>
              </div>
              <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]">{action.details}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}>{action.category}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}>{action.timeframe}</span>
                {action.module && (
                  <button
                    onClick={() => handleGoToModule(action.module!)}
                    className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors hover:opacity-80"
                    style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                  >
                    <ExternalLink className="w-2 h-2" />
                    {action.module}
                  </button>
                )}
                {createdTasks.has(i) ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}>
                    <CheckCircle2 className="w-2 h-2" />
                    Task created
                  </span>
                ) : (
                  <button
                    onClick={() => handleCreateTask(action, i)}
                    disabled={creatingTask === i}
                    className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors hover:opacity-80 disabled:opacity-50"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                  >
                    {creatingTask === i ? <Loader2 className="w-2 h-2 animate-spin" /> : <Plus className="w-2 h-2" />}
                    Create task
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function LegalView({ legal }: { legal: LegalCompliance }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-accent1) / 0.04)", border: "1px solid hsl(var(--kf-accent1) / 0.12)" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Briefcase className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>Recommended Structure</span>
        </div>
        <p className="text-xs text-[hsl(var(--kf-foreground))] leading-relaxed">{legal.businessStructure}</p>
      </div>

      <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-warning) / 0.04)", border: "1px solid hsl(var(--kf-warning) / 0.12)" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <DollarSign className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} />
          <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-warning))" }}>Tax Obligations</span>
        </div>
        <p className="text-xs text-[hsl(var(--kf-foreground))] leading-relaxed">{legal.taxObligations}</p>
      </div>

      {legal.registrations?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-2 block">Required Registrations</span>
          <div className="space-y-1.5">
            {legal.registrations.map((reg, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{reg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {legal.contracts?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-2 block">Essential Contracts</span>
          <div className="space-y-1.5">
            {legal.contracts.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {legal.insuranceNeeds?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-2 block">Insurance Coverage</span>
          <div className="space-y-1.5">
            {legal.insuranceNeeds.map((ins, i) => (
              <div key={i} className="flex items-start gap-2">
                <Shield className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-info))" }} />
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{ins}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {legal.complianceChecklist?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-success) / 0.04)", border: "1px solid hsl(var(--kf-success) / 0.12)" }}>
          <span className="text-[10px] font-semibold mb-2 block" style={{ color: "hsl(var(--kf-success))" }}>Compliance Checklist</span>
          <div className="space-y-1.5">
            {legal.complianceChecklist.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] font-bold flex-shrink-0 w-4 text-right" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{i + 1}.</span>
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function SWOTView({ analysis, economics }: { analysis: CompetitiveAnalysis; economics: UnitEconomics }) {
  const swotQuadrants = [
    { label: "Strengths", items: analysis.swot.strengths, colorVar: "--kf-success", icon: TrendingUp },
    { label: "Weaknesses", items: analysis.swot.weaknesses, colorVar: "--kf-error", icon: AlertTriangle },
    { label: "Opportunities", items: analysis.swot.opportunities, colorVar: "--kf-accent2", icon: Sparkles },
    { label: "Threats", items: analysis.swot.threats, colorVar: "--kf-warning", icon: Shield },
  ];

  const econMetrics = [
    { label: "CAC", value: economics.customerAcquisitionCost, colorVar: "--kf-accent1" },
    { label: "LTV", value: economics.lifetimeValue, colorVar: "--kf-accent2" },
    { label: "LTV:CAC", value: economics.ltvCacRatio, colorVar: "--kf-success" },
    { label: "ARPU", value: economics.averageRevenue, colorVar: "--kf-info" },
    { label: "Gross Margin", value: economics.grossMargin, colorVar: "--kf-accent1" },
    { label: "Contribution Margin", value: economics.contributionMargin, colorVar: "--kf-accent2" },
    { label: "Payback Period", value: economics.paybackPeriod, colorVar: "--kf-warning" },
    { label: "Break-Even Units", value: economics.breakEvenUnits, colorVar: "--kf-success" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {swotQuadrants.map(({ label, items, colorVar, icon: Icon }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: `hsl(var(${colorVar}) / 0.04)`, border: `1px solid hsl(var(${colorVar}) / 0.12)` }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3 h-3" style={{ color: `hsl(var(${colorVar}))` }} />
              <span className="text-[10px] font-semibold" style={{ color: `hsl(var(${colorVar}))` }}>{label}</span>
            </div>
            <div className="space-y-1">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: `hsl(var(${colorVar}))` }} />
                  <span className="text-[11px] text-[hsl(var(--kf-foreground))] leading-tight">{String(item)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {analysis.competitorLandscape && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-1.5 block">Competitor Landscape</span>
          <p className="text-[11px] text-[hsl(var(--kf-foreground))] leading-relaxed">{analysis.competitorLandscape}</p>
        </div>
      )}

      {analysis.differentiators?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-accent1) / 0.04)", border: "1px solid hsl(var(--kf-accent1) / 0.12)" }}>
          <span className="text-[10px] font-semibold mb-2 block" style={{ color: "hsl(var(--kf-accent1))" }}>Competitive Differentiators</span>
          <div className="space-y-1.5">
            {analysis.differentiators.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{String(d)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.marketEntry && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-accent2) / 0.04)", border: "1px solid hsl(var(--kf-accent2) / 0.12)" }}>
          <span className="text-[10px] font-semibold mb-1.5 block" style={{ color: "hsl(var(--kf-accent2))" }}>Market Entry Strategy</span>
          <p className="text-[11px] text-[hsl(var(--kf-foreground))] leading-relaxed">{analysis.marketEntry}</p>
        </div>
      )}

      <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
        <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-2 block">Unit Economics</span>
        <div className="grid grid-cols-2 gap-2">
          {econMetrics.map(({ label, value, colorVar }) => (
            <div key={label} className="px-2.5 py-2 rounded-lg" style={{ background: `hsl(var(${colorVar}) / 0.04)` }}>
              <span className="text-[9px] font-medium block mb-0.5" style={{ color: `hsl(var(${colorVar}))` }}>{label}</span>
              <span className="text-[11px] font-semibold text-[hsl(var(--kf-foreground))]">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function FinancialsView({ outlook }: { outlook: FinancialOutlook }) {
  const items = [
    { label: "Startup Costs", value: outlook.startupCosts, icon: DollarSign, colorVar: "--kf-accent1" },
    { label: "Monthly Burn", value: outlook.monthlyBurn, icon: TrendingUp, colorVar: "--kf-warning" },
    { label: "Break-Even", value: outlook.breakEvenTimeline, icon: Target, colorVar: "--kf-success" },
    { label: "Year 1 Revenue", value: outlook.yearOneRevenue, icon: BarChart3, colorVar: "--kf-accent2" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ label, value, icon: Icon, colorVar }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: `hsl(var(${colorVar}) / 0.04)`, border: `1px solid hsl(var(${colorVar}) / 0.12)` }}>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="w-3 h-3" style={{ color: `hsl(var(${colorVar}))` }} />
              <span className="text-[10px] font-medium text-[hsl(var(--kf-muted-foreground))]">{label}</span>
            </div>
            <p className="text-xs font-semibold text-[hsl(var(--kf-foreground))]">{value}</p>
          </div>
        ))}
      </div>
      {outlook.fundingStrategy && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-accent1) / 0.04)", border: "1px solid hsl(var(--kf-accent1) / 0.12)" }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Briefcase className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>Funding Strategy</span>
          </div>
          <p className="text-[11px] text-[hsl(var(--kf-foreground))] leading-relaxed">{outlook.fundingStrategy}</p>
        </div>
      )}
      {outlook.cashFlowProjection && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-accent2) / 0.04)", border: "1px solid hsl(var(--kf-accent2) / 0.12)" }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart3 className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>Cash Flow Projection</span>
          </div>
          <p className="text-[11px] text-[hsl(var(--kf-foreground))] leading-relaxed">{outlook.cashFlowProjection}</p>
        </div>
      )}
      {outlook.keyMetrics?.length > 0 && (
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.05)", border: "1px solid hsl(var(--kf-border) / 0.12)" }}>
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-muted-foreground))] mb-2 block">Key Metrics to Track</span>
          <div className="space-y-1">
            {outlook.keyMetrics.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} />
                <span className="text-[11px] text-[hsl(var(--kf-foreground))]">{m}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function RisksView({ risks }: { risks: Risk[] }) {
  const impactColor = (p: string) => p === "HIGH" ? "--kf-error" : p === "MEDIUM" ? "--kf-warning" : "--kf-success";
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
      {risks.map((risk, i) => (
        <div key={i} className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted) / 0.04)", border: "1px solid hsl(var(--kf-border) / 0.1)" }}>
          <div className="flex items-start gap-2 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: `hsl(var(${impactColor(risk.impact)}))` }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-[hsl(var(--kf-foreground))]">{risk.risk}</span>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `hsl(var(${impactColor(risk.impact)}) / 0.12)`, color: `hsl(var(${impactColor(risk.impact)}))` }}>Impact: {risk.impact}</span>
                {risk.likelihood && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: `hsl(var(${impactColor(risk.likelihood)}) / 0.12)`, color: `hsl(var(${impactColor(risk.likelihood)}))` }}>Likelihood: {risk.likelihood}</span>
                )}
                {risk.category && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}>{risk.category}</span>
                )}
              </div>
            </div>
          </div>
          <div className="ml-5 space-y-1.5">
            <div className="flex items-start gap-1.5">
              <Shield className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]"><span className="font-medium text-[hsl(var(--kf-foreground))]">Mitigation:</span> {risk.mitigation}</p>
            </div>
            {risk.contingency && (
              <div className="flex items-start gap-1.5">
                <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
                <p className="text-[10px] text-[hsl(var(--kf-muted-foreground))]"><span className="font-medium text-[hsl(var(--kf-foreground))]">Contingency:</span> {risk.contingency}</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
