export interface StageEmphasis {
  stage: string;
  label: string;
  emphasisAreas: string[];
  priorityCategories: string[];
  description: string;
}

export const STAGE_CONTEXT: Record<string, StageEmphasis> = {
  idea: {
    stage: 'idea',
    label: 'Idea Stage',
    emphasisAreas: ['offerClarity', 'customerClarity', 'valueProposition', 'basicViability'],
    priorityCategories: ['clarity', 'pricing'],
    description: 'You are at the idea stage. The focus should be on validating your concept, clarifying your offer, understanding your target customer, and assessing basic viability before investing more time or money.',
  },
  pre_launch: {
    stage: 'pre_launch',
    label: 'Pre-Launch',
    emphasisAreas: ['legalCompliance', 'pricingScore', 'businessModel', 'initialAcquisition'],
    priorityCategories: ['legal', 'pricing', 'sales'],
    description: 'You are preparing to launch. The priority is getting your legal foundation right, validating your pricing, establishing your business model, and identifying your first acquisition channel.',
  },
  newly_launched: {
    stage: 'newly_launched',
    label: 'Newly Launched',
    emphasisAreas: ['salesProcess', 'onboardingProcess', 'customerFeedback', 'costEfficiency'],
    priorityCategories: ['sales', 'operations', 'pricing'],
    description: 'You have recently launched. The focus now is on generating early sales, building a smooth onboarding experience, collecting customer feedback, and tracking costs carefully.',
  },
  operating: {
    stage: 'operating',
    label: 'Operating (Needs Structure)',
    emphasisAreas: ['workflowMaturity', 'operationalVisibility', 'profitability', 'founderDependency'],
    priorityCategories: ['operations', 'pricing', 'compliance'],
    description: 'Your business is running but may lack structure. The priority is documenting workflows, gaining operational visibility, improving profitability, and reducing founder dependency.',
  },
  growing: {
    stage: 'growing',
    label: 'Growing',
    emphasisAreas: ['systemization', 'retentionScore', 'delegation', 'capacity'],
    priorityCategories: ['retention', 'operations', 'growth'],
    description: 'Your business is growing. The focus shifts to building systems that scale, retaining existing customers, delegating effectively, and expanding capacity without compromising quality.',
  },
  mature: {
    stage: 'mature',
    label: 'Mature',
    emphasisAreas: ['marginImprovement', 'scalingStrategy', 'riskReduction', 'strategicExpansion'],
    priorityCategories: ['pricing', 'growth', 'compliance'],
    description: 'Your business is established. The priority is optimizing margins, identifying scaling strategies, reducing key risks, and exploring strategic expansion opportunities.',
  },
};

export function resolveStageContext(stage?: string | null): StageEmphasis {
  if (!stage) return STAGE_CONTEXT.idea;

  const normalized = stage.toLowerCase().replace(/[\s-]+/g, '_');

  const directMatch = STAGE_CONTEXT[normalized];
  if (directMatch) return directMatch;

  const stageMapping: Record<string, string> = {
    idea: 'idea',
    startup: 'pre_launch',
    pre_launch: 'pre_launch',
    prelaunch: 'pre_launch',
    launch: 'newly_launched',
    newly_launched: 'newly_launched',
    new: 'newly_launched',
    growth: 'growing',
    growing: 'growing',
    established: 'operating',
    operating: 'operating',
    scaling: 'mature',
    mature: 'mature',
    scale: 'mature',
  };

  const mapped = stageMapping[normalized];
  if (mapped) return STAGE_CONTEXT[mapped];

  return STAGE_CONTEXT.idea;
}

export function resolveBusinessType(archetype?: string | null): string {
  if (!archetype) return 'service';

  const mapping: Record<string, string> = {
    local_service: 'service',
    digital_product: 'saas',
    agency: 'agency',
    clinic: 'clinic',
    ecommerce: 'ecommerce',
    service: 'service',
    saas: 'saas',
  };

  const normalized = archetype.toLowerCase().replace(/[\s-]+/g, '_');
  return mapping[normalized] || 'service';
}

export interface BusinessTypeEmphasis {
  type: string;
  focusAreas: string[];
  description: string;
}

export const BUSINESS_TYPE_EMPHASIS: Record<string, BusinessTypeEmphasis> = {
  service: {
    type: 'service',
    focusAreas: ['positioning', 'workflow', 'retention', 'onboarding', 'contracts'],
    description: 'Service businesses should emphasize clear positioning, efficient workflows, client retention, smooth onboarding, and formal contracts.',
  },
  saas: {
    type: 'saas',
    focusAreas: ['icp', 'funnel', 'churn', 'pricing', 'data_privacy'],
    description: 'SaaS businesses should focus on a clear ICP, optimized acquisition funnel, churn reduction, value-based pricing, and data privacy compliance.',
  },
  clinic: {
    type: 'clinic',
    focusAreas: ['compliance', 'patient_flow', 'onboarding', 'data_privacy', 'scheduling'],
    description: 'Clinics should prioritize compliance, efficient patient flow, smooth onboarding, data privacy, and scheduling optimization.',
  },
  agency: {
    type: 'agency',
    focusAreas: ['packaging', 'profitability_per_client', 'contracts', 'workflow', 'delegation'],
    description: 'Agencies should focus on service packaging, per-client profitability, formal contracts, documented workflows, and effective delegation.',
  },
  ecommerce: {
    type: 'ecommerce',
    focusAreas: ['cogs', 'conversion', 'repeat_purchase', 'pricing', 'lead_generation'],
    description: 'Ecommerce businesses should emphasize COGS management, conversion optimization, repeat purchase strategies, competitive pricing, and lead generation.',
  },
};
