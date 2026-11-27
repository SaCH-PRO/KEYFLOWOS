/**
 * P160 (RR-LEGACY-FALLBACK-REMOVE): standalone domain helpers for the v1-kept
 * legacy KEY tools promoted into canonical `FLOW_TOOLS`:
 *   - `finance_list_overdue_invoices` (D-260 sent-only overdue invoices)
 *   - `finance_create_invoice_reminder_draft` (D-260 deterministic tier-2 reminder draft)
 *   - `crm_recommend_follow_ups` (stale contacts bounded by D-37 CRM visibility)
 *   - `commerce_summarize_revenue` (all-time PAID invoice revenue summary)
 *   - `crm_create_reminder` (ContactTask reminder for a required, own-tenant visible contactId)
 *
 * Kept as pure module helpers outside governed service classes so static
 * route-to-tool scope derivation (`job-role-tool-families.spec.ts`) remains exact.
 */
import type { Prisma } from '@keyflow/db';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { readInvoiceMoney } from '../commerce/commerce-stats.service';
import { balanceOfStoredRows, creditAwareBalance } from '../commerce/invoice-workflow.service';
import { fromCents, sumMoney, toCents } from '../commerce/money';
import { normalizeCurrency } from '../finance/posting.service';

/**
 * D-260 (FU-KEY-OVERDUE-SENT-ONLY): invoice statuses the customer was actually
 * sent and that remain open for collection. Excludes never-sent PENDING and
 * DRAFT, as well as settled/closed PAID, VOID, FAILED, FULLY_CREDITED.
 *
 * Distinct from OPEN_RECEIVABLE_STATUSES (D-256), which keeps PENDING in every
 * owed total and in ReceivablesService.getAging.
 */
export const SENT_OVERDUE_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  'SENT',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PARTIALLY_CREDITED',
]);

const MAX_OVERDUE_LIMIT = 100;
const MAX_FOLLOWUP_LIMIT = 100;
const MAX_DAYS_STALE = 3650;
const REMINDER_TONES = ['friendly', 'firm', 'urgent'] as const;
type ReminderTone = (typeof REMINDER_TONES)[number];

export interface OverdueInvoiceListResult {
  invoices: Array<{
    id: string;
    invoiceNumber?: string;
    status: string;
    total: number;
    currency: string;
    dueDate: string;
    contactName: string;
    daysOverdue: number;
  }>;
  total: number;
  currency: string;
  totalsByCurrency: Record<string, number>;
}

export async function listSentOverdueInvoices(
  prisma: PrismaService,
  businessId: string,
  rawLimit?: unknown,
): Promise<OverdueInvoiceListResult> {
  let limit = 10;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    const n = typeof rawLimit === 'boolean' ? Number.NaN : Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error('limit must be a positive finite number');
    }
    limit = Math.min(Math.floor(n), MAX_OVERDUE_LIMIT);
  }

  if (typeof businessId !== 'string' || businessId.length === 0) {
    return { invoices: [], total: 0, currency: 'TTD', totalsByCurrency: {} };
  }

  // D-260: read open receivables directly and restrict to sent open statuses
  // (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED) without altering
  // ReceivablesService.getAging totals (which keep PENDING under D-256).
  const now = new Date();
  const [biz, openInvoices] = await Promise.all([
    prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    }),
    readInvoiceMoney(prisma.client, businessId, now, { openOnly: true }),
  ]);
  const homeCurrency = normalizeCurrency(biz?.currency) || 'TTD';

  const overdueSent = openInvoices
    .filter((inv) => SENT_OVERDUE_INVOICE_STATUSES.has(inv.status) && inv.overdue && inv.remaining > 0)
    .map((inv) => {
      const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
      const daysOverdue =
        dueMs !== null ? Math.max(0, Math.floor((now.getTime() - dueMs) / 86400000)) : 0;
      return { inv, daysOverdue };
    });

  const contactIds = Array.from(
    new Set(overdueSent.map(({ inv }) => inv.contactId).filter((id): id is string => Boolean(id))),
  );
  const contacts = contactIds.length
    ? await prisma.client.contact.findMany({
        where: { businessId, deletedAt: null, id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  const contactOf = new Map(contacts.map((c) => [c.id, c]));

  // D-13 / D-251: never add different currencies together; keep top-level total in homeCurrency
  // and expose every currency separately in totalsByCurrency.
  const amountsByCurrency = new Map<string, number[]>();
  for (const { inv } of overdueSent) {
    const cur = normalizeCurrency(inv.currency) || homeCurrency;
    const bucket = amountsByCurrency.get(cur);
    if (bucket) bucket.push(inv.remaining);
    else amountsByCurrency.set(cur, [inv.remaining]);
  }
  const totalsByCurrency: Record<string, number> = {};
  for (const [cur, amounts] of amountsByCurrency.entries()) {
    totalsByCurrency[cur] = sumMoney(amounts);
  }

  const total = totalsByCurrency[homeCurrency] ?? 0;
  const invoices = overdueSent
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.inv.id.localeCompare(b.inv.id))
    .slice(0, limit)
    .map(({ inv, daysOverdue }) => {
      const contact = inv.contactId ? contactOf.get(inv.contactId) : undefined;
      const contactName = contact
        ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || contact.email || 'Unknown'
        : 'Unknown';
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? undefined,
        status: inv.status,
        total: inv.remaining,
        currency: normalizeCurrency(inv.currency) || homeCurrency,
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : '',
        contactName,
        daysOverdue,
      };
    });
  return { invoices, total, currency: homeCurrency, totalsByCurrency };
}

export async function createSentOverdueInvoiceReminderDraft(
  prisma: PrismaService,
  businessId: string,
  rawInvoiceId: unknown,
  rawTone?: unknown,
): Promise<{ draft: string; invoiceId: string }> {
  const invoiceId = typeof rawInvoiceId === 'string' ? rawInvoiceId.trim() : '';
  if (!invoiceId) {
    throw new Error('invoiceId is required');
  }

  let tone: ReminderTone = 'friendly';
  if (rawTone !== undefined && rawTone !== null && rawTone !== '') {
    const candidate = String(rawTone);
    if (!(REMINDER_TONES as readonly string[]).includes(candidate)) {
      throw new Error('tone must be one of: friendly, firm, urgent');
    }
    tone = candidate as ReminderTone;
  }

  if (typeof businessId !== 'string' || businessId.length === 0) {
    throw new Error('Invoice not found');
  }

  const invoice = await prisma.client.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId,
      deletedAt: null,
    },
    include: {
      contact: { select: { firstName: true, lastName: true, email: true, businessId: true, deletedAt: true } },
      payments: { where: { businessId }, select: { amount: true, status: true } },
    },
  });
  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // D-260: never draft payment reminders for never-sent (PENDING, DRAFT) or
  // settled/closed (PAID, VOID, FAILED, FULLY_CREDITED) invoices.
  if (!SENT_OVERDUE_INVOICE_STATUSES.has(invoice.status)) {
    throw new Error(
      `Cannot draft a payment reminder for invoice with status ${invoice.status}; only sent open invoices (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED) can be reminded`,
    );
  }

  const now = new Date();
  const isOverdue = invoice.status === 'OVERDUE' || (!!invoice.dueDate && new Date(invoice.dueDate) < now);
  if (!isOverdue) {
    throw new Error('Cannot draft an overdue payment reminder for an invoice that is not yet past due');
  }

  // Compute own-tenant payment- and credit-aware remaining balance (D-75, D-78, D-250).
  const grossTotal = Number(invoice.total ?? 0) || 0;
  const rowsBalance = balanceOfStoredRows(grossTotal, invoice.payments ?? [], invoice.currency);
  let appliedCredits = 0;
  if (invoice.status === 'PARTIALLY_CREDITED') {
    const creditAgg = await prisma.client.creditNote.aggregate({
      where: { businessId, invoiceId: invoice.id, status: 'APPLIED' },
      _sum: { amount: true },
    });
    appliedCredits = Number(creditAgg._sum.amount ?? 0) || 0;
  }
  const balance = creditAwareBalance(rowsBalance, appliedCredits);
  const owedCap = Math.max(0, toCents(rowsBalance.total) - toCents(balance.credited));
  const amount = fromCents(Math.min(toCents(balance.remaining), owedCap));
  if (amount <= 0) {
    throw new Error('Cannot draft a payment reminder for an invoice with no remaining balance due');
  }

  const ownContact =
    invoice.contact && invoice.contact.businessId === businessId && !invoice.contact.deletedAt
      ? invoice.contact
      : null;
  const name = ownContact?.firstName || 'there';
  const currency = normalizeCurrency(invoice.currency) || 'TTD';
  const daysOverdue = invoice.dueDate
    ? Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000))
    : 0;
  const overduePhrase = daysOverdue > 0 ? `${daysOverdue} days overdue` : 'overdue';

  const templates: Record<ReminderTone, string> = {
    friendly: `Hi ${name}, just a friendly reminder that invoice ${invoice.invoiceNumber} for ${currency} ${amount.toLocaleString()} is ${overduePhrase}. Please let me know if you need anything.`,
    firm: `Hi ${name}, this is a follow-up regarding invoice ${invoice.invoiceNumber} for ${currency} ${amount.toLocaleString()}, which is now ${overduePhrase}. Please arrange payment at your earliest convenience.`,
    urgent: `Hi ${name}, invoice ${invoice.invoiceNumber} for ${currency} ${amount.toLocaleString()} is ${overduePhrase} and requires immediate attention. Please contact us to arrange payment.`,
  };
  const draft = Object.prototype.hasOwnProperty.call(templates, tone)
    ? templates[tone]
    : templates.friendly;
  return { draft, invoiceId };
}

export async function summarizePaidRevenue(
  prisma: PrismaService,
  businessId: string,
): Promise<{ totalRevenue: number; paidInvoiceCount: number; currency: string }> {
  const [agg, count, sample] = await Promise.all([
    prisma.client.invoice.aggregate({
      where: { businessId, deletedAt: null, status: 'PAID' },
      _sum: { total: true },
    }),
    prisma.client.invoice.count({
      where: { businessId, deletedAt: null, status: 'PAID' },
    }),
    prisma.client.invoice.findFirst({
      where: { businessId, deletedAt: null },
      select: { currency: true },
    }),
  ]);
  return {
    totalRevenue: Number(agg._sum.total ?? 0),
    paidInvoiceCount: count,
    currency: sample?.currency ?? 'TTD',
  };
}

export async function recommendStaleFollowUps(
  prisma: PrismaService,
  businessId: string,
  rawDaysStale?: unknown,
  rawLimit?: unknown,
  visClause?: Prisma.ContactWhereInput | null,
): Promise<{
  contacts: Array<{ id: string; name: string; email: string; daysSinceContact: number; status: string }>;
  count: number;
}> {
  let daysStale = 14;
  if (rawDaysStale !== undefined && rawDaysStale !== null && rawDaysStale !== '') {
    const n = typeof rawDaysStale === 'boolean' ? Number.NaN : Number(rawDaysStale);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error('daysStale must be a non-negative finite number');
    }
    daysStale = Math.min(Math.floor(n), MAX_DAYS_STALE);
  }
  let limit = 10;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    const n = typeof rawLimit === 'boolean' ? Number.NaN : Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error('limit must be a positive finite number');
    }
    limit = Math.min(Math.floor(n), MAX_FOLLOWUP_LIMIT);
  }

  const cutoff = new Date(Date.now() - daysStale * 86400000);
  const contacts = await prisma.client.contact.findMany({
    where: {
      businessId,
      deletedAt: null,
      lastInteractionAt: { lt: cutoff },
      status: { not: 'DORMANT' },
      ...(visClause ? { AND: [visClause] } : {}),
    },
    orderBy: [{ lastInteractionAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, firstName: true, lastName: true, email: true, status: true, lastInteractionAt: true },
  });
  const mapped = contacts.map((c) => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
    email: c.email || '',
    daysSinceContact: c.lastInteractionAt
      ? Math.floor((Date.now() - new Date(c.lastInteractionAt).getTime()) / 86400000)
      : 999,
    status: c.status,
  }));
  return { contacts: mapped, count: mapped.length };
}

export async function createReminderTask(
  prisma: PrismaService,
  businessId: string,
  rawTitle: unknown,
  rawContactId?: unknown,
  rawDueDate?: unknown,
  visClause?: Prisma.ContactWhereInput | null,
): Promise<{ reminderId: string }> {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    throw new Error('title is required');
  }

  const contactId =
    typeof rawContactId === 'string' && rawContactId.trim().length > 0 ? rawContactId.trim() : '';
  if (!contactId) {
    throw new Error('contactId is required');
  }

  let dueDate: Date | undefined;
  if (rawDueDate !== undefined && rawDueDate !== null && rawDueDate !== '') {
    const parsed = new Date(String(rawDueDate));
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('dueDate is not a valid date');
    }
    dueDate = parsed;
  }

  const contact = await prisma.client.contact.findFirst({
    where: {
      id: contactId,
      businessId,
      deletedAt: null,
      ...(visClause ? { AND: [visClause] } : {}),
    },
    select: { id: true },
  });
  if (!contact) {
    throw new Error('Contact not found');
  }

  const task = await prisma.client.contactTask.create({
    data: {
      businessId,
      contactId,
      title,
      status: 'OPEN',
      dueDate,
    },
  });
  return { reminderId: task.id };
}
