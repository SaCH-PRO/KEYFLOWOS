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
  genomeIntegrity: number | null;
  executiveReadinessScore: number | null;
  genomeStage: string | null;
  withheldForRevenue?: string[];
  criticalCount: number;
  highPriorityCount: number;
  pendingApprovalCount: number;
  approvedAwaitingExecutionCount: number;
  urgentTemporalCount: number;
  pendingGenomeProposalCount: number;
  assetRiskCount: number;
  constitutionStale: boolean;
  keyGenomeOverall: number | null;
  keyGenomeReadiness: number | null;
  keyGenomeConfidence: number | null;
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
  integrity: number | null;
  readiness: number | null;
  stage: string | null;
  withheldForRevenue?: string[];
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
  overall: number | null;
  integrity: number | null;
  readiness: number | null;
  confidence: number | null;
  withheldForRevenue?: string[];
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

export interface PulseDimension {
  label: string;
  score: number;
  trend: 'up' | 'down' | 'flat';
  color: string;
}

export interface BusinessPulse {
  overallScore: number;
  dimensions: PulseDimension[];
}

export interface KeyBriefing {
  headline: string;
  bullets: string[];
  warnings: string[];
}

export interface GovernanceSummary {
  autoReady: number;
  needsApproval: number;
  dueToday: number;
  urgentRisks: number;
}

/**
 * V1-47-COCKPIT-TRUTH (CF-19, COMMAND-001). Every source the snapshot reads is
 * reported, so a source that failed is never mistaken for one that answered
 * with nothing. The legacy panels keep their fallback values; `sources` and
 * `degraded` say which of them are fallbacks.
 */
export type CommandCenterSourceStatus = 'OK' | 'FAILED';

export interface CommandCenterSource {
  label: string;
  status: CommandCenterSourceStatus;
  /** When the source settled (answered or failed), ISO-8601. */
  fetchedAt: string;
}

/**
 * A Release 0 record count. `count` is null whenever it is not known: the
 * source FAILED, or the caller may not read that list (RESTRICTED). 0 is only
 * ever a real zero.
 */
export type CommandCenterResultStatus = CommandCenterSourceStatus | 'RESTRICTED';

export interface CommandCenterResult {
  label: string;
  count: number | null;
  status: CommandCenterResultStatus;
  href: string;
}

export interface CommandCenterResults {
  contacts: CommandCenterResult;
  openInvoices: CommandCenterResult;
  payments: CommandCenterResult;
}

export interface BusinessCommandCenterSnapshot {
  businessId: string;
  generatedAt: string;
  /** True when any source FAILED. */
  degraded: boolean;
  sources: Record<string, CommandCenterSource>;
  results: CommandCenterResults;
  health: CommandCenterHealth;
  summary: string;
  pulse: BusinessPulse;
  briefing: KeyBriefing;
  governance: GovernanceSummary;
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

// ========== TODAY-AGGREGATE (V1-65, P79) ==========

export type TodayNeedsYouKind =
  | 'CLAIM'
  | 'ACCEPTED_QUOTE'
  | 'KEY_PROPOSAL'
  | 'APPROVAL_REQUEST'
  | 'PLAN_STEP';

export interface TodayNeedsYouAction {
  label: string;
  actionType: 'APPROVE' | 'EXECUTE' | 'REJECT' | 'CONFIRM' | 'DISMISS' | 'CONVERT' | 'OPEN';
  href?: string;
  method?: 'GET' | 'POST';
  endpoint?: string;
}

export interface TodayNeedsYouItem {
  id: string;
  kind: TodayNeedsYouKind;
  sourceId: string;
  title: string;
  summary: string;
  contactId: string | null;
  customerName: string | null;
  amount?: number | null;
  currency?: string | null;
  createdAt: string;
  href: string;
  actions: TodayNeedsYouAction[];
}

export interface TodayNeedsYouBlock {
  items: TodayNeedsYouItem[];
  totalCount: number;
  hasMore: boolean;
}

export interface TodayBookingItem {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  serviceName: string | null;
  customerName: string | null;
  contactId: string | null;
}

export interface TodayInvoiceItem {
  id: string;
  invoiceNumber: string;
  status: string;
  dueDate: string | null;
  remaining: number;
  total: number;
  currency: string;
  customerName: string | null;
  contactId: string | null;
  isOverdue: boolean;
}

export interface TodayAcceptedQuoteItem {
  id: string;
  quoteNumber: string;
  total: number;
  currency: string;
  acceptedAt: string | null;
  customerName: string | null;
  contactId: string | null;
}

export interface TodayTaskItem {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
  contactId: string | null;
  customerName: string | null;
}

export interface TodayOrderItem {
  id: string;
  orderNumber: string;
  status: string;
  total: number | null;
  currency: string;
  customerName: string | null;
  createdAt: string;
}

export interface TodayReminderItem {
  kind: 'invoice' | 'booking';
  id: string;
  contactId: string | null;
  customerName: string;
  whatsappUrl: string | null;
  messageText: string;
  dueAt: string;
  reference: string;
  amountDue?: number;
  currency?: string;
  serviceName?: string;
}

export interface TodayOperationalBlock {
  bookings: TodayBookingItem[];
  invoices: TodayInvoiceItem[];
  acceptedQuotes: TodayAcceptedQuoteItem[];
  tasks: TodayTaskItem[];
  orders: TodayOrderItem[];
  reminders: TodayReminderItem[];
  counts: {
    bookings: number;
    invoices: number;
    acceptedQuotes: number;
    tasks: number;
    orders: number;
    reminders: number;
    total: number;
  };
}

export type TodayPulseStatus = 'OK' | 'RESTRICTED';

export interface TodayPulse {
  cash: number;
  cashBasis: 'ledger';
  cashCurrency: string;
  otherCurrencyCash: Array<{ currency: string; amount: number }>;
  owedToYou: number;
  owedCount: number;
  overdueAmount: number;
  overdueCount: number;
  youOwe: number;
  youOweCount: number;
  monthRevenue: number;
  monthExpenses: number;
  monthProfit: number;
  safeToSpend: number;
  currency: string;
}

export interface TodaySetupStep {
  key: 'catalog' | 'hours' | 'payments' | 'share_link';
  label: string;
  done: boolean;
  href: string;
}

export interface TodayGetSetUpBlock {
  complete: boolean;
  steps: TodaySetupStep[];
}

export interface TodayAggregateResponse {
  businessId: string;
  generatedAt: string;
  timezone: string;
  needsYou: TodayNeedsYouBlock;
  today: TodayOperationalBlock;
  pulseStatus: TodayPulseStatus;
  pulse: TodayPulse | null;
  getSetUp: TodayGetSetUpBlock;
}

