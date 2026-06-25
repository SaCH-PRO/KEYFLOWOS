// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

export type KeystoreOrderStatus =
  | 'REQUESTED'
  | 'QUOTED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'REVISION_REQUESTED'
  | 'COMPLETED'
  | 'DELIVERED'
  | 'DECLINED'
  | 'CANCELLED';

export type KeystoreListingStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED';

export type KeystoreMessageSenderType =
  | 'USER'
  | 'KEYFLOW_TEAM'
  | 'SYSTEM';

// ── JSON Shapes ────────────────────────────────────────────────────────────

export interface KeystoreDeliverable {
  name: string;
  description: string;
  estimatedDays: number;
}

export interface KeystorePricingTier {
  name: string;
  price: number;
  currency: string;
  description: string;
  included: string[];
}

export interface KeystoreAddon {
  name: string;
  price: number;
  description: string;
}

export interface KeystoreFaqItem {
  question: string;
  answer: string;
}

export interface KeystoreBriefQuestion {
  id: string;
  question: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'number' | 'file';
  options?: string[];
  required: boolean;
  placeholder?: string;
}

export interface KeystoreSelectedAddon {
  addonName: string;
  price: number;
}

export interface KeystoreBriefAnswer {
  questionId: string;
  question: string;
  answer: string | string[];
}

export interface KeystoreDeliveryFile {
  fileName: string;
  url: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface KeystoreMessageAttachment {
  fileName: string;
  url: string;
  mimeType: string;
}

// ── Valid Status Transitions ───────────────────────────────────────────────

export const VALID_ORDER_STATUS_TRANSITIONS: Record<
  KeystoreOrderStatus,
  KeystoreOrderStatus[]
> = {
  REQUESTED: ['QUOTED', 'DECLINED', 'CANCELLED'],
  QUOTED: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['REVIEW', 'CANCELLED'],
  REVIEW: ['COMPLETED', 'REVISION_REQUESTED'],
  REVISION_REQUESTED: ['IN_PROGRESS'],
  COMPLETED: ['DELIVERED'],
  DELIVERED: [],
  DECLINED: [],
  CANCELLED: [],
};

export function isValidStatusTransition(
  from: KeystoreOrderStatus,
  to: KeystoreOrderStatus,
): boolean {
  return VALID_ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Default Service Categories ─────────────────────────────────────────────

export const DEFAULT_KEYSTORE_CATEGORIES = [
  {
    name: 'Content Creation',
    slug: 'content-creation',
    icon: 'FileText',
    description: 'Blog posts, social content, email campaigns, copywriting',
  },
  {
    name: 'Design & Branding',
    slug: 'design-branding',
    icon: 'Palette',
    description: 'Logo design, brand identity, graphics, UI/UX',
  },
  {
    name: 'Web Development',
    slug: 'web-development',
    icon: 'Code',
    description: 'Websites, landing pages, integrations, APIs',
  },
  {
    name: 'Marketing Strategy',
    slug: 'marketing-strategy',
    icon: 'TrendingUp',
    description: 'Growth plans, campaign strategy, market research',
  },
  {
    name: 'Business Operations',
    slug: 'business-operations',
    icon: 'Settings',
    description: 'Workflows, automations, process documentation',
  },
  {
    name: 'Consulting',
    slug: 'consulting',
    icon: 'Users',
    description: '1-on-1 advisory, business reviews, growth sessions',
  },
] as const;

// ── Order Timeline Event ───────────────────────────────────────────────────

export interface OrderTimelineEvent {
  status: KeystoreOrderStatus;
  timestamp: string;
  actor: { type: string; id: string };
  note?: string;
}
