export interface GuidanceProfile {
  founderName: string;
  founderRole: string;
  founderLocation: string;
  experienceLevel: string;
  weeklyHours: number | null;
  employmentStatus: string;
  cashCapacity: string;
  willingnessToHire: string;
  primaryGoal: string;

  businessName: string;
  industry: string;
  businessStage: string;
  businessType: string;
  legalStatus: string;
  teamSize: number | null;
  website: string;
  socialLinks: string[];

  offerName: string;
  offerCategory: string;
  offerDescription: string;
  problemSolved: string;
  whyCustomersBuy: string;
  deliveryMethod: string;
  differentiator: string;
  clarityRating: number;
  packageStructure: string;

  idealCustomer: string;
  customerSegment: string;
  b2bOrB2c: string;
  painPoints: string;
  budgetLevel: string;
  customerGeography: string;
  specificityRating: number;
  currentCustomerCount: number | null;
  targetCustomerCount: number | null;

  revenueModelType: string;
  pricingModel: string;
  priceRange: string;
  averageOrderValue: number | null;
  lifetimeValue: number | null;
  monthlySalesVolume: number | null;
  upsellExists: boolean;
  upsellDescription: string;
  seasonality: string;

  startupBudget: number | null;
  cashOnHand: number | null;
  fixedCosts: number | null;
  variableCosts: number | null;
  itemizedMonthlyCosts: string;
  taxEstimate: number | null;
  revenueTarget: number | null;
  profitTarget: number | null;
  fundingSource: string;

  fulfillmentModel: string;
  deliverySteps: string[];
  suppliers: string;
  tools: string[];
  teamRoles: string[];
  onboardingProcess: string;
  supportProcess: string;
  retentionProcess: string;
  workflowDocumentation: string;
  bottlenecks: string;

  registrationStatus: string;
  legalStructure: string;
  taxId: string;
  bankAccount: string;
  licensesRequired: string;
  insuranceStatus: string;
  contractsInPlace: string;
  privacyPolicy: string;
  termsOfService: string;
  collectsCustomerData: boolean;
  dataSecurityMeasures: string;
  bookkeepingMethod: string;

  leadSource: string;
  marketingChannels: string[];
  hasCrm: boolean;
  hasPipeline: boolean;
  hasConversionTracking: boolean;
  emailListSize: number | null;
  hasReferralProgram: boolean;
  usesAds: boolean;
  hasContentStrategy: boolean;
  hasPartnerships: boolean;
  monthlyLeads: number | null;
  conversionRate: number | null;
  retentionStrategy: string;

  biggestChallenges: string;
  shortTermGoals: string;
  mediumTermGoals: string;
  definitionOfSuccess: string;
  urgencyLevel: number;
}

export const DEFAULT_GUIDANCE_PROFILE: GuidanceProfile = {
  founderName: "",
  founderRole: "",
  founderLocation: "",
  experienceLevel: "",
  weeklyHours: null,
  employmentStatus: "",
  cashCapacity: "",
  willingnessToHire: "",
  primaryGoal: "",

  businessName: "",
  industry: "",
  businessStage: "",
  businessType: "",
  legalStatus: "",
  teamSize: null,
  website: "",
  socialLinks: [],

  offerName: "",
  offerCategory: "",
  offerDescription: "",
  problemSolved: "",
  whyCustomersBuy: "",
  deliveryMethod: "",
  differentiator: "",
  clarityRating: 3,
  packageStructure: "",

  idealCustomer: "",
  customerSegment: "",
  b2bOrB2c: "",
  painPoints: "",
  budgetLevel: "",
  customerGeography: "",
  specificityRating: 3,
  currentCustomerCount: null,
  targetCustomerCount: null,

  revenueModelType: "",
  pricingModel: "",
  priceRange: "",
  averageOrderValue: null,
  lifetimeValue: null,
  monthlySalesVolume: null,
  upsellExists: false,
  upsellDescription: "",
  seasonality: "",

  startupBudget: null,
  cashOnHand: null,
  fixedCosts: null,
  variableCosts: null,
  itemizedMonthlyCosts: "",
  taxEstimate: null,
  revenueTarget: null,
  profitTarget: null,
  fundingSource: "",

  fulfillmentModel: "",
  deliverySteps: [],
  suppliers: "",
  tools: [],
  teamRoles: [],
  onboardingProcess: "",
  supportProcess: "",
  retentionProcess: "",
  workflowDocumentation: "",
  bottlenecks: "",

  registrationStatus: "",
  legalStructure: "",
  taxId: "",
  bankAccount: "",
  licensesRequired: "",
  insuranceStatus: "",
  contractsInPlace: "",
  privacyPolicy: "",
  termsOfService: "",
  collectsCustomerData: false,
  dataSecurityMeasures: "",
  bookkeepingMethod: "",

  leadSource: "",
  marketingChannels: [],
  hasCrm: false,
  hasPipeline: false,
  hasConversionTracking: false,
  emailListSize: null,
  hasReferralProgram: false,
  usesAds: false,
  hasContentStrategy: false,
  hasPartnerships: false,
  monthlyLeads: null,
  conversionRate: null,
  retentionStrategy: "",

  biggestChallenges: "",
  shortTermGoals: "",
  mediumTermGoals: "",
  definitionOfSuccess: "",
  urgencyLevel: 3,
};

export const WIZARD_STEPS = [
  { key: "welcome", label: "Welcome", number: 0 },
  { key: "founder", label: "Founder Context", number: 1 },
  { key: "identity", label: "Business Identity", number: 2 },
  { key: "offer", label: "Offer Definition", number: 3 },
  { key: "customer", label: "Customer Definition", number: 4 },
  { key: "revenue", label: "Revenue Model", number: 5 },
  { key: "finance", label: "Cost & Finance", number: 6 },
  { key: "operations", label: "Operations", number: 7 },
  { key: "legal", label: "Legal & Compliance", number: 8 },
  { key: "growth", label: "Growth & Acquisition", number: 9 },
  { key: "constraints", label: "Constraints & Goals", number: 10 },
  { key: "review", label: "Review", number: 11 },
  { key: "generate", label: "Generate Analysis", number: 12 },
] as const;

export type StepKey = typeof WIZARD_STEPS[number]["key"];

export const EXPERIENCE_LEVELS = [
  { value: "none", label: "No prior business experience" },
  { value: "beginner", label: "1-2 years" },
  { value: "intermediate", label: "3-5 years" },
  { value: "experienced", label: "5-10 years" },
  { value: "expert", label: "10+ years" },
];

export const EMPLOYMENT_STATUSES = [
  { value: "full-time-employed", label: "Full-time employed" },
  { value: "part-time-employed", label: "Part-time employed" },
  { value: "self-employed", label: "Self-employed / Full-time founder" },
  { value: "unemployed", label: "Currently unemployed" },
  { value: "student", label: "Student" },
  { value: "retired", label: "Retired" },
];

export const BUSINESS_TYPES = [
  { value: "services", label: "Services" },
  { value: "products", label: "Products" },
  { value: "saas", label: "SaaS / Software" },
  { value: "clinic", label: "Clinic / Healthcare" },
  { value: "ecommerce", label: "E-Commerce" },
  { value: "consulting", label: "Consulting" },
  { value: "agency", label: "Agency" },
  { value: "marketplace", label: "Marketplace" },
  { value: "mixed", label: "Mixed / Hybrid" },
];

export const LEGAL_STATUSES = [
  { value: "sole-proprietor", label: "Sole Proprietorship" },
  { value: "llc", label: "Limited Liability Company (LLC)" },
  { value: "corporation", label: "Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "non-profit", label: "Non-Profit" },
  { value: "not-registered", label: "Not yet registered" },
];

export const BUSINESS_STAGES_GUIDANCE = [
  { value: "idea", label: "Idea — still planning" },
  { value: "pre-launch", label: "Pre-launch — building" },
  { value: "launched", label: "Launched — early customers" },
  { value: "growing", label: "Growing — consistent revenue" },
  { value: "scaling", label: "Scaling — expanding rapidly" },
  { value: "established", label: "Established — stable business" },
];

export const REVENUE_MODELS = [
  { value: "one-time", label: "One-time sales" },
  { value: "subscription", label: "Subscription / Recurring" },
  { value: "freemium", label: "Freemium" },
  { value: "commission", label: "Commission-based" },
  { value: "retainer", label: "Retainer / Contract" },
  { value: "per-project", label: "Per-project billing" },
  { value: "advertising", label: "Advertising-supported" },
  { value: "mixed", label: "Mixed model" },
];

export const PRICING_MODELS = [
  { value: "fixed", label: "Fixed pricing" },
  { value: "tiered", label: "Tiered pricing" },
  { value: "usage", label: "Usage-based" },
  { value: "custom", label: "Custom / Negotiated" },
  { value: "value", label: "Value-based" },
  { value: "hourly", label: "Hourly rate" },
];

export const FULFILLMENT_MODELS = [
  { value: "self", label: "Self-fulfilled" },
  { value: "outsourced", label: "Outsourced / Third-party" },
  { value: "hybrid", label: "Hybrid" },
  { value: "digital", label: "Digital / Automated delivery" },
  { value: "dropship", label: "Dropshipping" },
];

export const MARKETING_CHANNEL_OPTIONS = [
  "Social Media (Organic)",
  "Social Media (Paid)",
  "Google Ads",
  "SEO / Content Marketing",
  "Email Marketing",
  "Referrals / Word of Mouth",
  "Events / Networking",
  "Influencer Marketing",
  "Partnerships",
  "Cold Outreach",
  "Marketplace Listings",
  "Print / Traditional Media",
];

export const FUNDING_SOURCES = [
  { value: "self-funded", label: "Self-funded / Bootstrapped" },
  { value: "family-friends", label: "Family & Friends" },
  { value: "bank-loan", label: "Bank Loan" },
  { value: "grant", label: "Grant / Government funding" },
  { value: "angel", label: "Angel Investor" },
  { value: "vc", label: "Venture Capital" },
  { value: "crowdfunding", label: "Crowdfunding" },
  { value: "revenue", label: "Revenue-funded" },
];

export const INDUSTRY_OPTIONS_GUIDANCE = [
  "Technology", "Healthcare", "Finance", "Education", "Retail",
  "Food & Beverage", "Creative & Design", "Consulting", "Real Estate",
  "Fitness & Wellness", "Tourism & Hospitality", "Agriculture",
  "Construction", "Manufacturing", "Media & Entertainment",
  "Non-Profit", "Professional Services", "E-commerce",
  "Beauty & Personal Care", "Transportation & Logistics", "Other",
];
