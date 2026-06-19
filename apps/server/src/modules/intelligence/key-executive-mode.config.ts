import type { KeyExecutiveMode, KeyExecutiveModeConfig } from './key-executive-mode.types';

export const KEY_EXECUTIVE_MODE_CONFIG: Record<KeyExecutiveMode, KeyExecutiveModeConfig> = {
  STRATEGIST: {
    label: 'KEY Strategist',
    description: 'Strategic direction, positioning, and executive priorities.',
    focusDomains: ['EXECUTIVE', 'GENOME', 'TEMPORAL_FLOW', 'RISK', 'OPERATIONS'],
    dnaSections: ['vision', 'business', 'market', 'growth', 'risk'],
    defaultActionLabel: 'Review Strategy',
    defaultActionType: 'OPEN_INTELLIGENCE',
    defaultHref: '/app/intelligence',
  },
  CFO: {
    label: 'KEY CFO',
    description: 'Financial readiness, revenue, cash flow, pricing, and financial risk.',
    focusDomains: ['FINANCE', 'REVENUE', 'RISK', 'ASSETS', 'EXECUTIVE'],
    dnaSections: ['financial', 'sales', 'risk'],
    defaultActionLabel: 'Review Financial DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  CMO: {
    label: 'KEY CMO',
    description: 'Marketing channels, audience signals, brand, and acquisition.',
    focusDomains: ['MARKETING', 'CLIENTS', 'GENOME', 'TEMPORAL_FLOW', 'REVENUE'],
    dnaSections: ['marketing', 'market', 'business', 'growth'],
    defaultActionLabel: 'Review Marketing DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  COO: {
    label: 'KEY COO',
    description: 'Operations, workflows, execution, delivery, assets, and bottlenecks.',
    focusDomains: ['OPERATIONS', 'ASSETS', 'TEMPORAL_FLOW', 'RISK'],
    dnaSections: ['operations', 'technology', 'risk'],
    defaultActionLabel: 'Review Operations DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  LEGAL_GUIDE: {
    label: 'KEY Legal Guide',
    description: 'Legal readiness, governance, compliance, and risk guidance.',
    focusDomains: ['RISK', 'GENOME', 'ASSETS'],
    dnaSections: ['legal', 'risk', 'operations'],
    defaultActionLabel: 'Review Legal DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  GROWTH_ADVISOR: {
    label: 'KEY Growth Advisor',
    description: 'Growth opportunities, scaling readiness, sales and marketing expansion.',
    focusDomains: ['REVENUE', 'SALES', 'MARKETING', 'GENOME', 'TEMPORAL_FLOW'],
    dnaSections: ['growth', 'sales', 'marketing', 'market'],
    defaultActionLabel: 'Review Growth DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  RISK_OFFICER: {
    label: 'KEY Risk Officer',
    description: 'Financial, legal, operational, and asset risks.',
    focusDomains: ['RISK', 'ASSETS', 'TEMPORAL_FLOW', 'FINANCE', 'OPERATIONS'],
    dnaSections: ['risk', 'legal', 'financial', 'operations'],
    defaultActionLabel: 'Review Risk DNA',
    defaultActionType: 'OPEN_GENOME',
    defaultHref: '/app/profile?tab=business-genome&section=dna-sections',
  },
  EXECUTIVE_ASSISTANT: {
    label: 'KEY Executive Assistant',
    description: 'Today’s priorities, follow-ups, reminders, and pending actions.',
    focusDomains: ['TEMPORAL_FLOW', 'EXECUTIVE', 'GENOME', 'OPERATIONS'],
    dnaSections: ['operations', 'sales', 'marketing'],
    defaultActionLabel: 'Open Command Center',
    defaultActionType: 'OPEN_INTELLIGENCE',
    defaultHref: '/app/command-center',
  },
};

export const KEY_EXECUTIVE_MODE_LIST = Object.entries(KEY_EXECUTIVE_MODE_CONFIG).map(
  ([mode, config]) => ({
    mode: mode as KeyExecutiveMode,
    label: config.label,
    description: config.description,
  }),
);
