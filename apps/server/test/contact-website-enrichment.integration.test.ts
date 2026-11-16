/**
 * TOF-WEBSITE-ENRICHMENT (V1-63; #63, PRS-M14; owner ruling D-188 'enrichment') — contact
 * enrichment from the business website, against a REAL database, through the HTTP route
 * POST /crm/businesses/:businessId/contacts/:contactId/enrich.
 *
 * D-188: "Looking up a contact's website for extra details: only when a member who may edit the
 * contact taps 'Enrich'; never in the background." The website source (PublicDataEnrichmentProvider)
 * reads the business website of a contact's work email address. It is real here, behind the real
 * guard stack (AuthGuard, BusinessGuard, ModuleScopeGuard crm write, the CRM rate limit), the real
 * ContactEnrichmentService and the real CrmService write path, so a match is written with its
 * D-25 audit row and the CRM visibility and edit rules decide who may tap. Apollo is the real
 * provider too, unconfigured (no APOLLO_API_KEY), so the website source is the one that runs.
 *
 * Proven:
 *   - CONTROL: a member who may edit the contact taps Enrich; the site's own declared name, city
 *     and country fill the contact's blank fields only, written by CrmService.updateContact with
 *     one 'updated' audit row naming that member; the site was asked once, through a
 *     PinnedDispatcher pinned to the address its name was checked at, redirect 'manual'.
 *   - Off unless CONTACT_WEBSITE_ENRICHMENT is on (not_configured, nothing asked); with the flag on
 *     it counts as configured only for a contact with a business website (a free-mail address or
 *     none answers not_configured, nothing asked, nothing stamped).
 *   - A website whose name resolves to 127.0.0.1 or 169.254.169.254, or that redirects to the
 *     metadata address, is refused before any request to that address: a miss, nothing filled.
 *   - Only on the tap of a member who may edit the contact: a contact the member cannot see answers
 *     404 like an unknown id, an edit-scope refusal stays 403, a read-only member and an outsider
 *     are refused, and creating or editing a contact asks the website nothing.
 *
 * No real traffic: the resolver (node:dns promises lookup, the one the guard calls) is stubbed
 * from a table of .invalid names, and fetch is a tap that records every request and answers from
 * a table of pages; it never opens a socket. Fixture prefix v63l_ (V1-63, TOF-WEBSITE-ENRICHMENT).
 *
 * Run: cd apps/server && npx vitest run test/contact-website-enrichment.integration.test.ts
 * (DATABASE_URL to a migrated database).
 */
import 'reflect-metadata';
import path from 'path';
import { promises as dnsPromises } from 'node:dns';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63l_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staff: `${P}staff`, // STAFF of bizA, crm: write
  staffB: `${P}staffB`, // STAFF of bizA, crm: write; owns the PRIVATE contacts
  editOwned: `${P}editOwned`, // STAFF of bizA, crm: write, crm_edit: owned
  reader: `${P}reader`, // STAFF of bizA, crm: read
  outsider: `${P}outsider`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};
const UNKNOWN_CONTACT = `${P}c_unknown`;
const FLAG = 'CONTACT_WEBSITE_ENRICHMENT';

const PUBLIC_V4 = '93.184.215.14';
const ACME = 'v63l-acme.invalid';
const ACME_NAME = 'Acme Bakery & Co (v63l)';
const ACME_PAGE = [
  '<!doctype html><html><head><title>Home</title>',
  '<meta property="og:site_name" content="Acme">',
  '<script type="application/ld+json">',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: ACME_NAME,
    address: { '@type': 'PostalAddress', addressLocality: 'San Fernando', addressCountry: 'TT' },
  }),
  '</script></head><body>Fresh bread</body></html>',
].join('');

/** The resolver's answers. Any other name does not resolve. */
const ANSWERS: Record<string, Array<{ address: string; family: 4 | 6 }>> = {
  [ACME]: [{ address: PUBLIC_V4, family: 4 }],
  'v63l-hop.invalid': [{ address: PUBLIC_V4, family: 4 }],
  'v63l-down.invalid': [{ address: PUBLIC_V4, family: 4 }],
  'v63l-loopback.invalid': [{ address: '127.0.0.1', family: 4 }],
  'v63l-metadata.invalid': [{ address: '169.254.169.254', family: 4 }],
};

/** The pages the fetch tap serves, per URL. Anything else fails as a network error would. */
const PAGES: Record<string, () => Response> = {
  [`https://${ACME}/`]: () => new Response(ACME_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  'https://v63l-hop.invalid/': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
  'http://169.254.169.254/latest/meta-data/': () => new Response('<meta property="og:site_name" content="Metadata">', { status: 200, headers: { 'content-type': 'text/html' } }),
  'https://v63l-loopback.invalid/': () => new Response('<meta property="og:site_name" content="Loopback">', { status: 200, headers: { 'content-type': 'text/html' } }),
  'https://v63l-metadata.invalid/': () => new Response('<meta property="og:site_name" content="Metadata">', { status: 200, headers: { 'content-type': 'text/html' } }),
  'https://v63l-down.invalid/': () => new Response('down', { status: 503, headers: { 'content-type': 'text/html' } }),
};

/** Every name the resolver was asked for, and every request the fetch tap saw. */
const resolved: string[] = [];
const tapped: Array<{ url: string; method: string; redirect: unknown; dispatcher: any }> = [];

let db: any;
let app: any;
let PinnedDispatcherClass: any;
let lookupSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
const saved = { flag: process.env[FLAG], apollo: process.env.APOLLO_API_KEY };

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension).
  for (const sql of [
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

let ipSeq = 0;
/** A distinct client address per request, so the real per-IP rate limit never caps the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.63.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

function enrich(actor: string, contactId: string, body: Record<string, unknown> = {}, businessId = ID.bizA) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/${contactId}/enrich`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function createContact(actor: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function patchContact(actor: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

let seq = 0;
/** A live bizA contact seeded directly (no route traffic). */
async function seedContact(opts: {
  email: string | null;
  visibility?: 'PRIVATE' | 'TEAM';
  ownerId?: string | null;
  companyName?: string | null;
}) {
  seq += 1;
  return db.contact.create({
    data: {
      id: `${P}c_${seq}`,
      businessId: ID.bizA,
      firstName: `${P}Jane${seq}`,
      lastName: 'Doe',
      email: opts.email,
      emailNormalized: opts.email,
      visibility: opts.visibility ?? 'TEAM',
      ownerId: opts.ownerId === undefined ? ID.staffB : opts.ownerId,
      companyName: opts.companyName ?? null,
    },
  });
}

/** A work address at `domain`, carrying the suite prefix. */
function workEmail(domain: string) {
  seq += 1;
  return `${P}jane${seq}@${domain}`;
}

/** The raw row, every column, read past the soft-delete extension. */
async function rawRow(contactId: string): Promise<Record<string, any>> {
  const rows: Array<{ row: string }> = await db.$queryRawUnsafe(
    'SELECT to_jsonb(c)::text AS row FROM contacts c WHERE c.id = $1', contactId,
  );
  return JSON.parse(rows[0].row);
}

function auditsOf(contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId: ID.bizA, contactId }, orderBy: { createdAt: 'asc' } });
}

/** Let any fire-and-forget write a request might have started reach the database. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The error body with the two per-request fields (timestamp, echoed path) normalised. */
function normalisedError(res: { text: string }, contactId: string) {
  return res.text.replace(/"timestamp":"[^"]*"/, '"timestamp":"<t>"').split(contactId).join('<contactId>');
}

/** Run `act` and assert the contact row and its audit trail are unchanged and nothing was asked of the website. */
async function expectNothingAskedOrWritten(contactId: string, act: () => Promise<void>) {
  await settle();
  const before = await rawRow(contactId);
  const auditsBefore = (await auditsOf(contactId)).length;
  resolved.length = 0;
  tapped.length = 0;
  await act();
  await settle();
  expect(await rawRow(contactId)).toEqual(before);
  expect((await auditsOf(contactId)).length).toBe(auditsBefore);
  expect(resolved).toEqual([]);
  expect(tapped).toEqual([]);
}

beforeAll(async () => {
  // The website source on; Apollo unconfigured, so the website source is the one that runs.
  process.env[FLAG] = '1';
  delete process.env.APOLLO_API_KEY;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { PinnedDispatcher } = await import('../src/core/security/outbound-address');
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
  const { ContactEnrichmentController } = await import('../src/modules/crm/enrichment/contact-enrichment.controller');
  const { ContactEnrichmentService } = await import('../src/modules/crm/enrichment/contact-enrichment.service');
  const { ApolloEnrichmentProvider } = await import('../src/modules/crm/enrichment/apollo-enrichment.provider');
  const { PublicDataEnrichmentProvider } = await import('../src/modules/crm/enrichment/public-data-enrichment.provider');
  PinnedDispatcherClass = PinnedDispatcher;

  Logger.overrideLogger(['error']);

  // The constructor parameter type tsc emits for the enrichment controller (emitDecoratorMetadata,
  // the production build), which vitest's esbuild transform does not; the controller's parameter
  // carries no @Inject. Copied from its constructor. The service's parameters carry their own tokens.
  Reflect.defineMetadata('design:paramtypes', [ContactEnrichmentService], ContactEnrichmentController);

  // ---- the real HTTP path (wired before any row is seeded) ----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, ContactEnrichmentController],
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
      ContactEnrichmentService,
      // Both real: Apollo is unconfigured here, the website source runs behind the real guard.
      ApolloEnrichmentProvider,
      PublicDataEnrichmentProvider,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
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
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only, for seeded v63l_ users. No guard is overridden.
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

  // ---- the outbound taps (no real resolver, no real request) --------------
  lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementation((async (hostname: string, options?: { all?: boolean }) => {
    resolved.push(hostname);
    const list = ANSWERS[hostname];
    if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return options?.all ? list : list[0];
  }) as any);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init: any = {}) => {
    const url = String(input instanceof URL ? input.href : input);
    tapped.push({ url, method: init.method ?? 'GET', redirect: init.redirect, dispatcher: init.dispatcher });
    const page = PAGES[url];
    if (!page) throw new TypeError(`fetch failed: the tap has no page for ${url}`);
    return page();
  }) as any);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships -----------------------------------
  const users: Array<[string, string]> = [
    [ID.owner, `${P}owner@test.local`],
    [ID.staff, `${P}staff@test.local`],
    [ID.staffB, `${P}staffB@test.local`],
    [ID.editOwned, `${P}editOwned@test.local`],
    [ID.reader, `${P}reader@test.local`],
    [ID.outsider, `${P}outsider@test.local`],
  ];
  for (const [id, email] of users) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V63L Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V63L Biz B', ownerId: ID.outsider } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_staffB`, userId: ID.staffB, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({
    data: { id: `${P}m_editOwned`, userId: ID.editOwned, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_edit: 'owned' } },
  });
  await db.membership.create({ data: { id: `${P}m_reader`, userId: ID.reader, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' } } });
  await db.membership.create({ data: { id: `${P}m_outsider_bizB`, userId: ID.outsider, businessId: ID.bizB, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  lookupSpy?.mockRestore();
  fetchSpy?.mockRestore();
  if (saved.flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved.flag;
  if (saved.apollo !== undefined) process.env.APOLLO_API_KEY = saved.apollo;
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  process.env[FLAG] = '1';
  resolved.length = 0;
  tapped.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded two tenants, five bizA members and one outsider; nothing has been resolved or fetched', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(resolved).toEqual([]);
    expect(tapped).toEqual([]);
  });
});

describe("CONTROL: a member who may edit the contact taps Enrich; the business website fills the blank fields, through CrmService with its audit row, through the pinned guard", () => {
  it("the owner enriches another member's PRIVATE contact: the site's declared name, city and country fill the blank fields; one 'updated' audit row names the owner; one GET of the site through a PinnedDispatcher pinned to the checked address", async () => {
    const contact = await seedContact({ email: workEmail(ACME), visibility: 'PRIVATE', ownerId: ID.staffB });

    const res = await enrich(ID.owner, contact.id);

    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual({ status: 'enriched', provider: 'website', filled: ['companyName', 'city', 'country'] });
    const row = await rawRow(contact.id);
    expect(row).toMatchObject({ company_name: ACME_NAME, city: 'San Fernando', country: 'TT' });
    expect(row.custom.enrichment).toMatchObject({
      provider: 'website',
      filled: ['companyName', 'city', 'country'],
      raw: { source: 'website', website: `https://${ACME}/` },
    });
    const audits = await auditsOf(contact.id);
    expect(audits.map((a: any) => a.action)).toEqual(['updated']);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
    expect(audits[0].changedFields).toEqual(expect.arrayContaining(['companyName', 'city', 'country']));
    expect(audits[0].after).toMatchObject({ companyName: ACME_NAME, city: 'San Fernando', country: 'TT' });

    expect(resolved).toEqual([ACME]);
    expect(tapped).toHaveLength(1);
    expect(tapped[0]).toMatchObject({ url: `https://${ACME}/`, method: 'GET', redirect: 'manual' });
    expect(tapped[0].dispatcher).toBeInstanceOf(PinnedDispatcherClass);
    expect(tapped[0].dispatcher.target).toEqual({ hostname: ACME, addresses: [{ address: PUBLIC_V4, family: 4 }] });
  });

  it("a crm 'write' STAFF member enriches their own PRIVATE contact and another member's TEAM contact; the audit row names that member", async () => {
    for (const contact of [
      await seedContact({ email: workEmail(ACME), visibility: 'PRIVATE', ownerId: ID.staff }),
      await seedContact({ email: workEmail(ACME), visibility: 'TEAM', ownerId: ID.staffB }),
    ]) {
      const res = await enrich(ID.staff, contact.id);
      expect(res.status, res.text).toBe(201);
      expect(res.body, contact.id).toEqual({ status: 'enriched', provider: 'website', filled: ['companyName', 'city', 'country'] });
      const audits = await auditsOf(contact.id);
      expect(audits.map((a: any) => a.action), contact.id).toEqual(['updated']);
      expect(audits[0].actor, contact.id).toEqual({ type: 'USER', id: ID.staff });
    }
  });

  it('never overwrites: a company name the member typed is kept, and only the blank fields are filled', async () => {
    const contact = await seedContact({ email: workEmail(ACME), companyName: `${P}Typed by member` });

    const res = await enrich(ID.owner, contact.id);

    expect(res.body).toEqual({ status: 'enriched', provider: 'website', filled: ['city', 'country'] });
    expect(await rawRow(contact.id)).toMatchObject({ company_name: `${P}Typed by member`, city: 'San Fernando', country: 'TT' });
  });

  it('a second tap within the week asks the website nothing (skipped_recent); force asks again', async () => {
    const contact = await seedContact({ email: workEmail(ACME) });
    expect((await enrich(ID.owner, contact.id)).body.status).toBe('enriched');

    resolved.length = 0;
    tapped.length = 0;
    const again = await enrich(ID.owner, contact.id);
    expect(again.body).toEqual({ status: 'skipped_recent', provider: 'website', filled: [] });
    expect(resolved).toEqual([]);
    expect(tapped).toEqual([]);

    const forced = await enrich(ID.owner, contact.id, { force: true });
    expect(forced.body).toEqual({ status: 'no_new_data', provider: 'website', filled: [] });
    expect(resolved).toEqual([ACME]);
    expect(tapped.map((t) => t.url)).toEqual([`https://${ACME}/`]);
  });
});

describe('NEGATIVE CONTROL: off unless the flag is on; configured only for a contact with a business website; non-public addresses refused before any request', () => {
  it('with CONTACT_WEBSITE_ENRICHMENT off, enrich answers not_configured (as before this packet) and asks the website nothing', async () => {
    const contact = await seedContact({ email: workEmail(ACME) });
    process.env[FLAG] = '0';
    await expectNothingAskedOrWritten(contact.id, async () => {
      const res = await enrich(ID.owner, contact.id);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'not_configured', provider: 'apollo', filled: [] });
    });
  });

  it.each([
    ['a free-mail address (gmail.com)', `${P}jane@gmail.com`],
    ['a free-mail address (yahoo.co.uk)', `${P}jane@yahoo.co.uk`],
    ['no email', null],
    ['an IP-literal domain', `${P}jane@[127.0.0.1]`],
  ])('a contact with %s has no business website: not_configured, nothing resolved, fetched, stamped or written', async (_label, email) => {
    const contact = await seedContact({ email });
    await expectNothingAskedOrWritten(contact.id, async () => {
      const res = await enrich(ID.owner, contact.id, { force: true });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'not_configured', provider: 'website', filled: [] });
    });
    expect((await rawRow(contact.id)).custom ?? {}).not.toHaveProperty('enrichment');
  });

  it.each([
    ['127.0.0.1', 'v63l-loopback.invalid'],
    ['169.254.169.254 (the cloud metadata address)', 'v63l-metadata.invalid'],
  ])('a website whose name resolves to %s is refused before any request: a miss, nothing filled, no audit row', async (_label, domain) => {
    const contact = await seedContact({ email: workEmail(domain) });

    const res = await enrich(ID.owner, contact.id);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'no_match', provider: 'website', filled: [] });
    expect(resolved).toEqual([domain]);
    expect(tapped).toEqual([]);
    const row = await rawRow(contact.id);
    expect(row.company_name).toBeNull();
    expect(row.custom.enrichment).toMatchObject({ provider: 'website', filled: [] });
    await settle();
    expect(await auditsOf(contact.id)).toEqual([]);
  });

  it('a public website redirecting to the metadata address is refused before any request to it: one request (the public page), a miss, nothing filled', async () => {
    const contact = await seedContact({ email: workEmail('v63l-hop.invalid') });

    const res = await enrich(ID.owner, contact.id);

    expect(res.body).toEqual({ status: 'no_match', provider: 'website', filled: [] });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-hop.invalid/']);
    expect((await rawRow(contact.id)).company_name).toBeNull();
  });

  it('a website answering 503 is a transient failure: provider_error, no stamp, so the next tap tries again', async () => {
    const contact = await seedContact({ email: workEmail('v63l-down.invalid') });

    const res = await enrich(ID.owner, contact.id);

    expect(res.body).toEqual({ status: 'provider_error', provider: 'website', filled: [] });
    expect(tapped.map((t) => t.url)).toEqual(['https://v63l-down.invalid/']);
    expect((await rawRow(contact.id)).custom ?? {}).not.toHaveProperty('enrichment');
  });
});

describe('NEGATIVE CONTROL: only on the tap of a member who may edit the contact (D-188), never in the background', () => {
  it("a crm 'write' STAFF member tapping Enrich on another member's PRIVATE contact gets 404 byte-identical to an unknown id; the website is asked nothing and nothing is written", async () => {
    const contact = await seedContact({ email: workEmail(ACME), visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingAskedOrWritten(contact.id, async () => {
      const hidden = await enrich(ID.staff, contact.id, { force: true });
      const absent = await enrich(ID.staff, UNKNOWN_CONTACT, { force: true });
      expect(hidden.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(normalisedError(hidden, contact.id)).toBe(normalisedError(absent, UNKNOWN_CONTACT));
      expect(hidden.text).not.toContain(String(contact.email));
    });
  });

  it("a member whose crm_edit is 'owned' gets today's 403 on another member's TEAM contact; the website is asked nothing", async () => {
    const contact = await seedContact({ email: workEmail(ACME), visibility: 'TEAM', ownerId: ID.staffB });
    await expectNothingAskedOrWritten(contact.id, async () => {
      const res = await enrich(ID.editOwned, contact.id);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only edit contacts you own');
    });
  });

  it('a crm read-only member and an outsider (another business) are refused; the website is asked nothing', async () => {
    const contact = await seedContact({ email: workEmail(ACME) });
    await expectNothingAskedOrWritten(contact.id, async () => {
      expect((await enrich(ID.reader, contact.id)).status).toBe(403);
      expect((await enrich(ID.outsider, contact.id)).status).toBe(403);
      expect((await enrich(ID.outsider, contact.id, {}, ID.bizB)).status).toBe(404);
    });
  });

  it('creating a contact with a work email and editing it ask the website nothing: only the explicit tap does', async () => {
    const created = await createContact(ID.owner, { firstName: `${P}Created`, lastName: 'Doe', email: workEmail(ACME) });
    expect(created.status, created.text).toBe(201);
    const contactId = created.body.id ?? created.body.contact?.id;
    expect(typeof contactId).toBe('string');
    const edited = await patchContact(ID.owner, contactId, { jobTitle: `${P}Baker` });
    expect(edited.status, edited.text).toBe(200);
    await settle();
    expect(resolved).toEqual([]);
    expect(tapped).toEqual([]);
    expect((await rawRow(contactId)).company_name).toBeNull();

    const tapped1 = await enrich(ID.owner, contactId);
    expect(tapped1.body).toEqual({ status: 'enriched', provider: 'website', filled: ['companyName', 'city', 'country'] });
    expect(tapped.map((t) => t.url)).toEqual([`https://${ACME}/`]);
  });
});
