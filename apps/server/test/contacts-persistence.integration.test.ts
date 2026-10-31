/**
 * R0-13-CT-PERSISTENCE-PROOF — the contact write contract against a REAL
 * database: denial, validation and delete-then-refresh.
 *
 * CF-03 / M12 (BUILD-MAP-001): the contact DELETE route had no route-level
 * test, and CRUD denial and validation were proven only with mocks
 * (test/crm.e2e.test.ts). CONTACTS-v1 CT-P03, CT-P05 and CT-P07 ask for the
 * persisted answer:
 *   - REGRESSION CONTROLS (expected to pass before and after): an owner PATCH
 *     followed by a fresh GET shows the update and exactly one contact.updated
 *     ContactEvent carrying the actor id; an owner DELETE then makes the detail
 *     answer 404 and drops the row from the list, leaves the linked invoice
 *     intact and sets deleted_at (read with raw SQL, under the soft-delete
 *     extension).
 *   - NEGATIVE CONTROLS (pre-fix result recorded per case in the packet
 *     commit): a STAFF member whose CRM module level is write but whose
 *     crm_edit is none is refused 403 on POST and PATCH with no row change; an
 *     invalid email or an over-length name is refused 400 with no partial
 *     write; a STAFF member without delete scope is refused 403 on DELETE.
 *   - TODAY'S BEHAVIOUR, handed to V1-17: the soft-deleted holder still
 *     occupies the email, so re-creating it answers 409 with
 *     existingContactId null.
 *   - OWNER ON CREATE (review repair ST-3): naming another member as ownerId
 *     on POST needs the reassign permission PATCH already requires (403
 *     otherwise), and a non-member or unknown ownerId is refused 400, both
 *     with nothing written. Naming yourself stays allowed.
 *
 * SCOPE OF THE CREATE DENIAL. The crm_edit 'none' refusal and the bounded 409
 * are proven for POST /crm/businesses/:businessId/contacts, the one route that
 * passes the actor to CrmService.createContact. The import routes
 * (import/image/ocr, import/file, import/link) reach createContact through
 * CrmImportService and CrmService.findOrCreateContact with no actor, so
 * neither check runs there. Closing that needs crm.controller.ts and
 * crm-import.service.ts, which are outside this packet's write set. It is
 * handed off as it.todo in test/contacts-import-write-scope.integration.test.ts.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business, membership, contact and invoice rows, CrmRateLimitGuard,
 * AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard,
 * TeamAuditInterceptor, the global ValidationPipe and GlobalHttpExceptionFilter
 * (configured as app-bootstrap.ts configures them), CrmController, CrmService,
 * CrmStatsService (detail), CrmTimelineService (the ContactEvent written inside
 * the contact transaction) and ContactAuditService are all real against
 * DATABASE_URL. The stand-ins: identity attachment (a test middleware reads
 * `x-test-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as AuthMiddleware would after Supabase token verification), the
 * timeline service's side channels (unified activity ledger, evidence, task
 * assignment), the stats/flow caches (invalidated, never read here) and the
 * plan limit (a stub that allows).
 *
 * DTO VALIDATION IN-PROCESS. The global ValidationPipe validates `@Body()`
 * against the parameter's `design:paramtypes` entry, which tsc emits
 * (emitDecoratorMetadata, the production build) and vitest's esbuild transform
 * does not: in-process the pipe sees no metatype and lets any body through
 * (observed on this suite's first run: an invalid email answered 201). The
 * harness therefore installs, before app.init() and only where absent, the
 * entries tsc emits for the two handlers under test. They are DERIVED, not
 * written out: crm.controller.ts is transpiled with ts.transpileModule under
 * the server tsconfig's decorator options (experimentalDecorators,
 * emitDecoratorMetadata), the design:paramtypes array of each handler is read
 * from the output, and each imported class is resolved through the emitted
 * require(). Today that gives
 *   createContact  [String, CreateContactDto, Object]
 *   updateContact  [String, String, UpdateContactDto, Object]
 * If the controller's @Body() lost its DTO type (say `body: any`), tsc would
 * emit Object, the harness would install Object, the pipe would skip
 * validation and the 400 cases would turn red, just as production would
 * accept the body. The HARNESS cases prove that tie. The DTO classes, their
 * decorators and the pipe options are the production ones.
 *
 * Requires DATABASE_URL. Every seeded row carries the `k13a_` prefix (contacts
 * created through the API are deleted by their business id) and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k13a_';
const ID = {
  // identities
  owner: `${P}owner`,             // OWNER of bizA
  staffNoEdit: `${P}staffNoEdit`, // STAFF, crm: write, crm_edit: none  (passes the module guard)
  staffNoDel: `${P}staffNoDel`,   // STAFF, crm: write, crm_delete: none (passes the module guard)
  staffWrite: `${P}staffWrite`,   // STAFF, crm: write (default delete scope: owned)
  staffRead: `${P}staffRead`,     // STAFF, crm: read  (module guard refuses writes)
  staffAssign: `${P}staffAssign`, // STAFF, crm: write, crm_reassign: true (seeded by the owner-on-create block)
  outsider: `${P}outsider`,       // a user with NO membership in bizA
  // tenant
  bizA: `${P}bizA`,
  // contacts
  cMain: `${P}cMain`,             // TEAM, owned by owner, linked invoice; PATCHed then DELETEd by the owner
  cTarget: `${P}cTarget`,         // TEAM, owned by owner; target of every refused write
  // linked invoice of cMain
  invMain: `${P}invMain`,
};

const MAIN_EMAIL = `${P}main@test.local`;
const TARGET_EMAIL = `${P}target@test.local`;

let db: any;
let app: any;

// ---- DTO validation metadata, derived from the controller source ---------
const CONTROLLER_DIR = path.resolve(__dirname, '../src/modules/crm');
const CONTROLLER_FILE = path.join(CONTROLLER_DIR, 'crm.controller.ts');
const PARAMTYPES = 'design:paramtypes';
const BODY_HANDLERS = ['createContact', 'updateContact'] as const;
let ts: any;
let CrmControllerClass: any;
let CreateContactDtoClass: any;
let UpdateContactDtoClass: any;
/** What tsc emits for each body-validated handler, derived in beforeAll. */
const derivedParamTypes: Record<string, unknown[]> = {};

/** Split a JS list at its top-level commas (none inside (), [] or {}). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * The design:paramtypes tsc emits for `handler` on CrmController, given the
 * controller's source text. Transpiled with the decorator options of
 * apps/server/tsconfig.json. An imported class is resolved through the
 * emitted require() and loaded from its module; anything else must be a
 * global constructor, and an unrecognised entry fails loudly.
 */
async function emittedParamTypes(source: string, handler: string): Promise<unknown[]> {
  const js: string = ts.transpileModule(source, {
    fileName: CONTROLLER_FILE,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  }).outputText;
  const block = js.match(new RegExp(
    `__decorate\\(\\[((?:(?!__decorate\\(\\[)[\\s\\S])*?)\\],\\s*CrmController\\.prototype,\\s*"${handler}",\\s*null\\)`,
  ));
  if (!block) throw new Error(`no decorated method ${handler} in the transpiled controller`);
  const list = block[1].match(/__metadata\("design:paramtypes",\s*\[([\s\S]*?)\]\)/);
  if (!list) throw new Error(`no ${PARAMTYPES} emitted for ${handler}`);

  const required = new Map<string, string>();
  for (const m of js.matchAll(/(\w+)\s*=\s*require\("([^"]+)"\)/g)) required.set(m[1], m[2]);
  const globals: Record<string, unknown> = { String, Number, Boolean, Object, Array, Function };

  const types: unknown[] = [];
  for (const entry of splitTopLevel(list[1])) {
    if (Object.hasOwn(globals, entry)) {
      types.push(globals[entry]);
      continue;
    }
    // e.g. typeof (_u = typeof create_contact_dto_1.CreateContactDto !== "undefined" && ...) === "function" ? _u : Object
    const ref = entry.match(/\b(\w+)\.(\w+)\b/);
    const specifier = ref ? required.get(ref[1]) : undefined;
    if (!ref || !specifier) throw new Error(`unrecognised ${PARAMTYPES} entry for ${handler}: ${entry}`);
    const mod: Record<string, unknown> = await import(
      specifier.startsWith('.') ? path.resolve(CONTROLLER_DIR, specifier) : specifier
    );
    if (typeof mod[ref[2]] !== 'function') throw new Error(`${specifier} has no class ${ref[2]}`);
    types.push(mod[ref[2]]);
  }
  return types;
}

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts may
  // be created through the API with generated ids, so they go by business id.
  for (const sql of [
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function post(actor: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts`)
    .set('x-test-user', actor)
    .send(body);
}

function patch(actor: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .send(body);
}

function del(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor);
}

function detail(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor);
}

function list(actor: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/contacts?take=100`)
    .set('x-test-user', actor);
}

/**
 * The whole persisted row, read with raw SQL so a soft-deleted row is still
 * visible. As JSON (snake_case keys, timestamps as ISO strings) because the
 * client cannot deserialize the tsvector search column, which the trigger
 * maintains and is left out.
 */
async function rawContact(contactId: string): Promise<Record<string, any> | null> {
  const rows: Array<{ row: Record<string, any> }> = await db.$queryRawUnsafe(
    `SELECT to_jsonb(c) - 'search_vector' AS row FROM contacts c WHERE c.id = $1`, contactId,
  );
  return rows[0]?.row ?? null;
}

async function rawInvoice(invoiceId: string) {
  const rows: Array<Record<string, unknown>> = await db.$queryRawUnsafe(
    'SELECT * FROM invoices WHERE id = $1', invoiceId,
  );
  return rows[0] ?? null;
}

/**
 * Every durable trace a contact write leaves for the tenant, read with raw SQL
 * (deleted rows included), for "no row change" and "no partial write".
 */
async function traceCounts() {
  const one = async (sql: string) => {
    const rows: Array<{ n: bigint | number }> = await db.$queryRawUnsafe(sql, ID.bizA);
    return Number(rows[0].n);
  };
  return {
    contacts: await one('SELECT COUNT(*)::int AS n FROM contacts WHERE business_id = $1'),
    live: await one('SELECT COUNT(*)::int AS n FROM contacts WHERE business_id = $1 AND deleted_at IS NULL'),
    contactEvents: await one('SELECT COUNT(*)::int AS n FROM contact_events WHERE business_id = $1'),
    audits: await one('SELECT COUNT(*)::int AS n FROM contact_audit_entries WHERE business_id = $1'),
    teamLogs: await one('SELECT COUNT(*)::int AS n FROM team_activity_logs WHERE business_id = $1'),
  };
}

/** Let any fire-and-forget write a request might have started reach the database. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The ContactAuditEntry write is fire-and-forget (DEC-CONTACTS-002): wait for it to land. */
async function auditEntries(contactId: string, action: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactId, action },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A refused write: the given status, and the target row plus every trace exactly as before. */
async function expectRefusedWithNoChange(
  send: () => Promise<{ status: number; body: any }>,
  status: number,
  contactId: string = ID.cTarget,
) {
  await settle(); // an earlier case's fire-and-forget writes land before the baseline
  const rowBefore = await rawContact(contactId);
  const tracesBefore = await traceCounts();
  const res = await send();
  expect(res.status).toBe(status);
  expect(res.body.statusCode).toBe(status);
  // The refusal carries no contact record.
  for (const key of ['id', 'firstName', 'email', 'contact']) {
    expect(res.body).not.toHaveProperty(key);
  }
  await settle();
  expect(await rawContact(contactId)).toEqual(rowBefore);
  expect(await traceCounts()).toEqual(tracesBefore);
  return res;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { CreateContactDto } = await import('../src/modules/crm/dto/create-contact.dto');
  const { UpdateContactDto } = await import('../src/modules/crm/dto/update-contact.dto');

  // ---- the parameter metadata tsc emits for the body-validated handlers,
  // derived from crm.controller.ts (see DTO VALIDATION IN-PROCESS above).
  // Only filled in where absent. ------------------------------------------
  const tsModule: any = await import('typescript');
  ts = tsModule.default ?? tsModule;
  CrmControllerClass = CrmController;
  CreateContactDtoClass = CreateContactDto;
  UpdateContactDtoClass = UpdateContactDto;
  const controllerSource = readFileSync(CONTROLLER_FILE, 'utf8');
  for (const handler of BODY_HANDLERS) {
    derivedParamTypes[handler] = await emittedParamTypes(controllerSource, handler);
    if (!Reflect.getMetadata(PARAMTYPES, CrmController.prototype, handler)) {
      Reflect.defineMetadata(PARAMTYPES, derivedParamTypes[handler], CrmController.prototype, handler);
    }
  }

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // CrmTimelineService's side channels: the unified activity ledger (its
      // write is already fire-and-forget), evidence and task assignment. The
      // ContactEvent row itself is the real write inside the contact
      // transaction.
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. The real AuthMiddleware attaches
  // `{ id, email, role }` from the User row after Supabase verifies the token;
  // this does the same from a header, for seeded k13a_ users only. No guard is
  // overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenant, memberships -----------------------------------
  for (const id of [ID.owner, ID.staffNoEdit, ID.staffNoDel, ID.staffWrite, ID.staffRead, ID.staffAssign, ID.outsider]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13A Biz A', ownerId: ID.owner } });
  const m = async (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, 'OWNER');
  await m(ID.staffNoEdit, 'STAFF', { crm: 'write', crm_edit: 'none' });
  await m(ID.staffNoDel, 'STAFF', { crm: 'write', crm_delete: 'none' });
  await m(ID.staffWrite, 'STAFF', { crm: 'write' });
  await m(ID.staffRead, 'STAFF', { crm: 'read' });

  // ---- contacts and the linked invoice -----------------------------------
  await db.contact.create({
    data: {
      id: ID.cMain, businessId: ID.bizA, firstName: `${P}Ada`, lastName: 'Lovelace',
      email: MAIN_EMAIL, emailNormalized: MAIN_EMAIL, visibility: 'TEAM', ownerId: ID.owner,
    },
  });
  await db.contact.create({
    data: {
      id: ID.cTarget, businessId: ID.bizA, firstName: `${P}Grace`, lastName: 'Hopper',
      email: TARGET_EMAIL, emailNormalized: TARGET_EMAIL, visibility: 'TEAM', ownerId: ID.owner,
    },
  });
  await db.invoice.create({
    data: {
      id: ID.invMain, invoiceNumber: `${P}INV-0001`, businessId: ID.bizA, contactId: ID.cMain,
      status: 'SENT', subtotal: 125, total: 125, currency: 'TTD',
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant with an owner, four STAFF members, two live contacts and one linked invoice', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await traceCounts()).toEqual({ contacts: 2, live: 2, contactEvents: 0, audits: 0, teamLogs: 0 });
    const inv = await rawInvoice(ID.invMain);
    expect(inv).toMatchObject({ contact_id: ID.cMain, business_id: ID.bizA, deleted_at: null });
  });
});

describe('HARNESS: the body DTO the ValidationPipe validates against is the one crm.controller.ts declares', () => {
  it('the design:paramtypes in effect for createContact and updateContact are the ones tsc emits from the controller source, binding CreateContactDto and UpdateContactDto', () => {
    expect(derivedParamTypes.createContact).toEqual([String, CreateContactDtoClass, Object]);
    expect(derivedParamTypes.updateContact).toEqual([String, String, UpdateContactDtoClass, Object]);
    for (const handler of BODY_HANDLERS) {
      const inEffect: unknown[] = Reflect.getMetadata(PARAMTYPES, CrmControllerClass.prototype, handler);
      expect(inEffect, handler).toHaveLength(derivedParamTypes[handler].length);
      inEffect.forEach((type, i) => expect(type, `${handler}[${i}]`).toBe(derivedParamTypes[handler][i]));
    }
  });

  it('negative control: a copy of the controller whose @Body() is typed any derives Object, and the production ValidationPipe lets an invalid email through Object but refuses it 400 through CreateContactDto', async () => {
    const source = readFileSync(CONTROLLER_FILE, 'utf8');
    const mutated = source
      .replace('@Body() body: CreateContactDto', '@Body() body: any')
      .replace('@Body() body: UpdateContactDto', '@Body() body: any');
    expect(mutated).not.toBe(source);
    expect(await emittedParamTypes(mutated, 'createContact')).toEqual([String, Object, Object]);
    expect(await emittedParamTypes(mutated, 'updateContact')).toEqual([String, String, Object, Object]);

    const { ValidationPipe, BadRequestException } = await import('@nestjs/common');
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const body = { firstName: `${P}Pipe`, email: 'not-an-email' };
    await expect(pipe.transform({ ...body }, { type: 'body', metatype: Object })).resolves.toMatchObject(body);
    await expect(pipe.transform({ ...body }, { type: 'body', metatype: CreateContactDtoClass }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('REGRESSION CONTROL: an owner PATCH followed by a fresh GET', () => {
  it('the owner PATCH answers 200 and a fresh GET of the detail and of the list shows the persisted update', async () => {
    const res = await patch(ID.owner, ID.cMain, { firstName: `${P}Augusta`, jobTitle: 'Analyst' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID.cMain, firstName: `${P}Augusta`, jobTitle: 'Analyst' });

    const fresh = await detail(ID.owner, ID.cMain);
    expect(fresh.status).toBe(200);
    expect(fresh.body.contact).toMatchObject({
      id: ID.cMain, firstName: `${P}Augusta`, lastName: 'Lovelace', jobTitle: 'Analyst', email: MAIN_EMAIL,
    });

    const listed = await list(ID.owner);
    expect(listed.status).toBe(200);
    const row = listed.body.contacts.find((c: any) => c.id === ID.cMain);
    expect(row).toMatchObject({ firstName: `${P}Augusta`, jobTitle: 'Analyst' });

    const raw = await rawContact(ID.cMain);
    expect(raw).toMatchObject({ first_name: `${P}Augusta`, job_title: 'Analyst', deleted_at: null });
  });

  it('exactly one contact.updated ContactEvent is persisted for the PATCH, carrying the owner as actorId, and the fresh GET returns it', async () => {
    const rows = await db.contactEvent.findMany({ where: { businessId: ID.bizA, contactId: ID.cMain, type: 'contact.updated' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });

    const fresh = await detail(ID.owner, ID.cMain);
    const updated = fresh.body.events.filter((e: any) => e.type === 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: rows[0].id, actorId: ID.owner });
  });
});

describe('NEGATIVE CONTROL: STAFF with crm_edit none cannot create or edit', () => {
  it('NEGATIVE CONTROL: POST by STAFF with crm write but crm_edit none answers 403 and writes no contact, event, audit entry or team log', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const res = await post(ID.staffNoEdit, { firstName: `${P}Denied`, email: `${P}denied@test.local` });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe(403);
    expect(res.body).not.toHaveProperty('id');
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
    const rows: unknown[] = await db.$queryRawUnsafe(
      'SELECT id FROM contacts WHERE business_id = $1 AND email_normalized = $2', ID.bizA, `${P}denied@test.local`,
    );
    expect(rows).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: PATCH by STAFF with crm write but crm_edit none answers 403 and the row and its traces are unchanged', async () => {
    const res = await expectRefusedWithNoChange(
      () => patch(ID.staffNoEdit, ID.cTarget, { firstName: `${P}Hijacked`, jobTitle: 'Nope' }),
      403,
    );
    expect(String(res.body.message)).toMatch(/permission/i);
  });

  it('control: a read-only STAFF member is refused 403 by the module guard on POST and on PATCH, with no row change', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const created = await post(ID.staffRead, { firstName: `${P}ReadOnly`, email: `${P}readonly@test.local` });
    expect(created.status).toBe(403);
    expect(String(created.body.message)).toMatch(/Insufficient permissions/);
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);

    const res = await expectRefusedWithNoChange(
      () => patch(ID.staffRead, ID.cTarget, { firstName: `${P}ReadOnlyEdit` }),
      403,
    );
    expect(String(res.body.message)).toMatch(/Insufficient permissions/);
  });
});

describe('NEGATIVE CONTROL: naming an owner on create obeys the reassign permission and business membership', () => {
  beforeAll(async () => {
    // Seeded here and not with the fixture, so the fixture sanity count stays
    // the tenant's original five memberships.
    await db.membership.create({
      data: {
        id: `${P}m_staffAssign`, userId: ID.staffAssign, businessId: ID.bizA, role: 'STAFF',
        permissionScopes: { crm: 'write', crm_reassign: 'true' },
      },
    });
  });

  async function rowsWithEmail(email: string) {
    const rows: Array<{ id: string; owner_id: string | null }> = await db.$queryRawUnsafe(
      'SELECT id, owner_id FROM contacts WHERE business_id = $1 AND email_normalized = $2', ID.bizA, email,
    );
    return rows;
  }

  it('NEGATIVE CONTROL: POST by STAFF without the reassign permission naming another member as ownerId answers 403 and writes nothing', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const email = `${P}planted@test.local`;
    const res = await post(ID.staffWrite, { firstName: `${P}Planted`, email, ownerId: ID.staffNoDel });
    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe(403);
    expect(String(res.body.message)).toMatch(/permission to assign contacts/i);
    expect(res.body).not.toHaveProperty('id');
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
    expect(await rowsWithEmail(email)).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: POST naming a user who is not a member of the business, or no user at all, as ownerId answers 400 and writes nothing, for the owner and for STAFF with crm_reassign', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const cases: Array<[string, string]> = [
      [ID.owner, ID.outsider],
      [ID.owner, `${P}no-such-user`],
      [ID.staffAssign, ID.outsider],
    ];
    for (const [actor, ownerId] of cases) {
      const email = `${P}orphan-${actor.slice(P.length)}-${ownerId.slice(P.length)}@test.local`;
      const res = await post(actor, { firstName: `${P}Orphan`, email, ownerId });
      expect(res.status, `${actor} -> ${ownerId}`).toBe(400);
      expect(String(res.body.message), `${actor} -> ${ownerId}`).toMatch(/member of this business/);
      expect(res.body).not.toHaveProperty('id');
      expect(await rowsWithEmail(email)).toHaveLength(0);
    }
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
  });

  it('positive control: STAFF without the reassign permission may name themselves as ownerId (201, owner_id persisted as that member)', async () => {
    const email = `${P}self-owned@test.local`;
    const res = await post(ID.staffWrite, { firstName: `${P}SelfOwned`, email, ownerId: ID.staffWrite });
    expect(res.status).toBe(201);
    expect(await rawContact(res.body.id)).toMatchObject({ business_id: ID.bizA, owner_id: ID.staffWrite, deleted_at: null });
  });

  it('positive control: the owner, and STAFF with crm_reassign true, may assign a new contact to another member (201, owner_id persisted)', async () => {
    const byOwner = await post(ID.owner, { firstName: `${P}AssignedByOwner`, email: `${P}assigned-owner@test.local`, ownerId: ID.staffWrite });
    expect(byOwner.status).toBe(201);
    expect(await rawContact(byOwner.body.id)).toMatchObject({ owner_id: ID.staffWrite, deleted_at: null });

    const byStaff = await post(ID.staffAssign, { firstName: `${P}AssignedByStaff`, email: `${P}assigned-staff@test.local`, ownerId: ID.staffNoDel });
    expect(byStaff.status).toBe(201);
    expect(await rawContact(byStaff.body.id)).toMatchObject({ owner_id: ID.staffNoDel, deleted_at: null });
  });
});

describe('NEGATIVE CONTROL: invalid input is refused 400 with no partial write', () => {
  const LONG_NAME = 'x'.repeat(101);

  it('NEGATIVE CONTROL: POST with an invalid email answers 400 and writes nothing', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const res = await post(ID.owner, { firstName: `${P}BadEmail`, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/email/i);
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
  });

  it('NEGATIVE CONTROL: POST with an over-length firstName or lastName (101 characters) answers 400 and writes nothing', async () => {
    await settle();
    const tracesBefore = await traceCounts();
    for (const field of ['firstName', 'lastName']) {
      const res = await post(ID.owner, { firstName: `${P}Long`, [field]: LONG_NAME, email: `${P}long-${field}@test.local` });
      expect(res.status, field).toBe(400);
      expect(JSON.stringify(res.body.message), field).toContain(field);
    }
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
  });

  it('NEGATIVE CONTROL: PATCH with an invalid email beside a valid edit answers 400 and the row and its traces are unchanged (no partial write)', async () => {
    const res = await expectRefusedWithNoChange(
      () => patch(ID.owner, ID.cTarget, { jobTitle: 'Partial', email: 'still-not-an-email' }),
      400,
    );
    expect(JSON.stringify(res.body.message)).toMatch(/email/i);
  });

  it('NEGATIVE CONTROL: PATCH with an over-length name beside a valid edit answers 400 and the row and its traces are unchanged (no partial write)', async () => {
    const res = await expectRefusedWithNoChange(
      () => patch(ID.owner, ID.cTarget, { jobTitle: 'Partial', lastName: LONG_NAME }),
      400,
    );
    expect(JSON.stringify(res.body.message)).toContain('lastName');
  });

  it('positive control: a 100-character firstName with a valid email is accepted (201) and persisted as sent', async () => {
    const name = `${P}${'y'.repeat(100 - P.length)}`;
    expect(name).toHaveLength(100);
    const res = await post(ID.owner, { firstName: name, email: `${P}boundary@test.local` });
    expect(res.status).toBe(201);
    const raw = await rawContact(res.body.id);
    expect(raw).toMatchObject({ business_id: ID.bizA, first_name: name, email_normalized: `${P}boundary@test.local`, deleted_at: null });
  });
});

describe('NEGATIVE CONTROL: STAFF without delete scope cannot delete', () => {
  it('NEGATIVE CONTROL: DELETE by STAFF with crm write but crm_delete none answers 403; the row stays live and nothing is written', async () => {
    const res = await expectRefusedWithNoChange(() => del(ID.staffNoDel, ID.cTarget), 403);
    expect(String(res.body.message)).toMatch(/permission to delete/i);
    expect((await rawContact(ID.cTarget))?.deleted_at).toBeNull();
  });

  it("DELETE by STAFF with crm write (default delete scope: owned) of the owner's contact answers 403; the row stays live and nothing is written", async () => {
    const res = await expectRefusedWithNoChange(() => del(ID.staffWrite, ID.cTarget), 403);
    expect(String(res.body.message)).toMatch(/only delete contacts you own/i);
    expect((await rawContact(ID.cTarget))?.deleted_at).toBeNull();
  });

  it('control: a read-only STAFF member is refused 403 by the module guard on DELETE, with no row change', async () => {
    const res = await expectRefusedWithNoChange(() => del(ID.staffRead, ID.cTarget), 403);
    expect(String(res.body.message)).toMatch(/Insufficient permissions/);
  });
});

describe('REGRESSION CONTROL: an owner DELETE then a refresh', () => {
  let invoiceBefore: Record<string, unknown> | null = null;

  it('the owner DELETE answers 200 and sets deleted_at on the row (raw SQL)', async () => {
    invoiceBefore = await rawInvoice(ID.invMain);
    expect(invoiceBefore).not.toBeNull();

    const res = await del(ID.owner, ID.cMain);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ID.cMain);

    const raw = await rawContact(ID.cMain);
    expect(raw).not.toBeNull();
    expect(typeof raw!.deleted_at).toBe('string');
    expect(Number.isNaN(Date.parse(raw!.deleted_at))).toBe(false);
    // Soft delete only: the identity and history columns are kept.
    expect(raw).toMatchObject({ id: ID.cMain, business_id: ID.bizA, email_normalized: MAIN_EMAIL, first_name: `${P}Augusta` });

    const deleted = await db.contactEvent.findMany({ where: { businessId: ID.bizA, contactId: ID.cMain, type: 'contact.deleted' } });
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });
    const audits = await auditEntries(ID.cMain, 'deleted');
    expect(audits).toHaveLength(1);
  });

  it('after the DELETE a fresh GET of the detail answers 404 and the list no longer returns the contact', async () => {
    const fresh = await detail(ID.owner, ID.cMain);
    expect(fresh.status).toBe(404);
    expect(fresh.body).not.toHaveProperty('contact');
    expect(fresh.body).not.toHaveProperty('invoices');

    const listed = await list(ID.owner);
    expect(listed.status).toBe(200);
    const ids = listed.body.contacts.map((c: any) => c.id);
    expect(ids).not.toContain(ID.cMain);
    expect(ids).toContain(ID.cTarget);
  });

  it('the linked invoice is intact after the DELETE: the same row, still linked to the contact, not deleted (raw SQL)', async () => {
    const after = await rawInvoice(ID.invMain);
    expect(after).toEqual(invoiceBefore);
    expect(after).toMatchObject({ contact_id: ID.cMain, status: 'SENT', total: 125, deleted_at: null });
  });

  it('a PATCH of the deleted contact answers 404 and writes nothing', async () => {
    await expectRefusedWithNoChange(() => patch(ID.owner, ID.cMain, { jobTitle: 'Ghost' }), 404, ID.cMain);
  });

  it("TODAY'S BEHAVIOUR (handed to V1-17): re-creating the deleted contact's email answers 409 contact_email_taken with existingContactId null, and no live row is created", async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const res = await post(ID.owner, { firstName: `${P}Again`, email: MAIN_EMAIL });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('contact_email_taken');
    expect(res.body.details).toEqual({ existingContactId: null });
    await settle();
    expect(await traceCounts()).toEqual(tracesBefore);
  });
});
