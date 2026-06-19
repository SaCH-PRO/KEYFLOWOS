import { apiGet } from "@/lib/api";

export type CommandCenterPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type CommandCenterItemType =
  | "KEY_APPROVAL"
  | "KEY_APPROVED"
  | "TEMPORAL_URGENT"
  | "RISK"
  | "OPPORTUNITY"
  | "GENOME_PROPOSAL"
  | "ASSET_RISK"
  | "CONSTITUTION"
  | "EXECUTIVE_MODE"
  | "DOCUMENT";

export type CommandCenterActionType =
  | "OPEN"
  | "APPROVE"
  | "EXECUTE"
  | "REVIEW"
  | "REQUEST_APPROVAL"
  | "GENERATE"
  | "EXPORT"
  | "CREATE_TASK";

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
  constitution: CommandCenterConstitution;
  executiveModes: CommandCenterExecutiveMode[];
  recommendedActions: CommandCenterAction[];
}

export async function getBusinessCommandCenterSnapshot(businessId: string) {
  return apiGet<BusinessCommandCenterSnapshot>(
    `/business-command-center/businesses/${businessId}/snapshot`,
  );
}
