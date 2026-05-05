import {
  CalendarEventInput,
  CalendarEventStatus,
  CalendarEventType,
  CalendarEventPriority,
} from '@keyflow/shared';

// ---------------------------------------------------------------------------
// Structural source types
//
// Mappers stay decoupled from Prisma row types so they can be unit-tested
// and re-used by listeners that receive partial payloads. Each interface
// captures only the fields the projection needs.
// ---------------------------------------------------------------------------

export interface SourceContact {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  nextActionAt?: Date | string | null;
  nextActionType?: string | null;
  priority?: string | null;
}

export interface SourceBooking {
  id: string;
  startTime: Date | string;
  endTime?: Date | string | null;
  status: string;
  notes?: string | null;
  location?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  contactId?: string | null;
  service?: { name?: string | null } | null;
  contact?: SourceContact | null;
}

export interface SourceSocialPost {
  id: string;
  content?: string | null;
  status: string;
  scheduledAt?: Date | string | null;
  postedAt?: Date | string | null;
  externalUrl?: string | null;
  channelIds?: string[] | null;
}

export interface SourceEmailCampaign {
  id: string;
  name?: string | null;
  subject?: string | null;
  status: string;
  scheduledAt?: Date | string | null;
  sentAt?: Date | string | null;
  totalRecipients?: number | null;
  sentCount?: number | null;
}

export interface SourceContactTask {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  source?: string | null;
  contactId: string;
  assigneeId?: string | null;
  dueDate?: Date | string | null;
  remindAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export interface SourceInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  contactId: string;
  total: number;
  currency: string;
  dueDate?: Date | string | null;
  paidAt?: Date | string | null;
}

export interface SourceQuote {
  id: string;
  quoteNumber: string;
  status: string;
  contactId: string;
  total: number;
  currency: string;
  expiryDate?: Date | string | null;
}

export interface SourceProject {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  color?: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  invoiceId?: string | null;
  dueDate?: Date | string | null;
}

export interface SourceProjectTask {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  isCompleted?: boolean | null;
  projectId: string;
  assigneeId?: string | null;
  dueDate?: Date | string | null;
}

export interface SourceRecurringInvoice {
  id: string;
  name: string;
  frequency: string;
  contactId: string;
  total: number;
  currency: string;
  nextRunDate?: Date | string | null;
  runCount?: number | null;
}

export interface SourceMarketplaceOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus?: string | null;
  total: number;
  currency: string;
  metadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Status maps
// ---------------------------------------------------------------------------

const BOOKING_STATUS_MAP: Record<string, CalendarEventStatus> = {
  PENDING: 'TENTATIVE',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};

const SOCIAL_STATUS_MAP: Record<string, CalendarEventStatus> = {
  DRAFT: 'TENTATIVE',
  SCHEDULED: 'SCHEDULED',
  POSTED: 'COMPLETED',
  FAILED: 'FAILED',
};

const CAMPAIGN_STATUS_MAP: Record<string, CalendarEventStatus> = {
  DRAFT: 'TENTATIVE',
  SCHEDULED: 'SCHEDULED',
  SENDING: 'IN_PROGRESS',
  SENT: 'COMPLETED',
  FAILED: 'FAILED',
};

const TASK_STATUS_MAP: Record<string, CalendarEventStatus> = {
  OPEN: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export function priorityFor(value?: string | null): CalendarEventPriority {
  switch ((value ?? '').toUpperCase()) {
    case 'LOW':
      return 'LOW';
    case 'HIGH':
      return 'HIGH';
    case 'URGENT':
      return 'URGENT';
    default:
      return 'NORMAL';
  }
}

function contactName(c: SourceContact | null | undefined): string | null {
  if (!c) return null;
  if (c.displayName) return c.displayName;
  const fn = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return fn || c.email || null;
}

function preview(text: string | null | undefined, max: number): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapBooking(b: SourceBooking, businessId: string): CalendarEventInput | null {
  if (!b?.startTime) return null;
  return {
    businessId,
    type: 'BOOKING' as CalendarEventType,
    module: 'BOOKINGS',
    title: `${b.service?.name ?? 'Booking'} — ${contactName(b.contact) ?? 'Customer'}`,
    description: b.notes ?? null,
    startAt: new Date(b.startTime),
    endAt: b.endTime ? new Date(b.endTime) : null,
    timezone: null,
    status: BOOKING_STATUS_MAP[b.status] ?? 'SCHEDULED',
    sourceType: 'booking',
    sourceId: b.id,
    contactId: b.contactId ?? null,
    staffId: b.staffId ?? null,
    meta: { location: b.location ?? null, serviceId: b.serviceId },
  };
}

export function mapSocialPost(p: SourceSocialPost, businessId: string): CalendarEventInput | null {
  const start = p?.scheduledAt ?? p?.postedAt;
  if (!start) return null;
  return {
    businessId,
    type: 'CONTENT_POST',
    module: 'MARKETING',
    title: preview(p.content, 80) || 'Social post',
    description: p.content,
    startAt: new Date(start),
    endAt: null,
    status: SOCIAL_STATUS_MAP[p.status] ?? 'SCHEDULED',
    sourceType: 'social_post',
    sourceId: p.id,
    sourceUrl: p.externalUrl ?? null,
    meta: { channelIds: p.channelIds, postedAt: p.postedAt },
  };
}

export function mapEmailCampaign(
  c: SourceEmailCampaign,
  businessId: string,
): CalendarEventInput | null {
  const start = c?.scheduledAt ?? c?.sentAt;
  if (!start) return null;
  return {
    businessId,
    type: 'EMAIL_CAMPAIGN',
    module: 'MARKETING',
    title: c.name || c.subject || 'Email campaign',
    description: c.subject,
    startAt: new Date(start),
    endAt: null,
    status: CAMPAIGN_STATUS_MAP[c.status] ?? 'SCHEDULED',
    sourceType: 'email_campaign',
    sourceId: c.id,
    meta: { totalRecipients: c.totalRecipients, sentCount: c.sentCount },
  };
}

export function mapContactTask(
  t: SourceContactTask,
  businessId: string,
): CalendarEventInput | null {
  if (!t?.dueDate) return null;
  const isFollowUp = (t.source ?? '').toLowerCase().includes('follow');
  return {
    businessId,
    type: isFollowUp ? 'FOLLOW_UP' : 'CONTACT_TASK',
    module: 'CRM',
    title: t.title,
    startAt: new Date(t.dueDate),
    endAt: null,
    status: TASK_STATUS_MAP[t.status] ?? 'SCHEDULED',
    priority: priorityFor(t.priority),
    sourceType: 'contact_task',
    sourceId: t.id,
    contactId: t.contactId,
    assigneeId: t.assigneeId ?? null,
    meta: { remindAt: t.remindAt, completedAt: t.completedAt },
  };
}

export function mapInvoiceDue(i: SourceInvoice, businessId: string): CalendarEventInput | null {
  if (!i?.dueDate) return null;
  return {
    businessId,
    type: 'INVOICE_DUE',
    module: 'REVENUE',
    title: `Invoice ${i.invoiceNumber} due`,
    startAt: new Date(i.dueDate),
    endAt: null,
    status: i.status === 'PAID' ? 'COMPLETED' : 'SCHEDULED',
    sourceType: 'invoice',
    sourceId: i.id,
    contactId: i.contactId,
    amount: i.total,
    currency: i.currency,
    meta: { status: i.status, paidAt: i.paidAt },
  };
}

export function mapInvoiceOverdue(
  i: SourceInvoice,
  businessId: string,
): CalendarEventInput | null {
  if (!i?.dueDate) return null;
  return {
    businessId,
    type: 'INVOICE_OVERDUE',
    module: 'REVENUE',
    title: `Invoice ${i.invoiceNumber} overdue`,
    startAt: new Date(i.dueDate),
    endAt: null,
    status: 'OVERDUE',
    priority: 'HIGH',
    sourceType: 'invoice_overdue',
    sourceId: i.id,
    contactId: i.contactId,
    amount: i.total,
    currency: i.currency,
    meta: { status: i.status, paidAt: i.paidAt },
  };
}

export function mapQuote(q: SourceQuote, businessId: string): CalendarEventInput | null {
  if (!q?.expiryDate) return null;
  return {
    businessId,
    type: 'QUOTE_EXPIRY',
    module: 'REVENUE',
    title: `Quote ${q.quoteNumber} expires`,
    startAt: new Date(q.expiryDate),
    endAt: null,
    status: q.status === 'ACCEPTED' ? 'COMPLETED' : 'SCHEDULED',
    sourceType: 'quote',
    sourceId: q.id,
    contactId: q.contactId,
    amount: q.total,
    currency: q.currency,
    meta: { status: q.status },
  };
}

export function mapProject(p: SourceProject, businessId: string): CalendarEventInput | null {
  if (!p?.dueDate) return null;
  return {
    businessId,
    type: 'PROJECT_TASK',
    module: 'PROJECTS',
    title: `${p.name} (project due)`,
    description: p.description,
    startAt: new Date(p.dueDate),
    endAt: null,
    status: p.status === 'COMPLETED' ? 'COMPLETED' : 'SCHEDULED',
    priority: priorityFor(p.priority),
    color: p.color ?? null,
    sourceType: 'project',
    sourceId: p.id,
    contactId: p.contactId ?? null,
    meta: { status: p.status, bookingId: p.bookingId, invoiceId: p.invoiceId },
  };
}

export function mapProjectTask(
  t: SourceProjectTask,
  businessId: string,
): CalendarEventInput | null {
  if (!t?.dueDate) return null;
  return {
    businessId,
    type: 'PROJECT_TASK',
    module: 'PROJECTS',
    title: t.title,
    description: t.description,
    startAt: new Date(t.dueDate),
    endAt: null,
    status: t.isCompleted ? 'COMPLETED' : 'SCHEDULED',
    priority: priorityFor(t.priority),
    sourceType: 'project_task',
    sourceId: t.id,
    assigneeId: t.assigneeId ?? null,
    meta: { projectId: t.projectId },
  };
}

export function mapRecurringInvoice(
  r: SourceRecurringInvoice,
  businessId: string,
): CalendarEventInput | null {
  if (!r?.nextRunDate) return null;
  return {
    businessId,
    type: 'RECURRING_INVOICE',
    module: 'REVENUE',
    title: `${r.name} (next ${String(r.frequency).toLowerCase()})`,
    startAt: new Date(r.nextRunDate),
    endAt: null,
    status: 'SCHEDULED',
    sourceType: 'recurring_invoice',
    sourceId: r.id,
    contactId: r.contactId,
    amount: r.total,
    currency: r.currency,
    meta: { frequency: r.frequency, runCount: r.runCount },
  };
}

export function mapMarketplaceOrder(
  o: SourceMarketplaceOrder,
  businessId: string,
): CalendarEventInput | null {
  const meta = (o?.metadata as Record<string, unknown> | null) ?? {};
  const expected =
    (meta['expectedShipAt'] as string | undefined) ??
    (meta['expectedDeliveryAt'] as string | undefined);
  if (!expected) return null;
  const status = String(o.status ?? '').toLowerCase();
  let mapped: CalendarEventStatus = 'SCHEDULED';
  if (status === 'delivered' || status === 'completed') mapped = 'COMPLETED';
  else if (status === 'cancelled' || status === 'canceled') mapped = 'CANCELLED';
  else if (status === 'refunded') mapped = 'CANCELLED';
  else if (status === 'failed') mapped = 'FAILED';
  return {
    businessId,
    type: 'SHIPMENT',
    module: 'ORDERS',
    title: `Order ${o.orderNumber} — expected delivery`,
    startAt: new Date(expected),
    endAt: null,
    status: mapped,
    sourceType: 'marketplace_order',
    sourceId: o.id,
    amount: o.total,
    currency: o.currency,
    meta: { status: o.status, paymentStatus: o.paymentStatus },
  };
}

export function mapContactNextAction(
  c: SourceContact,
  businessId: string,
): CalendarEventInput | null {
  if (!c?.nextActionAt) return null;
  return {
    businessId,
    type: 'FOLLOW_UP',
    module: 'CRM',
    title: `Follow up: ${contactName(c) ?? 'contact'}${c.nextActionType ? ` (${c.nextActionType})` : ''}`,
    startAt: new Date(c.nextActionAt),
    endAt: null,
    status: 'SCHEDULED',
    priority: priorityFor(c.priority),
    sourceType: 'activity',
    sourceId: `next_action:${c.id}`,
    contactId: c.id,
    meta: { nextActionType: c.nextActionType ?? null },
  };
}
