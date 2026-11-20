/**
 * V1-63 (SWP-ORDERBY-SINGLE-KEY), sweep BUG-012 and BUG-036: Settings > AI
 * Skills and a customer's Tasks load, in the order they promise.
 *
 * The sweep (key-calendar-settings, contacts-crm; rechecks M7 and M9): GET
 * /ai/businesses/:id/ai/settings/skills answered 500 on every visit of
 * /app/settings/ai, and GET /crm/businesses/:id/tasks?contactId=... answered
 * 500, so the customer's Tasks tab said 'No tasks yet' right after 'Task
 * added'. The API log named PrismaClientValidationError 'Argument `orderBy`:
 * Invalid value provided. Expected SkillOrderByWithRelationInput[], provided
 * Object' (and ContactTaskOrderByWithRelationInput[]): AiSettingsService.
 * listSkills sorted by `{ category: 'asc', name: 'asc' }` and CrmTimelineService.
 * listContactTasks by `{ dueDate: 'asc', createdAt: 'desc' }`. A Prisma orderBy
 * object names one field; two fields are an array, one object each, in order.
 *
 * Pinned here, through the real HTTP routes on a real database:
 *   - GET .../ai/settings/skills answers 200 with the skills by category, then
 *     by name (as the database orders them), a skill added through POST
 *     .../ai/settings/skills among them;
 *   - GET .../crm/businesses/:id/tasks?contactId= answers 200 with that
 *     customer's tasks by due date (earliest first, undated last), the newer of
 *     two tasks due at the same moment first; with ?status= and without
 *     contactId (the business's list, ?dueBefore= too) the same order holds, and
 *     no other customer's or business's task is listed.
 * Controls (green before and after): a customer of another business is 404, a
 * non-member is 403.
 *
 * Review repair (SEC-OB-1, OB-COR-1, SEC-OB-2; rules D-37, D-63, D-90, D-100;
 * W9-CRM-RESIDUALS SEC-L81-3): once the list answers 200 it is a read like its
 * sibling GET .../tasks/due, so in a second business (v63f_bizV, its own
 * contacts and tasks; the cases above keep theirs) it is pinned that:
 *   - with ?contactId= a contact the member cannot open (a PRIVATE contact of
 *     the owner for a STAFF member; another member's contact for one limited to
 *     their own book, crm_view 'owned') is 404 'Contact not found', as GET
 *     contacts/:id/notes answers, and nothing of it is served;
 *   - without contactId the list holds only the tasks of contacts the member
 *     may open (a PRIVATE contact shared with them included), in the same order;
 *   - every task carries the contact summary tasks/due serves (id, names,
 *     email, phone, status), never the stored row: no notesInternal, custom
 *     fields or the stored money fields (lifetimeValue, averageSpend,
 *     paymentReliability, leadScore) a member with revenue 'none' is not served;
 *   - a soft-deleted contact's tasks are not listed, for the OWNER either
 *     (?contactId= on it is 404, as before).
 *
 * Harness (as test/team-invite-email-case.integration.test.ts): the real
 * AuthMiddleware and AuthGuard (HS256 tokens on the test-only verifyLocal path,
 * signed with a secret built at run time), the real BusinessGuard,
 * ModuleScopeGuard, RateLimitGuard (Redis) and CrmRateLimitGuard, the
 * TenantInterceptor as the APP_INTERCEPTOR production installs, configureNestApp
 * (the global exception filter and validation pipe), and the real
 * AiSettingsController/AiSettingsService and CrmController/CrmService/
 * CrmTimelineService on the real PrismaService. Collaborators these routes never
 * call are empty stand-ins. Global fetch is a tap that refuses every call; the
 * suite asserts it was never used.
 *
 * RESOURCES: fixture prefix v63f_ (registered in test/helpers/fixture-prefixes.json,
 * packet V1-63 (SWP-ORDERBY-SINGLE-KEY)). Every seeded id, address and skill name
 * carries it; a skill the POST route creates is named with it too. Skill is a
 * global catalogue (no businessId), so the list assertions read this suite's
 * skills in the response and compare the whole response with the database's own
 * ORDER BY over the same rows. The review-repair business (v63f_bizV) has its
 * own users, memberships, contacts, contact share and tasks, all named with the
 * prefix. Everything is hard-deleted by raw SQL through sqlLikePrefix(P) before
 * and after the suite.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63f_';

/** Test-only HS256 secret, assembled at run time (no secret-shaped literal). */
const SIGNING_SECRET = [P, 'orderby', 'single', 'key', 'signing'].join('-');

const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
] as const;
const saved: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

const ID = {
  owner: `${P}owner`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  bizB: `${P}bizB`,
  /** The customer whose Tasks tab the sweep opened. */
  hana: `${P}c_hana`,
  /** Another customer of the same business. */
  ivan: `${P}c_ivan`,
  /** A customer of the outsider's business. */
  other: `${P}c_other`,
  /** The review-repair business (SEC-OB-1, OB-COR-1, SEC-OB-2): the owner's second business. */
  bizV: `${P}bizV`,
  /** A STAFF member of bizV: crm read, revenue 'none', every TEAM/SHARED contact (crm_view defaults to 'all'). */
  staff: `${P}staff`,
  /** A STAFF member of bizV limited to their own book: crm read, revenue 'none', crm_view 'owned'. */
  book: `${P}book`,
  /** bizV contacts: the owner's TEAM contact with stored money figures. */
  vTeam: `${P}cv_team`,
  /** The owner's PRIVATE contact, shared with nobody. */
  vPriv: `${P}cv_priv`,
  /** The owner's PRIVATE contact, shared with the staff member. */
  vShared: `${P}cv_shared`,
  /** A TEAM contact the book-limited member owns. */
  vBook: `${P}cv_book`,
  /** A soft-deleted contact (a forget in its grace period). */
  vGone: `${P}cv_gone`,
};

const EMAIL = {
  owner: `${P}owner@test.local`,
  outsider: `${P}outsider@test.local`,
  staff: `${P}staff@test.local`,
  book: `${P}book@test.local`,
};

/** Who a request is sent as: the session user and their address. */
const AS = {
  owner: { id: ID.owner, email: EMAIL.owner },
  outsider: { id: ID.outsider, email: EMAIL.outsider },
  staff: { id: ID.staff, email: EMAIL.staff },
  book: { id: ID.book, email: EMAIL.book },
} as const;
type As = keyof typeof AS;

const DAY = 86_400_000;
/** One fixed instant the seeded due dates and creation times count from (no wall-clock ties). */
const T0 = Date.UTC(2026, 10, 20, 12, 0, 0);

/**
 * Hana's tasks, written in an order that is none of the orders the list may
 * take, so an unsorted read cannot pass. Two are due at the same moment: the
 * newer one (by createdAt) comes first. One has no due date: it comes last.
 */
const TASK = {
  late: { id: `${P}t_late`, contactId: ID.hana, title: `${P}call back about the deposit`, due: T0 + 3 * DAY, created: T0 - 50 * 60_000, status: 'OPEN' },
  undated: { id: `${P}t_undated`, contactId: ID.hana, title: `${P}send the aftercare sheet`, due: null, created: T0 - 40 * 60_000, status: 'OPEN' },
  soonOld: { id: `${P}t_soon_old`, contactId: ID.hana, title: `${P}confirm Thursday`, due: T0 + 1 * DAY, created: T0 - 30 * 60_000, status: 'OPEN' },
  done: { id: `${P}t_done`, contactId: ID.hana, title: `${P}book the follow-up`, due: T0 + 2 * DAY, created: T0 - 20 * 60_000, status: 'DONE' },
  soonNew: { id: `${P}t_soon_new`, contactId: ID.hana, title: `${P}confirm the time`, due: T0 + 1 * DAY, created: T0 - 10 * 60_000, status: 'OPEN' },
  ivan: { id: `${P}t_ivan`, contactId: ID.ivan, title: `${P}quote for Ivan`, due: T0 + 0.5 * DAY, created: T0 - 60 * 60_000, status: 'OPEN' },
};
const OTHER_TASK = { id: `${P}t_other`, contactId: ID.other, title: `${P}another business's task`, due: T0 + 0.25 * DAY, created: T0 - 5 * 60_000, status: 'OPEN' };

/** Hana's tasks as the Tasks tab must list them: by due date, the newer first on a tie, undated last. */
const HANA_ORDER = [TASK.soonNew.id, TASK.soonOld.id, TASK.done.id, TASK.late.id, TASK.undated.id];

/**
 * The catalogue rows this suite owns. Sorted by name alone they would read
 * alpha, eta, zeta; by category alone the two in cat_a could come either way.
 * By category, then name: eta, zeta (cat_a), alpha (cat_b).
 */
const SKILL = {
  zeta: { id: `${P}s_zeta`, name: `${P}zeta lettering`, category: `${P}cat_a` },
  alpha: { id: `${P}s_alpha`, name: `${P}alpha bookkeeping`, category: `${P}cat_b` },
  eta: { id: `${P}s_eta`, name: `${P}eta copywriting`, category: `${P}cat_a` },
};
const SKILL_ORDER = [SKILL.eta.name, SKILL.zeta.name, SKILL.alpha.name];
/** The skill the owner adds through POST, as the Skills tab does. */
const ADDED_SKILL = { name: `${P}beta reels`, category: `${P}cat_a` };

/**
 * The review-repair business's contacts. Every one carries an internal note and
 * stored money figures, so a full row on the wire is seen; the amounts are
 * distinctive enough to be searched for in a response body.
 */
const VCONTACT = {
  team: { id: ID.vTeam, firstName: 'Tomas', visibility: 'TEAM', ownerId: ID.owner, lifetimeValue: 4321.5, deleted: false },
  priv: { id: ID.vPriv, firstName: 'Priya', visibility: 'PRIVATE', ownerId: ID.owner, lifetimeValue: 98765.43, deleted: false },
  shared: { id: ID.vShared, firstName: 'Sana', visibility: 'PRIVATE', ownerId: ID.owner, lifetimeValue: 5555.25, deleted: false },
  book: { id: ID.vBook, firstName: 'Bo', visibility: 'TEAM', ownerId: ID.book, lifetimeValue: 777.75, deleted: false },
  gone: { id: ID.vGone, firstName: 'Greta', visibility: 'TEAM', ownerId: ID.owner, lifetimeValue: 3333.5, deleted: true },
};
const vEmail = (c: { firstName: string }) => `${P}${c.firstName.toLowerCase()}@private.local`;
const vNote = (c: { firstName: string }) => `${P}internal note on ${c.firstName}`;
/** The stored money figures besides lifetimeValue (the same on every bizV contact). */
const V_AVERAGE_SPEND = 1234.5;
const V_PAYMENT_RELIABILITY = 87;
const V_LEAD_SCORE = 91;

/** One OPEN task per bizV contact, due on distinct days (the deleted contact's first, were it listed). */
const VTASK = {
  gone: { id: `${P}tv_gone`, contactId: ID.vGone, title: `${P}call Greta about the refund`, due: T0 + 0.5 * DAY, created: T0 - 15 * 60_000, status: 'OPEN' },
  book: { id: `${P}tv_book`, contactId: ID.vBook, title: `${P}send Bo the price list`, due: T0 + 1 * DAY, created: T0 - 14 * 60_000, status: 'OPEN' },
  priv: { id: `${P}tv_priv`, contactId: ID.vPriv, title: `${P}discuss the private settlement`, due: T0 + 2 * DAY, created: T0 - 13 * 60_000, status: 'OPEN' },
  team: { id: `${P}tv_team`, contactId: ID.vTeam, title: `${P}confirm Tomas's booking`, due: T0 + 3 * DAY, created: T0 - 12 * 60_000, status: 'OPEN' },
  shared: { id: `${P}tv_shared`, contactId: ID.vShared, title: `${P}follow up with Sana`, due: T0 + 4 * DAY, created: T0 - 11 * 60_000, status: 'OPEN' },
};

/** The contact summary GET .../tasks/due serves (CrmTimelineService.dueTasks): never the stored row. */
const CONTACT_SUMMARY_KEYS = ['displayName', 'email', 'firstName', 'id', 'lastName', 'phone', 'status'];

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the @keyflow/db client is loaded after env
let db: any;
let skipTenantIsolation: <T extends object>(args: T) => T;
let redis: { quit: () => Promise<unknown> } | undefined;

/** Outbound fetch tap: every attempted call is recorded and refused. */
const outbound: string[] = [];
const realFetch = globalThis.fetch;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An HS256 access token in the shape the real-database harnesses mint (no iss). */
function token(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 600, jti: randomUUID() });
  const sig = createHmac('sha256', SIGNING_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function get(url: string, as: As = 'owner', businessId: string = ID.biz) {
  return request(app.getHttpServer())
    .get(url)
    .set('Authorization', `Bearer ${token(AS[as].id, AS[as].email)}`)
    .set('x-business-id', businessId);
}

const skillsUrl = (businessId: string = ID.biz) => `/ai/businesses/${businessId}/ai/settings/skills`;
const tasksUrl = (query: Record<string, string> = {}, businessId: string = ID.biz) => {
  const qs = new URLSearchParams(query).toString();
  return `/crm/businesses/${businessId}/tasks${qs ? `?${qs}` : ''}`;
};

/** A 500's body, kept short, so a failing status names what the server said. */
const said = (res: { status: number; body: unknown; text?: string }) => `${res.status} ${JSON.stringify(res.body).slice(0, 300)}`;

/**
 * Hard-delete every row this suite seeds or its routes create. Raw SQL: Business,
 * Contact and ContactTask are soft-deleted models, so deleteMany would only set
 * deletedAt.
 */
async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM skills WHERE name LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM sessions WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function seed() {
  await db.user.create({ data: { id: ID.owner, email: EMAIL.owner, name: 'Owner', role: 'USER' } });
  await db.user.create({ data: { id: ID.outsider, email: EMAIL.outsider, name: 'Outsider', role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: `${P}business`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}other business`, ownerId: ID.outsider } });
  await db.membership.create(skipTenantIsolation({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } }));
  await db.membership.create(skipTenantIsolation({ data: { id: `${P}m_outsider`, userId: ID.outsider, businessId: ID.bizB, role: 'OWNER' } }));

  const contact = (id: string, businessId: string, firstName: string, ownerId: string) =>
    db.contact.create(skipTenantIsolation({ data: { id, businessId, firstName, lastName: `${P}${firstName}`, ownerId, visibility: 'TEAM' } }));
  await contact(ID.hana, ID.biz, 'Hana', ID.owner);
  await contact(ID.ivan, ID.biz, 'Ivan', ID.owner);
  await contact(ID.other, ID.bizB, 'Olga', ID.outsider);

  const task = (t: typeof OTHER_TASK | (typeof TASK)[keyof typeof TASK], businessId: string) =>
    db.contactTask.create(
      skipTenantIsolation({
        data: {
          id: t.id,
          businessId,
          contactId: t.contactId,
          title: t.title,
          status: t.status,
          dueDate: t.due === null ? null : new Date(t.due),
          createdAt: new Date(t.created),
        },
      }),
    );
  for (const t of Object.values(TASK)) await task(t, ID.biz);
  await task(OTHER_TASK, ID.bizB);

  for (const s of Object.values(SKILL)) await db.skill.create({ data: s });

  // The review-repair business: the same owner, two STAFF members without revenue read.
  await db.user.create({ data: { id: ID.staff, email: EMAIL.staff, name: 'Staff', role: 'USER' } });
  await db.user.create({ data: { id: ID.book, email: EMAIL.book, name: 'Book', role: 'USER' } });
  await db.business.create({ data: { id: ID.bizV, name: `${P}review business`, ownerId: ID.owner } });
  await db.membership.create(skipTenantIsolation({ data: { id: `${P}m_owner_v`, userId: ID.owner, businessId: ID.bizV, role: 'OWNER' } }));
  await db.membership.create(
    skipTenantIsolation({ data: { id: `${P}m_staff_v`, userId: ID.staff, businessId: ID.bizV, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } }),
  );
  await db.membership.create(
    skipTenantIsolation({
      data: { id: `${P}m_book_v`, userId: ID.book, businessId: ID.bizV, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none', crm_view: 'owned' } },
    }),
  );
  for (const c of Object.values(VCONTACT)) {
    await db.contact.create(
      skipTenantIsolation({
        data: {
          id: c.id,
          businessId: ID.bizV,
          firstName: c.firstName,
          lastName: `${P}${c.firstName}`,
          email: vEmail(c),
          phone: '+18685550101',
          ownerId: c.ownerId,
          visibility: c.visibility,
          notesInternal: vNote(c),
          custom: { [`${P}field`]: `${P}custom value of ${c.firstName}` },
          lifetimeValue: c.lifetimeValue,
          averageSpend: V_AVERAGE_SPEND,
          paymentReliability: V_PAYMENT_RELIABILITY,
          leadScore: V_LEAD_SCORE,
          ...(c.deleted ? { deletedAt: new Date(T0 - DAY) } : {}),
        },
      }),
    );
  }
  await db.contactShare.create(skipTenantIsolation({ data: { id: `${P}share_v`, businessId: ID.bizV, contactId: ID.vShared, userId: ID.staff, createdBy: ID.owner } }));
  for (const t of Object.values(VTASK)) await task(t, ID.bizV);
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  // The test-only verifyLocal path: a configured secret, no Supabase URL, NODE_ENV=test.
  process.env.SUPABASE_JWT_SECRET = SIGNING_SECRET;

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('v63f: outbound fetch refused by the test');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  skipTenantIsolation = dbMod.skipTenantIsolation;

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { AiSettingsController } = await import('../src/modules/ai/ai-settings.controller');
  const { AiSettingsService } = await import('../src/modules/ai/ai-settings.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
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

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
  redis = client;

  // The real services over the real client. Collaborators no route here calls are
  // empty stand-ins: a call into one throws. No EffectiveAuthorityResolver is
  // provided, so ModuleScopeGuard's authority shadow (@ShadowEffectiveAuthority on
  // the skills routes) is inert; it only logs and never changes the answer.
  const prisma = new PrismaService();
  const notOnThesePaths = {};
  const events = new EventEmitter2();
  // AiSettingsService names its constructor parameters by type only (no @Inject),
  // which vitest's esbuild transform gives Nest no metadata for: built here. Its
  // authority resolver is on DELETE .../skills/:id only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stand-in for a collaborator off these paths
  const aiSettings = new AiSettingsService(prisma, notOnThesePaths as any);
  // EvidenceService and TaskAssignmentService: task completion and assignee resolution, not the list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-ins for collaborators off these paths
  const crmTimeline = new CrmTimelineService(prisma, events, new TimelineService(prisma), notOnThesePaths as any, notOnThesePaths as any);

  const moduleRef = await Test.createTestingModule({
    controllers: [AiSettingsController, CrmController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      RateLimitGuard,
      CrmRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: client },
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      { provide: AiSettingsService, useValue: aiSettings },
      CrmService,
      { provide: EventEmitter2, useValue: events },
      { provide: CrmTimelineService, useValue: crmTimeline },
      { provide: SubscriptionsService, useValue: notOnThesePaths },
      { provide: CrmStatsService, useValue: notOnThesePaths },
      { provide: CrmListsService, useValue: notOnThesePaths },
      { provide: CrmFlowService, useValue: notOnThesePaths },
      { provide: EntityResolutionService, useValue: notOnThesePaths },
      { provide: ContactAuditService, useValue: notOnThesePaths },
      { provide: ContactCustomFieldValueService, useValue: notOnThesePaths },
      { provide: CrmCacheService, useValue: notOnThesePaths },
      { provide: CrmImportService, useValue: notOnThesePaths },
      { provide: CrmPlaybookService, useValue: notOnThesePaths },
      { provide: CrmActionsService, useValue: notOnThesePaths },
      { provide: CrmRevenueService, useValue: notOnThesePaths },
      { provide: CrmJourneyService, useValue: notOnThesePaths },
      { provide: CrmDuplicateDetectionService, useValue: notOnThesePaths },
      { provide: CrmDataQualityService, useValue: notOnThesePaths },
      { provide: CrmSavedViewsService, useValue: notOnThesePaths },
      { provide: CrmRelationshipHealthService, useValue: notOnThesePaths },
      { provide: CrmCommunicationService, useValue: notOnThesePaths },
      { provide: BestChannelService, useValue: notOnThesePaths },
      { provide: ConversationAiService, useValue: notOnThesePaths },
      { provide: CrmNetworkService, useValue: notOnThesePaths },
      { provide: ContactInsightService, useValue: notOnThesePaths },
    ],
  }).compile();

  // AiSettingsController names its service by type only too (no @Inject): hand it
  // the real service, as team-invite-email-case does for TaskAssignmentController.
  // Its guards are resolved by Nest as usual.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private constructor field
  const aiSettingsController = moduleRef.get(AiSettingsController) as any;
  aiSettingsController.aiSettings ??= aiSettings;

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  await cleanup(); // in case a prior run aborted
  await seed();
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) await cleanup();
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('fixture sanity (real rows)', () => {
  it('seeded the business, its two customers and their tasks, the other business, and the catalogue rows', async () => {
    expect(await db.contactTask.count(skipTenantIsolation({ where: { businessId: ID.biz } }))).toBe(Object.keys(TASK).length);
    expect(await db.contactTask.count(skipTenantIsolation({ where: { businessId: ID.bizB } }))).toBe(1);
    expect(await db.skill.count({ where: { id: { in: Object.values(SKILL).map((s) => s.id) } } })).toBe(3);
  });

  it('seeded the review-repair business: five contacts (one soft-deleted, one shared with the staff member) and one task each', async () => {
    expect(await db.contactTask.count(skipTenantIsolation({ where: { businessId: ID.bizV } }))).toBe(Object.keys(VTASK).length);
    const rows: Array<{ id: string; deleted_at: Date | null }> = await db.$queryRawUnsafe(
      `SELECT id, deleted_at FROM contacts WHERE business_id = '${ID.bizV}' ORDER BY id`,
    );
    expect(rows.map((r) => r.id)).toEqual(Object.values(VCONTACT).map((c) => c.id).sort());
    expect(rows.filter((r) => r.deleted_at !== null).map((r) => r.id)).toEqual([ID.vGone]);
    expect(await db.contactShare.count(skipTenantIsolation({ where: { businessId: ID.bizV, userId: ID.staff } }))).toBe(1);
  });
});

describe('BUG-012: GET .../ai/settings/skills (Settings > AI, Skills tab)', () => {
  it('answers 200 with the skills by category, then by name', async () => {
    const res = await get(skillsUrl());
    expect(res.status, said(res)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ours = (res.body as Array<{ name: string }>).map((s) => s.name).filter((n) => n.startsWith(P));
    expect(ours).toEqual(SKILL_ORDER);
  });

  it("lists every row in the database's own (category, name) order", async () => {
    const res = await get(skillsUrl());
    expect(res.status, said(res)).toBe(200);
    const listed = (res.body as Array<{ id: string }>).map((s) => s.id);
    // Skill is global: another suite may add or remove rows between the two reads,
    // so both sides are compared over the rows present in both.
    const dbOrder: string[] = (await db.$queryRawUnsafe('SELECT id FROM skills ORDER BY category ASC, name ASC')).map((r: { id: string }) => r.id);
    const inDb = new Set(dbOrder);
    const inResponse = new Set(listed);
    expect(listed.filter((id) => inDb.has(id))).toEqual(dbOrder.filter((id) => inResponse.has(id)));
    expect(listed.length).toBeGreaterThanOrEqual(3);
  });

  it('a skill added through POST appears in its place on the next read', async () => {
    const created = await request(app.getHttpServer())
      .post(skillsUrl())
      .set('Authorization', `Bearer ${token(ID.owner, EMAIL.owner)}`)
      .set('x-business-id', ID.biz)
      .send(ADDED_SKILL);
    expect(created.status, said(created)).toBe(201);
    const res = await get(skillsUrl());
    expect(res.status, said(res)).toBe(200);
    const ours = (res.body as Array<{ name: string }>).map((s) => s.name).filter((n) => n.startsWith(P));
    // cat_a: beta, eta, zeta; then cat_b: alpha.
    expect(ours).toEqual([ADDED_SKILL.name, SKILL.eta.name, SKILL.zeta.name, SKILL.alpha.name]);
  });

  it('control: a member of another business is refused (403), before any read', async () => {
    const res = await get(skillsUrl(ID.biz), 'outsider', ID.biz);
    expect(res.status, said(res)).toBe(403);
  });
});

describe("BUG-036: GET .../crm/businesses/:id/tasks (a customer's Tasks tab)", () => {
  const ids = (body: unknown) => (body as Array<{ id: string }>).map((t) => t.id);

  it("?contactId= answers 200 with that customer's tasks by due date: the newer of a tie first, undated last", async () => {
    const res = await get(tasksUrl({ contactId: ID.hana }));
    expect(res.status, said(res)).toBe(200);
    expect(ids(res.body)).toEqual(HANA_ORDER);
    // The fields the web Tasks tab reads (apps/web/src/lib/client.ts taskSchema), the customer included.
    const first = (res.body as Array<Record<string, unknown>>)[0];
    expect(first).toMatchObject({ id: TASK.soonNew.id, contactId: ID.hana, title: TASK.soonNew.title, status: 'OPEN' });
    expect(new Date(first.dueDate as string).getTime()).toBe(TASK.soonNew.due);
    expect((first.contact as { id: string }).id).toBe(ID.hana);
  });

  it('?contactId=&status=OPEN keeps the order and leaves the done task out', async () => {
    const res = await get(tasksUrl({ contactId: ID.hana, status: 'OPEN' }));
    expect(res.status, said(res)).toBe(200);
    expect(ids(res.body)).toEqual(HANA_ORDER.filter((id) => id !== TASK.done.id));
  });

  it("without contactId it lists the business's tasks, every customer's, in the same order (and none of another business)", async () => {
    const res = await get(tasksUrl());
    expect(res.status, said(res)).toBe(200);
    expect(ids(res.body)).toEqual([TASK.ivan.id, ...HANA_ORDER]);
    expect(ids(res.body)).not.toContain(OTHER_TASK.id);
  });

  it('?dueBefore= keeps the order and lists only what is due by then', async () => {
    const res = await get(tasksUrl({ dueBefore: new Date(T0 + 2.5 * DAY).toISOString() }));
    expect(res.status, said(res)).toBe(200);
    expect(ids(res.body)).toEqual([TASK.ivan.id, TASK.soonNew.id, TASK.soonOld.id, TASK.done.id]);
  });

  it("control: another business's customer is 404 (Contact not found), and nothing of theirs is read", async () => {
    const res = await get(tasksUrl({ contactId: ID.other }));
    expect(res.status, said(res)).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(OTHER_TASK.title);
  });

  it('control: a member of another business is refused (403)', async () => {
    const res = await get(tasksUrl({ contactId: ID.hana }), 'outsider', ID.biz);
    expect(res.status, said(res)).toBe(403);
  });
});

describe('SEC-OB-1, OB-COR-1, SEC-OB-2: GET .../tasks is read by the rules its sibling tasks/due applies (D-37, D-63, D-90, D-100)', () => {
  const ids = (body: unknown) => (body as Array<{ id: string }>).map((t) => t.id);
  const vUrl = (query: Record<string, string> = {}) => tasksUrl(query, ID.bizV);
  const contactsOf = (body: unknown) => (body as Array<{ contact?: Record<string, unknown> | null }>).map((t) => t.contact);

  /** Nothing of a contact's stored row beyond the summary is in a response body. */
  function expectNoStoredRow(body: unknown) {
    const text = JSON.stringify(body);
    for (const c of Object.values(VCONTACT)) {
      expect(text).not.toContain(vNote(c));
      expect(text).not.toContain(`custom value of ${c.firstName}`);
      expect(text).not.toContain(String(c.lifetimeValue));
    }
    // Contact-only keys (a ContactTask row has none of these; its own deletedAt is its own).
    for (const key of ['notesInternal', 'custom', 'lifetimeValue', 'averageSpend', 'paymentReliability', 'leadScore', 'visibility', 'ownerId']) {
      expect(text).not.toContain(`"${key}"`);
    }
  }

  describe('controls: the gates the sibling reads already apply (green before and after)', () => {
    it("a STAFF member cannot open the owner's PRIVATE contact: GET contacts/:id/notes is 404", async () => {
      const res = await get(`/crm/businesses/${ID.bizV}/contacts/${ID.vPriv}/notes`, 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(404);
      expect(JSON.stringify(res.body)).toContain('Contact not found');
    });

    it("GET tasks/due omits the PRIVATE contact's task for the STAFF member", async () => {
      const res = await get(`/crm/businesses/${ID.bizV}/tasks/due?windowDays=30`, 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).not.toContain(VTASK.priv.id);
      expect(JSON.stringify(res.body)).not.toContain(VTASK.priv.title);
    });

    it('?contactId= on a soft-deleted contact is 404 for the OWNER', async () => {
      const res = await get(vUrl({ contactId: ID.vGone }), 'owner', ID.bizV);
      expect(res.status, said(res)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(VTASK.gone.title);
    });

    it('?contactId= on a PRIVATE contact shared with the STAFF member answers 200 with its task', async () => {
      const res = await get(vUrl({ contactId: ID.vShared }), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.shared.id]);
    });
  });

  describe('?contactId=: a contact the member cannot open is 404, as GET contacts/:id/notes answers', () => {
    it("a STAFF member (crm read, revenue 'none'): the owner's PRIVATE contact is 404 and nothing of it is served", async () => {
      const res = await get(vUrl({ contactId: ID.vPriv }), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(404);
      expect(JSON.stringify(res.body)).toContain('Contact not found');
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(VTASK.priv.title);
      expect(text).not.toContain(vEmail(VCONTACT.priv));
      expect(text).not.toContain(String(VCONTACT.priv.lifetimeValue));
    });

    it("a member limited to their own book (crm_view 'owned'): another member's TEAM contact is 404", async () => {
      const res = await get(vUrl({ contactId: ID.vTeam }), 'book', ID.bizV);
      expect(res.status, said(res)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(VTASK.team.title);
    });

    it("a member limited to their own book: the owner's PRIVATE contact is 404 too", async () => {
      const res = await get(vUrl({ contactId: ID.vPriv }), 'book', ID.bizV);
      expect(res.status, said(res)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(VTASK.priv.title);
    });

    it('a member limited to their own book: their own contact answers 200 with its task, the contact as a summary', async () => {
      const res = await get(vUrl({ contactId: ID.vBook }), 'book', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.book.id]);
      expect(Object.keys(contactsOf(res.body)[0] ?? {}).sort()).toEqual(CONTACT_SUMMARY_KEYS);
      expectNoStoredRow(res.body);
    });
  });

  describe("without contactId: only the tasks of contacts the member may open, a soft-deleted contact's for nobody", () => {
    it('the STAFF member: the TEAM contacts and the PRIVATE contact shared with them, by due date; not the unshared PRIVATE one', async () => {
      const res = await get(vUrl(), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.book.id, VTASK.team.id, VTASK.shared.id]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(VTASK.priv.title);
      expect(text).not.toContain(vEmail(VCONTACT.priv));
      expect(text).not.toContain(VTASK.gone.title);
    });

    it('the member limited to their own book: only their own contact', async () => {
      const res = await get(vUrl(), 'book', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.book.id]);
    });

    it("the STAFF member with ?status=OPEN&dueBefore=: the same rule (no PRIVATE or deleted contact's task)", async () => {
      const res = await get(vUrl({ status: 'OPEN', dueBefore: new Date(T0 + 2.5 * DAY).toISOString() }), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.book.id]);
    });

    it("the OWNER: every live contact's task, the PRIVATE one included; the soft-deleted contact's task is not listed (SEC-OB-2)", async () => {
      const res = await get(vUrl(), 'owner', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.book.id, VTASK.priv.id, VTASK.team.id, VTASK.shared.id]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(VTASK.gone.title);
      expect(text).not.toContain(vEmail(VCONTACT.gone));
    });
  });

  describe('every task carries the contact summary, never the stored row (money withheld, D-63, D-90, D-100)', () => {
    it("the STAFF member (revenue 'none'): no notesInternal, custom fields, lifetimeValue, averageSpend, paymentReliability or leadScore", async () => {
      const res = await get(vUrl(), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      const contacts = contactsOf(res.body);
      expect(contacts.length).toBe(3);
      for (const contact of contacts) expect(Object.keys(contact ?? {}).sort()).toEqual(CONTACT_SUMMARY_KEYS);
      expectNoStoredRow(res.body);
      // The summary is the contact the Tasks tab names.
      const team = (res.body as Array<{ id: string; contact: Record<string, unknown> }>).find((t) => t.id === VTASK.team.id);
      expect(team?.contact).toMatchObject({ id: ID.vTeam, firstName: 'Tomas', email: vEmail(VCONTACT.team) });
    });

    it('the STAFF member with ?contactId=: the same summary', async () => {
      const res = await get(vUrl({ contactId: ID.vTeam }), 'staff', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      expect(ids(res.body)).toEqual([VTASK.team.id]);
      expect(Object.keys(contactsOf(res.body)[0] ?? {}).sort()).toEqual(CONTACT_SUMMARY_KEYS);
      expectNoStoredRow(res.body);
    });

    it('the OWNER: the same summary, as tasks/due serves it', async () => {
      const res = await get(vUrl(), 'owner', ID.bizV);
      expect(res.status, said(res)).toBe(200);
      for (const contact of contactsOf(res.body)) expect(Object.keys(contact ?? {}).sort()).toEqual(CONTACT_SUMMARY_KEYS);
      expectNoStoredRow(res.body);
    });
  });
});

describe('no provider traffic', () => {
  it('global fetch was never called', () => {
    expect(outbound).toEqual([]);
  });
});
