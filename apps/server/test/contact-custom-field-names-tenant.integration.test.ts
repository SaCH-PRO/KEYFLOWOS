/**
 * W9-CUSTOM-FIELDS-TENANT (SEC-R015c-3): a contact's typed custom-field names
 * resolve only against its own business's definitions (REAL database).
 *
 * WHY this suite exists. The contact form sends typed values keyed by
 * definition NAME (`customFieldValues: { tier: "Gold" }`) on
 * POST /crm/businesses/:businessId/contacts and
 * PATCH /crm/businesses/:businessId/contacts/:contactId. CrmService hands them
 * to ContactCustomFieldValueService.setValuesForContact, which looked the
 * names up with NO business (`customFieldDefinition.findMany({ where: { name:
 * { in: names }, archivedAt: null } })`), while names are unique only per
 * business (@@unique([businessId, name])). A member of A who sent a name only
 * B defines bound A's contact to B's definition, and A's contact detail and
 * values route then served B's definition with it (label, description,
 * options: schema.prisma ContactCustomFieldValue has no businessId, so nothing
 * downstream re-checks the tenant). A name both businesses define bound
 * whichever definition the database returned first, and a name A had archived
 * fell through to B's live one. The review of R0-15c confirmed it against a
 * real database; the web suite
 * apps/web/src/components/contacts/__tests__/contact-custom-fields-tenant.test.tsx
 * carried it as an it.todo and now points here.
 *
 * The fix scopes the lookup to the contact's own business (the business on the
 * contact row), so only that business's live definitions can bind.
 *
 * WHAT PRODUCTION COULD REACH (review CR-W9CF-1). In the deployed app the
 * global TenantInterceptor (app.module.ts APP_INTERCEPTOR) installs the path
 * business as the ambient tenant (verifiedTenantBusinessId: the guarded path
 * business, SUPER_ADMIN included) and main.ts installs
 * setTenantContextProvider, and CustomFieldDefinition is in BUSINESS_ID_MODELS
 * (packages/db/src/client.ts), so the extension already added that businessId
 * to the business-blind findMany on every POST/PATCH contacts request. Under
 * that wiring, which this suite now installs exactly as production does, the
 * HTTP write cases (C01..C08) pass on the pre-fix service too: they are
 * regression pins, not proof of a bind production HTTP could make today. The
 * write-path fix is defence in depth for a caller with NO ambient tenant
 * (the service called outside a request, by a job, a KEY flow or a script):
 * the [CFN-D*] cases call the service directly with no tenant installed, and
 * those are RED on the pre-fix service.
 *
 * READS (review SF-1). The extension never reaches an `include`d relation, and
 * ContactCustomFieldValue has no businessId, so a value row that already binds
 * A's contact to B's definition (left by the business-blind lookup from a
 * no-tenant caller, or by HTTP before main.ts installed the provider) was
 * served to A in full, with production wiring: B's businessId, label,
 * description and options, through the values route and the contact detail.
 * Both reads now keep only definitions of the contact's own business, and a
 * custom-field write on the contact removes such a row, which A could not
 * address by name (the [CFN-R*] cases, RED on the packet head before review).
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business, membership, contact, definition and value rows, CrmRateLimitGuard,
 * AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard,
 * TeamAuditInterceptor, the global TenantInterceptor (APP_INTERCEPTOR) with the
 * tenant context provider main.ts installs, the global ValidationPipe and
 * GlobalHttpExceptionFilter (as app-bootstrap.ts configures them),
 * CrmController, CrmService, CrmStatsService (detail), CrmTimelineService,
 * ContactAuditService, ContactCustomFieldValueService and CrmCustomFieldsController
 * (its values route) are real against DATABASE_URL. The
 * stand-ins: identity attachment (a test middleware reads `x-test-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as
 * AuthMiddleware would after Supabase token verification), the timeline
 * service's side channels, the stats/flow caches and the plan limit (allows),
 * and collaborators the routes never call (empty stubs).
 *
 * DTO VALIDATION IN-PROCESS. vitest's esbuild transform emits no
 * design:paramtypes, so the global ValidationPipe would see no metatype and
 * pass any body through. The entries tsc emits for the two handlers are
 * installed where absent ([String, CreateContactDto, Object] and
 * [String, String, UpdateContactDto, Object]); test/contacts-persistence
 * .integration.test.ts derives them from the controller source and proves the
 * tie (its HARNESS cases). With them the production pipe (whitelist) decides
 * whether `customFieldValues` reaches the service, as it does in production;
 * the positive controls prove it does.
 *
 * Cases tagged RED-BEFORE fail before their fix: the [CFN-D*] cases on the
 * packet base (53e9424a), where the service bound a contact to the other
 * business's definition; the [CFN-R*] cases on the packet head before review
 * (194fdc6e), where the reads served B's definition. For a name both
 * businesses define, the business-blind lookup took whichever row the
 * database returned first, so either order fails one side. (Without the
 * TenantInterceptor, as this suite was first written, C01, C02, C05, C06 and
 * C08 also failed on the base; that harness did not match production.)
 *
 * Every seeded row carries the `v95p_` prefix (contacts created through the
 * API are deleted by their business id, their values by contact) and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v95p_';
const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA
  ownerB: `${P}ownerB`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts seeded directly (PATCH targets)
  cA: `${P}cA`,
  cA2: `${P}cA2`,
  cB: `${P}cB`,
  // A's contacts for the direct service calls (no ambient tenant) and the
  // cross-bound reads.
  cD: `${P}cD`,
  cX: `${P}cX`,
  // B's contact for the direct-call mirror
  cBD: `${P}cBD`,
  // definitions. B's are inserted before A's, so a business-blind lookup meets B's row first.
  defBOnly: `${P}defBOnly`,         // B: `secretTier` (A defines no such name)
  defBShared: `${P}defBShared`,     // B: `tier`
  defBRetired: `${P}defBRetired`,   // B: `retired`, live
  defAShared: `${P}defAShared`,     // A: `tier`
  defAOwn: `${P}defAOwn`,           // A: `ownA`
  defARetired: `${P}defARetired`,   // A: `retired`, ARCHIVED
  // a value B already holds on its own contact
  valB: `${P}valB`,
  // a row the business-blind lookup left behind: A's contact cX bound to B's definition
  valCross: `${P}valCross`,
  // A's own value on cX
  valXOwn: `${P}valXOwn`,
};

/** Definition names: unique per business only, so the shared ones collide across A and B on purpose. */
const NAME = {
  bOnly: `${P}secretTier`,
  shared: `${P}tier`,
  retired: `${P}retired`,
  aOwn: `${P}ownA`,
};

/** What B's definitions disclose if they ever reach A's contact. */
const B_SECRET = {
  label: 'v95p B confidential tier',
  description: 'v95p B-only description 7c41',
  options: { options: [{ label: 'v95p B Platinum', value: 'b-plat' }] },
};

let db: any;
let app: any;
/** The real ContactCustomFieldValueService of the app, for the calls made outside a request. */
let valueService: any;
let setTenantContextProvider: ((p: { getCurrentBusinessId: () => string | undefined }) => void) | undefined;
let getCurrentBusinessId: () => string | undefined;
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
/** B's rows (definitions and values), serialized by the database, before any attempt. */
let bStateBefore: string;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts may
  // be created through the API with generated ids, so they and their values go
  // by business id.
  for (const sql of [
    `DELETE FROM contact_custom_field_values WHERE id LIKE ${sqlLikePrefix(P)}
       OR definition_id LIKE ${sqlLikePrefix(P)}
       OR contact_id IN (SELECT id FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM custom_field_definitions WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function createContact(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts`)
    .set('x-test-user', actor)
    .send(body);
}

function updateContact(actor: string, businessId: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .send(body);
}

function valuesRoute(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/custom-field-values`)
    .set('x-test-user', actor);
}

function detailRoute(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor);
}

/** Every value row of a contact with its definition's business, read with raw SQL. */
async function boundValues(contactId: string): Promise<Array<{ definitionId: string; business: string; name: string; value: unknown }>> {
  const rows: Array<{ definition_id: string; business_id: string; name: string; value: unknown }> = await db.$queryRawUnsafe(
    `SELECT v.definition_id, d.business_id, d.name, v.value
       FROM contact_custom_field_values v JOIN custom_field_definitions d ON d.id = v.definition_id
      WHERE v.contact_id = $1 ORDER BY d.name, d.business_id`,
    contactId,
  );
  return rows.map((r) => ({ definitionId: r.definition_id, business: r.business_id, name: r.name, value: r.value }));
}

/** B's definitions and every value bound to them, serialized by the database. */
async function bState(): Promise<string> {
  const defs: Array<{ row: unknown }> = await db.$queryRawUnsafe(
    `SELECT to_jsonb(d) AS row FROM custom_field_definitions d WHERE d.business_id = $1 ORDER BY d.id`, ID.bizB,
  );
  const values: Array<{ row: unknown }> = await db.$queryRawUnsafe(
    `SELECT to_jsonb(v) AS row FROM contact_custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.definition_id
      WHERE d.business_id = $1 ORDER BY v.id`, ID.bizB,
  );
  return JSON.stringify({ defs: defs.map((r) => r.row), values: values.map((r) => r.row) });
}

/** A fresh contact of A, created through the API with `customFieldValues`; answers its id. */
async function createInA(tag: string, customFieldValues: Record<string, unknown>): Promise<string> {
  const res = await createContact(ID.ownerA, ID.bizA, {
    firstName: `${P}${tag}`,
    lastName: 'Created',
    email: `${P}${tag.toLowerCase()}@test.local`,
    customFieldValues,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(typeof res.body.id).toBe('string');
  return res.body.id as string;
}

/** Nothing B defines appears in a response body (label, description, option label, definition ids). */
function expectNoTraceOfB(body: unknown) {
  const text = JSON.stringify(body);
  for (const secret of [B_SECRET.label, B_SECRET.description, B_SECRET.options.options[0].label, ID.defBOnly, ID.defBShared, ID.defBRetired]) {
    expect(text).not.toContain(secret);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenantMod = await import('../src/core/tenant/tenant-context');
  getCurrentBusinessId = tenantMod.getCurrentBusinessId;
  // As main.ts does before the app serves (CR-W9CF-1): the Prisma tenant
  // extension reads the ambient tenant that TenantInterceptor installs.
  setTenantContextProvider = dbMod.setTenantContextProvider;
  setTenantContextProvider({ getCurrentBusinessId: tenantMod.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmCustomFieldsController } = await import('../src/modules/crm/crm-custom-fields.controller');
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
  const { CustomFieldDefinitionService } = await import('../src/modules/crm/custom-field-definition.service');
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

  // The fire-and-forget writers (ContactAuditEntry, team log): drained before cleanup.
  asyncWrites = trackAsyncWrites([
    [ContactAuditService.prototype, 'write'],
    [TeamAuditInterceptor.prototype, 'record'],
  ]);

  // What tsc emits for the two body-validated handlers (see DTO VALIDATION IN-PROCESS).
  const PARAMTYPES = 'design:paramtypes';
  const emitted: Record<string, unknown[]> = {
    createContact: [String, CreateContactDto, Object],
    updateContact: [String, String, UpdateContactDto, Object],
  };
  for (const [handler, types] of Object.entries(emitted)) {
    if (!Reflect.getMetadata(PARAMTYPES, CrmController.prototype, handler)) {
      Reflect.defineMetadata(PARAMTYPES, types, CrmController.prototype, handler);
    }
  }

  // ContactCustomFieldValueService takes PrismaService by type, with no @Inject
  // token. tsc (emitDecoratorMetadata) emits this list; the test transform does
  // not, so it is declared here as test/contact-scoped-tenancy.integration.test.ts
  // declares it. Without it the service holds no Prisma, every write throws,
  // and CrmService swallows the error: the positive controls below catch that.
  if (!Reflect.getMetadata(PARAMTYPES, ContactCustomFieldValueService)) {
    Reflect.defineMetadata(PARAMTYPES, [PrismaService], ContactCustomFieldValueService);
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, CrmCustomFieldsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      // The app's global tenant scope (app.module.ts), registered as production registers it.
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      CrmStatsService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      ContactCustomFieldValueService,
      // The definition routes are never called here.
      { provide: CustomFieldDefinitionService, useValue: {} },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
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
  // Identity attachment only, for seeded v95p_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
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
  valueService = app.get(ContactCustomFieldValueService);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships -----------------------------------
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V95P Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V95P Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- contacts -------------------------------------------------------------
  for (const [id, businessId, ownerId, first] of [
    [ID.cA, ID.bizA, ID.ownerA, 'Ada'],
    [ID.cA2, ID.bizA, ID.ownerA, 'Alan'],
    [ID.cB, ID.bizB, ID.ownerB, 'Barbara'],
    [ID.cD, ID.bizA, ID.ownerA, 'Dora'],
    [ID.cX, ID.bizA, ID.ownerA, 'Xavier'],
    [ID.cBD, ID.bizB, ID.ownerB, 'Bettina'],
  ] as const) {
    await db.contact.create({
      data: { id, businessId, firstName: `${P}${first}`, lastName: 'Seeded', visibility: 'TEAM', ownerId },
    });
  }

  // ---- definitions: B's first, then A's -----------------------------------
  const def = (id: string, businessId: string, name: string, extra: Record<string, unknown> = {}) =>
    db.customFieldDefinition.create({ data: { id, businessId, name, label: `${name} label`, type: 'TEXT', ...extra } });
  await def(ID.defBOnly, ID.bizB, NAME.bOnly, { ...B_SECRET, type: 'SELECT' });
  await def(ID.defBShared, ID.bizB, NAME.shared, { label: `${B_SECRET.label} (shared name)` });
  await def(ID.defBRetired, ID.bizB, NAME.retired, { label: `${B_SECRET.label} (retired name)` });
  await def(ID.defAShared, ID.bizA, NAME.shared, { label: 'v95p A tier' });
  await def(ID.defAOwn, ID.bizA, NAME.aOwn, { label: 'v95p A own field' });
  await def(ID.defARetired, ID.bizA, NAME.retired, { label: 'v95p A retired field', archivedAt: new Date('2026-10-01T00:00:00.000Z') });

  // ---- B's own value on B's contact (must stay untouched) ------------------
  await db.contactCustomFieldValue.create({ data: { id: ID.valB, contactId: ID.cB, definitionId: ID.defBOnly, value: 'b-plat' } });

  bStateBefore = await bState();
}, 120_000);

afterAll(async () => {
  if (asyncWrites) await asyncWrites.drain();
  if (app) await app.close();
  if (db) await cleanup();
  asyncWrites?.restore();
  setTenantContextProvider?.({ getCurrentBusinessId: () => undefined });
}, 60_000);

describe('W9-CUSTOM-FIELDS-TENANT fixture sanity (real rows)', () => {
  it('[CFN-X01] B defines a name A does not, both define one shared name (B\'s row first), A archived a name B keeps live, and B holds one value', async () => {
    const defs: Array<{ id: string; business_id: string; name: string; archived: boolean }> = await db.$queryRawUnsafe(
      `SELECT id, business_id, name, archived_at IS NOT NULL AS archived FROM custom_field_definitions
        WHERE business_id IN ($1, $2) ORDER BY created_at, id`, ID.bizA, ID.bizB,
    );
    expect(defs.map((d) => [d.id, d.business_id, d.name, d.archived])).toEqual([
      [ID.defBOnly, ID.bizB, NAME.bOnly, false],
      [ID.defBShared, ID.bizB, NAME.shared, false],
      [ID.defBRetired, ID.bizB, NAME.retired, false],
      [ID.defAShared, ID.bizA, NAME.shared, false],
      [ID.defAOwn, ID.bizA, NAME.aOwn, false],
      [ID.defARetired, ID.bizA, NAME.retired, true],
    ]);
    expect(await boundValues(ID.cB)).toEqual([{ definitionId: ID.defBOnly, business: ID.bizB, name: NAME.bOnly, value: 'b-plat' }]);
    expect(await boundValues(ID.cA)).toEqual([]);
  });
});

describe('SEC-R015c-3 (W9-CUSTOM-FIELDS-TENANT) through HTTP with the production tenant wiring, a contact\'s typed custom-field names resolve only against its own business\'s definitions', () => {
  it('[CFN-C01] creating a contact of A with a name only B defines binds no value; B\'s definition never reaches A\'s contact', async () => {
    const id = await createInA('BOnlyCreate', { [NAME.bOnly]: 'b-plat' });
    expect(await boundValues(id)).toEqual([]);
  });

  it('[CFN-C02] updating a contact of A with a name only B defines binds no value', async () => {
    const res = await updateContact(ID.ownerA, ID.bizA, ID.cA, { customFieldValues: { [NAME.bOnly]: 'b-plat' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(ID.cA)).toEqual([]);
  });

  it('[CFN-C03] a name both businesses define binds A\'s definition on create, never B\'s', async () => {
    const id = await createInA('SharedCreate', { [NAME.shared]: 'Gold' });
    expect(await boundValues(id)).toEqual([{ definitionId: ID.defAShared, business: ID.bizA, name: NAME.shared, value: 'Gold' }]);
  });

  it('[CFN-C04] a name both businesses define binds A\'s definition on update, never B\'s', async () => {
    const res = await updateContact(ID.ownerA, ID.bizA, ID.cA2, { customFieldValues: { [NAME.shared]: 'Silver' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(ID.cA2)).toEqual([{ definitionId: ID.defAShared, business: ID.bizA, name: NAME.shared, value: 'Silver' }]);
  });

  it('[CFN-C05] a name A has archived while B\'s is live binds nothing (no fall-through to B)', async () => {
    const created = await createInA('RetiredCreate', { [NAME.retired]: 'x' });
    expect(await boundValues(created)).toEqual([]);
    const res = await updateContact(ID.ownerA, ID.bizA, ID.cA, { customFieldValues: { [NAME.retired]: 'y' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(ID.cA)).toEqual([]);
  });

  it('[CFN-C06] after the attempts above, A\'s values route and contact detail serve nothing B defines (label, description, options)', async () => {
    const id = await createInA('Disclosure', { [NAME.bOnly]: 'b-plat', [NAME.shared]: 'Gold', [NAME.retired]: 'x' });
    const values = await valuesRoute(ID.ownerA, ID.bizA, id);
    expect(values.status).toBe(200);
    expectNoTraceOfB(values.body);
    expect((values.body as Array<{ definitionId: string }>).map((v) => v.definitionId)).toEqual([ID.defAShared]);

    for (const contactId of [ID.cA, ID.cA2, id]) {
      const detail = await detailRoute(ID.ownerA, ID.bizA, contactId);
      expect(detail.status).toBe(200);
      expect(Array.isArray(detail.body.customFieldValues)).toBe(true);
      expectNoTraceOfB(detail.body.customFieldValues);
      const again = await valuesRoute(ID.ownerA, ID.bizA, contactId);
      expect(again.status).toBe(200);
      expectNoTraceOfB(again.body);
    }
  });

  it('[CFN-C07] positive control: A\'s own names bind A\'s definitions on create and update, through the production pipe, and A\'s routes show them', async () => {
    const id = await createInA('OwnCreate', { [NAME.aOwn]: 'mine', [NAME.shared]: 'Gold' });
    expect(await boundValues(id)).toEqual([
      { definitionId: ID.defAOwn, business: ID.bizA, name: NAME.aOwn, value: 'mine' },
      { definitionId: ID.defAShared, business: ID.bizA, name: NAME.shared, value: 'Gold' },
    ]);
    const res = await updateContact(ID.ownerA, ID.bizA, id, { customFieldValues: { [NAME.aOwn]: 'changed' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(id)).toEqual([
      { definitionId: ID.defAOwn, business: ID.bizA, name: NAME.aOwn, value: 'changed' },
      { definitionId: ID.defAShared, business: ID.bizA, name: NAME.shared, value: 'Gold' },
    ]);
    const values = await valuesRoute(ID.ownerA, ID.bizA, id);
    expect(values.status).toBe(200);
    expect((values.body as Array<{ definitionId: string; definition: { label: string } }>).map((v) => v.definition.label).sort())
      .toEqual(['v95p A own field', 'v95p A tier']);
  });

  it('[CFN-C08] B\'s own contact with the name both businesses define binds B\'s definition, never A\'s (the mirror of C03 and C04)', async () => {
    const res = await updateContact(ID.ownerB, ID.bizB, ID.cB, { customFieldValues: { [NAME.shared]: 'B-Gold' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(ID.cB)).toEqual([
      { definitionId: ID.defBOnly, business: ID.bizB, name: NAME.bOnly, value: 'b-plat' },
      { definitionId: ID.defBShared, business: ID.bizB, name: NAME.shared, value: 'B-Gold' },
    ]);
    // B's names also still bind B's definitions (the scoping is not a refusal
    // of every name). Undo, so B's state below compares against the seed.
    await db.$executeRawUnsafe('DELETE FROM contact_custom_field_values WHERE contact_id = $1 AND definition_id = $2', ID.cB, ID.defBShared);
  });
});

describe('SEC-R015c-3 (W9-CUSTOM-FIELDS-TENANT, review CR-W9CF-1) with no ambient tenant, as a caller outside a request runs, the service binds only the contact\'s own business\'s live definitions', () => {
  /** No tenant is installed: the Prisma tenant extension adds nothing, so the service's own scoping is all there is. */
  async function setOutsideARequest(contactId: string, values: Record<string, unknown>) {
    expect(getCurrentBusinessId()).toBeUndefined();
    return valueService.setValuesForContact(contactId, values);
  }

  /** Values of `contactId` bound to a definition of any business but `own`. */
  async function boundElsewhere(contactId: string, own: string) {
    return (await boundValues(contactId)).filter((v) => v.business !== own);
  }

  it('[CFN-D01] RED-BEFORE: a name only B defines binds nothing on A\'s contact', async () => {
    expect(await setOutsideARequest(ID.cD, { [NAME.bOnly]: 'b-plat' })).toEqual([]);
    expect(await boundValues(ID.cD)).toEqual([]);
  });

  it('[CFN-D02] RED-BEFORE: a name both businesses define binds A\'s definition on A\'s contact and B\'s on B\'s, whichever row the database returns first', async () => {
    try {
      await setOutsideARequest(ID.cD, { [NAME.shared]: 'Gold' });
      await setOutsideARequest(ID.cBD, { [NAME.shared]: 'B-Gold' });
      expect(await boundValues(ID.cD)).toEqual([{ definitionId: ID.defAShared, business: ID.bizA, name: NAME.shared, value: 'Gold' }]);
      expect(await boundValues(ID.cBD)).toEqual([{ definitionId: ID.defBShared, business: ID.bizB, name: NAME.shared, value: 'B-Gold' }]);
    } finally {
      // B's contact is not A's attempt: undo it, so B's state below compares against the seed.
      await db.$executeRawUnsafe('DELETE FROM contact_custom_field_values WHERE contact_id = $1', ID.cBD);
    }
  });

  it('[CFN-D03] RED-BEFORE: a name A archived while B\'s is live binds nothing (no fall-through to B)', async () => {
    await setOutsideARequest(ID.cD, { [NAME.retired]: 'x' });
    expect((await boundValues(ID.cD)).filter((v) => v.name === NAME.retired)).toEqual([]);
    expect(await boundElsewhere(ID.cD, ID.bizA)).toEqual([]);
  });
});

describe('SF-1 (W9-CUSTOM-FIELDS-TENANT review) a value row already bound to another business\'s definition is never served, and a custom-field write on the contact removes it', () => {
  beforeAll(async () => {
    // A's own value, and the row the business-blind lookup left behind
    // (written directly, as no fixed path can write it now).
    await db.contactCustomFieldValue.create({ data: { id: ID.valXOwn, contactId: ID.cX, definitionId: ID.defAOwn, value: 'x-own' } });
    await db.contactCustomFieldValue.create({ data: { id: ID.valCross, contactId: ID.cX, definitionId: ID.defBOnly, value: 'b-plat' } });
  });

  afterAll(async () => {
    // The planted row is this block's fixture, not A's attempt: S01 below
    // measures only what A's requests did to B's rows.
    await db.$executeRawUnsafe('DELETE FROM contact_custom_field_values WHERE id = $1', ID.valCross);
  });

  const ownOnly = [{ definitionId: ID.defAOwn, business: ID.bizA, name: NAME.aOwn, value: 'x-own' }];

  it('[CFN-R01] RED-BEFORE: A\'s values route serves A\'s own value and nothing bound to B\'s definition (no B businessId, label, description or options)', async () => {
    const res = await valuesRoute(ID.ownerA, ID.bizA, ID.cX);
    expect(res.status).toBe(200);
    expectNoTraceOfB(res.body);
    expect(JSON.stringify(res.body)).not.toContain(ID.bizB);
    expect((res.body as Array<{ id: string }>).map((v) => v.id)).toEqual([ID.valXOwn]);
  });

  it('[CFN-R02] RED-BEFORE: A\'s contact detail serves A\'s own value and nothing bound to B\'s definition', async () => {
    const res = await detailRoute(ID.ownerA, ID.bizA, ID.cX);
    expect(res.status).toBe(200);
    expectNoTraceOfB(res.body.customFieldValues);
    expect(JSON.stringify(res.body.customFieldValues)).not.toContain(ID.bizB);
    expect((res.body.customFieldValues as Array<{ id: string }>).map((v) => v.id)).toEqual([ID.valXOwn]);
  });

  it('[CFN-R03] RED-BEFORE: getValuesForContacts names its business and answers only rows whose contact and definition both belong to it', async () => {
    const rows: Array<{ id: string }> = await valueService.getValuesForContacts(ID.bizA, [ID.cX, ID.cB]);
    expect(rows.map((r) => r.id)).toEqual([ID.valXOwn]);
  });

  it('[CFN-R04] RED-BEFORE: a PATCH of A\'s contact that clears B\'s field name removes the row bound to B\'s definition; A\'s own value and B\'s own rows are untouched', async () => {
    expect(await boundValues(ID.cX)).toEqual([
      ...ownOnly,
      { definitionId: ID.defBOnly, business: ID.bizB, name: NAME.bOnly, value: 'b-plat' },
    ]);
    const res = await updateContact(ID.ownerA, ID.bizA, ID.cX, { customFieldValues: { [NAME.bOnly]: null } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await boundValues(ID.cX)).toEqual(ownOnly);
    expect(await boundValues(ID.cB)).toEqual([{ definitionId: ID.defBOnly, business: ID.bizB, name: NAME.bOnly, value: 'b-plat' }]);
    const values = await valuesRoute(ID.ownerA, ID.bizA, ID.cX);
    expect((values.body as Array<{ id: string }>).map((v) => v.id)).toEqual([ID.valXOwn]);
  });
});

describe('W9-CUSTOM-FIELDS-TENANT tenant state after the attempts', () => {
  it('[CFN-S01] B\'s definitions and every value bound to them are byte-identical after A\'s attempts', async () => {
    if (asyncWrites) await asyncWrites.drain();
    expect(await bState()).toBe(bStateBefore);
  });
});
