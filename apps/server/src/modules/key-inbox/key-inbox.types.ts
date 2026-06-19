export interface InboxSuggestedAction {
  type: string;
  label: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface InboxEntities {
  contacts?: string[];
  dates?: string[];
  invoices?: string[];
  bookings?: string[];
  projects?: string[];
}

export interface InboxAnalysis {
  intent: string;
  sentiment: string;
  urgency: string;
  confidence: number;
  summary: string;
  entities: InboxEntities;
  suggestedActions: InboxSuggestedAction[];
}

export interface CreateInboxMessageInput {
  businessId: string;
  threadId?: string;
  channel: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderName?: string | null;
  senderHandle?: string | null;
  senderEmail?: string | null;
  senderPhone?: string | null;
  contentText?: string | null;
  contentHtml?: string | null;
  attachments?: Record<string, unknown>[];
  externalMessageId?: string | null;
  receivedAt?: Date | null;
  sentAt?: Date | null;
  sendStatus?: string | null;
  providerMessageId?: string | null;
  sendError?: string | null;
  sentByUserId?: string | null;
  sentVia?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateInboxThreadInput {
  businessId: string;
  channel: string;
  externalThreadId?: string | null;
  contactId?: string | null;
  subject?: string | null;
  status?: 'OPEN' | 'WAITING' | 'DONE' | 'ARCHIVED';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  metadata?: Record<string, unknown>;
}
