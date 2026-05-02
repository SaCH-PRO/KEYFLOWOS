import {
  Lightbulb,
  Rocket,
  Settings,
  TrendingUp,
  Sparkles,
  Target,
  DollarSign,
  Users,
  BarChart3,
  FileText,
  Calendar,
  ShoppingBag,
  Megaphone,
  Zap,
  Brain,
  AlertTriangle,
  Shield,
  Globe,
  Briefcase,
  Flag,
  Layers,
  Activity,
  Crosshair,
} from "lucide-react";
import type {
  Phase,
  BusinessModelCanvas,
  IntakeForm,
  RoadmapPhase,
  ActionItem,
  Risk,
  AssumptionEntry,
  GeneratedModel,
} from "./business-builder-types";

export const DOCUMENT_SLUG_NAMES: Record<string, string> = {
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

export const MODULE_ROUTES: Record<string, string> = {
  projects: "/app/projects",
  bookings: "/app/bookings",
  commerce: "/app/commerce",
  marketing: "/app/marketing",
  expenses: "/app/expenses",
  contacts: "/app/crm/pipeline",
  store: "/app/store",
  documents: "/app/profile?tab=documents",
  reports: "/app/reports",
  settings: "/app/settings",
  today: "/app",
  profile: "/app/profile",
};

export type QuickLink = { label: string; path: string; icon: React.ElementType; colorVar: string };

export const TAB_QUICK_LINKS: Record<string, QuickLink[]> = {
  overview: [
    { label: "Today Dashboard", path: "/app", icon: Zap, colorVar: "--kf-accent1" },
    { label: "Reports", path: "/app/reports", icon: BarChart3, colorVar: "--kf-accent2" },
    { label: "Documents", path: "/app/profile?tab=documents", icon: FileText, colorVar: "--kf-info" },
  ],
  canvas: [
    { label: "Commerce", path: "/app/commerce", icon: DollarSign, colorVar: "--kf-accent1" },
    { label: "Contacts", path: "/app/crm/pipeline", icon: Users, colorVar: "--kf-accent2" },
    { label: "Store", path: "/app/store", icon: ShoppingBag, colorVar: "--kf-info" },
    { label: "Marketing", path: "/app/marketing", icon: Megaphone, colorVar: "--kf-success" },
  ],
  swot: [
    { label: "Marketing", path: "/app/marketing", icon: Megaphone, colorVar: "--kf-accent1" },
    { label: "Contacts", path: "/app/crm/pipeline", icon: Users, colorVar: "--kf-accent2" },
    { label: "Reports", path: "/app/reports", icon: BarChart3, colorVar: "--kf-info" },
  ],
  financials: [
    { label: "Expenses", path: "/app/expenses", icon: DollarSign, colorVar: "--kf-warning" },
    { label: "Commerce", path: "/app/commerce", icon: ShoppingBag, colorVar: "--kf-accent1" },
    { label: "Reports", path: "/app/reports", icon: BarChart3, colorVar: "--kf-accent2" },
  ],
  roadmap: [
    { label: "Projects", path: "/app/projects", icon: Target, colorVar: "--kf-accent1" },
    { label: "Bookings", path: "/app/bookings", icon: Calendar, colorVar: "--kf-accent2" },
    { label: "Store", path: "/app/store", icon: ShoppingBag, colorVar: "--kf-info" },
  ],
  actions: [
    { label: "Projects", path: "/app/projects", icon: Target, colorVar: "--kf-accent1" },
    { label: "Today", path: "/app", icon: Zap, colorVar: "--kf-accent2" },
  ],
  risks: [
    { label: "Projects", path: "/app/projects", icon: Target, colorVar: "--kf-accent1" },
    { label: "Reports", path: "/app/reports", icon: BarChart3, colorVar: "--kf-accent2" },
    { label: "Documents", path: "/app/profile?tab=documents", icon: FileText, colorVar: "--kf-info" },
  ],
  governance: [
    { label: "Reports", path: "/app/reports", icon: BarChart3, colorVar: "--kf-success" },
    { label: "Settings", path: "/app/settings", icon: Settings, colorVar: "--kf-accent1" },
    { label: "Projects", path: "/app/projects", icon: Target, colorVar: "--kf-accent2" },
  ],
};

export const INTAKE_STEPS = [
  { id: "idea", label: "Business Idea", icon: Lightbulb, field: "businessIdea" as const, placeholder: "Describe your business idea in detail — what product or service will you offer?", hint: "Be specific about what you're building. E.g. 'A mobile car detailing service targeting luxury car owners in Port of Spain'" },
  { id: "industry", label: "Industry & Sector", icon: Layers, field: "industry" as const, placeholder: "What industry or sector does your business operate in?", hint: "E.g. 'Automotive services', 'Healthcare tech', 'Food & beverage', 'Professional consulting', 'E-commerce retail'" },
  { id: "problem", label: "Problem You Solve", icon: Crosshair, field: "problemSolved" as const, placeholder: "What specific problem does your business solve? Who has this problem and how are they currently dealing with it?", hint: "The clearer the problem, the stronger your plan. E.g. 'Luxury car owners in Trinidad have no convenient, high-quality mobile detailing option — they waste hours dropping off at shops'" },
  { id: "market", label: "Target Market", icon: Users, field: "targetMarket" as const, placeholder: "Who are your ideal customers? What demographics, behaviors, or needs define them?", hint: "Think demographics (age, income, location), psychographics (values, lifestyle), and buying behavior" },
  { id: "value", label: "Value Proposition", icon: Sparkles, field: "valueProposition" as const, placeholder: "What unique value do you bring? Why would customers choose you over alternatives?", hint: "Focus on your unfair advantage — what problem you solve better than anyone else" },
  { id: "revenue", label: "Revenue Model", icon: DollarSign, field: "revenueModel" as const, placeholder: "How will you make money? Include pricing strategy and expected price points.", hint: "E.g. 'Per-service pricing ($500-2000 TTD per detail) + monthly subscription plans ($800 TTD/mo)'" },
  { id: "budget", label: "Budget & Funding", icon: BarChart3, field: "budget" as const, placeholder: "What's your available startup capital? Are you self-funding, seeking a loan, or looking for investors?", hint: "Be honest about your financial starting point. E.g. '$50,000 TTD personal savings + considering NEDCO loan'" },
  { id: "team", label: "Team & Resources", icon: Users, field: "teamSize" as const, placeholder: "Who's on your team? What skills do you have, and what do you need to hire for?", hint: "E.g. 'Just me (marketing background) — will need a developer and operations person within 6 months'" },
  { id: "assets", label: "Assets & Resources", icon: Briefcase, field: "assets" as const, placeholder: "What existing resources, skills, networks, equipment, or advantages do you already have?", hint: "Include: existing customer base, industry connections, equipment, IP, relevant experience, brand recognition, partnerships" },
  { id: "location", label: "Location & Market", icon: Globe, field: "location" as const, placeholder: "Where will you operate? What's your primary market geography?", hint: "E.g. 'Based in Port of Spain, serving all of Trinidad initially, expanding to Tobago and Caribbean within Year 2'" },
  { id: "competitive", label: "Competitive Landscape", icon: Activity, field: "competitiveContext" as const, placeholder: "Who are your main competitors? How are they positioned? What do they do well or poorly?", hint: "Name specific competitors if possible. Include direct competitors (same service) and indirect competitors (alternative solutions)" },
  { id: "goals", label: "Goals & Vision", icon: Flag, field: "goals" as const, placeholder: "What are your 6-month and 12-month goals? Where do you see this business in 3 years?", hint: "Include revenue targets, customer milestones, hiring plans, or expansion goals" },
  { id: "challenges", label: "Challenges & Risks", icon: AlertTriangle, field: "challenges" as const, placeholder: "What obstacles or concerns do you foresee? What keeps you up at night about this venture?", hint: "Common Caribbean challenges: import costs, forex limitations, finding skilled staff, seasonal fluctuations, competition" },
  { id: "salesApproach", label: "Sales Strategy", icon: Target, field: "salesApproach" as const, placeholder: "How will you sell? Describe your sales process, channels, and how you'll follow up with leads.", hint: "E.g. 'Direct outreach via Instagram DMs and WhatsApp, in-person consultations, referral-based growth. Average deal closes in 2 weeks.'" },
  { id: "marketingStrategy", label: "Marketing & Content", icon: Megaphone, field: "marketingStrategy" as const, placeholder: "What's your brand voice? What content will you create? Which platforms will you focus on?", hint: "Think about: brand personality, content pillars (topics you'll cover), posting frequency, and your overall messaging framework." },
  { id: "peopleStrategy", label: "People & Culture", icon: Users, field: "peopleStrategy" as const, placeholder: "What culture do you want to build? What key roles do you need to hire? How will you find and retain talent?", hint: "Consider: company values, hiring approach, compensation philosophy, remote/in-office policy, and training plans." },
  { id: "technologyStack", label: "Technology & Digital", icon: Settings, field: "technologyStack" as const, placeholder: "What tools and technology do you use or plan to use? How digitally mature is your business?", hint: "E.g. 'Using Shopify for e-commerce, QuickBooks for accounting, Instagram for marketing. Planning to add email automation.'" },
  { id: "partnerships", label: "Partnerships & Ecosystem", icon: Users, field: "partnerships" as const, placeholder: "Who are your key suppliers, partners, or collaborators? Any strategic alliances or industry associations?", hint: "Think about: supply chain, distribution partners, referral networks, industry groups, and community involvement." },
  { id: "intellectualProperty", label: "Intellectual Property", icon: Shield, field: "intellectualProperty" as const, placeholder: "Do you have trademarks, patents, proprietary processes, or unique brand assets to protect?", hint: "Consider: business name/logo trademarks, unique recipes/formulas, proprietary software, domain names, and trade secrets." },
];

export const STAGE_OPTIONS = [
  { value: "IDEA", label: "Just an Idea", description: "I'm still thinking through the concept" },
  { value: "PLANNING", label: "Planning", description: "I'm researching and laying groundwork" },
  { value: "STARTUP", label: "Early Startup", description: "I've started but haven't launched yet" },
  { value: "LAUNCHED", label: "Launched", description: "I'm live and getting first customers" },
  { value: "GROWING", label: "Growing", description: "I have traction and want to scale" },
];

export const LEGAL_STRUCTURE_OPTIONS = [
  { value: "SOLE_TRADER", label: "Sole Trader", description: "Simplest structure — you and the business are one entity" },
  { value: "PARTNERSHIP", label: "Partnership", description: "Two or more owners sharing profits and liability" },
  { value: "LLC", label: "Limited Liability Company", description: "Separate legal entity protecting personal assets" },
  { value: "LIMITED", label: "Limited Company", description: "Formal corporate structure with shareholders and directors" },
  { value: "UNSURE", label: "Not Sure Yet", description: "I'd like the AI to recommend the best structure" },
];

export const TIMELINE_OPTIONS = [
  { value: "ASAP", label: "Ready to Launch", description: "Within the next 1-2 months" },
  { value: "3_MONTHS", label: "3 Months", description: "Building foundations over the next quarter" },
  { value: "6_MONTHS", label: "6 Months", description: "Taking time to plan and prepare properly" },
  { value: "12_MONTHS", label: "12+ Months", description: "Long-term planning before launch" },
];

export const INTERACTION_MODE_OPTIONS = [
  { value: "founder", label: "Founder Mode", description: "Shape ideas and early-stage business design", icon: Lightbulb },
  { value: "executive", label: "Executive Mode", description: "High-level, decision-grade strategic summaries", icon: Briefcase },
  { value: "operator", label: "Operator Mode", description: "Practical systems, workflows, and SOPs", icon: Settings },
  { value: "analyst", label: "Analyst Mode", description: "Deep diagnosis, frameworks, and rigorous evaluation", icon: BarChart3 },
  { value: "investor", label: "Investor Mode", description: "Attractiveness, risk, scalability, and returns", icon: TrendingUp },
  { value: "compliance", label: "Compliance Mode", description: "Regulation, governance, and legal-review focus", icon: Shield },
  { value: "builder", label: "Builder Mode", description: "Comprehensive operational and documentation systems", icon: Layers },
];

export const CANVAS_LABELS: { key: keyof BusinessModelCanvas; label: string; icon: React.ElementType; colorVar: string }[] = [
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

export const PROGRESS_PHASES: Phase[] = [
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
      { label: "First Contact", description: "Add or import your first customers", icon: Users, route: "/app/crm/pipeline", doneKey: "hasContacts" },
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

export const INITIAL_INTAKE: IntakeForm = {
  businessIdea: "", targetMarket: "", valueProposition: "",
  revenueModel: "", goals: "", stage: "", challenges: "",
  budget: "", timeline: "", teamSize: "", location: "",
  legalStructure: "", industry: "", problemSolved: "",
  assets: "", competitiveContext: "", interactionMode: "founder",
  salesApproach: "", marketingStrategy: "", peopleStrategy: "",
  technologyStack: "", partnerships: "", intellectualProperty: "",
};

export function safeArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

export function validateModel(raw: unknown): GeneratedModel {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const canvasRaw = (m.canvas && typeof m.canvas === "object" ? m.canvas : {}) as Record<string, unknown>;
  const toStr = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n• ");
    if (v && typeof v === "object") return Object.entries(v).map(([k, val]) => `${k}: ${typeof val === "string" ? val : JSON.stringify(val)}`).join("\n");
    return "";
  };
  const canvas: Record<string, string> = {};
  for (const k of ["valueProposition", "customerSegments", "channels", "customerRelationships", "revenueStreams", "keyResources", "keyActivities", "keyPartnerships", "costStructure"]) {
    canvas[k] = toStr(canvasRaw[k]);
  }
  const fin = (m.financialOutlook && typeof m.financialOutlook === "object" ? m.financialOutlook : {}) as Record<string, unknown>;
  const comp = (m.competitiveAnalysis && typeof m.competitiveAnalysis === "object" ? m.competitiveAnalysis : {}) as Record<string, unknown>;
  const swotRaw = (comp.swot && typeof comp.swot === "object" ? comp.swot : {}) as Record<string, unknown>;
  const unit = (m.unitEconomics && typeof m.unitEconomics === "object" ? m.unitEconomics : {}) as Record<string, unknown>;
  const brief = (m.executiveBrief && typeof m.executiveBrief === "object" ? m.executiveBrief : {}) as Record<string, unknown>;
  const gov = (m.governanceFramework && typeof m.governanceFramework === "object" ? m.governanceFramework : {}) as Record<string, unknown>;
  const qs = (m.qualityScore && typeof m.qualityScore === "object" ? m.qualityScore : {}) as Record<string, unknown>;
  const s = (v: unknown, f = "") => typeof v === "string" ? v : f;
  const a = (v: unknown) => Array.isArray(v) ? v : [];
  const n = (v: unknown, f = 7) => typeof v === "number" ? v : f;

  const safeRoadmap = (arr: unknown[]): RoadmapPhase[] =>
    arr.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        phase: s(item.phase, "Phase"),
        timeline: s(item.timeline, "TBD"),
        objectives: a(item.objectives).map(String),
        milestones: a(item.milestones).map(String),
        estimatedCost: s(item.estimatedCost),
        dependencies: a(item.dependencies).map(String),
        reviewPoints: a(item.reviewPoints).map(String),
      }));

  const safeActions = (arr: unknown[]): ActionItem[] =>
    arr.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        priority: (s(item.priority, "MEDIUM") as ActionItem["priority"]),
        action: s(item.action, "Action item"),
        category: s(item.category, "SETUP"),
        timeframe: s(item.timeframe, "This month"),
        details: s(item.details),
        module: item.module ? s(item.module) : undefined,
        canParallel: typeof item.canParallel === "boolean" ? item.canParallel : undefined,
        requiresExternal: typeof item.requiresExternal === "boolean" ? item.requiresExternal : undefined,
      }));

  const safeRisks = (arr: unknown[]): Risk[] =>
    arr.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        risk: s(item.risk, "Risk"),
        impact: (s(item.impact, "MEDIUM") as Risk["impact"]),
        likelihood: item.likelihood ? s(item.likelihood) as Risk["likelihood"] : undefined,
        category: item.category ? s(item.category) : undefined,
        mitigation: s(item.mitigation),
        contingency: item.contingency ? s(item.contingency) : undefined,
        owner: item.owner ? s(item.owner) : undefined,
      }));

  const safeAssumptions = (arr: unknown[]): AssumptionEntry[] =>
    arr.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        assumption: s(item.assumption, "Assumption"),
        category: s(item.category, "GENERAL"),
        confidence: s(item.confidence, "MEDIUM"),
        validationMethod: s(item.validationMethod),
        impactIfWrong: s(item.impactIfWrong),
      }));

  return {
    summary: s(m.summary),
    executiveBrief: {
      businessThesis: s(brief.businessThesis),
      conceptSummary: s(brief.conceptSummary),
      opportunitySize: s(brief.opportunitySize),
      keyAssumptions: a(brief.keyAssumptions).map(String),
      validationNeeded: a(brief.validationNeeded).map(String),
      expertReviewAreas: a(brief.expertReviewAreas).map(String),
      confidenceLevel: s(brief.confidenceLevel, "MEDIUM"),
      confidenceRationale: s(brief.confidenceRationale),
    },
    canvas: {
      valueProposition: canvas.valueProposition ?? "",
      customerSegments: canvas.customerSegments ?? "",
      channels: canvas.channels ?? "",
      customerRelationships: canvas.customerRelationships ?? "",
      revenueStreams: canvas.revenueStreams ?? "",
      keyResources: canvas.keyResources ?? "",
      keyActivities: canvas.keyActivities ?? "",
      keyPartnerships: canvas.keyPartnerships ?? "",
      costStructure: canvas.costStructure ?? "",
    },
    competitiveAnalysis: {
      swot: {
        strengths: a(swotRaw.strengths).map(String),
        weaknesses: a(swotRaw.weaknesses).map(String),
        opportunities: a(swotRaw.opportunities).map(String),
        threats: a(swotRaw.threats).map(String),
      },
      competitorLandscape: s(comp.competitorLandscape),
      differentiators: a(comp.differentiators).map(String),
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
    roadmap: safeRoadmap(a(m.roadmap)),
    actionPlan: safeActions(a(m.actionPlan)),
    financialOutlook: {
      startupCosts: s(fin.startupCosts, "Not estimated"),
      monthlyBurn: s(fin.monthlyBurn, "Not estimated"),
      breakEvenTimeline: s(fin.breakEvenTimeline, "Not estimated"),
      yearOneRevenue: s(fin.yearOneRevenue, "Not estimated"),
      keyMetrics: a(fin.keyMetrics).map(String),
      fundingStrategy: s(fin.fundingStrategy),
      cashFlowProjection: s(fin.cashFlowProjection),
      sensitivityAnalysis: s(fin.sensitivityAnalysis),
    },
    risks: safeRisks(a(m.risks)),
    assumptionsRegister: safeAssumptions(a(m.assumptionsRegister)),
    governanceFramework: {
      operatingModel: s(gov.operatingModel),
      reviewCadence: s(gov.reviewCadence),
      kpiFramework: a(gov.kpiFramework).map(String),
      escalationPathways: s(gov.escalationPathways),
      decisionRights: s(gov.decisionRights),
    },
    qualityScore: {
      logicalCoherence: n(qs.logicalCoherence),
      comprehensiveness: n(qs.comprehensiveness),
      contextSpecificity: n(qs.contextSpecificity),
      commercialRelevance: n(qs.commercialRelevance),
      actionability: n(qs.actionability),
      financialSensibility: n(qs.financialSensibility),
      operationalFeasibility: n(qs.operationalFeasibility),
      riskIdentification: n(qs.riskIdentification),
      overallGrade: s(qs.overallGrade, "B"),
      improvementAreas: a(qs.improvementAreas).map(String),
    },
    recommendedDocuments: a(m.recommendedDocuments).map(String),
  };
}
