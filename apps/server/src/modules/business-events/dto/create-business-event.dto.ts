export type ActorType = 'human' | 'ai' | 'system' | 'integration';
export type EventSource = 'web' | 'mobile' | 'email' | 'whatsapp' | 'api' | 'worker' | 'ai';

export interface CreateBusinessEventInput {
  businessId: string;
  branchId?: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  evidenceIds?: string[];
  messageIds?: string[];
  approvalId?: string;
  riskScore?: number;
  source: EventSource;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  eventTypes?: string[];
  subjectTypes?: string[];
  actorTypes?: ActorType[];
  actions?: string[];
  sources?: EventSource[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface KpiStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByActor: Record<string, number>;
  highRiskEvents: number;
  approvalEvents: number;
  aiActions: number;
}
