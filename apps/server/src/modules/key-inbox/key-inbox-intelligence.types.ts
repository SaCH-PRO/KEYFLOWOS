export type IntelligenceScope = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface EvidenceSample {
  threadId: string;
  messageId: string;
  channel: string;
  intent?: string;
  excerpt: string;
}

export interface MetricTrend {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number | null;
  direction: 'up' | 'down' | 'flat';
}

export interface TopItem {
  channel?: string;
  intent?: string;
  urgency?: string;
  sentiment?: string;
  tag?: string;
  contactId?: string | null;
  count: number;
}

export interface KeyInboxIntelligenceMetrics {
  totalThreads: number;
  newThreads: number;
  openThreads: number;
  waitingThreads: number;
  doneThreads: number;
  archivedThreads: number;

  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;

  draftReplies: number;
  sentReplies: number;
  failedReplies: number;
  notSupportedReplies: number;

  urgentThreads: number;
  highPriorityThreads: number;
  unansweredThreads: number;

  averageFirstResponseMinutes: number | null;
  averageLastResponseMinutes: number | null;

  leadInquiries: number;
  pricingQuestions: number;
  bookingRequests: number;
  invoiceRequests: number;
  supportRequests: number;
  complaints: number;
  spam: number;

  topChannels: Array<{ channel: string; count: number }>;
  topIntents: Array<{ intent: string; count: number }>;
  topUrgencies: Array<{ urgency: string; count: number }>;
  topSentiments: Array<{ sentiment: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  topContacts: Array<{ contactId: string | null; count: number }>;
}

export interface KeyInboxIntelligenceInsight {
  type:
    | 'LEAD_OPPORTUNITY'
    | 'REVENUE_OPPORTUNITY'
    | 'CUSTOMER_COMPLAINT'
    | 'OPERATIONAL_RISK'
    | 'FOLLOW_UP_GAP'
    | 'CHANNEL_PERFORMANCE'
    | 'PRICING_SIGNAL'
    | 'BOOKING_SIGNAL'
    | 'INVOICE_SIGNAL'
    | 'SUPPORT_SIGNAL'
    | 'OFFER_CONFUSION'
    | 'REPEATED_QUESTION'
    | 'GENOME_SIGNAL';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  evidence: string[];
  relatedThreadIds?: string[];
  relatedMessageIds?: string[];
  suggestedAction?: {
    type: string;
    label: string;
    payload?: Record<string, unknown>;
  };
}

export interface GenomeSignalEvidence {
  threadId?: string;
  messageId?: string;
  channel?: string;
  excerpt?: string;
}

export interface GenomeSignalPreview {
  signalType:
    | 'pricing_objection_detected'
    | 'lead_source_detected'
    | 'complaint_pattern_detected'
    | 'support_risk_detected'
    | 'offer_confusion_detected'
    | 'recurring_offer_interest'
    | 'booking_request_pattern'
    | 'response_time_risk';
  section: string;
  domain: string;
  title: string;
  reason: string;
  confidence: number;
  evidence: GenomeSignalEvidence[];
}

export interface KeyInboxIntelligenceReportContent {
  executiveSummary: string;
  keyFindings: string[];
  recommendations: string[];
  taskSuggestions: string[];

  metrics: KeyInboxIntelligenceMetrics;
  trends: Record<string, MetricTrend>;
  insights: KeyInboxIntelligenceInsight[];
  genomeSignals: GenomeSignalPreview[];

  channelBreakdown: Record<string, number>;
  generatedBy?: 'ai' | 'fallback' | string;
  reportVersion: number;
}

export interface KeyInboxIntelligenceReport extends KeyInboxIntelligenceReportContent {
  id: string;
  businessId: string;
  scope: IntelligenceScope;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}
