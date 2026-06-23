/**
 * Canonical department registry for KEY Genome.
 *
 * Departments are the business-level cortex: they group Genome sections,
 * modules, and capabilities into the functions that actually run the company.
 * This registry is the source of truth for the department framework.
 */

import type { KeyGenomeModuleName, KeyGenomeSection } from './key-genome.ontology';
import type { GenomeDepartmentCode } from './key-genome.types';

export interface GenomeDepartmentDefinition {
  code: GenomeDepartmentCode;
  name: string;
  description: string;
  primarySections: KeyGenomeSection[];
  supportingSections: KeyGenomeSection[];
  impactedModules: KeyGenomeModuleName[];
  coreCapabilities: string[];
  autonomySensitive: boolean;
}

export const KEY_GENOME_DEPARTMENTS: GenomeDepartmentDefinition[] = [
  {
    code: 'CEO_STRATEGY',
    name: 'CEO / Strategy',
    description: 'Direction, priorities, positioning, and executive decisions.',
    primarySections: ['FOUNDER_LEADERSHIP', 'VISION_IDENTITY', 'BUSINESS_MODEL'],
    supportingSections: ['RISK_RESILIENCE', 'TECH_DATA_INTELLIGENCE'],
    impactedModules: ['command_center', 'key_autonomy', 'projects'],
    coreCapabilities: ['strategy', 'prioritization', 'governance', 'decision-making'],
    autonomySensitive: true,
  },
  {
    code: 'COO_OPERATIONS',
    name: 'COO / Operations',
    description: 'Delivery, capacity, SOPs, projects, and recurring operations.',
    primarySections: ['OPERATIONS_DELIVERY', 'OFFER_PRODUCT'],
    supportingSections: ['FOUNDER_LEADERSHIP', 'RISK_RESILIENCE'],
    impactedModules: ['sop', 'projects', 'bookings', 'people_flow'],
    coreCapabilities: ['delivery', 'capacity', 'SOPs', 'quality control'],
    autonomySensitive: true,
  },
  {
    code: 'CFO_FINANCE',
    name: 'CFO / Finance',
    description: 'Revenue, costs, pricing, margin, cash flow, and financial controls.',
    primarySections: ['FINANCIAL', 'BUSINESS_MODEL'],
    supportingSections: ['LEGAL_GOVERNANCE_COMPLIANCE', 'RISK_RESILIENCE'],
    impactedModules: ['finance', 'commerce'],
    coreCapabilities: ['pricing', 'cash flow', 'margin', 'budgeting', 'financial risk'],
    autonomySensitive: true,
  },
  {
    code: 'CMO_MARKETING',
    name: 'CMO / Marketing',
    description: 'Brand, channels, content, campaigns, and growth.',
    primarySections: ['MARKETING_GROWTH', 'CUSTOMER_MARKET', 'VISION_IDENTITY'],
    supportingSections: ['OFFER_PRODUCT'],
    impactedModules: ['marketing', 'key_inbox'],
    coreCapabilities: ['campaigns', 'content', 'growth channels', 'brand voice'],
    autonomySensitive: false,
  },
  {
    code: 'SALES',
    name: 'Sales',
    description: 'Sales motion, lead handling, follow-up, objections, and conversion.',
    primarySections: ['SALES', 'CUSTOMER_MARKET', 'OFFER_PRODUCT'],
    supportingSections: ['BUSINESS_MODEL'],
    impactedModules: ['crm', 'commerce', 'key_inbox'],
    coreCapabilities: ['pipeline', 'follow-up', 'conversion', 'objections'],
    autonomySensitive: false,
  },
  {
    code: 'CUSTOMER_SUCCESS',
    name: 'Customer Success',
    description: 'Support, retention, satisfaction, complaints, and customer outcomes.',
    primarySections: ['CUSTOMER_MARKET', 'OFFER_PRODUCT', 'OPERATIONS_DELIVERY'],
    supportingSections: ['VISION_IDENTITY'],
    impactedModules: ['key_inbox', 'sop', 'projects'],
    coreCapabilities: ['support', 'retention', 'complaints', 'customer outcomes'],
    autonomySensitive: false,
  },
  {
    code: 'PRODUCT_SERVICE',
    name: 'Product / Service',
    description: 'Offer design, delivery model, differentiation, and value proposition.',
    primarySections: ['OFFER_PRODUCT', 'BUSINESS_MODEL'],
    supportingSections: ['CUSTOMER_MARKET', 'OPERATIONS_DELIVERY'],
    impactedModules: ['commerce', 'business_assets', 'bookings', 'sop'],
    coreCapabilities: ['offer design', 'delivery model', 'differentiation', 'quality'],
    autonomySensitive: false,
  },
  {
    code: 'LEGAL_COMPLIANCE',
    name: 'Legal / Compliance',
    description: 'Entity, tax, licenses, obligations, policies, and compliance boundaries.',
    primarySections: ['LEGAL_GOVERNANCE_COMPLIANCE'],
    supportingSections: ['RISK_RESILIENCE', 'FINANCIAL'],
    impactedModules: ['documents', 'business_assets'],
    coreCapabilities: ['contracts', 'tax profile', 'licenses', 'policy boundaries'],
    autonomySensitive: true,
  },
  {
    code: 'RISK',
    name: 'Risk',
    description: 'Known risks, contingencies, resilience, and high-impact failure prevention.',
    primarySections: ['RISK_RESILIENCE', 'LEGAL_GOVERNANCE_COMPLIANCE'],
    supportingSections: ['FINANCIAL', 'OPERATIONS_DELIVERY'],
    impactedModules: ['key_autonomy', 'command_center'],
    coreCapabilities: ['risk detection', 'contingency planning', 'approval boundaries'],
    autonomySensitive: true,
  },
  {
    code: 'TECH_DATA',
    name: 'Technology / Data',
    description: 'Integrations, data maturity, automation stack, and intelligence infrastructure.',
    primarySections: ['TECH_DATA_INTELLIGENCE'],
    supportingSections: ['RISK_RESILIENCE'],
    impactedModules: ['key_autonomy', 'command_center'],
    coreCapabilities: ['integrations', 'data quality', 'automation maturity'],
    autonomySensitive: true,
  },
  {
    code: 'HR_STAFFING',
    name: 'HR / Staffing',
    description: 'Roles, staffing, accountability, training, and capacity.',
    primarySections: ['FOUNDER_LEADERSHIP', 'OPERATIONS_DELIVERY'],
    supportingSections: ['RISK_RESILIENCE'],
    impactedModules: ['people_flow', 'sop', 'projects'],
    coreCapabilities: ['roles', 'staffing', 'training', 'capacity'],
    autonomySensitive: true,
  },
  {
    code: 'VENDOR_PROCUREMENT',
    name: 'Vendor / Procurement',
    description: 'External suppliers, vendor risk, procurement, and dependencies.',
    primarySections: ['BUSINESS_MODEL', 'OPERATIONS_DELIVERY'],
    supportingSections: ['FINANCIAL', 'RISK_RESILIENCE'],
    impactedModules: ['business_assets', 'projects'],
    coreCapabilities: ['vendors', 'procurement', 'supplier reliability'],
    autonomySensitive: false,
  },
  {
    code: 'EXECUTIVE_ASSISTANT',
    name: 'Executive Assistant',
    description: 'Scheduling, inbox, reminders, coordination, and executive support.',
    primarySections: ['FOUNDER_LEADERSHIP', 'VISION_IDENTITY', 'TECH_DATA_INTELLIGENCE'],
    supportingSections: ['OPERATIONS_DELIVERY'],
    impactedModules: ['calendar', 'key_inbox', 'command_center'],
    coreCapabilities: ['calendar', 'inbox', 'coordination', 'follow-up'],
    autonomySensitive: false,
  },
];

export const KEY_GENOME_DEPARTMENT_CODES: GenomeDepartmentCode[] = KEY_GENOME_DEPARTMENTS.map(
  (d) => d.code,
);

export function getDepartmentDefinition(
  code: GenomeDepartmentCode | string,
): GenomeDepartmentDefinition | undefined {
  return KEY_GENOME_DEPARTMENTS.find((d) => d.code === code);
}
