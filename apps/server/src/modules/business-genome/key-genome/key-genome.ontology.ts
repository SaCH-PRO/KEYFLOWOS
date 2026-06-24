/**
 * KEY Genome ontology.
 *
 * This file is the single source of truth for the business intelligence
 * kernel. It defines the sections, domains, scoring weights, and fact
 * requirement shapes that all KEY Genome services use.
 *
 * It intentionally does not mutate Blueprint or other modules. It is a
 * contract layer.
 */

export type KeyGenomeSection =
  | 'FOUNDER_LEADERSHIP'
  | 'VISION_IDENTITY'
  | 'BUSINESS_MODEL'
  | 'CUSTOMER_MARKET'
  | 'OFFER_PRODUCT'
  | 'FINANCIAL'
  | 'LEGAL_GOVERNANCE_COMPLIANCE'
  | 'OPERATIONS_DELIVERY'
  | 'SALES'
  | 'MARKETING_GROWTH'
  | 'TECH_DATA_INTELLIGENCE'
  | 'RISK_RESILIENCE';

export const KEY_GENOME_SECTIONS: KeyGenomeSection[] = [
  'FOUNDER_LEADERSHIP',
  'VISION_IDENTITY',
  'BUSINESS_MODEL',
  'CUSTOMER_MARKET',
  'OFFER_PRODUCT',
  'FINANCIAL',
  'LEGAL_GOVERNANCE_COMPLIANCE',
  'OPERATIONS_DELIVERY',
  'SALES',
  'MARKETING_GROWTH',
  'TECH_DATA_INTELLIGENCE',
  'RISK_RESILIENCE',
];

export const KEY_GENOME_SECTION_WEIGHTS: Record<KeyGenomeSection, number> = {
  FOUNDER_LEADERSHIP: 8,
  VISION_IDENTITY: 6,
  BUSINESS_MODEL: 10,
  CUSTOMER_MARKET: 10,
  OFFER_PRODUCT: 10,
  FINANCIAL: 12,
  LEGAL_GOVERNANCE_COMPLIANCE: 10,
  OPERATIONS_DELIVERY: 10,
  SALES: 7,
  MARKETING_GROWTH: 7,
  TECH_DATA_INTELLIGENCE: 5,
  RISK_RESILIENCE: 5,
};

export const KEY_GENOME_TOTAL_WEIGHT = Object.values(KEY_GENOME_SECTION_WEIGHTS).reduce(
  (sum, w) => sum + w,
  0,
);

export interface KeyGenomeSectionConfig {
  key: KeyGenomeSection;
  label: string;
  weight: number;
  description: string;
  blueprintSources: string[];
  requiredFacts: GenomeFactRequirement[];
  optionalFacts: GenomeFactRequirement[];
  moduleImpact: string[];
}

export interface GenomeFactRequirement {
  section: KeyGenomeSection;
  domain: string;
  field: string;
  label: string;
  impact: 'BLOCKING' | 'DEGRADED' | 'OPTIONAL';
}

export const KEY_GENOME_SECTION_CONFIG: Record<KeyGenomeSection, KeyGenomeSectionConfig> = {
  FOUNDER_LEADERSHIP: {
    key: 'FOUNDER_LEADERSHIP',
    label: 'Founder & Leadership',
    weight: KEY_GENOME_SECTION_WEIGHTS.FOUNDER_LEADERSHIP,
    description: 'Who is building the business, what they know, and how they operate.',
    blueprintSources: ['founderProfile', 'team'],
    requiredFacts: [
      { section: 'FOUNDER_LEADERSHIP', domain: 'founder', field: 'experience_level', label: 'Founder experience level', impact: 'DEGRADED' },
      { section: 'FOUNDER_LEADERSHIP', domain: 'founder', field: 'time_commitment', label: 'Time commitment', impact: 'BLOCKING' },
    ],
    optionalFacts: [
      { section: 'FOUNDER_LEADERSHIP', domain: 'team', field: 'co_founders', label: 'Co-founders', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['people_flow', 'sop', 'key_autonomy'],
  },
  VISION_IDENTITY: {
    key: 'VISION_IDENTITY',
    label: 'Vision & Identity',
    weight: KEY_GENOME_SECTION_WEIGHTS.VISION_IDENTITY,
    description: 'What the business stands for, its name, mission, and brand voice.',
    blueprintSources: ['identity'],
    requiredFacts: [
      { section: 'VISION_IDENTITY', domain: 'identity', field: 'business_name', label: 'Business name', impact: 'BLOCKING' },
      { section: 'VISION_IDENTITY', domain: 'identity', field: 'mission', label: 'Mission', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'VISION_IDENTITY', domain: 'brand', field: 'voice', label: 'Brand voice', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['marketing', 'key_inbox', 'content_ops'],
  },
  BUSINESS_MODEL: {
    key: 'BUSINESS_MODEL',
    label: 'Business Model',
    weight: KEY_GENOME_SECTION_WEIGHTS.BUSINESS_MODEL,
    description: 'How the business creates, delivers, and captures value.',
    blueprintSources: ['operatingModel'],
    requiredFacts: [
      { section: 'BUSINESS_MODEL', domain: 'model', field: 'revenue_model', label: 'Revenue model', impact: 'BLOCKING' },
      { section: 'BUSINESS_MODEL', domain: 'model', field: 'pricing_model', label: 'Pricing model', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'BUSINESS_MODEL', domain: 'model', field: 'partnerships', label: 'Key partnerships', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['finance', 'commerce', 'key_autonomy'],
  },
  CUSTOMER_MARKET: {
    key: 'CUSTOMER_MARKET',
    label: 'Customer & Market',
    weight: KEY_GENOME_SECTION_WEIGHTS.CUSTOMER_MARKET,
    description: 'Who the customer is, what they need, and where to find them.',
    blueprintSources: ['customerModel'],
    requiredFacts: [
      { section: 'CUSTOMER_MARKET', domain: 'customer', field: 'ideal_customer', label: 'Ideal customer', impact: 'BLOCKING' },
      { section: 'CUSTOMER_MARKET', domain: 'market', field: 'target_market', label: 'Target market', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'CUSTOMER_MARKET', domain: 'customer', field: 'channels', label: 'Customer channels', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['crm', 'marketing', 'key_inbox', 'sales'],
  },
  OFFER_PRODUCT: {
    key: 'OFFER_PRODUCT',
    label: 'Offer & Product',
    weight: KEY_GENOME_SECTION_WEIGHTS.OFFER_PRODUCT,
    description: 'What is sold, how it is delivered, and what makes it unique.',
    blueprintSources: ['offerings'],
    requiredFacts: [
      { section: 'OFFER_PRODUCT', domain: 'offer', field: 'core_offer', label: 'Core offer', impact: 'BLOCKING' },
      { section: 'OFFER_PRODUCT', domain: 'offer', field: 'delivery_model', label: 'Delivery model', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'OFFER_PRODUCT', domain: 'offer', field: 'differentiation', label: 'Differentiation', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['commerce', 'catalog', 'bookings', 'sop'],
  },
  FINANCIAL: {
    key: 'FINANCIAL',
    label: 'Financial',
    weight: KEY_GENOME_SECTION_WEIGHTS.FINANCIAL,
    description: 'Currency, pricing, costs, revenue, and financial controls.',
    blueprintSources: ['financials'],
    requiredFacts: [
      { section: 'FINANCIAL', domain: 'finance', field: 'currency', label: 'Currency', impact: 'BLOCKING' },
      { section: 'FINANCIAL', domain: 'finance', field: 'cost_structure', label: 'Cost structure', impact: 'DEGRADED' },
      { section: 'FINANCIAL', domain: 'finance', field: 'avg_ticket', label: 'Average ticket', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'FINANCIAL', domain: 'finance', field: 'reserve_policy', label: 'Reserve policy', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['finance', 'commerce', 'expenses', 'reports'],
  },
  LEGAL_GOVERNANCE_COMPLIANCE: {
    key: 'LEGAL_GOVERNANCE_COMPLIANCE',
    label: 'Legal, Governance & Compliance',
    weight: KEY_GENOME_SECTION_WEIGHTS.LEGAL_GOVERNANCE_COMPLIANCE,
    description: 'Entity type, registrations, tax profile, and compliance posture.',
    blueprintSources: ['legalProfile'],
    requiredFacts: [
      { section: 'LEGAL_GOVERNANCE_COMPLIANCE', domain: 'legal', field: 'entity_type', label: 'Entity type', impact: 'BLOCKING' },
      { section: 'LEGAL_GOVERNANCE_COMPLIANCE', domain: 'legal', field: 'tax_profile', label: 'Tax profile', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'LEGAL_GOVERNANCE_COMPLIANCE', domain: 'compliance', field: 'required_licenses', label: 'Required licenses', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['finance', 'evidence', 'legal'],
  },
  OPERATIONS_DELIVERY: {
    key: 'OPERATIONS_DELIVERY',
    label: 'Operations & Delivery',
    weight: KEY_GENOME_SECTION_WEIGHTS.OPERATIONS_DELIVERY,
    description: 'How work gets done, fulfilled, and repeated.',
    blueprintSources: ['operations'],
    requiredFacts: [
      { section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'delivery_process', label: 'Delivery process', impact: 'BLOCKING' },
      { section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'capacity', label: 'Capacity', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'quality_checks', label: 'Quality checks', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['bookings', 'projects', 'sop', 'people_flow'],
  },
  SALES: {
    key: 'SALES',
    label: 'Sales',
    weight: KEY_GENOME_SECTION_WEIGHTS.SALES,
    description: 'Sales motion, pipeline, follow-up cadence, and conversion.',
    blueprintSources: ['sales'],
    requiredFacts: [
      { section: 'SALES', domain: 'sales', field: 'sales_motion', label: 'Sales motion', impact: 'DEGRADED' },
      { section: 'SALES', domain: 'sales', field: 'follow_up_cadence', label: 'Follow-up cadence', impact: 'OPTIONAL' },
    ],
    optionalFacts: [
      { section: 'SALES', domain: 'sales', field: 'conversion_benchmark', label: 'Conversion benchmark', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['crm', 'commerce', 'key_inbox'],
  },
  MARKETING_GROWTH: {
    key: 'MARKETING_GROWTH',
    label: 'Marketing & Growth',
    weight: KEY_GENOME_SECTION_WEIGHTS.MARKETING_GROWTH,
    description: 'Growth channels, content strategy, and lead generation.',
    blueprintSources: ['marketing'],
    requiredFacts: [
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'primary_channel', label: 'Primary channel', impact: 'DEGRADED' },
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'channel_mix', label: 'Channel mix', impact: 'DEGRADED' },
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'content_cadence', label: 'Content cadence', impact: 'DEGRADED' },
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'content_strategy', label: 'Content strategy', impact: 'OPTIONAL' },
    ],
    optionalFacts: [
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'ad_budget', label: 'Ad budget', impact: 'OPTIONAL' },
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'organic_traffic', label: 'Organic traffic', impact: 'OPTIONAL' },
      { section: 'MARKETING_GROWTH', domain: 'marketing', field: 'conversion_funnel', label: 'Conversion funnel', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['marketing', 'social', 'key_inbox', 'commerce'],
  },
  TECH_DATA_INTELLIGENCE: {
    key: 'TECH_DATA_INTELLIGENCE',
    label: 'Technology, Data & Intelligence',
    weight: KEY_GENOME_SECTION_WEIGHTS.TECH_DATA_INTELLIGENCE,
    description: 'Autonomy level, integrations, data maturity, and intelligence stack.',
    blueprintSources: ['techStack'],
    requiredFacts: [
      { section: 'TECH_DATA_INTELLIGENCE', domain: 'tech', field: 'autonomy_level', label: 'Autonomy level', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'TECH_DATA_INTELLIGENCE', domain: 'tech', field: 'integrations', label: 'Integrations', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['key_autonomy', 'integration_hub', 'security_audit'],
  },
  RISK_RESILIENCE: {
    key: 'RISK_RESILIENCE',
    label: 'Risk & Resilience',
    weight: KEY_GENOME_SECTION_WEIGHTS.RISK_RESILIENCE,
    description: 'Known risks, contingencies, and business continuity.',
    blueprintSources: ['riskRegister'],
    requiredFacts: [
      { section: 'RISK_RESILIENCE', domain: 'risk', field: 'top_risks', label: 'Top risks', impact: 'DEGRADED' },
    ],
    optionalFacts: [
      { section: 'RISK_RESILIENCE', domain: 'risk', field: 'contingency_plan', label: 'Contingency plan', impact: 'OPTIONAL' },
    ],
    moduleImpact: ['evidence', 'key_autonomy', 'command_center'],
  },
};

export const KEY_GENOME_SCORING_WEIGHTS = {
  completeness: 0.25,
  quality: 0.25,
  confidence: 0.2,
  freshness: 0.1,
  operationalReadiness: 0.2,
};

export const KEY_GENOME_RISK_PENALTIES: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number> = {
  LOW: 0,
  MEDIUM: 0.03,
  HIGH: 0.08,
  CRITICAL: 0.15,
};

export type KeyGenomeModuleName =
  | 'key_inbox'
  | 'finance'
  | 'commerce'
  | 'calendar'
  | 'bookings'
  | 'people_flow'
  | 'sop'
  | 'projects'
  | 'marketing'
  | 'crm'
  | 'business_assets'
  | 'documents'
  | 'key_autonomy'
  | 'command_center';

export const KEY_GENOME_MODULE_NAMES: KeyGenomeModuleName[] = [
  'key_inbox',
  'finance',
  'commerce',
  'calendar',
  'bookings',
  'people_flow',
  'sop',
  'projects',
  'marketing',
  'crm',
  'business_assets',
  'documents',
  'key_autonomy',
  'command_center',
];
