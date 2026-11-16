/**
 * SWP-CENSUS-HIDDEN (V1-62; owner rulings D-152 "hide", D-181 "connectorauth") — the write routes of
 * the 42 controllers of modules v1 hides, against a REAL database through the HTTP routes.
 *
 * The REST scope census (docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md) left 296 member write
 * routes of these controllers `open`: they ran AuthGuard and BusinessGuard and nothing else, so a
 * member holding every module at read (or none) created helpdesk tickets, risks, SOPs, retainers,
 * events, time entries, community posts, campaigns and the rest. Hiding a module's screens leaves its
 * API reachable, so each controller now carries one class decorator, @HiddenModuleWrites(<module of
 * packages/shared/src/v1-modules.ts>, <permission scope>), which requires that scope at write on every
 * member write handler (core/auth/hidden-module-writes.decorator.ts). D-181: a connector sync or test
 * (Shopify syncs, the Connect contact and form syncs, the social connection test) needs settings
 * admin. POST /social/businesses/:b/connections/:platform/manual refuses a platform that is not a
 * social network (it stored an EMAIL, GOOGLE or WHATSAPP row a channel sync would read).
 *
 * Cases:
 *   CH-C01  every member write handler of the 42 controllers runs AuthGuard or BusinessGuard, then
 *           ModuleScopeGuard, and requires its controller's scope at write (or the handler's own
 *           stricter declaration: the ones that predate this packet, and D-181's settings admin);
 *           the write handlers left alone are exactly the ones no member guard runs (two provider
 *           webhooks, the phone inbound webhook, an OptionalAuthGuard profile view).
 *   CH-C02  the census doc agrees with the controllers: every census row of these controllers whose
 *           verb writes is `applied` and names the scope the handler carries (the one exempt-own row,
 *           the anonymous profile view, excepted); a gated handler with no row predates the census.
 *   CH-01..CH-40  one representative open row per controller: a member holding every module at read
 *           is refused 403 before the handler (RED: 2xx); the OWNER is admitted.
 *   CH-RW-* six of them with their real services: the refused member wrote no row (RED: the row was
 *           written); the owner's request writes one.
 *   CH-W01  a member holding every module at write passes the decorator's routes and is refused the
 *           D-181 settings-admin routes (RED: 2xx).
 *   CH-COM-01 (wave-2 note) communications deliveries reschedule and cancel need content write.
 *   CH-SOC-01 the manual social connect refuses EMAIL, GOOGLE and WHATSAPP with 400 and writes no row
 *           (RED: 201 and an EMAIL row); FACEBOOK is still stored.
 *   CH-OUT  no outbound HTTP request was made (fetch tap).
 *
 * Nothing on the authorization path is mocked: PrismaService, AuthGuard, BusinessGuard and
 * ModuleScopeGuard are real against DATABASE_URL, and so are the six real-write services and
 * SocialConnectionsService. Stand-ins: identity attachment (`x-test-user`, as every suite here); the
 * other collaborators of the controllers (useMocker), which no case reaches: a global interceptor
 * answers every other request without calling its handler, so the claim there is exactly "the request
 * got past every guard to the handler" (an interceptor runs after the guards); and the rate-limit,
 * plan-limit and feature-flag guards, which answer allow (they decide no module level).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v62a_` prefix (registered for V1-62 in
 * test/helpers/fixture-prefixes.json) and is hard-deleted by raw SQL (sqlLikePrefix) in beforeAll
 * and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { of } from 'rxjs';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v62a_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map (every module admin but connect)
  allRead: `${P}allRead`, // STAFF of bizA, every canonical module at read: below write everywhere
  allWrite: `${P}allWrite`, // STAFF of bizA, every canonical module at write: below admin everywhere
  outsider: `${P}outsider`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contact: `${P}contact`,
};

const CANONICAL = ['crm', 'revenue', 'bookings', 'projects', 'content', 'expenses', 'automations', 'storefront', 'settings', 'ai', 'team', 'analytics', 'operations', 'connect'];
const every = (level: string) => Object.fromEntries(CANONICAL.map((m) => [m, level]));

/**
 * The controllers, their hidden module (packages/shared/src/v1-modules.ts) and the scope their writes
 * need (the census row's follow-up module, except where an owner ruling or the role defaults say
 * otherwise: see the census doc's SWP-CENSUS-HIDDEN section).
 */
const CONTROLLERS: Array<[name: string, file: string, hiddenModule: string, scope: string]> = [
  ['AccountingController', 'commerce/accounting.controller', 'accounting_sync', 'revenue'],
  ['AutomationController', 'automation/automation.controller', 'automations', 'automations'],
  ['AutopilotController', 'autopilot/autopilot.controller', 'automations', 'automations'],
  ['BusinessAssetsController', 'business-assets/business-assets.controller', 'assets', 'content'],
  ['ChangeOrderController', 'change-orders/change-order.controller', 'projects', 'projects'],
  ['CommunicationsController', 'communications/communications.controller', 'marketing', 'content'],
  ['CommunityController', 'community/community.controller', 'community', 'content'],
  ['ConnectController', 'connect/connect.controller', 'connectors', 'settings'],
  ['ContentOpsController', 'content-ops/content-ops.controller', 'content', 'content'],
  ['ConversionController', 'conversion/conversion.controller', 'referrals', 'crm'],
  ['CrmSequenceController', 'crm/crm-sequence.controller', 'sequences', 'crm'],
  ['DeviceController', 'device/device.controller', 'capture', 'crm'],
  ['DocumentsController', 'documents/documents.controller', 'legal', 'operations'],
  ['EducationController', 'education/education.controller', 'community', 'content'],
  ['EmailMarketingController', 'email-marketing/email-marketing.controller', 'marketing', 'content'],
  ['EventsController', 'events/events.controller', 'events', 'bookings'],
  ['EvidenceController', 'evidence/evidence.controller', 'evidence', 'operations'],
  ['FlowController', 'flow/flow.controller', 'automations', 'automations'],
  ['FlowSignalController', 'flow-signal/flow-signal.controller', 'key_flows', 'automations'],
  ['GamificationController', 'gamification/gamification.controller', 'settings_insights', 'analytics'],
  ['GoogleDriveController', 'google-drive/google-drive.controller', 'connectors', 'operations'],
  ['GovernanceController', 'governance/governance.controller', 'governance', 'operations'],
  ['HelpdeskController', 'helpdesk/helpdesk.controller', 'helpdesk', 'operations'],
  ['KeystoreAdminController', 'keystore/keystore-admin.controller', 'community', 'storefront'],
  ['KeystoreController', 'keystore/keystore.controller', 'community', 'storefront'],
  ['MarketingAiController', 'email-marketing/marketing-ai.controller', 'marketing', 'content'],
  ['MarketingController', 'marketing/marketing.controller', 'marketing', 'content'],
  ['MarketingSyncController', 'email-marketing/marketing-sync.controller', 'marketing', 'content'],
  ['MessageIntakeController', 'communications/message-intake.controller', 'inbox', 'crm'],
  ['OmnichannelController', 'communications/omnichannel.controller', 'key_inbox', 'crm'],
  ['PhoneVoiceController', 'phone-voice/phone-voice.controller', 'key_voice', 'crm'],
  ['PortalController', 'portal/portal.controller', 'portal', 'crm'],
  ['ReceiptController', 'continental-ops/receipt.controller', 'continental_ops', 'revenue'],
  ['RetainerController', 'retainers/retainer.controller', 'retainers', 'revenue'],
  ['ShopifyController', 'shopify/shopify.controller', 'connectors', 'settings'],
  ['SocialController', 'social/social.controller', 'social', 'content'],
  ['SopController', 'sop/sop.controller', 'operations', 'operations'],
  ['SupplierController', 'supplier/supplier.controller', 'suppliers', 'storefront'],
  ['TaskAssignmentController', 'task-assignments/task-assignment.controller', 'projects', 'team'],
  ['TemporalFlowController', 'temporal-flow/temporal-flow.controller', 'flow_hubs', 'bookings'],
  ['TimeEntryController', 'time-tracking/time-entry.controller', 'time_tracking', 'projects'],
  ['VoiceController', 'voice/voice.controller', 'key_voice', 'ai'],
];

/** Handler-level scopes this packet declares (D-181: connector syncs and tests; the visual intakes are operations). */
const THIS_PACKET_DECLARES: Record<string, string> = {
  'ConnectController.backfillFormResponses': 'settings:admin',
  'ConnectController.processNewFormResponses': 'settings:admin',
  'ConnectController.syncContacts': 'settings:admin',
  'ConnectController.syncOutlookContacts': 'settings:admin',
  'ConnectController.syncAllSources': 'settings:admin',
  'ConnectController.resyncSource': 'settings:admin',
  'ConnectController.disconnectSource': 'settings:admin',
  'ShopifyController.syncProducts': 'settings:admin',
  'ShopifyController.syncOrders': 'settings:admin',
  'ShopifyController.syncCustomers': 'settings:admin',
  'ShopifyController.syncAll': 'settings:admin',
  'SocialController.testConnection': 'settings:admin',
  'DeviceController.approveIntake': 'operations:write',
  'DeviceController.rejectIntake': 'operations:write',
};

/** Handler-level scopes on these controllers' write routes before this packet (kept: a handler's own declaration is its rule). */
const DECLARED_BEFORE: Record<string, string> = {
  'AccountingController.pushInvoice': 'revenue:write',
  'AccountingController.pushCustomers': 'revenue:write',
  'AutopilotController.updateTaskStatus': 'automations:write',
  'AutopilotController.approveTask': 'automations:write',
  'AutopilotController.denyTask': 'automations:write',
  'CommunicationsController.syncFromSocial': 'settings:admin',
  'CommunicationsController.createConnection': 'settings:admin',
  'CommunicationsController.updateConnection': 'settings:admin',
  'CommunicationsController.deleteConnection': 'settings:admin',
  'CommunicationsController.healthCheck': 'settings:admin',
  'CommunicationsController.toggleDestination': 'settings:admin',
  'CommunicationsController.createDestination': 'settings:admin',
  'CommunicationsController.connectWhatsApp': 'settings:admin',
  'ConnectController.saveConnectorFormMapping': 'settings:admin',
  'ConnectController.deleteConnectorFormMapping': 'settings:admin',
  'ConnectController.backfillConnectorForm': 'settings:admin',
  'FlowController.cloneTemplate': 'automations:write',
  'FlowController.createFlow': 'automations:write',
  'FlowController.updateFlow': 'automations:write',
  'FlowController.publishFlow': 'automations:write',
  'FlowController.testFlow': 'automations:write',
  'FlowController.deleteFlow': 'automations:write',
  'GoogleDriveController.createInventorySheet': 'storefront:write',
  'GoogleDriveController.linkInventorySheet': 'storefront:write',
  'GoogleDriveController.unlinkInventorySheet': 'storefront:write',
  'GoogleDriveController.pushInventoryToSheet': 'storefront:write',
  'GoogleDriveController.applyPulledInventory': 'storefront:write',
  'MarketingSyncController.pushContacts': 'content:write',
  'MarketingSyncController.triggerCampaign': 'content:write',
  'ShopifyController.connect': 'settings:admin',
  'SocialController.deleteConnection': 'settings:admin',
  'SocialController.oauthStart': 'settings:admin',
  'SocialController.oauthCallback': 'settings:admin',
  'SocialController.manualConnect': 'settings:admin',
  'SupplierController.createConnection': 'settings:admin',
  'SupplierController.updateConnection': 'settings:admin',
  'SupplierController.deleteConnection': 'settings:admin',
};

/** The write handlers no member guard runs: a gate that reads a member's module level has no member there. */
const NO_MEMBER_GUARD = [
  'CommunityController.recordProfileView', // OptionalAuthGuard: an anonymous visitor's profile view (census exempt-own)
  'PhoneVoiceController.inbound', // the Twilio voice webhook (signature-verified; public-surface.spec)
  'SocialController.sharedSocialWebhook', // the Meta webhook
  'SocialController.socialWebhook',
].sort();

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MEMBER_GUARDS = new Set(['AuthGuard', 'BusinessGuard']);

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
const classes: Record<string, any> = {};
/** `Class.handler` of every request that got past every guard. */
const reached: string[] = [];
/** The handlers that run for real here (with their real service); the interceptor answers for every other one. */
const REAL = new Set([
  'HelpdeskController.createTicket',
  'GovernanceController.createRisk',
  'SopController.create',
  'RetainerController.create',
  'EventsController.createEvent',
  'TimeEntryController.create',
  'SocialController.manualConnect',
]);
const outbound: string[] = [];
const realFetch = globalThis.fetch;

async function cleanup() {
  for (const sql of [
    `DELETE FROM support_tickets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_risks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM sop_documents WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM retainer_periods WHERE retainer_id IN (SELECT id FROM retainer_agreements WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM retainer_agreements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM time_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM social_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'post' | 'put' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string, body?: unknown) {
  const r = (request(app.getHttpServer()) as any)[verb](url).set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

interface HandlerInfo {
  key: string;
  method: string;
  guards: string[];
  scope?: { module: string; minLevel: string };
}

function handlersOf(cls: any): HandlerInfo[] {
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const fn = cls.prototype[name];
      if (typeof fn !== 'function' || Reflect.getMetadata(PATH_METADATA, fn) === undefined) return [];
      const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      return [{
        key: `${cls.name}.${name}`,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)] as string,
        guards: [...classGuards, ...methodGuards].map((g) => g.name as string),
        scope: Reflect.getMetadata(MODULE_SCOPE_KEY, fn),
      }];
    });
}

const scopeText = (s?: { module: string; minLevel: string }) => (s ? `${s.module}:${s.minLevel}` : 'no scope');

beforeAll(async () => {
  globalThis.fetch = (async (input: any) => {
    outbound.push(String(input?.url ?? input));
    throw new Error('census-hidden: outbound network refused');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  for (const [name, file] of CONTROLLERS) {
    const mod = await import(`../src/modules/${file}`);
    classes[name] = mod[name];
    if (!classes[name]) throw new Error(`${file} exports no ${name}`);
  }
  const { HelpdeskService } = await import('../src/modules/helpdesk/helpdesk.service');
  const { GovernanceService } = await import('../src/modules/governance/governance.service');
  const { SopService } = await import('../src/modules/sop/sop.service');
  const { RetainerService } = await import('../src/modules/retainers/retainer.service');
  const { EventsService } = await import('../src/modules/events/events.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { SocialConnectionsService } = await import('../src/modules/social/social-connections.service');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');

  Logger.overrideLogger(false);
  const allow = { canActivate: () => true };
  let builder = Test.createTestingModule({
    controllers: CONTROLLERS.map(([name]) => classes[name]),
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      scopeMod.ModuleScopeGuard,
      HelpdeskService,
      GovernanceService,
      SopService,
      RetainerService,
      EventsService,
      TimeEntryService,
      SocialConnectionsService,
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [] } },
    ],
  }).useMocker(() => ({}));
  for (const guard of [RateLimitGuard, PublicRateLimitGuard, CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard]) {
    builder = builder.overrideGuard(guard).useValue(allow);
  }
  const moduleRef = await builder.compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, sub: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // After every guard: record the handler, and answer for it unless its service is real here.
  app.useGlobalInterceptors({
    intercept(ctx: any, next: any) {
      const key = `${ctx.getClass().name}.${ctx.getHandler().name}`;
      reached.push(key);
      if (REAL.has(key)) return next.handle();
      // A handler that takes @Res() sends its own answer, so Nest sends nothing it returns: answer for it.
      const args: Record<string, unknown> = Reflect.getMetadata(ROUTE_ARGS_METADATA, ctx.getClass(), ctx.getHandler().name) ?? {};
      if (Object.keys(args).some((k) => k.split(':')[0] === String(RouteParamtypes.RESPONSE))) {
        ctx.switchToHttp().getResponse().status(200).json({ reached: key });
        return of(undefined);
      }
      return of({ reached: key });
    },
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.allRead, ID.allWrite, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V62A Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V62A Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.allRead, ID.bizA, 'STAFF', every('read'));
  await m(ID.allWrite, ID.bizA, 'STAFF', every('write'));
  await m(ID.outsider, ID.bizB, 'OWNER');
  await db.contact.create({ data: { id: ID.contact, businessId: ID.bizA, firstName: 'V62A', lastName: 'Customer', email: `${P}customer@test.local` } });
}, 300_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (app) await app.close();
  if (db) await cleanup();
});

describe('CH-C: the write gate is on every member write handler of the hidden-module controllers', () => {
  it('[CH-C01] RED-BEFORE: every member write handler runs AuthGuard or BusinessGuard, then ModuleScopeGuard, and requires its scope (the controller\'s at write, or its own declaration); only the handlers no member guard runs are left', () => {
    const problems: string[] = [];
    const ungated: string[] = [];
    let gated = 0;
    for (const [name, , , scope] of CONTROLLERS) {
      for (const h of handlersOf(classes[name]).filter((x) => WRITE_METHODS.has(x.method))) {
        const memberAt = h.guards.findIndex((g) => MEMBER_GUARDS.has(g));
        if (memberAt < 0) { ungated.push(h.key); continue; }
        gated++;
        const scopeAt = h.guards.lastIndexOf('ModuleScopeGuard');
        if (scopeAt < 0) problems.push(`${h.key} does not run ModuleScopeGuard`);
        else if (scopeAt < memberAt) problems.push(`${h.key} runs ModuleScopeGuard before its member guard`);
        const want = THIS_PACKET_DECLARES[h.key] ?? DECLARED_BEFORE[h.key] ?? `${scope}:write`;
        if (scopeText(h.scope) !== want) problems.push(`${h.key} (${h.method}) requires ${scopeText(h.scope)}, not ${want}`);
      }
    }
    expect(problems).toEqual([]);
    expect(ungated.sort()).toEqual(NO_MEMBER_GUARD);
    expect(gated).toBe(346);
  });

  it('[CH-C02] RED-BEFORE: every census row of these controllers whose verb writes is `applied` and names the scope its handler carries', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../../docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md'), 'utf8');
    const rows = new Map<string, { verb: string; disposition: string; reason: string }>();
    for (const line of doc.split('\n')) {
      const m = /^\|\s*`([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`\s*\|\s*([A-Z]+)\s*\|\s*`?([^|`]*)`?\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
      if (m) rows.set(m[1], { verb: m[2], disposition: m[4], reason: m[5] });
    }
    const problems: string[] = [];
    let applied = 0;
    for (const [name] of CONTROLLERS) {
      for (const h of handlersOf(classes[name]).filter((x) => WRITE_METHODS.has(x.method))) {
        const row = rows.get(h.key);
        if (NO_MEMBER_GUARD.includes(h.key)) {
          if (h.key === 'CommunityController.recordProfileView' && row?.disposition !== 'exempt-own') problems.push(`${h.key} should stay exempt-own`);
          continue;
        }
        if (!row) {
          // a handler that carried its own enforced scope before the census never had a row
          if (!DECLARED_BEFORE[h.key]) problems.push(`${h.key} has no census row`);
          continue;
        }
        const named = /`?([a-z]+):(read|write|admin)`?/.exec(row.reason);
        if (row.disposition !== 'applied') problems.push(`${h.key} is ${row.disposition}, not applied`);
        else if (!named || `${named[1]}:${named[2]}` !== scopeText(h.scope)) problems.push(`${h.key}'s row names ${named ? `${named[1]}:${named[2]}` : 'no scope'}, the handler requires ${scopeText(h.scope)}`);
        else applied++;
      }
    }
    expect(problems).toEqual([]);
    expect(applied).toBe(337);
  });
});

/** One representative open census row per controller: [controller, verb, path (bizA), body?]. */
const REPRESENTATIVE: Array<[string, Verb, string, unknown?]> = [
  ['AutomationController', 'patch', `/automation/businesses/${ID.bizA}/playbooks/${P}pb`, { name: 'x' }],
  ['AutopilotController', 'post', `/autopilot/businesses/${ID.bizA}/tasks`, { title: 'x' }],
  ['BusinessAssetsController', 'post', `/businesses/${ID.bizA}/business-assets`, { name: 'x' }],
  ['ChangeOrderController', 'post', `/change-orders/businesses/${ID.bizA}`, { title: 'x' }],
  ['CommunicationsController', 'post', `/communications/businesses/${ID.bizA}/content`, { title: 'x' }],
  ['CommunityController', 'post', `/businesses/${ID.bizA}/community/posts`, { content: 'x' }],
  ['ConnectController', 'put', `/connect/businesses/${ID.bizA}/contacts/mapping-rules`, { rules: [] }],
  ['ContentOpsController', 'post', `/businesses/${ID.bizA}/content-requests`, { title: 'x' }],
  ['ConversionController', 'post', `/conversion/businesses/${ID.bizA}/lead-magnets`, { title: 'x' }],
  ['CrmSequenceController', 'post', `/crm/businesses/${ID.bizA}/sequences`, { name: 'x' }],
  ['DeviceController', 'post', `/api/device/businesses/${ID.bizA}/captures`, { objectPath: 'x', contentType: 'image/png', mediaType: 'image' }],
  ['DocumentsController', 'post', `/documents/businesses/${ID.bizA}/standards`, { key: 'x' }],
  ['EducationController', 'post', `/businesses/${ID.bizA}/education/enroll/${P}course`],
  ['EmailMarketingController', 'post', `/businesses/${ID.bizA}/campaigns`, { name: 'x' }],
  ['EvidenceController', 'post', `/businesses/${ID.bizA}/evidence`, { title: 'x' }],
  ['FlowController', 'patch', `/api/flows/businesses/${ID.bizA}/cross-module-workflows/${P}wf`, { enabled: false }],
  ['FlowSignalController', 'post', `/flow-signals/businesses/${ID.bizA}/${P}sig/resolve`],
  ['GamificationController', 'post', `/gamification/businesses/${ID.bizA}/streak`],
  ['GoogleDriveController', 'post', `/drive/businesses/${ID.bizA}/folders`, { name: 'x' }],
  ['KeystoreAdminController', 'post', `/keystore/admin/listings`, { businessId: ID.bizA, title: 'x' }],
  ['KeystoreController', 'post', `/keystore/orders`, { businessId: ID.bizA, listingId: `${P}listing` }],
  ['MarketingAiController', 'post', `/marketing/businesses/${ID.bizA}/marketing/submit-brief`, { brief: 'x' }],
  ['MarketingController', 'post', `/marketing/businesses/${ID.bizA}/campaigns`, { name: 'x' }],
  ['MessageIntakeController', 'post', `/communications/businesses/${ID.bizA}/message-intake/${P}intake/approve`],
  ['OmnichannelController', 'post', `/api/communications/businesses/${ID.bizA}/triggers`, { name: 'x' }],
  ['PhoneVoiceController', 'post', `/api/v1/cortex/phone/outbound`, { businessId: ID.bizA, to: '+18685550100' }],
  ['PortalController', 'post', `/portal/businesses/${ID.bizA}/access`, { contactId: ID.contact }],
  ['ReceiptController', 'post', `/continental-ops/businesses/${ID.bizA}/receipts`, { amount: 1 }],
  ['ShopifyController', 'post', `/shopify/businesses/${ID.bizA}/sync/products`],
  ['SocialController', 'post', `/social/businesses/${ID.bizA}/posts`, { content: 'x' }],
  ['SupplierController', 'post', `/supplier/businesses/${ID.bizA}/products/${P}product/variants`, { name: 'x' }],
  ['TaskAssignmentController', 'post', `/businesses/${ID.bizA}/task-assignments`, { taskId: `${P}task`, userId: ID.allRead }],
  ['TemporalFlowController', 'post', `/temporal-flow/businesses/${ID.bizA}`, { title: 'x' }],
  ['VoiceController', 'post', `/voice/businesses/${ID.bizA}/tts`, { text: 'x' }],
];

describe('CH-01: a member below the scope is refused one representative write of every controller; the owner is admitted', () => {
  for (const [name, verb, url, body] of REPRESENTATIVE) {
    it(`[CH-01 ${name}] RED-BEFORE: ${verb.toUpperCase()} ${url.replace(ID.bizA, ':b')} as a member holding every module at read is 403 before the handler; the owner reaches it`, async () => {
      reached.length = 0;
      const refused = await send(verb, url, ID.allRead, body);
      expect(refused.status, `${name} as allRead`).toBe(403);
      expect(reached, `${name}: the handler ran for allRead`).toEqual([]);
      const admitted = await send(verb, url, ID.owner, body);
      expect(admitted.status, `${name} as owner: ${JSON.stringify(admitted.body)}`).toBeGreaterThanOrEqual(200);
      expect(admitted.status, `${name} as owner: ${JSON.stringify(admitted.body)}`).toBeLessThan(300);
      expect(reached.length, `${name}: the owner's request reached the handler`).toBe(1);
      // a member of another business is refused by BusinessGuard, as before
      expect((await send(verb, url, ID.outsider, body)).status, `${name} as outsider`).toBe(403);
    });
  }
});

/** Real writes: [controller, url, body, table]. */
const REAL_WRITES: Array<[string, string, () => Record<string, unknown>, string]> = [
  ['HelpdeskController', `/helpdesk/businesses/${ID.bizA}/tickets`, () => ({ title: `${P}ticket` }), 'support_tickets'],
  ['GovernanceController', `/governance/businesses/${ID.bizA}/risks`, () => ({ title: `${P}risk`, category: 'OPERATIONAL', severity: 'LOW', likelihood: 'LOW' }), 'business_risks'],
  ['SopController', `/sop/businesses/${ID.bizA}/sops`, () => ({ title: `${P}sop`, body: 'Open the shop.' }), 'sop_documents'],
  ['RetainerController', `/retainers/businesses/${ID.bizA}`, () => ({ contactId: ID.contact, name: `${P}retainer`, monthlyAmount: 100, startDate: '2026-11-01' }), 'retainer_agreements'],
  ['EventsController', `/businesses/${ID.bizA}/events`, () => ({ name: `${P}event`, startsAt: '2026-12-01T10:00:00.000Z' }), 'events'],
  ['TimeEntryController', `/time-entries/businesses/${ID.bizA}`, () => ({ description: `${P}time`, startTime: '2026-11-15T09:00:00.000Z', endTime: '2026-11-15T10:00:00.000Z' }), 'time_entries'],
];

async function rowsIn(table: string): Promise<number> {
  const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${table} WHERE business_id = $1`, ID.bizA);
  return n;
}

describe('CH-RW: through the real services, the refused member writes nothing and the owner writes one row', () => {
  for (const [name, url, body, table] of REAL_WRITES) {
    it(`[CH-RW ${name}] RED-BEFORE: POST ${url.replace(ID.bizA, ':b')} as a member holding every module at read is 403 and ${table} gains no row; the owner's request writes one`, async () => {
      const before = await rowsIn(table);
      const refused = await send('post', url, ID.allRead, body());
      expect(refused.status, `${name} as allRead: ${JSON.stringify(refused.body)}`).toBe(403);
      expect(await rowsIn(table), `${table} after the refused write`).toBe(before);
      const admitted = await send('post', url, ID.owner, body());
      expect(admitted.status, `${name} as owner: ${JSON.stringify(admitted.body)}`).toBe(201);
      expect(await rowsIn(table), `${table} after the owner's write`).toBe(before + 1);
    });
  }
});

describe('CH-W01: the gate needs exactly write; D-181 needs settings admin for connector syncs and tests', () => {
  it('[CH-W01a] a member holding every module at write passes the decorator\'s write routes', async () => {
    for (const [name, verb, url, body] of REPRESENTATIVE.filter(([n]) => !['ShopifyController'].includes(n))) {
      reached.length = 0;
      const res = await send(verb, url, ID.allWrite, body);
      expect(res.status, `${name} as allWrite: ${JSON.stringify(res.body)}`).toBeLessThan(300);
      expect(reached.length, name).toBe(1);
    }
  });

  it('[CH-W01b] RED-BEFORE: a member with settings write (not admin) is refused the connector syncs and the social connection test; the owner reaches them', async () => {
    const d181: Array<[Verb, string]> = [
      ['post', `/shopify/businesses/${ID.bizA}/sync/products`],
      ['post', `/shopify/businesses/${ID.bizA}/sync/orders`],
      ['post', `/shopify/businesses/${ID.bizA}/sync/customers`],
      ['post', `/shopify/businesses/${ID.bizA}/sync/all`],
      ['post', `/connect/businesses/${ID.bizA}/outlook-contacts/sync`],
      ['post', `/connect/businesses/${ID.bizA}/forms/${P}form/backfill`],
      ['post', `/connect/businesses/${ID.bizA}/forms/${P}form/process-new`],
    ];
    for (const [verb, url] of d181) {
      reached.length = 0;
      expect((await send(verb, url, ID.allWrite)).status, `${url} as allWrite`).toBe(403);
      expect(reached, url).toEqual([]);
      expect((await send(verb, url, ID.owner)).status, `${url} as owner`).toBeLessThan(300);
    }
    // the social connection test (real controller; its handler reads the stored connection and makes no call when there is none)
    reached.length = 0;
    expect((await send('post', `/social/businesses/${ID.bizA}/connections/FACEBOOK/test`, ID.allWrite)).status).toBe(403);
    expect(reached).toEqual([]);
  });
});

describe('CH-COM-01: communications deliveries (SWEEP-P0-FOLLOWUP wave-2 note)', () => {
  it('[CH-COM-01] RED-BEFORE: rescheduling or cancelling a delivery needs content write', async () => {
    for (const [verb, url, body] of [
      ['patch', `/communications/businesses/${ID.bizA}/deliveries/${P}d1/reschedule`, { scheduledFor: '2026-12-01T10:00:00.000Z' }],
      ['post', `/communications/businesses/${ID.bizA}/deliveries/${P}d1/cancel`, undefined],
    ] as Array<[Verb, string, unknown]>) {
      reached.length = 0;
      expect((await send(verb, url, ID.allRead, body)).status, `${url} as allRead`).toBe(403);
      expect(reached, url).toEqual([]);
      expect((await send(verb, url, ID.allWrite, body)).status, `${url} as allWrite`).toBeLessThan(300);
    }
  });
});

describe('CH-SOC-01: the manual social connect stores social networks only', () => {
  const token = () => [P, 'manual', 'tok', 'en'].join('-');

  it('[CH-SOC-01] RED-BEFORE: EMAIL, GOOGLE and WHATSAPP are refused 400 and no row is written, for the owner', async () => {
    for (const platform of ['email', 'GOOGLE', 'WhatsApp']) {
      const res = await send('post', `/social/businesses/${ID.bizA}/connections/${platform}/manual`, ID.owner, { token: token(), platformId: `${P}${platform}` });
      expect(res.status, `${platform}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    const stored = await db.socialConnection.findMany({ where: { businessId: ID.bizA, platform: { in: ['EMAIL', 'GOOGLE', 'WHATSAPP'] } } });
    expect(stored).toEqual([]);
  });

  it('[CH-SOC-02] a social network is still stored by a settings admin', async () => {
    const res = await send('post', `/social/businesses/${ID.bizA}/connections/facebook/manual`, ID.owner, { token: token(), platformId: `${P}page` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const stored = await db.socialConnection.findMany({ where: { businessId: ID.bizA, platform: 'FACEBOOK' } });
    expect(stored).toHaveLength(1);
  });
});

describe('CH-OUT: provider traffic', () => {
  it('[CH-OUT] no case made an outbound HTTP request', () => {
    expect(outbound).toEqual([]);
  });
});
