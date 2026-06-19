import type { IntelligenceDomain } from './business-intelligence.types';
import type { DnaSectionKey } from '../blueprint/blueprint.types';

export type KeyExecutiveMode =
  | 'STRATEGIST'
  | 'CFO'
  | 'CMO'
  | 'COO'
  | 'LEGAL_GUIDE'
  | 'GROWTH_ADVISOR'
  | 'RISK_OFFICER'
  | 'EXECUTIVE_ASSISTANT';

export const KEY_EXECUTIVE_MODES: KeyExecutiveMode[] = [
  'STRATEGIST',
  'CFO',
  'CMO',
  'COO',
  'LEGAL_GUIDE',
  'GROWTH_ADVISOR',
  'RISK_OFFICER',
  'EXECUTIVE_ASSISTANT',
];

export type KeyModePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type KeyModeActionType =
  | 'OPEN_GENOME'
  | 'OPEN_TEMPORAL_FLOW'
  | 'OPEN_INTELLIGENCE'
  | 'REVIEW_EVOLUTION_PROPOSALS'
  | 'REVIEW_ASSETS'
  | 'OPEN_CONSTITUTION'
  | 'CREATE_TASK'
  | 'CREATE_DOCUMENT'
  | 'OPEN_KEY_INBOX'
  | 'REQUEST_APPROVAL';

export interface KeyModeAction {
  label: string;
  actionType: KeyModeActionType;
  href?: string;
  payload?: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface KeyModeFinding {
  id: string;
  priority: KeyModePriority;
  title: string;
  finding: string;
  evidence: string[];
  confidence: number;
  actions: KeyModeAction[];
}

export interface KeyExecutiveModeBrief {
  businessId: string;
  mode: KeyExecutiveMode;
  generatedAt: string;
  title: string;
  summary: string;
  diagnosis: string;
  findings: KeyModeFinding[];
  recommendedActions: KeyModeAction[];
  risks: KeyModeFinding[];
  opportunities: KeyModeFinding[];
  sourceBriefId?: string;
}

export interface KeyExecutiveModeConfig {
  label: string;
  description: string;
  focusDomains: IntelligenceDomain[];
  dnaSections: DnaSectionKey[];
  defaultActionLabel: string;
  defaultActionType: KeyModeActionType;
  defaultHref: string;
}

export interface KeyModeListItem {
  mode: KeyExecutiveMode;
  label: string;
  description: string;
}
