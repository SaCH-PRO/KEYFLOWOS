/**
 * The obligation contract.
 *
 * An obligation is something this business OWES someone by a date: rebook the
 * client six weeks after their cut, file the VAT return by the 20th, chase the
 * invoice that went past due yesterday, call the customer back before the SLA
 * expires. A salon's rebook and an accountant's return are the same row with
 * the same clock, and that is the entire point — the vocabulary differs per
 * business, the shape does not.
 *
 * WHY THIS IS AN EVENT AND NOT A TABLE.
 *
 * The obligation row already exists. `CommandItem` (schema.prisma) carries
 * dueAt, snoozedUntil, riskTier, requiresApproval, executableByKey,
 * executionTool, executionPayload, entityType/entityId, contactId and
 * expectedValue, and it already has a manual surface at /app/command-center
 * with complete / dismiss / snooze / approve / execute / assign / reopen wired.
 * A second `Obligation` table would be the fourth recurrence-ish store in this
 * schema and the seventeenth writer of the third.
 *
 * What CommandItem did not have is an OWNER. Sixteen files across twelve
 * modules write `commandItem.create` directly today, which is how a table ends
 * up with twelve different opinions about what its status vocabulary means.
 * So the contract is: producers emit, `CommandModule` writes. This file is the
 * only thing they share.
 *
 * IDEMPOTENCY IS THE FIVE-TUPLE, NOT A NEW COLUMN.
 *
 * CommandItem already declares
 *   @@unique([businessId, sourceModule, sourceType, sourceId, actionType])
 * which is exactly an obligation key. A series occurrence sets
 * sourceModule='obligations', sourceType='series', sourceId=<seriesId> and
 * actionType=<ISO occurrence date>, so "exactly once per occurrence" needs no
 * index that is not already there. Raise the same obligation twice and the
 * second is an upsert onto the first.
 *
 * STATUS IS NOT STORED FOR THE CLOCK.
 *
 * PENDING / DUE / OVERDUE are a comparison of `dueAt` to now(), not states.
 * Storing them would need a sweep that flips rows — a timer, on a product that
 * already has 52 setInterval schedulers and no leader election. `dueAt` and a
 * query are enough, and they cannot drift.
 */

/** Emitted by any module that has learned this business owes someone something. */
export const WORK_OBLIGATION_RAISED = 'work.obligation.raised' as const;

/** Emitted when the thing owed has been done, or is no longer owed. */
export const WORK_OBLIGATION_SETTLED = 'work.obligation.settled' as const;

export const WORK_EVENTS = [WORK_OBLIGATION_RAISED, WORK_OBLIGATION_SETTLED] as const;

export type WorkEventName = (typeof WORK_EVENTS)[number];

/**
 * Who the obligation is owed TO.
 *
 * Deliberately a label alongside the id. "Due this week" has to render without
 * fanning out to four tables per row, and the label is a snapshot at the moment
 * the obligation was raised — if a contact is later renamed, the obligation
 * still says who it was about when it was made.
 */
export type ObligationOwedToType = 'CONTACT' | 'SUPPLIER' | 'AUTHORITY' | 'STAFF' | 'BUSINESS';

export interface ObligationRaisedPayload {
  businessId: string;

  /** The five-tuple. Together these are the obligation's identity. */
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  /** What is owed: 'REBOOK', 'FILE_VAT', 'CHASE_PAYMENT', 'FIRST_RESPONSE'. */
  actionType: string;

  /** What a human reads in the list. */
  title: string;
  description?: string | null;

  /** MONEY | TIME | PEOPLE | WORK | SALES | MARKETING | GOVERNANCE | STRATEGY | SYSTEM */
  category: string;

  /** When it is owed by. An obligation without a clock is a suggestion. */
  dueAt: Date;

  owedToType?: ObligationOwedToType | null;
  owedToId?: string | null;
  owedToLabel?: string | null;

  /** Set when this occurrence was materialised from a recurring series. */
  seriesId?: string | null;

  /** Optional pass-throughs onto the CommandItem row. */
  contactId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  expectedValue?: number | null;
  currency?: string | null;
  priority?: number;
  urgency?: number;

  /** If KEY can discharge this unattended, the tool that does it. */
  executionTool?: string | null;
  executionPayload?: Record<string, unknown> | null;
  riskTier?: number;
  requiresApproval?: boolean;
}

/**
 * Two ways to say an obligation is met, because producers know two different
 * things.
 *
 * BY FIVE-TUPLE — the producer knows exactly which obligation it discharged.
 * BY PARTY (`owedToId` + `actionType`, no `sourceId`) — the producer knows only
 * WHO it settled for. A rebooking is the motivating case: it knows the contact,
 * but not the id of the completed appointment that made a rebook owed, so it
 * cannot name the five-tuple that raised the obligation. Without this second
 * form the rebook obligation stays open after the client is actually rebooked,
 * and the due list fills with work that genuinely happened.
 */
export interface ObligationSettledPayload {
  businessId: string;
  actionType: string;
  /** The five-tuple form. Omit `sourceId` to settle by party instead. */
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  /** The by-party form: settles every open obligation of this actionType owed to them. */
  owedToId?: string | null;
  /** What discharged it — a tool name, a route, 'manual', an invoice id. */
  dischargeRef?: string | null;
}
