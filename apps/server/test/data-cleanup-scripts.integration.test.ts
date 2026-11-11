/**
 * W10-DATA-CLEANUP-SCRIPTS (V1-96) — two operator scripts, against Postgres.
 *
 * 1. SF-1 (W9-CUSTOM-FIELDS-TENANT review): before that packet, the
 *    business-blind name lookup in ContactCustomFieldValueService could bind a
 *    contact of A to a definition of B (contact_custom_field_values has no
 *    businessId). The packet stopped new binds and made the reads skip such
 *    rows, but rows already stored stay in the table.
 *    apps/server/scripts/cleanup-cross-tenant-custom-field-values.ts deletes
 *    every value row whose contact and definition belong to different
 *    businesses:
 *      DELETE FROM contact_custom_field_values v USING contacts c,
 *        custom_field_definitions d WHERE v.contact_id = c.id
 *        AND v.definition_id = d.id AND c.business_id <> d.business_id
 *
 * 2. Owner ruling D-115 (review SEC-W9TO-1, timeline-scope TS-13d): rows the
 *    two text-only writers stored before W9-TEXT-ONLY-CONTACT-WRITERS (KEY
 *    send_invoice: module 'commerce', action 'invoice_sent', entityType
 *    'invoice', title 'Invoice <n> sent to <name>'; MessageIntakeOrchestrator:
 *    module 'communications', action 'message_intake.approved', entityType
 *    'message_intake', detail '<intent> from <sender> — <subject>') keep
 *    contactId null, so the timeline rule (timeline-visibility.ts, D-63)
 *    served them to members who may not open the contact they name.
 *    apps/server/scripts/backfill-timeline-contact-links.ts sets their
 *    contactId from the invoice's / intake's contact in the SAME business; a
 *    row whose source is gone (no such invoice or intake in the row's
 *    business, or its contact belongs to another business) is moved to the
 *    module the table deliberately does not map (WITHHELD_MODULE), which the
 *    rule serves to OWNER and ADMIN only (D-63's unmapped branch; its
 *    original module and category kept under data.d115). An invoice row so
 *    withheld is filed under category COMMERCE, so it still needs revenue
 *    read, as its module 'commerce' required. An approved intake whose sender
 *    is no contact (intake.contactId null) is left as the W9 writer stores it
 *    today (TS-13b).
 *
 * Review repairs (D-115): an invoice row is linked only when its title names
 * the invoice's contact as the writer formats it (SEC-W10DCS-2: updateInvoice
 * re-points a SENT invoice's contact; DCS-T06, business C); a withheld intake
 * row is not served to an ADMIN whose crm access is 'none', as the timeline
 * rule also reads the scope of a withheld row's original module (SEC-W10DCS-1 /
 * CR-W10DCS-1; DCS-T07, a trial-Z seam). An intake of A whose contact is B's
 * (oldInCrossContact) is the intake side's negative control for the tenant
 * binding, as oldInvCrossContact is the invoice side's (SEC-W10DCS-3): it is
 * withheld, never linked to B's contact.
 *
 * Both are dry runs by default (counts only, nothing written), write with
 * --apply, are idempotent, and accept --business=<id> (repeatable) to limit a
 * run to some businesses. Nothing here runs against a real database.
 *
 * HOW THEY ARE DRIVEN: each script's exported main(argv, deps) runs in process
 * over the real @keyflow/db client (DATABASE_URL), its output captured. The
 * global dry runs (no --business) read every business and write nothing; every
 * --apply is limited to this suite's businesses, so a parallel suite's rows
 * (contact-custom-field-names-tenant seeds a cross-bound row of its own) are
 * never touched. TS-13d reads the timeline through the real TimelineController
 * (/events, the day's summary) and FlowController's legacy activity route,
 * with the real AuthGuard, BusinessGuard, ModuleScopeGuard and
 * CrmRateLimitGuard, the production GlobalHttpExceptionFilter and
 * ValidationPipe; the one stand-in is identity attachment (a test middleware
 * reads `x-v96o-user`, loads that seeded user and attaches { id, email, role }
 * as AuthMiddleware does after token verification), and FlowController's
 * other collaborators are stubs the activity route never calls.
 *
 * Tests first: on the packet base (d08eff32) neither script exists, so every
 * case fails by absence (the import of the script).
 *
 * FIXTURES: prefix `v96o_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL through sqlLikePrefix(P) in beforeAll and afterAll
 * (Invoice and Contact are soft-deleted models). No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v96o_';
const HEADER = 'x-v96o-user';

const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  staffOwned: `${P}staffOwned`,   // crm read, crm_view 'owned', revenue read
  staffCrmNone: `${P}staffCrmNone`, // crm none, revenue read
  staffFull: `${P}staffFull`,     // STAFF with crm and revenue read (view-all)
  adminCrmNone: `${P}adminCrmNone`, // C (and A from DCS-T07): ADMIN with explicit crm 'none', revenue read (D-114: explicit scopes bind ADMINs)
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  /** A business with no rows at all: a run limited to it counts nothing. */
  bizNone: `${P}bizNone`,
  /** Review repairs (SEC-W10DCS-2): an invoice re-pointed to another contact after it was sent. */
  bizC: `${P}bizC`,
  cPriv: `${P}cPriv`, // A, PRIVATE, owned by the owner (ADMIN, staffOwned, staffCrmNone may not open it)
  cTeam: `${P}cTeam`, // A, TEAM, owned by the owner
  cB: `${P}cB`,       // B
  cCPriv: `${P}cCPriv`,         // C, PRIVATE, owned by the owner: the contact the invoice was sent to
  cCTeam: `${P}cCTeam`,         // C, TEAM: the invoice's contact now (re-pointed by updateInvoice)
  cCNameless: `${P}cCNameless`, // C, TEAM, no first or last name: the writer titles it 'Customer'
};
const C_PRIV_NAME = 'v96o Private Payee';
const C_TEAM_NAME = 'v96o Current Payer';

const HIDDEN_NAME = 'v96o Hidden Payer';
const HIDDEN_EMAIL = `${P}hidden-payer@test.local`;
const HIDDEN_SUBJECT = 'v96o confidential renovation';

/** Invoices: A's two, B's one, and A's invoice whose contact is B's (data corruption, never linked). */
const INV = {
  priv: `${P}invPriv`,
  team: `${P}invTeam`,
  b: `${P}invB`,
  crossContact: `${P}invCrossContact`,
  gone: `${P}invGone`, // no row
  repointed: `${P}invRepointed`, // C: sent to cCPriv, now cCTeam's
  nameless: `${P}invNameless`,   // C: cCNameless's
};
/** Message intakes: A's (PRIVATE contact, TEAM contact, no contact), B's, one that is gone, and A's intake whose contact is B's. */
const INTAKE = {
  priv: `${P}inPriv`,
  team: `${P}inTeam`,
  none: `${P}inNone`,
  b: `${P}inB`,
  gone: `${P}inGone`, // no row
  crossContact: `${P}inCrossContact`, // A's intake naming B's contact (data corruption, never linked; review SEC-W10DCS-3)
};

/** The day the timeline rows sit on (local noon two days back: the summary reads local days). */
const DAY = new Date();
DAY.setHours(12, 0, 0, 0);
DAY.setTime(DAY.getTime() - 2 * 86_400_000);
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_PARAM = `${DAY.getFullYear()}-${pad(DAY.getMonth() + 1)}-${pad(DAY.getDate())}T12:00:00`;
const LEGACY_CURSOR = `cursor=${new Date(DAY.getTime() + 86_400_000).toISOString()}`;

const act = (key: string) => `${P}act_${key}`;

/**
 * The timeline rows. `old*` rows have the shape the two writers stored before
 * W9-TEXT-ONLY-CONTACT-WRITERS (contactId null); `ctl*` rows are controls the
 * backfill must leave exactly as they are.
 */
type Row = {
  key: string;
  businessId: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  title: string;
  detail?: string;
  category?: string;
  contactId?: string;
  data?: Record<string, unknown>;
};
const invoiceRow = (key: string, businessId: string, entityId: string | null, number: string, name: string): Row => ({
  key,
  businessId,
  module: 'commerce',
  action: 'invoice_sent',
  entityType: 'invoice',
  entityId,
  title: `Invoice ${number} sent to ${name}`,
});
const intakeRow = (key: string, businessId: string, entityId: string | null, from: string, subject: string): Row => ({
  key,
  businessId,
  module: 'communications',
  action: 'message_intake.approved',
  entityType: 'message_intake',
  entityId,
  title: 'Message intake approved',
  detail: `quote request from ${from} — ${subject}`,
  category: 'AI',
  data: { intentType: 'quote_request', results: [] },
});
const ROWS: Row[] = [
  // linked to their source's contact
  invoiceRow('oldInvPriv', ID.bizA, INV.priv, 'v96o-INV-1', HIDDEN_NAME),
  invoiceRow('oldInvTeam', ID.bizA, INV.team, 'v96o-INV-2', 'v96o Team Payer'),
  intakeRow('oldInPriv', ID.bizA, INTAKE.priv, HIDDEN_EMAIL, HIDDEN_SUBJECT),
  intakeRow('oldInTeam', ID.bizA, INTAKE.team, `${P}team-payer@test.local`, 'v96o team question'),
  // source gone: withheld (OWNER and ADMIN only)
  invoiceRow('oldInvGone', ID.bizA, INV.gone, 'v96o-INV-9', 'v96o Gone Payer'),
  invoiceRow('oldInvNoEntity', ID.bizA, null, 'v96o-INV-8', 'v96o Nameless Payer'),
  invoiceRow('oldInvOtherBiz', ID.bizA, INV.b, 'v96o-INV-B1', 'v96o B Payer'),
  invoiceRow('oldInvCrossContact', ID.bizA, INV.crossContact, 'v96o-INV-3', 'v96o B Payer'),
  intakeRow('oldInGone', ID.bizA, INTAKE.gone, `${P}gone-sender@test.local`, 'v96o gone subject'),
  intakeRow('oldInOtherBiz', ID.bizA, INTAKE.b, `${P}b-sender@test.local`, 'v96o B subject'),
  intakeRow('oldInCrossContact', ID.bizA, INTAKE.crossContact, `${P}cross-sender@test.local`, 'v96o cross subject'),
  // left as the W9 writer stores it: the intake names no contact
  intakeRow('oldInNone', ID.bizA, INTAKE.none, `${P}stranger@test.local`, 'v96o general question'),
  // B's own pre-W9 row, linked only by a run that includes B
  invoiceRow('oldBInv', ID.bizB, INV.b, 'v96o-INV-B1', 'v96o B Payer'),
  // controls
  { ...invoiceRow('ctlW9Inv', ID.bizA, INV.team, 'v96o-INV-2', 'v96o Team Payer'), contactId: ID.cTeam },
  { ...intakeRow('ctlW9In', ID.bizA, INTAKE.team, `${P}team-payer@test.local`, 'v96o team question'), contactId: ID.cTeam },
  { key: 'ctlInvPaid', businessId: ID.bizA, module: 'commerce', action: 'invoice_paid', entityType: 'invoice', entityId: INV.gone, title: 'Invoice v96o-INV-9 paid' },
  { key: 'ctlCrm', businessId: ID.bizA, module: 'crm', action: 'note_added', entityType: 'v96o_entity', entityId: null, title: 'v96o crm note' },
  // C (review SEC-W10DCS-2): the title names the contact the invoice had when it was sent
  invoiceRow('oldCInvRepointed', ID.bizC, INV.repointed, 'v96o-INV-C1', C_PRIV_NAME),
  invoiceRow('oldCInvCurrent', ID.bizC, INV.repointed, 'v96o-INV-C1', C_TEAM_NAME),
  invoiceRow('oldCInvCustomer', ID.bizC, INV.nameless, 'v96o-INV-C2', 'Customer'),
];
const LINKED: Record<string, string> = {
  oldInvPriv: ID.cPriv,
  oldInvTeam: ID.cTeam,
  oldInPriv: ID.cPriv,
  oldInTeam: ID.cTeam,
};
const WITHHELD = ['oldInvGone', 'oldInvNoEntity', 'oldInvOtherBiz', 'oldInvCrossContact', 'oldInGone', 'oldInOtherBiz', 'oldInCrossContact'];
const UNTOUCHED = ['oldInNone', 'ctlW9Inv', 'ctlW9In', 'ctlInvPaid', 'ctlCrm'];
const A_ROW_IDS = ROWS.filter((r) => r.businessId === ID.bizA).map((r) => act(r.key));
const C_ROW_IDS = ROWS.filter((r) => r.businessId === ID.bizC).map((r) => act(r.key));

/** Custom-field definitions and values. A and B both define `tier` (names are unique per business only). */
const DEF = {
  aTier: `${P}defATier`,
  bTier: `${P}defBTier`,
  bSecret: `${P}defBSecret`,
};
const VAL = {
  // cross-bound: contact and definition of different businesses
  crossPrivB: `${P}valCrossPrivB`,   // A's cPriv -> B's tier
  crossTeamB: `${P}valCrossTeamB`,   // A's cTeam -> B's secret
  crossBA: `${P}valCrossBA`,         // B's cB -> A's tier
  // same-business controls
  ctlA: `${P}valCtlA`,               // A's cPriv -> A's tier
  ctlB: `${P}valCtlB`,               // B's cB -> B's tier
};
const CROSS_VALUES = [VAL.crossPrivB, VAL.crossTeamB, VAL.crossBA];
const CONTROL_VALUES = [VAL.ctlA, VAL.ctlB];

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_custom_field_values WHERE id LIKE ${sqlLikePrefix(P)} OR contact_id LIKE ${sqlLikePrefix(P)} OR definition_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM custom_field_definitions WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM message_intakes WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Runs a script's main(argv) in process; its exit status and everything it printed. */
async function run(script: 'custom-fields' | 'timeline', argv: string[]): Promise<{ code: number; out: string }> {
  const mod =
    script === 'custom-fields'
      ? await import('../scripts/cleanup-cross-tenant-custom-field-values')
      : await import('../scripts/backfill-timeline-contact-links');
  const lines: string[] = [];
  const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  const code = await mod.main(argv, { db, log, error: log });
  return { code, out: lines.join('\n') };
}

/** The number a count line `  <label>   <n>` reports. */
function countOf(out: string, label: string): number {
  const m = out.match(new RegExp(`^\\s*${label}\\s+(\\d+)\\s*$`, 'm'));
  expect(m, `${label} in:\n${out}`).toBeTruthy();
  return Number(m![1]);
}

/** Every fixture timeline row, as stored, keyed by id (the columns the rule reads). */
async function timelineState(): Promise<Record<string, unknown>> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, module, category, contact_id, entity_type, entity_id, title, detail, data FROM activities
      WHERE id LIKE ${sqlLikePrefix(P)} ORDER BY id`,
  );
  return Object.fromEntries(rows.map((r: { id: string }) => [r.id, r]));
}

async function valueIds(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe(`SELECT id FROM contact_custom_field_values WHERE id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
  return rows.map((r: { id: string }) => r.id);
}

const SCOPE = [`--business=${ID.bizA}`, `--business=${ID.bizB}`];

const agent = () => request(app.getHttpServer());
async function ids(res: request.Response | Promise<request.Response>): Promise<string[]> {
  const r = await res;
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
  expect(Array.isArray(r.body)).toBe(true);
  return r.body.map((row: { id: string }) => row.id);
}
/** The fixture rows a member is served on /events, the day's summary and the legacy route, and the text of the three answers. */
async function served(user: string, biz: string = ID.bizA): Promise<{ events: string[]; summary: string[]; legacy: string[]; text: string }> {
  const rowIds = biz === ID.bizC ? C_ROW_IDS : A_ROW_IDS;
  const ev = await agent().get(`/timeline/businesses/${biz}/events?limit=200`).set(HEADER, user);
  const day = await agent().get(`/timeline/businesses/${biz}/summary/${DAY_PARAM}`).set(HEADER, user);
  expect(day.status, `${user}: ${JSON.stringify(day.body).slice(0, 300)}`).toBe(200);
  const leg = await agent().get(`/api/flows/businesses/${biz}/activity?limit=200&${LEGACY_CURSOR}`).set(HEADER, user);
  const pick = (list: string[]) => list.filter((id) => rowIds.includes(id)).sort();
  return {
    events: pick(await ids(ev)),
    summary: pick(day.body.events.map((e: { id: string }) => e.id)),
    legacy: pick(await ids(leg)),
    text: JSON.stringify([ev.body, day.body, leg.body]),
  };
}
const READS = ['events', 'summary', 'legacy'] as const;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
  const { FlowController } = await import('../src/modules/flow/flow.controller');
  const { FlowService } = await import('../src/modules/flow/flow.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrossModuleAgentService } = await import('../src/modules/flow/cross-module-agent.service');
  const { FlowEngineService } = await import('../src/modules/flow/flow-engine.service');
  const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
  const { FlowTemplateService } = await import('../src/modules/flow/flow-template.service');

  // What tsc emits (the test transform emits no design:paramtypes), as timeline-scope does.
  if (!Reflect.getMetadata('design:paramtypes', TimelineController)) {
    Reflect.defineMetadata('design:paramtypes', [TimelineService], TimelineController);
  }
  if (!Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')) {
    Reflect.defineMetadata('design:paramtypes', [String, QueryTimelineDto], TimelineController.prototype, 'queryEvents');
  }
  Reflect.defineMetadata('design:paramtypes', [
    FlowService, ActivityService, CrossModuleAgentService, PrismaService,
    FlowEngineService, FlowRunnerService, FlowTemplateService,
  ], FlowController);

  const moduleRef = await Test.createTestingModule({
    controllers: [TimelineController, FlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TimelineService,
      ActivityService,
      // FlowController collaborators the activity route never calls.
      { provide: FlowService, useValue: {} },
      { provide: CrossModuleAgentService, useValue: {} },
      { provide: FlowEngineService, useValue: {} },
      { provide: FlowRunnerService, useValue: {} },
      { provide: FlowTemplateService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.admin, ID.staffOwned, ID.staffCrmNone, ID.staffFull, ID.adminCrmNone, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}u_${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V96O Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V96O Biz B', ownerId: ID.ownerB } });
  await db.business.create({ data: { id: ID.bizNone, name: 'V96O Biz None', ownerId: ID.ownerB } });
  await db.business.create({ data: { id: ID.bizC, name: 'V96O Biz C', ownerId: ID.owner } });

  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned', revenue: 'read' });
  await m(ID.staffCrmNone, ID.bizA, 'STAFF', { crm: 'none', revenue: 'read' });
  await m(ID.staffFull, ID.bizA, 'STAFF', { crm: 'read', revenue: 'read' });
  await m(ID.ownerB, ID.bizB, 'OWNER');
  await m(ID.ownerB, ID.bizNone, 'OWNER');
  await m(ID.owner, ID.bizC, 'OWNER');
  await m(ID.staffFull, ID.bizC, 'STAFF', { crm: 'read', revenue: 'read' });
  await m(ID.adminCrmNone, ID.bizC, 'ADMIN', { crm: 'none', revenue: 'read', ai: 'read' });

  await db.contact.create({ data: { id: ID.cPriv, businessId: ID.bizA, firstName: 'v96o', lastName: 'Hidden Payer', email: HIDDEN_EMAIL, visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cTeam, businessId: ID.bizA, firstName: 'v96o', lastName: 'Team Payer', email: `${P}team-payer@test.local`, visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cB, businessId: ID.bizB, firstName: 'v96o', lastName: 'B Payer', email: `${P}b-payer@test.local`, ownerId: ID.ownerB } });
  await db.contact.create({ data: { id: ID.cCPriv, businessId: ID.bizC, firstName: 'v96o', lastName: 'Private Payee', email: `${P}c-private@test.local`, visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cCTeam, businessId: ID.bizC, firstName: 'v96o', lastName: 'Current Payer', email: `${P}c-current@test.local`, visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cCNameless, businessId: ID.bizC, email: `${P}c-nameless@test.local`, visibility: 'TEAM', ownerId: ID.owner } });

  await db.invoice.createMany({
    data: [
      { id: INV.priv, invoiceNumber: 'v96o-INV-1', status: 'SENT', subtotal: 90, total: 90, currency: 'TTD', businessId: ID.bizA, contactId: ID.cPriv },
      { id: INV.team, invoiceNumber: 'v96o-INV-2', status: 'SENT', subtotal: 60, total: 60, currency: 'TTD', businessId: ID.bizA, contactId: ID.cTeam },
      { id: INV.b, invoiceNumber: 'v96o-INV-B1', status: 'SENT', subtotal: 30, total: 30, currency: 'TTD', businessId: ID.bizB, contactId: ID.cB },
      // A's invoice naming B's contact: never a contact of A, so never linked.
      { id: INV.crossContact, invoiceNumber: 'v96o-INV-3', status: 'SENT', subtotal: 10, total: 10, currency: 'TTD', businessId: ID.bizA, contactId: ID.cB },
      // C: sent to the PRIVATE contact, re-pointed below (updateInvoice re-points a SENT invoice's contactId).
      { id: INV.repointed, invoiceNumber: 'v96o-INV-C1', status: 'SENT', subtotal: 40, total: 40, currency: 'TTD', businessId: ID.bizC, contactId: ID.cCPriv },
      { id: INV.nameless, invoiceNumber: 'v96o-INV-C2', status: 'SENT', subtotal: 20, total: 20, currency: 'TTD', businessId: ID.bizC, contactId: ID.cCNameless },
    ],
  });
  await db.invoice.update({ where: { id: INV.repointed }, data: { contactId: ID.cCTeam } });
  const intake = (id: string, businessId: string, contactId: string | null) =>
    db.messageIntake.create({
      data: { id, businessId, connectorType: 'gmail', sourceChannel: 'email', from: `${id}@test.local`, subject: 'v96o', body: 'v96o', contactId, status: 'approved' },
    });
  await intake(INTAKE.priv, ID.bizA, ID.cPriv);
  await intake(INTAKE.team, ID.bizA, ID.cTeam);
  await intake(INTAKE.none, ID.bizA, null);
  await intake(INTAKE.b, ID.bizB, ID.cB);
  // A's intake whose contact is B's: never a contact of A, so never linked (review SEC-W10DCS-3).
  await intake(INTAKE.crossContact, ID.bizA, ID.cB);

  await db.activity.createMany({
    data: ROWS.map((r, i) => ({
      id: act(r.key),
      businessId: r.businessId,
      module: r.module,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      detail: r.detail ?? null,
      category: r.category ?? null,
      contactId: r.contactId ?? null,
      data: r.data ?? undefined,
      tone: 'success',
      occurredAt: new Date(DAY.getTime() - i * 1000),
      createdAt: new Date(DAY.getTime() - i * 1000),
    })),
  });

  await db.customFieldDefinition.create({ data: { id: DEF.bTier, businessId: ID.bizB, name: `${P}tier`, label: 'v96o B tier', type: 'TEXT' } });
  await db.customFieldDefinition.create({ data: { id: DEF.bSecret, businessId: ID.bizB, name: `${P}secret`, label: 'v96o B secret', type: 'TEXT' } });
  await db.customFieldDefinition.create({ data: { id: DEF.aTier, businessId: ID.bizA, name: `${P}tier`, label: 'v96o A tier', type: 'TEXT' } });
  await db.contactCustomFieldValue.createMany({
    data: [
      { id: VAL.crossPrivB, contactId: ID.cPriv, definitionId: DEF.bTier, value: 'b-gold' },
      { id: VAL.crossTeamB, contactId: ID.cTeam, definitionId: DEF.bSecret, value: 'b-secret' },
      { id: VAL.crossBA, contactId: ID.cB, definitionId: DEF.aTier, value: 'a-gold' },
      { id: VAL.ctlA, contactId: ID.cPriv, definitionId: DEF.aTier, value: 'a-silver' },
      { id: VAL.ctlB, contactId: ID.cB, definitionId: DEF.bTier, value: 'b-silver' },
    ],
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('W10-DATA-CLEANUP-SCRIPTS (SF-1): cross-tenant custom-field values', () => {
  it('[DCS-C01] the dry run (the default) reports the cross-bound value rows as counts only and deletes nothing: limited to A and B it counts exactly the three fixture rows, the global run counts at least those, and a run limited to a business with no rows counts none', async () => {
    const before = await valueIds();
    expect(before).toEqual([...CROSS_VALUES, ...CONTROL_VALUES].sort());

    const scoped = await run('custom-fields', SCOPE);
    expect(scoped.code, scoped.out).toBe(0);
    expect(scoped.out).toMatch(/DRY RUN/);
    expect(countOf(scoped.out, 'cross_bound_values')).toBe(3);
    expect(countOf(scoped.out, 'contacts_affected')).toBe(3);
    expect(countOf(scoped.out, 'businesses_affected')).toBe(2);
    expect(scoped.out).not.toMatch(/^\s*deleted\s/m);
    // Counts only: no id, name or value is printed.
    expect(scoped.out).not.toContain(P);
    expect(scoped.out).not.toContain('b-gold');

    const global = await run('custom-fields', []);
    expect(global.code, global.out).toBe(0);
    expect(countOf(global.out, 'cross_bound_values')).toBeGreaterThanOrEqual(3);
    expect(global.out).not.toContain(P);

    const none = await run('custom-fields', [`--business=${ID.bizNone}`]);
    expect(none.code, none.out).toBe(0);
    expect(countOf(none.out, 'cross_bound_values')).toBe(0);

    expect(await valueIds(), 'a dry run deletes nothing').toEqual(before);
  });

  it('[DCS-C02] --apply deletes exactly the value rows whose contact and definition belong to different businesses; the same-business values of A and B are untouched', async () => {
    const res = await run('custom-fields', ['--apply', ...SCOPE]);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/APPLY/);
    expect(countOf(res.out, 'cross_bound_values')).toBe(3);
    expect(countOf(res.out, 'deleted')).toBe(3);
    expect(res.out).not.toContain(P);

    expect(await valueIds()).toEqual([...CONTROL_VALUES].sort());
    const controls = await db.$queryRawUnsafe(
      `SELECT id, contact_id, definition_id, value FROM contact_custom_field_values WHERE id = ANY($1::text[]) ORDER BY id`,
      CONTROL_VALUES,
    );
    expect(controls).toEqual([
      { id: VAL.ctlA, contact_id: ID.cPriv, definition_id: DEF.aTier, value: 'a-silver' },
      { id: VAL.ctlB, contact_id: ID.cB, definition_id: DEF.bTier, value: 'b-silver' },
    ]);
    // The definitions and contacts themselves stay.
    const defs = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM custom_field_definitions WHERE id = ANY($1::text[])`, Object.values(DEF));
    expect(defs[0].n).toBe(3);
  });

  it('[DCS-C03] --apply is idempotent: a second run finds and deletes nothing, and the controls stay', async () => {
    const res = await run('custom-fields', ['--apply', ...SCOPE]);
    expect(res.code, res.out).toBe(0);
    expect(countOf(res.out, 'cross_bound_values')).toBe(0);
    expect(countOf(res.out, 'deleted')).toBe(0);
    expect(await valueIds()).toEqual([...CONTROL_VALUES].sort());
  });

  it('[DCS-C04] an unknown argument or an empty --business stops the script with exit 2 before it reads or writes anything', async () => {
    for (const argv of [['--aply'], ['--business='], ['--apply', '--everything']]) {
      const res = await run('custom-fields', argv);
      expect(res.code, `${argv.join(' ')}: ${res.out}`).toBe(2);
    }
  });
});

describe('W10-DATA-CLEANUP-SCRIPTS (D-115, SEC-W9TO-1): pre-W9 timeline rows that name a contact only in their text', () => {
  it('[DCS-T01] before the backfill a view-all ADMIN is served the pre-W9 invoice_sent and message_intake.approved rows naming the PRIVATE contact (SEC-W9TO-1); the dry run (the default) reports counts only and writes nothing, globally and limited to A and B', async () => {
    const before = await timelineState();
    expect(Object.keys(before)).toHaveLength(ROWS.length);

    const res = await run('timeline', SCOPE);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/DRY RUN/);
    expect(countOf(res.out, 'invoice_sent_unlinked')).toBe(7);
    expect(countOf(res.out, 'invoice_sent_would_link')).toBe(3);
    expect(countOf(res.out, 'invoice_sent_would_withhold')).toBe(4);
    expect(countOf(res.out, 'intake_approved_unlinked')).toBe(6);
    expect(countOf(res.out, 'intake_approved_would_link')).toBe(2);
    expect(countOf(res.out, 'intake_approved_no_contact')).toBe(1);
    expect(countOf(res.out, 'intake_approved_would_withhold')).toBe(3); // incl. oldInCrossContact (review SEC-W10DCS-3)
    expect(res.out).not.toContain(P);
    expect(res.out).not.toContain(HIDDEN_NAME);

    const global = await run('timeline', []);
    expect(global.code, global.out).toBe(0);
    expect(countOf(global.out, 'invoice_sent_unlinked')).toBeGreaterThanOrEqual(7);
    expect(countOf(global.out, 'intake_approved_unlinked')).toBeGreaterThanOrEqual(6);
    expect(global.out).not.toContain(P);

    expect(await timelineState(), 'a dry run writes nothing').toEqual(before);

    // The defect the backfill closes, on this data (unchanged by a dry run).
    const admin = await served(ID.admin);
    expect(admin.events).toEqual(expect.arrayContaining([act('oldInvPriv'), act('oldInPriv')]));
    expect(admin.text).toContain(HIDDEN_NAME);
  });

  it('[DCS-T02] --apply limited to A links the four rows to their source contact in A, withholds the seven whose source is gone (another business, an invoice or intake whose contact is of another business (review SEC-W10DCS-3), no row, no entity id), leaves the approved intake without a contact and every control exactly as stored, and does not touch B', async () => {
    const before = await timelineState();
    const res = await run('timeline', ['--apply', `--business=${ID.bizA}`]);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toMatch(/APPLY/);
    expect(countOf(res.out, 'invoice_sent_linked')).toBe(2);
    expect(countOf(res.out, 'invoice_sent_withheld')).toBe(4);
    expect(countOf(res.out, 'intake_approved_linked')).toBe(2);
    expect(countOf(res.out, 'intake_approved_withheld')).toBe(3); // incl. oldInCrossContact (review SEC-W10DCS-3)
    expect(countOf(res.out, 'intake_approved_no_contact')).toBe(1);
    expect(res.out).not.toContain(P);

    const { WITHHELD_MODULE } = await import('../scripts/backfill-timeline-contact-links');
    const after: Record<string, any> = await timelineState();
    for (const [key, contactId] of Object.entries(LINKED)) {
      const was = before[act(key)] as Record<string, unknown>;
      expect(after[act(key)], key).toEqual({ ...was, contact_id: contactId });
    }
    for (const key of WITHHELD) {
      const was = before[act(key)] as Record<string, any>;
      const row = after[act(key)];
      expect(row.module, key).toBe(WITHHELD_MODULE);
      expect(row.contact_id, key).toBeNull();
      // An invoice row keeps needing revenue read (category COMMERCE, as its module 'commerce' required).
      expect(row.category, key).toBe(was.module === 'commerce' ? 'COMMERCE' : was.category);
      expect(row.data.d115, key).toEqual({ withheld: 'source_gone', module: was.module, category: was.category });
      // The row's own data, title and detail are kept.
      const { d115: _marker, ...rest } = row.data;
      expect(rest, key).toEqual(was.data ?? {});
      expect([row.title, row.detail, row.entity_type, row.entity_id], key).toEqual([was.title, was.detail, was.entity_type, was.entity_id]);
    }
    for (const key of UNTOUCHED) expect(after[act(key)], key).toEqual(before[act(key)]);
    expect(after[act('oldBInv')], "B's row (outside the run)").toEqual(before[act('oldBInv')]);
  });

  it('[DCS-T03] --apply is idempotent: a run over A and B links only B\'s own row from B\'s invoice, a further run changes nothing, and the dry run then counts nothing left to do', async () => {
    const first = await run('timeline', ['--apply', ...SCOPE]);
    expect(first.code, first.out).toBe(0);
    expect(countOf(first.out, 'invoice_sent_linked')).toBe(1);
    expect(countOf(first.out, 'invoice_sent_withheld')).toBe(0);
    expect(countOf(first.out, 'intake_approved_linked')).toBe(0);
    expect(countOf(first.out, 'intake_approved_withheld')).toBe(0);
    expect((await timelineState())[act('oldBInv')]).toMatchObject({ contact_id: ID.cB, module: 'commerce' });

    const settled = await timelineState();
    const again = await run('timeline', ['--apply', ...SCOPE]);
    expect(again.code, again.out).toBe(0);
    for (const label of ['invoice_sent_linked', 'invoice_sent_withheld', 'intake_approved_linked', 'intake_approved_withheld']) {
      expect(countOf(again.out, label), label).toBe(0);
    }
    expect(await timelineState()).toEqual(settled);

    const dry = await run('timeline', SCOPE);
    expect(countOf(dry.out, 'invoice_sent_unlinked')).toBe(0);
    expect(countOf(dry.out, 'intake_approved_unlinked')).toBe(1); // the intake with no contact, left as is
    expect(countOf(dry.out, 'intake_approved_no_contact')).toBe(1);
    expect(countOf(dry.out, 'intake_approved_would_withhold')).toBe(0);
  });

  it("TS-13d (review SEC-W9TO-1, D-63) (W10-DATA-CLEANUP-SCRIPTS, D-115, was it.todo): after the backfill, the pre-W9 KEY invoice_sent row and message_intake.approved row naming the owner's PRIVATE contact are no longer served on /events, the day's summary or the legacy route to a view-all ADMIN, a crm_view 'owned' and a crm 'none' revenue reader (nor its name, sender or subject), as TS-13a/b serve the rows the writers store today; the TEAM contact's rows are served to ADMIN; a row whose source is gone is served to OWNER and ADMIN only, not to a STAFF member reading crm and revenue; OWNER is served every row", async () => {
    // The backfill is idempotent, so this case runs it itself and stands alone.
    const res = await run('timeline', ['--apply', ...SCOPE]);
    expect(res.code, res.out).toBe(0);

    const priv = [act('oldInvPriv'), act('oldInPriv')];
    const team = [act('oldInvTeam'), act('oldInTeam')];
    const withheld = WITHHELD.map(act);

    const owner = await served(ID.owner);
    for (const key of READS) expect(owner[key], `owner ${key}`).toEqual([...A_ROW_IDS].sort());

    const admin = await served(ID.admin);
    for (const key of READS) {
      for (const id of priv) expect(admin[key], `admin ${key}`).not.toContain(id);
      expect(admin[key], `admin ${key}`).toEqual(expect.arrayContaining([...team, ...withheld, act('oldInNone')]));
    }
    expect(admin.text).not.toContain(HIDDEN_NAME);
    expect(admin.text).not.toContain(HIDDEN_EMAIL);
    expect(admin.text).not.toContain(HIDDEN_SUBJECT);

    const owned = await served(ID.staffOwned);
    const crmNone = await served(ID.staffCrmNone);
    const full = await served(ID.staffFull);
    for (const key of READS) {
      for (const id of [...priv, ...team, ...withheld]) {
        expect(owned[key], `staffOwned ${key}`).not.toContain(id);
        expect(crmNone[key], `staffCrmNone ${key}`).not.toContain(id);
      }
      // A view-all STAFF member reading crm and revenue: the TEAM rows, never a withheld one (D-115).
      expect(full[key], `staffFull ${key}`).toEqual(expect.arrayContaining(team));
      for (const id of [...priv, ...withheld]) expect(full[key], `staffFull ${key}`).not.toContain(id);
    }
    for (const seen of [owned, crmNone, full]) {
      expect(seen.text).not.toContain(HIDDEN_NAME);
      expect(seen.text).not.toContain(HIDDEN_SUBJECT);
    }

    // The rows now belong to the PRIVATE contact's history: OWNER gets them on ?contactId=, ADMIN 200 [].
    const history = await ids(agent().get(`/timeline/businesses/${ID.bizA}/events?limit=50&contactId=${ID.cPriv}`).set(HEADER, ID.owner));
    expect(history.filter((id) => A_ROW_IDS.includes(id)).sort()).toEqual(priv.sort());
    expect(await ids(agent().get(`/timeline/businesses/${ID.bizA}/events?limit=50&contactId=${ID.cPriv}`).set(HEADER, ID.admin))).toEqual([]);
  });

  it('[DCS-T05] the withheld marker is a module the timeline table does not map (D-63: OWNER and ADMIN only), so a withheld row is never served by a module grant; an invoice row withheld keeps needing revenue read', async () => {
    const { WITHHELD_MODULE } = await import('../scripts/backfill-timeline-contact-links');
    const { activityModuleScope, canReadActivityRow } = await import('../src/modules/timeline/timeline-visibility');
    expect(activityModuleScope(WITHHELD_MODULE)).toBeNull();
    const everyModule = new Set(['crm', 'revenue', 'bookings', 'operations', 'expenses', 'projects', 'automations', 'content', 'storefront', 'analytics', 'settings', 'ai', 'connect', 'team'] as any);
    const crmAccess = { isOwner: false, isSuperAdmin: false, viewAll: true, editScope: 'any', reassign: false, deleteScope: 'none', level: 'read' } as any;
    const viewer = (readsUnmapped: boolean, readable: Set<any>) => ({ businessId: ID.bizA, userId: ID.admin, readsUnmapped, readable, crmAccess });
    const row = { module: WITHHELD_MODULE, category: 'COMMERCE', contactId: null, entityType: 'invoice', entityId: INV.gone };
    expect(canReadActivityRow(viewer(false, everyModule), row), 'a STAFF member reading every module').toBe(false);
    expect(canReadActivityRow(viewer(true, everyModule), row), 'OWNER / ADMIN').toBe(true);
    const noRevenue = new Set([...everyModule].filter((m) => m !== 'revenue'));
    expect(canReadActivityRow(viewer(true, noRevenue), row), "an ADMIN whose revenue access is 'none'").toBe(false);
  });

  it("[DCS-T06] (review SEC-W10DCS-2, D-115) a row is linked to its invoice's contact only when its title names that contact (the writer's 'first last', or 'Customer'): a row naming the PRIVATE contact the invoice was sent to before updateInvoice re-pointed it is withheld (data.d115 withheld 'name_mismatch'), not linked to the invoice's TEAM contact, so a view-all STAFF member reading crm and revenue is no longer served it or the PRIVATE name; an ADMIN with explicit crm 'none' is served no row it was not served before; a further dry run counts nothing left", async () => {
    const before = await timelineState();
    const repointed = act('oldCInvRepointed');

    // The defect on this data: the row naming the PRIVATE contact is served to the view-all STAFF member.
    const fullBefore = await served(ID.staffFull, ID.bizC);
    expect(fullBefore.events).toContain(repointed);
    expect(fullBefore.text).toContain(C_PRIV_NAME);
    const adminBefore = await served(ID.adminCrmNone, ID.bizC);

    const dry = await run('timeline', [`--business=${ID.bizC}`]);
    expect(dry.code, dry.out).toBe(0);
    expect(countOf(dry.out, 'invoice_sent_unlinked')).toBe(3);
    expect(countOf(dry.out, 'invoice_sent_name_mismatch')).toBe(1);
    expect(countOf(dry.out, 'invoice_sent_would_link')).toBe(2);
    expect(countOf(dry.out, 'invoice_sent_would_withhold')).toBe(1);
    expect(dry.out).not.toContain(P);
    expect(dry.out).not.toContain(C_PRIV_NAME);
    expect(await timelineState(), 'a dry run writes nothing').toEqual(before);

    const res = await run('timeline', ['--apply', `--business=${ID.bizC}`]);
    expect(res.code, res.out).toBe(0);
    expect(countOf(res.out, 'invoice_sent_linked')).toBe(2);
    expect(countOf(res.out, 'invoice_sent_withheld')).toBe(1);
    expect(res.out).not.toContain(P);

    const { WITHHELD_MODULE } = await import('../scripts/backfill-timeline-contact-links');
    const after: Record<string, any> = await timelineState();
    expect(after[act('oldCInvCurrent')]).toEqual({ ...(before[act('oldCInvCurrent')] as object), contact_id: ID.cCTeam });
    expect(after[act('oldCInvCustomer')]).toEqual({ ...(before[act('oldCInvCustomer')] as object), contact_id: ID.cCNameless });
    const was = before[repointed] as Record<string, any>;
    expect(after[repointed]).toEqual({
      ...was,
      module: WITHHELD_MODULE,
      category: 'COMMERCE',
      data: { d115: { withheld: 'name_mismatch', module: 'commerce', category: null } },
    });

    const owner = await served(ID.owner, ID.bizC);
    for (const key of READS) expect(owner[key], `owner ${key}`).toEqual([...C_ROW_IDS].sort());
    const full = await served(ID.staffFull, ID.bizC);
    for (const key of READS) {
      expect(full[key], `staffFull ${key}`).toEqual([act('oldCInvCurrent'), act('oldCInvCustomer')].sort());
    }
    expect(full.text).not.toContain(C_PRIV_NAME);
    // No widening for the ADMIN whose crm access is 'none' (D-114's principle): every row served after was served before.
    const adminAfter = await served(ID.adminCrmNone, ID.bizC);
    for (const key of READS) {
      for (const id of adminAfter[key]) expect(adminBefore[key], `adminCrmNone ${key}`).toContain(id);
    }

    const settled = await run('timeline', [`--business=${ID.bizC}`]);
    for (const label of ['invoice_sent_unlinked', 'invoice_sent_name_mismatch', 'invoice_sent_would_link', 'invoice_sent_would_withhold']) {
      expect(countOf(settled.out, label), label).toBe(0);
    }
  });

  it("[DCS-T07] (review SEC-W10DCS-1 / CR-W10DCS-1, D-115 with D-114's principle) (trial-Z seam, was it.todo) an ADMIN whose crm access is explicitly 'none' is not served a withheld message_intake.approved row (nor its sender or subject), as it was not served the row before the backfill: a row of module d115_withheld also needs read on the scope of its data.d115.module; the withheld invoice rows (module 'commerce', revenue) are still served to that ADMIN, who reads revenue, and a STAFF member is served no withheld row", async () => {
    const { WITHHELD_MODULE } = await import('../scripts/backfill-timeline-contact-links');
    const { canReadActivityRow, D115_WITHHELD_MODULE } = await import('../src/modules/timeline/timeline-visibility');
    expect(D115_WITHHELD_MODULE, 'the rule and the script name the same marker').toBe(WITHHELD_MODULE);
    const crmAccess = { isOwner: false, isSuperAdmin: false, viewAll: true, editScope: 'any', reassign: false, deleteScope: 'none', level: 'read' } as any;
    const adminCrmNone = { businessId: ID.bizA, userId: ID.adminCrmNone, readsUnmapped: true, readable: new Set(['revenue', 'ai'] as any), crmAccess };
    const staffEvery = { ...adminCrmNone, readsUnmapped: false, readable: new Set(['crm', 'revenue', 'ai'] as any) };
    const intake = { module: 'communications', category: 'AI', contactId: null, entityType: 'message_intake', entityId: INTAKE.gone, data: { intentType: 'quote_request', results: [] } };
    const withheldIntake = { ...intake, module: WITHHELD_MODULE, data: { ...intake.data, d115: { withheld: 'source_gone', module: 'communications', category: 'AI' } } };
    expect(canReadActivityRow(adminCrmNone, intake), 'before the backfill: a communications row is read on crm (D-63 (iii))').toBe(false);
    expect(canReadActivityRow(adminCrmNone, withheldIntake), 'after the backfill: the same row, withheld').toBe(false);
    expect(canReadActivityRow(staffEvery, withheldIntake), 'a STAFF member reading crm').toBe(false);
    expect(canReadActivityRow({ ...adminCrmNone, readable: new Set(['crm', 'revenue', 'ai'] as any) }, withheldIntake), 'an ADMIN reading crm').toBe(true);

    // Over the real routes: the same ADMIN shape as C's, given a membership of A (whose rows DCS-T02 backfilled).
    await db.membership.create({
      data: { id: `${P}m_adminCrmNone_bizA`, userId: ID.adminCrmNone, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { crm: 'none', revenue: 'read', ai: 'read' } },
    });
    const withheldIntakes = ['oldInGone', 'oldInOtherBiz', 'oldInCrossContact'].map(act);
    const withheldInvoices = ['oldInvGone', 'oldInvNoEntity', 'oldInvOtherBiz', 'oldInvCrossContact'].map(act);
    const seen = await served(ID.adminCrmNone, ID.bizA);
    for (const key of READS) {
      for (const id of withheldIntakes) expect(seen[key], `adminCrmNone ${key}`).not.toContain(id);
      expect(seen[key], `adminCrmNone ${key}`).toEqual(expect.arrayContaining(withheldInvoices));
    }
    for (const text of [`${P}gone-sender@test.local`, 'v96o gone subject', `${P}b-sender@test.local`, 'v96o B subject', `${P}cross-sender@test.local`, 'v96o cross subject']) {
      expect(seen.text, text).not.toContain(text);
    }
  });
});
