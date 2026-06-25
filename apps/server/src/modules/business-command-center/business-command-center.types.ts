import type {
  GenomeAutonomyGateResult,
  GenomeCrossDomainOpportunityCandidate,
  GenomeRankedRecommendation,
} from '../business-genome/key-genome/key-genome.types';

export type CommandCenterPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CommandCenterItemType =
  | 'KEY_APPROVAL'
  | 'KEY_APPROVED'
  | 'TEMPORAL_URGENT'
  | 'RISK'
  | 'OPPORTUNITY'
  | 'GENOME_PROPOSAL'
  | 'ASSET_RISK'
  | 'CONSTITUTION'
  | 'EXECUTIVE_MODE'
  | 'DOCUMENT'
  | 'KEY_GENOME_GAP'
  | 'MODULE_READINESS'
  | 'MISSING_FACT'
  | 'GENOME_SIGNAL'
  | 'GENOME_RECOMMENDATION';

export type CommandCenterActionType =
  | 'OPEN'
  | 'APPROVE'
  | 'EXECUTE'
  | 'REVIEW'
  | 'REQUEST_APPROVAL'
  | 'GENERATE'
  | 'EXPORT'
  | 'CREATE_TASK';

export interface CommandCenterAction {
  label: string;
  actionType: CommandCenterActionType;
  href?: string;
  payload?: Record<string, unknown>;
}

export interface CommandCenterItem {
  id: string;
  type: CommandCenterItemType;
  priority: CommandCenterPriority;
  title: string;
  summary: string;
  evidence: string[];
  source: string;
  sourceId?: string;
  href?: string;
  actions: CommandCenterAction[];
  createdAt?: string;
  dueAt?: string;
}

export interface CommandCenterHealth {
  genomeIntegrity: number;
  executiveReadinessScore: number;
  genomeStage: string;
  criticalCount: number;
  highPriorityCount: number;
  pendingApprovalCount: number;
  approvedAwaitingExecutionCount: number;
  urgentTemporalCount: number;
  pendingGenomeProposalCount: number;
  assetRiskCount: number;
  constitutionStale: boolean;
  keyGenomeOverall: number;
  keyGenomeReadiness: number;
  keyGenomeConfidence: number;
  blockedModuleCount: number;
  lowReadinessModuleCount: number;
  missingBlockingFactCount: number;
}

export interface CommandCenterExecutiveMode {
  mode: string;
  label: string;
  summary: string;
  riskCount: number;
  opportunityCount: number;
  href: string;
}

export interface CommandCenterConstitution {
  latestVersion: number | null;
  stale: boolean;
  reason?: string | null;
  href: string;
}

export interface CommandCenterGenome {
  integrity: number;
  readiness: number;
  stage: string;
  pendingProposals: CommandCenterItem[];
  weakestSections: CommandCenterItem[];
}

export interface CommandCenterKeyGenomeCrossDomain {
  healthScore: number;
  readinessScore: number;
  confidenceScore: number;
  overallRiskLevel: string;
  domainHealth: Record<string, number>;
  domainReadiness: Record<string, number>;
  topRecommendations: GenomeRankedRecommendation[];
  topOpportunities: GenomeCrossDomainOpportunityCandidate[];
  unsafeAutomationBlocks: GenomeAutonomyGateResult[];
  staleFactCount: number;
  criticalMissingFactCount: number;
}

export interface CommandCenterKeyGenome {
  overall: number;
  integrity: number;
  readiness: number;
  confidence: number;
  computedAt: string;
  sections: {
    section: string;
    weight: number;
    score: {
      completeness: number;
      quality: number;
      confidence: number;
      freshness: number;
      operationalReadiness: number;
      riskPenalty: number;
      overall: number;
    };
  }[];
  weakestSections: {
    section: string;
    overall: number;
    confidence: number;
    freshness: number;
    readiness: number;
  }[];
  crossDomain?: CommandCenterKeyGenomeCrossDomain;
}

export interface CommandCenterModuleReadiness {
  module: string;
  readinessScore: number;
  automationAllowed: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  missingFacts: {
    section: string;
    domain: string;
    field: string;
    reason: string;
    impact: 'BLOCKING' | 'DEGRADED' | 'OPTIONAL';
  }[];
  blockedReasons: string[];
  recommendedSetupActions: string[];
  lastComputedAt: string;
}

export interface BusinessCommandCenterSnapshot {
  businessId: string;
  generatedAt: string;
  health: CommandCenterHealth;
  summary: string;
  topPriorities: CommandCenterItem[];
  pendingApprovals: CommandCenterItem[];
  approvedAwaitingExecution: CommandCenterItem[];
  urgentItems: CommandCenterItem[];
  risks: CommandCenterItem[];
  opportunities: CommandCenterItem[];
  genome: CommandCenterGenome;
  keyGenome: CommandCenterKeyGenome;
  moduleReadiness: CommandCenterModuleReadiness[];
  constitution: CommandCenterConstitution;
  executiveModes: CommandCenterExecutiveMode[];
  recommendedActions: CommandCenterAction[];
}
