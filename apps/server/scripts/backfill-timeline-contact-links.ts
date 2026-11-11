#!/usr/bin/env tsx
/**
 * Backfill the contact link of timeline rows that name a contact only in their
 * text (owner ruling D-115; review SEC-W9TO-1; packet W10-DATA-CLEANUP-SCRIPTS).
 *
 * WHY THIS EXISTS
 *
 * The timeline rule (apps/server/src/modules/timeline/timeline-visibility.ts,
 * owner ruling D-63) withholds a row naming a contact from a member who may not
 * open that contact, and it reads which contact a row names from its
 * contactId (and its entityId when entityType is 'contact'). Two writers named
 * the contact only in the row's text until W9-TEXT-ONLY-CONTACT-WRITERS:
 *
 *   - KEY's commerce_send_invoice (FlowOrchestratorService.executeToolAction):
 *     { module 'commerce', action 'invoice_sent', entityType 'invoice',
 *       entityId <invoice id>, title 'Invoice <n> sent to <contact name>' };
 *   - MessageIntakeOrchestrator.executePlan:
 *     { module 'communications', action 'message_intake.approved',
 *       entityType 'message_intake', entityId <intake id>,
 *       detail '<intent> from <sender> — <subject>' }.
 *
 * Since W9 both store the contactId; the rows they stored before keep it null,
 * so the feed (/events, the day's summary, the legacy activity route, the
 * briefings) still serves them to members who may not open that contact
 * (timeline-scope TS-13d, live in test/data-cleanup-scripts.integration.test.ts).
 *
 * WHAT IT DOES (D-115)
 *
 *   1. Link: a row of either writer whose contactId is empty gets the contact
 *      of the invoice / intake its entityId names, when that invoice / intake
 *      belongs to the row's business and its contact does too. An invoice row
 *      is linked only when its title names that contact (review SEC-W10DCS-2):
 *      updateInvoice re-points a DRAFT / SENT / OVERDUE invoice's contactId,
 *      and the title names the contact the invoice had when it was sent, so the
 *      title must end ' sent to <the contact's name as the writer formats it>'
 *      ('first last', or 'Customer'). A message intake's contact is never
 *      re-pointed after approval (only set null when the contact is deleted).
 *      Nothing else on the row changes.
 *   2. Withhold: a row whose source is gone (no invoice / intake with that id in
 *      the row's business, no entityId, or a source whose contact belongs to
 *      another business), and an invoice row whose title names someone other
 *      than its invoice's contact (renamed, or re-pointed since), cannot be
 *      tied to a contact, so it is served only to OWNER and ADMIN: its module
 *      becomes WITHHELD_MODULE, a module the
 *      timeline table (ACTIVITY_MODULE_SCOPES) deliberately does not map, and
 *      the rule serves a row of an unmapped module to OWNER and ADMIN only
 *      (and SUPER_ADMIN; D-63, canReadActivityRow's readsUnmapped). The rule is
 *      not changed. An invoice row is filed under category COMMERCE (unless it
 *      already carries a revenue category), so it still needs revenue read, as
 *      its module 'commerce' required. The original module and category are
 *      kept under data.d115 ({ withheld, module, category }; withheld is
 *      'source_gone', or 'name_mismatch' for an invoice row whose invoice is
 *      there but names another contact), the row's own data merged around it;
 *      title, detail and entity stay.
 *
 *      OPEN (review SEC-W10DCS-1 / CR-W10DCS-1, outside this packet's write
 *      set): the unmapped branch reads the role only, so a withheld intake row
 *      (module 'communications' before, which needed crm read) is served to an
 *      ADMIN whose crm access is explicitly 'none', who was not served it
 *      before. No column the rule reads ties an unmapped row to crm (only a
 *      named contact does, and naming an id that is no contact of the
 *      business would hide the row from every ADMIN). The smallest rule change: in canReadActivityRow, a
 *      row of module WITHHELD_MODULE also needs read on
 *      activityModuleScope(data.d115.module). data-cleanup-scripts DCS-T07
 *      (it.todo) is its negative control.
 *   3. Left as is: an approved intake whose intake names no contact (the
 *      sender is no contact of the business, or the contact was deleted and
 *      the intake's link set null). The W9 writer stores exactly that row
 *      today (contactId null; timeline-scope TS-13b), so it is counted, not
 *      changed.
 *
 * A row is a candidate only with its writer's exact shape (action, module and
 * entityType case-folded, contactId null or empty, and for the invoice row the
 * title 'Invoice % sent to %'); every other row is never read or written.
 *
 * SAFETY
 *
 * Dry run by default: it counts and writes nothing unless `--apply` is passed.
 * `--apply` runs four UPDATE statements (link invoice rows, link intake rows,
 * withhold invoice rows, withhold intake rows). A linked row has a contactId
 * and a withheld row another module, so neither is a candidate again: a re-run
 * changes nothing (idempotent), and a run stopped part way is finished by
 * running it again. `--business=<id>` (repeatable) limits a run to rows of
 * those businesses. It prints COUNTS ONLY (never an id, a title or a name), and
 * on a failure only the error's class and code, never the database's message.
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm backfill:timeline-contacts                     # dry run: counts only
 *   pnpm backfill:timeline-contacts --business=<id>     # dry run for one business
 *   pnpm backfill:timeline-contacts --apply             # write
 *
 * Exit status: 0 done, 1 a database read or write failed, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md.
 */
import { db } from '@keyflow/db';

type Db = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/**
 * D-115: the module a withheld row is moved to. The timeline table
 * (ACTIVITY_MODULE_SCOPES) must never map it: an unmapped module is served to
 * OWNER and ADMIN only (D-63). data-cleanup-scripts [DCS-T05] pins that.
 */
export const WITHHELD_MODULE = 'd115_withheld';

/** The two writers' rows, as `a` (activities). */
const INVOICE_ROW =
  "a.action = 'invoice_sent' AND lower(a.module) = 'commerce' AND lower(a.entity_type) = 'invoice'" +
  " AND (a.contact_id IS NULL OR a.contact_id = '') AND a.title LIKE 'Invoice % sent to %'";
const INTAKE_ROW =
  "a.action = 'message_intake.approved' AND lower(a.module) = 'communications' AND lower(a.entity_type) = 'message_intake'" +
  " AND (a.contact_id IS NULL OR a.contact_id = '')";

/** The row's invoice (`i`) in its business, whose contact (`c`) is of the same business. */
const INVOICE_SOURCE = 'i.id = a.entity_id AND i.business_id = a.business_id AND c.business_id = a.business_id';
/**
 * The contact's name as the KEY send_invoice writer put it in the title
 * (FlowOrchestratorService: [firstName, lastName].filter(Boolean).join(' ') || 'Customer').
 */
const CONTACT_TITLE_NAME = "coalesce(nullif(concat_ws(' ', nullif(c.first_name, ''), nullif(c.last_name, '')), ''), 'Customer')";
/** Review SEC-W10DCS-2: the row's title names `c` ('Invoice <n> sent to <name>' ends with ' sent to <name>'). */
const TITLE_NAMES_CONTACT = `right(a.title, length(' sent to ' || ${CONTACT_TITLE_NAME})) = ' sent to ' || ${CONTACT_TITLE_NAME}`;
/** The row's invoice is in its business with a contact of the same business (whoever the title names). */
const INVOICE_PRESENT = `EXISTS (SELECT 1 FROM invoices i JOIN contacts c ON c.id = i.contact_id WHERE ${INVOICE_SOURCE})`;
/** ...and the title names that contact: the row is linked to it. */
const INVOICE_LINKABLE = `EXISTS (SELECT 1 FROM invoices i JOIN contacts c ON c.id = i.contact_id WHERE ${INVOICE_SOURCE} AND ${TITLE_NAMES_CONTACT})`;
const INTAKE_LINKABLE =
  'EXISTS (SELECT 1 FROM message_intakes m JOIN contacts c ON c.id = m.contact_id' +
  ' WHERE m.id = a.entity_id AND m.business_id = a.business_id AND c.business_id = a.business_id)';
/** The row's intake in its business names no contact: left as the W9 writer stores it. */
const INTAKE_NO_CONTACT =
  'EXISTS (SELECT 1 FROM message_intakes m WHERE m.id = a.entity_id AND m.business_id = a.business_id AND m.contact_id IS NULL)';

/**
 * The row's own data (an object, or {} / { value } for anything else) with the
 * D-115 marker merged in; `reason` is an SQL text expression.
 */
const withheldData = (reason: string) =>
  "(CASE WHEN a.data IS NULL OR jsonb_typeof(a.data) = 'null' THEN '{}'::jsonb" +
  " WHEN jsonb_typeof(a.data) = 'object' THEN a.data ELSE jsonb_build_object('value', a.data) END)" +
  ` || jsonb_build_object('d115', jsonb_build_object('withheld', ${reason}, 'module', a.module, 'category', a.category))`;
/** An invoice row withheld though its invoice is there names another contact (review SEC-W10DCS-2). */
const INVOICE_WITHHELD_REASON = `(CASE WHEN ${INVOICE_PRESENT} THEN 'name_mismatch' ELSE 'source_gone' END)`;

export interface TimelineBackfillCounts {
  /** KEY send_invoice rows with no contactId. */
  invoiceUnlinked: number;
  /** Of those, the ones whose invoice and its contact are in the row's business and whose title names that contact. */
  invoiceLinkable: number;
  /** Of those not linkable, the ones whose invoice is there but names another contact (review SEC-W10DCS-2; withheld). */
  invoiceNameMismatch: number;
  /** Of those, the ones that are withheld: source gone, or the title names another contact. */
  invoiceSourceGone: number;
  /** message_intake.approved rows with no contactId. */
  intakeUnlinked: number;
  intakeLinkable: number;
  /** Rows whose intake names no contact: left as is. */
  intakeNoContact: number;
  intakeSourceGone: number;
}

export interface TimelineBackfillWrites {
  invoiceLinked: number;
  intakeLinked: number;
  invoiceWithheld: number;
  intakeWithheld: number;
}

/** The parsed command line, or the reason it was refused. */
export type Args = { apply: boolean; businessIds: string[] } | { error: string };

export function parseArgs(argv: string[]): Args {
  let apply = false;
  const businessIds: string[] = [];
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--business=')) {
      const id = arg.slice('--business='.length).trim();
      if (!id) return { error: '--business= needs a business id' };
      if (!businessIds.includes(id)) businessIds.push(id);
      continue;
    }
    return { error: 'unknown argument' };
  }
  return { apply, businessIds };
}

/** The scope term (the business ids bound as $1) and its parameters. */
function scopeOf(businessIds: string[]): { term: string; params: unknown[] } {
  return businessIds.length > 0 ? { term: ' AND a.business_id = ANY($1::text[])', params: [businessIds] } : { term: '', params: [] };
}

export async function countTimelineBackfill(database: Db, businessIds: string[] = []): Promise<TimelineBackfillCounts> {
  const scope = scopeOf(businessIds);
  const rows = (await database.$queryRawUnsafe(
    `SELECT
       count(*) FILTER (WHERE ${INVOICE_ROW})::int AS invoice_unlinked,
       count(*) FILTER (WHERE ${INVOICE_ROW} AND ${INVOICE_LINKABLE})::int AS invoice_linkable,
       count(*) FILTER (WHERE ${INVOICE_ROW} AND ${INVOICE_PRESENT} AND NOT ${INVOICE_LINKABLE})::int AS invoice_name_mismatch,
       count(*) FILTER (WHERE ${INTAKE_ROW})::int AS intake_unlinked,
       count(*) FILTER (WHERE ${INTAKE_ROW} AND ${INTAKE_LINKABLE})::int AS intake_linkable,
       count(*) FILTER (WHERE ${INTAKE_ROW} AND ${INTAKE_NO_CONTACT})::int AS intake_no_contact
     FROM activities a
     WHERE ((${INVOICE_ROW}) OR (${INTAKE_ROW}))${scope.term}`,
    ...scope.params,
  )) as Array<Record<string, number>>;
  const r = rows[0] ?? {};
  const n = (key: string) => Number(r[key] ?? 0);
  return {
    invoiceUnlinked: n('invoice_unlinked'),
    invoiceLinkable: n('invoice_linkable'),
    invoiceNameMismatch: n('invoice_name_mismatch'),
    invoiceSourceGone: n('invoice_unlinked') - n('invoice_linkable'),
    intakeUnlinked: n('intake_unlinked'),
    intakeLinkable: n('intake_linkable'),
    intakeNoContact: n('intake_no_contact'),
    intakeSourceGone: n('intake_unlinked') - n('intake_linkable') - n('intake_no_contact'),
  };
}

/**
 * The four writes, in order: links first, then the rows still unlinked whose
 * source is gone are withheld. Each statement is idempotent on its own.
 */
export async function applyTimelineBackfill(database: Db, businessIds: string[] = []): Promise<TimelineBackfillWrites> {
  const scope = scopeOf(businessIds);
  const invoiceLinked = await database.$executeRawUnsafe(
    `UPDATE activities a SET contact_id = i.contact_id
       FROM invoices i JOIN contacts c ON c.id = i.contact_id
      WHERE ${INVOICE_ROW}
        AND ${INVOICE_SOURCE} AND ${TITLE_NAMES_CONTACT}${scope.term}`,
    ...scope.params,
  );
  const intakeLinked = await database.$executeRawUnsafe(
    `UPDATE activities a SET contact_id = m.contact_id
       FROM message_intakes m JOIN contacts c ON c.id = m.contact_id
      WHERE ${INTAKE_ROW}
        AND m.id = a.entity_id AND m.business_id = a.business_id AND c.business_id = a.business_id${scope.term}`,
    ...scope.params,
  );
  const invoiceWithheld = await database.$executeRawUnsafe(
    `UPDATE activities a
        SET module = '${WITHHELD_MODULE}',
            category = CASE WHEN upper(coalesce(a.category, '')) IN ('COMMERCE', 'PAYMENT', 'FINANCE') THEN a.category ELSE 'COMMERCE' END,
            data = ${withheldData(INVOICE_WITHHELD_REASON)}
      WHERE ${INVOICE_ROW} AND NOT ${INVOICE_LINKABLE}${scope.term}`,
    ...scope.params,
  );
  const intakeWithheld = await database.$executeRawUnsafe(
    `UPDATE activities a
        SET module = '${WITHHELD_MODULE}',
            data = ${withheldData("'source_gone'")}
      WHERE ${INTAKE_ROW} AND NOT ${INTAKE_LINKABLE} AND NOT ${INTAKE_NO_CONTACT}${scope.term}`,
    ...scope.params,
  );
  return { invoiceLinked, intakeLinked, invoiceWithheld, intakeWithheld };
}

/** The error's class and its code: never its message. */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;
const row = (label: string, n: number) => `  ${label.padEnd(32)} ${n}`;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a database and
 * a logger; by default it uses @keyflow/db's client and prints to the console.
 */
export async function main(argv: string[], deps: { db?: Db; log?: Log; error?: Log } = {}): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(`Bad arguments (${args.error}). Usage: backfill-timeline-contact-links [--apply] [--business=<id> ...]`);
    return 2;
  }
  const database = deps.db ?? db;
  const scope = args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `Timeline contact-link backfill (D-115, SEC-W9TO-1) - APPLY: linking and withholding${scope}`
      : `Timeline contact-link backfill (D-115, SEC-W9TO-1) - DRY RUN: nothing is written; re-run with --apply to write${scope}`,
  );

  let counts: TimelineBackfillCounts;
  try {
    counts = await countTimelineBackfill(database, args.businessIds);
  } catch (err: unknown) {
    error(`The rows could not be counted: ${describeFailure(err)}. Nothing was written.`);
    return 1;
  }
  log(row('invoice_sent_unlinked', counts.invoiceUnlinked));
  log(row('invoice_sent_name_mismatch', counts.invoiceNameMismatch));
  log(row('intake_approved_unlinked', counts.intakeUnlinked));
  log(row('intake_approved_no_contact', counts.intakeNoContact));
  if (!args.apply) {
    log(row('invoice_sent_would_link', counts.invoiceLinkable));
    log(row('invoice_sent_would_withhold', counts.invoiceSourceGone));
    log(row('intake_approved_would_link', counts.intakeLinkable));
    log(row('intake_approved_would_withhold', counts.intakeSourceGone));
    return 0;
  }

  try {
    const writes = await applyTimelineBackfill(database, args.businessIds);
    log(row('invoice_sent_linked', writes.invoiceLinked));
    log(row('invoice_sent_withheld', writes.invoiceWithheld));
    log(row('intake_approved_linked', writes.intakeLinked));
    log(row('intake_approved_withheld', writes.intakeWithheld));
  } catch (err: unknown) {
    error(`A write failed: ${describeFailure(err)}. Rows written before it stay (each is correct on its own); re-run to finish.`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Timeline contact-link backfill failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
