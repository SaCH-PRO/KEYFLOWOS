/**
 * V1-21b review 9 — the WhatsApp/SMS staff bridge and the KEY dispatcher, on a REAL database.
 *
 * The bridge answers a staff position by its phone and runs the KEY dispatcher inside a provider
 * webhook, with no tenant context (TenantInterceptor arms one only for an authenticated user), so
 * nothing but the code in the path binds a row to the business KEY acts in. Each case below is a
 * finding of the review, written from its repro (RED at d64cc3e5):
 *
 *   WB-1 / FB-3  a reply 'YES' resolved a pending approval by the position's JobRole tier alone:
 *                a holder HTTP refuses (narrowed to tier 0, banned, or a member of another
 *                business only) approved a tier-3 item by WhatsApp. K2: KEY may not let a holder
 *                do what HTTP refuses them.
 *   FB-2         the phone-member cap matched User.phone and the position phone only when every
 *                digit agreed, so a national spelling ('868-555-0122') did not cap
 *                '+18685550122', and a contact-only position could be filed on that member's phone.
 *   WB-2         POST /whatsapp/webhook/:businessId took a Meta-signed body for another business's
 *                number: a message Meta signed for B's number ran in A's bridge.
 *   WB-3         a Twilio-signed staff 'YES' could be replayed: the delivery log stored
 *                x-twilio-signature in clear, and the staff path had no message-id dedup, so the
 *                same signed request approved a later pending item.
 *   TD9-1        projects_create_task wrote a task into another business's project
 *                (ProjectsService.addTask never looked the project up), and projects_list_tasks
 *                then read that project's name.
 *   TD9-2        call_create_task stored another business's contact on the caller's own call log
 *                (CallLogService.createCallLog checked nothing), call_schedule_followup then
 *                planted a task on that contact, and B's call script read it into B's prompt.
 *   TD9-3        bookings_create_booking accepted another business's service (and staff member);
 *                bookings_list_bookings then read the service's name.
 *   TD9-4        commerce_create_invoice / commerce_create_quote bound another business's contact
 *                (main base: no R0-27); the invoice echoed the contact, the quote was a half-write.
 *
 * HOW IT IS COMPOSED: the real WhatsAppController behind the production bootstrap
 * (configureNestApp, raw body kept as main.ts keeps it) with the real WhatsAppService,
 * StaffChatBridgeService, StructureService, JobRolePolicyService, AiOversightService and
 * WebhookIngressLoggerService over the real PrismaService. The dispatcher is the real
 * FlowOrchestratorService.executeToolAction with the real ProjectsService, CallLogService,
 * CallScriptService, BookingsService and CommerceService. Stubbed: what the path does not decide
 * (event emitters, timeline, CRM activity log, KEY's LLM chat, the model gateway, customer intake).
 * WhatsApp sends go through the 'mock' provider: no provider traffic. No tenant context is ever
 * installed, as on the bridge.
 *
 * FIXTURES: every row carries the `v21b_` prefix (test/helpers/fixture-prefixes.json) or belongs to
 * a `v21b_` business, and is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v21b_';
const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  full: `${P}full`, //         ADMIN of bizA, role defaults (tier 3): the replay holder (WB-3)
  narrow: `${P}narrow`, //     STAFF of bizA narrowed by PATCH .../permissions: { crm: read }, tier 0 (WB-1)
  banned: `${P}banned`, //     ADMIN of bizA, role defaults, tier 3, User.bannedAt set (WB-1)
  elsewhere: `${P}elsewhere`, // OWNER of bizB only; an old bizA position names that membership (FB-3)
  national: `${P}national`, // STAFF of bizA, { crm: read }, tier 0, User.phone in national form (FB-2)
  national2: `${P}national2`, // STAFF of bizA, User.phone '(868) 555-0177': no position yet (FB-2)
  short: `${P}short`, //       STAFF of bizA whose User.phone is a 7-digit local number (FB-2 control)
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  unitA: `${P}unitA`,
  unitB: `${P}unitB`,
  role: `${P}role_ownerish`, // bizA JobRole: the OWNER's default scopes, defaultApprovalTier 3
  posFull: `${P}pos_full`,
  posNarrow: `${P}pos_narrow`,
  posBanned: `${P}pos_banned`,
  posForeign: `${P}pos_foreign`,
  posMeta: `${P}pos_meta`, //  contact-only, phone in Meta's spelling (WB-2)
  posCtl: `${P}pos_ctl`, //    contact-only control
  posPhone: `${P}pos_phone`, // contact-only, on the national member's phone (filed before they set it)
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  projectA: `${P}projectA`,
  projectB: `${P}projectB`,
  serviceA: `${P}serviceA`,
  serviceB: `${P}serviceB`,
  staffA: `${P}staffA`,
  staffB: `${P}staffB`,
  callLogB: `${P}calllogB`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const PHONE = {
  full: '+18685550101',
  narrow: '+18685550102',
  banned: '+18685550103',
  meta: '18685550104',
  foreign: '+18685550105',
  ctl: '+18685550106',
  national: '+18685550122',
};
const PNID_A = '990000000001';
const PNID_B = '990000000002';
const APP_SECRET = 'v21b_meta_app_secret';
const TWILIO_TOKEN = 'v21b_twilio_auth_token';
const HOST = 'api.v21b.test';
const SECRET = { project: 'B-SECRET-PROJECT', service: 'B-SECRET-SERVICE', contact: 'B-SECRET-NAME' };
const REFUSED_MEMBER_PHONE =
  'A member of this business uses this phone number; give the position to their membership instead of a contact-only position';

let db: any;
let app: any;
let ROLE_DEFAULT_SCOPES: Record<string, Record<string, string>>;
let structure: any;
let policy: any;
let oversight: any;
let dispatcher: any;
let projects: any;
let callLogs: any;
let callScripts: any;
let gateway: { complete: ReturnType<typeof vi.fn> };
const saved = { secret: process.env.WHATSAPP_APP_SECRET, token: process.env.TWILIO_AUTH_TOKEN, verify: process.env.WHATSAPP_VERIFY_TOKEN };

/** Any method, any depth: an async no-op (the collaborators the path does not decide). */
const stub = (): any =>
  new Proxy(
    {},
    { get: (_t, k) => (k === 'then' ? undefined : vi.fn(async () => undefined)) },
  );

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('whatsapp_messages'),
    byBiz('whatsapp_contacts'),
    byBiz('webhook_delivery_logs'),
    byBiz('webhook_events'),
    byBiz('team_activity_logs'),
    byBiz('ai_approval_items'),
    byBiz('bookings'),
    byBiz('contact_tasks'),
    byBiz('call_logs'),
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('invoices'),
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('quotes'),
    byBiz('project_tasks'),
    byBiz('projects'),
    byBiz('business_goals'),
    byBiz('services'),
    byBiz('staff_members'),
    byBiz('org_assignments'),
    byBiz('job_roles'),
    byBiz('org_units'),
    byBiz('contacts'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort: a table may not exist on an older schema */
    }
  }
}

async function seed() {
  const users: Array<[string, Record<string, unknown>]> = [
    [ID.ownerA, {}],
    [ID.ownerB, {}],
    [ID.full, {}],
    [ID.narrow, {}],
    [ID.banned, { bannedAt: new Date() }],
    [ID.elsewhere, {}],
    [ID.national, { phone: '868-555-0122' }],
    [ID.national2, { phone: '(868) 555-0177' }],
    [ID.short, { phone: '555-0122' }],
  ];
  for (const [id, extra] of users) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role: 'USER', ...extra } });
  }
  await db.business.create({
    data: { id: ID.bizA, name: 'A', slug: `${P}biz-a`, ownerId: ID.ownerA, metaData: { whatsapp: { provider: 'mock', phoneNumberId: PNID_A } } },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'B', slug: `${P}biz-b`, ownerId: ID.ownerB, metaData: { whatsapp: { provider: 'mock', phoneNumberId: PNID_B } } },
  });
  const memberships: Array<[string, string, string, Record<string, unknown>]> = [
    [ID.ownerA, ID.bizA, 'OWNER', { maxApprovalTier: 4 }],
    [ID.ownerB, ID.bizB, 'OWNER', { maxApprovalTier: 4 }],
    [ID.full, ID.bizA, 'ADMIN', { maxApprovalTier: 3 }],
    // the state PATCH .../members/:id/permissions leaves: an explicit map and tier 0
    [ID.narrow, ID.bizA, 'STAFF', { permissionScopes: { crm: 'read' }, maxApprovalTier: 0 }],
    [ID.banned, ID.bizA, 'ADMIN', { maxApprovalTier: 3 }],
    [ID.elsewhere, ID.bizB, 'OWNER', { maxApprovalTier: 4 }],
    [ID.national, ID.bizA, 'STAFF', { permissionScopes: { crm: 'read' }, maxApprovalTier: 0 }],
    [ID.national2, ID.bizA, 'STAFF', { maxApprovalTier: 0 }],
    [ID.short, ID.bizA, 'STAFF', { maxApprovalTier: 0 }],
  ];
  for (const [userId, businessId, role, extra] of memberships) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.orgUnit.create({ data: { id: ID.unitA, businessId: ID.bizA, name: 'A HQ' } });
  await db.orgUnit.create({ data: { id: ID.unitB, businessId: ID.bizB, name: 'B HQ' } });
  await db.jobRole.create({
    data: { id: ID.role, businessId: ID.bizA, name: 'Ownerish', permissions: ROLE_DEFAULT_SCOPES.OWNER, defaultApprovalTier: 3 },
  });
  const position = (id: string, contactPhone: string, holder: string | null, extra: Record<string, unknown> = {}) =>
    db.orgAssignment.create({
      data: {
        id,
        businessId: ID.bizA,
        orgUnitId: ID.unitA,
        jobRoleId: ID.role,
        contactPhone,
        autoApprovalViaReply: true,
        ...(holder
          ? { membershipId: m(holder), userId: holder, isContactOnly: false }
          : { isContactOnly: true, contactName: `${id} contact` }),
        ...extra,
      },
    });
  await position(ID.posFull, PHONE.full, ID.full);
  await position(ID.posNarrow, PHONE.narrow, ID.narrow);
  await position(ID.posBanned, PHONE.banned, ID.banned);
  // written before assertAssignmentRefs: names the holder's membership in another business
  await position(ID.posForeign, PHONE.foreign, ID.elsewhere);
  await position(ID.posMeta, PHONE.meta, null);
  await position(ID.posCtl, PHONE.ctl, null);
  // filed before the national member set this number as their account phone
  await position(ID.posPhone, PHONE.national, null);

  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Vtwentyonebee', lastName: 'Alpha' } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: SECRET.contact, lastName: 'Bravo' } });
  await db.project.create({ data: { id: ID.projectA, businessId: ID.bizA, name: 'A-OWN-PROJECT' } });
  await db.project.create({ data: { id: ID.projectB, businessId: ID.bizB, name: SECRET.project } });
  await db.service.create({ data: { id: ID.serviceA, businessId: ID.bizA, name: 'A-OWN-SERVICE', duration: 60, price: 10 } });
  await db.service.create({ data: { id: ID.serviceB, businessId: ID.bizB, name: SECRET.service, duration: 60, price: 10 } });
  await db.staffMember.create({ data: { id: ID.staffA, businessId: ID.bizA, name: 'A staff' } });
  await db.staffMember.create({ data: { id: ID.staffB, businessId: ID.bizB, name: 'B staff' } });
  await db.callLog.create({ data: { id: ID.callLogB, businessId: ID.bizB, contactId: ID.contactB, callerId: ID.ownerB } });
}

let approvalSeq = 0;
/** A pending item routed to `assignmentId` (ApprovalRoutingService's result). */
async function pendingItem(assignmentId: string, riskTier: number) {
  approvalSeq += 1;
  return db.aiApprovalItem.create({
    data: {
      id: `${P}item_${approvalSeq}`,
      businessId: ID.bizA,
      toolName: 'commerce_refund_payment',
      title: `v21b refund ${approvalSeq}`,
      riskTier,
      status: 'pending',
      approverAssignmentId: assignmentId,
    },
  });
}
const statusOf = async (id: string) => (await db.aiApprovalItem.findUnique({ where: { id } })) as { status: string; resolvedBy: string | null; resolvedByUserId: string | null };

// ─── HTTP: the provider webhooks ─────────────────────────────────────────────

/**
 * X-Twilio-Signature as Twilio computes it (V1-21c TW-SHA1): HMAC-SHA1 under the auth token over
 * the URL followed by each POST parameter's name and value, sorted by name, base64-encoded. This
 * suite and the controller used HMAC-SHA256 before V1-21c, so a genuine Twilio delivery was refused.
 */
const twilioSignature = (url: string, params: Record<string, string>, algorithm: 'sha1' | 'sha256' = 'sha1') =>
  createHmac(algorithm, TWILIO_TOKEN)
    .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))
    .digest('base64');
const metaSignature = (raw: string) => `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

/** A Twilio-signed form POST, as Twilio sends it to the business's own route. */
function twilioPost(businessId: string, params: Record<string, string>, signature?: string) {
  const urlPath = `/whatsapp/webhook/${businessId}`;
  const sig = signature ?? twilioSignature(`http://${HOST}${urlPath}`, params);
  return request(app.getHttpServer()).post(urlPath).set('host', HOST).set('x-twilio-signature', sig).type('form').send(params);
}

const metaBody = (pnid: string, from: string, text: string, wamid: string) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: pnid }, messages: [{ from, id: wamid, timestamp: '1700000000', text: { body: text } }] } }] }],
});
function metaPost(urlPath: string, raw: string, signature = metaSignature(raw)) {
  return request(app.getHttpServer()).post(urlPath).set('Content-Type', 'application/json').set('x-hub-signature-256', signature).send(raw);
}

/** The reply the bridge sent back to `phone` through the mock provider (newest first). */
async function repliesTo(businessId: string, phone: string): Promise<string[]> {
  const digits = phone.replace(/\D/g, '');
  const rows = await db.whatsAppMessage.findMany({ where: { businessId, direction: 'OUTBOUND' }, include: { whatsappContact: true }, orderBy: { createdAt: 'desc' } });
  return rows.filter((r: any) => r.whatsappContact.phoneNumber.replace(/\D/g, '') === digits).map((r: any) => r.body as string);
}

function run(businessId: string, tool: string, args: Record<string, unknown>, action?: Record<string, unknown>) {
  return dispatcher.executeToolAction(businessId, tool, args, action);
}

beforeAll(async () => {
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
  process.env.WHATSAPP_VERIFY_TOKEN = 'v21b_verify';

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  ({ ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary'));
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { StructureService } = await import('../src/modules/structure/structure.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { StaffChatBridgeService } = await import('../src/modules/structure/staff-chat-bridge.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { WhatsAppController } = await import('../src/modules/whatsapp/whatsapp.controller');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { CallLogService } = await import('../src/modules/call-tasks/call-log.service');
  const { CallScriptService } = await import('../src/modules/call-tasks/call-script.service');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { NotFoundException } = await import('@nestjs/common');
  const { Test } = await import('@nestjs/testing');

  const prisma = new PrismaService();
  structure = new StructureService(prisma as any);
  policy = new JobRolePolicyService();
  oversight = new AiOversightService(
    prisma as any,
    { log: vi.fn(async () => undefined) } as any,
    { recordApprovalSignal: vi.fn(async () => undefined) } as any,
    stub(),
    stub(),
    policy,
  );
  // KEY's LLM turn: never reached by a reply approval; answers a plain message.
  const orchestratorChat = { chat: vi.fn(async () => ({ reply: 'stub KEY reply', sessionId: null })), getConversationHistory: vi.fn(async () => []) };
  const bridgeRef = {
    get: (token: unknown) =>
      token === JobRolePolicyService ? policy : token === AiOversightService ? oversight : token === FlowOrchestratorService ? orchestratorChat : undefined,
  };
  const bridge = new StaffChatBridgeService(structure, prisma as any, bridgeRef as any);
  const entityResolution = { resolveContact: vi.fn(async () => ({ contactId: null, matchedOn: 'none', isNew: false, merged: false })) };
  const whatsapp = new WhatsAppService(prisma as any, { emit: vi.fn() } as any, entityResolution as any, stub(), bridge);
  const logger = new WebhookIngressLoggerService(prisma as any);

  const moduleRef = await Test.createTestingModule({
    controllers: [WhatsAppController],
    providers: [
      { provide: WhatsAppService, useValue: whatsapp },
      { provide: PrismaService, useValue: prisma },
      { provide: WebhookIngressLoggerService, useValue: logger },
      { provide: AuthGuard, useValue: { canActivate: () => false } },
      { provide: BusinessGuard, useValue: { canActivate: () => false } },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  configureNestApp(app);
  await app.init();

  // The dispatcher: the real executeToolAction over the real services.
  // CRM activity log: refuses a contact outside the business, as CrmService.logContactEvent does.
  const crm = {
    logContactEvent: vi.fn(async ({ businessId, contactId }: { businessId: string; contactId: string }) => {
      const c = await db.contact.findFirst({ where: { id: contactId, businessId } });
      if (!c) throw new NotFoundException('Contact not found');
    }),
  };
  gateway = { complete: vi.fn(async () => ({ content: JSON.stringify({ greeting: 'Hi', talkingPoints: ['a'], ask: 'b', close: 'c', durationEstimate: 3 }) })) };
  projects = new ProjectsService(prisma as any, { emit: vi.fn() } as any, stub(), stub(), stub());
  callLogs = new CallLogService(prisma as any, { emit: vi.fn() } as any);
  callScripts = new CallScriptService(prisma as any, gateway as any);
  const bookings = new BookingsService(prisma as any, { emit: vi.fn() } as any, crm as any, stub(), stub(), stub(), stub(), stub(), stub());
  const commerce = new CommerceService(prisma as any, { emit: vi.fn() } as any, crm as any, stub(), stub(), stub(), stub(), stub(), stub());
  const services = new Map<unknown, unknown>([
    [ProjectsService, projects],
    [CallLogService, callLogs],
    [CallScriptService, callScripts],
    [BookingsService, bookings],
    [CommerceService, commerce],
  ]);
  dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    moduleRef: { get: (token: unknown) => services.get(token) },
  });

  await cleanup();
  await seed();
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (db) await cleanup();
  process.env.WHATSAPP_APP_SECRET = saved.secret;
  process.env.TWILIO_AUTH_TOKEN = saved.token;
  process.env.WHATSAPP_VERIFY_TOKEN = saved.verify;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('WB-1 / FB-3 — a reply approval needs the holder to be able to approve that tier over HTTP', () => {
  it('premise: HTTP refuses the narrowed holder a tier-3 item, and their KEY envelope is narrowed (IC3-1)', async () => {
    const item = await pendingItem(ID.posNarrow, 3);
    await expect(oversight.resolveApproval(item.id, ID.bizA, 'approved', ID.narrow)).rejects.toThrow(
      'Tier 3 approvals require approval tier 3 or higher (you have tier 0)',
    );
    const env = policy.envelopeForPosition(await structure.resolveStaffByPhone(ID.bizA, PHONE.narrow));
    expect(env.maxRiskTier).toBe(1);
    expect(policy.isToolAllowed(env, 'commerce_create_invoice')).toBe(false);
    await db.aiApprovalItem.delete({ where: { id: item.id } });
  });

  it("the narrowed holder's Twilio-signed 'YES' leaves the tier-3 item pending", async () => {
    const item = await pendingItem(ID.posNarrow, 3);
    const res = await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.narrow}`, Body: 'YES', SmsMessageSid: 'SMv21bnarrow1' });
    expect(res.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending', resolvedByUserId: null });
    expect((await repliesTo(ID.bizA, PHONE.narrow))[0]).not.toMatch(/I've approved/);
  });

  it("a banned holder's 'YES' leaves the item pending (AuthMiddleware refuses them every route)", async () => {
    const item = await pendingItem(ID.posBanned, 3);
    const res = await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.banned}`, Body: 'YES', SmsMessageSid: 'SMv21bbanned1' });
    expect(res.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
  });

  it("a holder whose only membership is in another business cannot approve here (FB-3: the membership HTTP reads is the one in this business)", async () => {
    const item = await pendingItem(ID.posForeign, 3);
    const res = await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.foreign}`, Body: 'YES', SmsMessageSid: 'SMv21bforeign1' });
    expect(res.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
  });

  it('called directly, resolveApprovalByAssignment refuses each of them too (no caller can skip the cap)', async () => {
    for (const pos of [ID.posNarrow, ID.posBanned, ID.posForeign]) {
      const item = await pendingItem(pos, 3);
      await expect(oversight.resolveApprovalByAssignment(item.id, ID.bizA, pos, 'approved'), pos).rejects.toThrow();
      expect(await statusOf(item.id), pos).toMatchObject({ status: 'pending' });
    }
  });

  it('control: within their tier the holder still approves by reply (tier 2 for an ADMIN at tier 3)', async () => {
    const item = await pendingItem(ID.posFull, 2);
    await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.full}`, Body: 'YES', SmsMessageSid: 'SMv21bfull0' });
    expect(await statusOf(item.id)).toMatchObject({ status: 'approved', resolvedByUserId: ID.full });
  });

  it('control: a contact-only position (no account, no member on its phone) approves by its JobRole tier, as before', async () => {
    const item = await pendingItem(ID.posCtl, 3);
    await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.ctl}`, Body: 'YES', SmsMessageSid: 'SMv21bctl1' });
    expect(await statusOf(item.id)).toMatchObject({ status: 'approved', resolvedBy: 'key_delegate' });
  });
});

describe('FB-2 — a member is matched to a position phone however either number is spelled', () => {
  it("the national spelling of a member's phone ('868-555-0122') is that member's '+18685550122'; a 7-digit local number is not", async () => {
    const resolved = await structure.resolveStaffByPhone(ID.bizA, PHONE.national);
    expect(resolved?.id).toBe(ID.posPhone);
    expect((resolved.phoneMembers ?? []).map((x: any) => x.userId)).toEqual([ID.national]);
    const env = policy.envelopeForPosition(resolved);
    expect(env.maxRiskTier).toBe(1);
    expect(policy.isToolAllowed(env, 'commerce_create_invoice')).toBe(false);
  });

  it("a contact-only position cannot be filed on that member's phone in another spelling (INP4-3's refusal)", async () => {
    await expect(
      structure.createAssignment(ID.bizA, { isContactOnly: true, contactName: 'Second line', contactPhone: '+1 (868) 555-0177', orgUnitId: ID.unitA }, ID.ownerA),
    ).rejects.toThrow(REFUSED_MEMBER_PHONE);
    expect(await db.orgAssignment.count({ where: { businessId: ID.bizA, contactPhone: '+18685550177' } })).toBe(0);
    // control: a number no member uses is filed
    await expect(
      structure.createAssignment(ID.bizA, { isContactOnly: true, contactName: 'Third line', contactPhone: '+18685550133', orgUnitId: ID.unitA }, ID.ownerA),
    ).resolves.toMatchObject({ contactPhone: '+18685550133' });
  });

  it("a 'YES' from that phone leaves a tier-3 item pending: the member HTTP knows at that phone has tier 0", async () => {
    const item = await pendingItem(ID.posPhone, 3);
    await twilioPost(ID.bizA, { From: `whatsapp:${PHONE.national}`, Body: 'YES', SmsMessageSid: 'SMv21bnational1' });
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
  });
});

describe("V1-21c review CR-1 — a Vietnamese number in Meta's spelling is not a Moscow member's phone", () => {
  const moscow = `${P}moscow`; // STAFF of bizA, User.phone '+7 495 123-45-67'
  const trunk8 = `${P}trunk8`; // STAFF of bizA, User.phone written with the trunk 8: '8 (912) 345-67-89'

  beforeAll(async () => {
    for (const [id, phone] of [[moscow, '+7 495 123-45-67'], [trunk8, '8 (912) 345-67-89']]) {
      await db.user.create({ data: { id, email: `${id}@${P}test.local`, role: 'USER', phone } });
      await db.membership.create({ data: { id: m(id), userId: id, businessId: ID.bizA, role: 'STAFF', maxApprovalTier: 0 } });
    }
  });

  it("a contact-only position on '84951234567' (Vietnam, as Meta writes a sender) is filed: no member uses that number", async () => {
    await expect(
      structure.createAssignment(ID.bizA, { isContactOnly: true, contactName: 'Hanoi line', contactPhone: '84951234567', orgUnitId: ID.unitA }, ID.ownerA),
    ).resolves.toMatchObject({ contactPhone: '84951234567', isContactOnly: true });
  });

  it("control: a member's own number is still refused, in Meta's spelling and against a User.phone written with the trunk 8", async () => {
    for (const contactPhone of ['74951234567', '+7 (495) 123-45-67', '79123456789', '+7 912 345 67 89']) {
      await expect(
        structure.createAssignment(ID.bizA, { isContactOnly: true, contactName: 'Member line', contactPhone, orgUnitId: ID.unitA }, ID.ownerA),
        contactPhone,
      ).rejects.toThrow(REFUSED_MEMBER_PHONE);
    }
  });
});

describe("WB-2 — the per-business route takes a Meta message only for that business's own number", () => {
  it("a body Meta signed for B's number, posted to A's route, runs nothing in A", async () => {
    const item = await pendingItem(ID.posMeta, 3);
    const raw = JSON.stringify(metaBody(PNID_B, PHONE.meta, 'YES', 'wamid.v21b.cross'));
    // the shared route routes it to B, where the sender is no one's position
    const shared = await metaPost('/whatsapp/webhook', raw);
    expect(shared.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
    // the same bytes and signature on A's route
    const scoped = await metaPost(`/whatsapp/webhook/${ID.bizA}`, raw);
    expect(scoped.status).toBe(403);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
    expect(await repliesTo(ID.bizA, PHONE.meta)).toEqual([]);
  });

  it("control: a body Meta signed for A's own number is taken on A's route", async () => {
    const item = (await db.aiApprovalItem.findFirst({ where: { businessId: ID.bizA, approverAssignmentId: ID.posMeta, status: 'pending' } }))!;
    const raw = JSON.stringify(metaBody(PNID_A, PHONE.meta, 'YES', 'wamid.v21b.own'));
    const res = await metaPost(`/whatsapp/webhook/${ID.bizA}`, raw);
    expect(res.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'approved', resolvedBy: 'key_delegate' });
  });
});

describe('WB-3 — a signed staff message is acted on once', () => {
  const params = { From: `whatsapp:${PHONE.full}`, Body: 'YES', SmsMessageSid: 'SMv21bb2' };
  let signature: string;

  it('the delivery log does not keep the Twilio signature', async () => {
    const first = await pendingItem(ID.posFull, 2);
    signature = twilioSignature(`http://${HOST}/whatsapp/webhook/${ID.bizA}`, params);
    const res = await twilioPost(ID.bizA, params, signature);
    expect(res.status).toBe(201);
    expect(await statusOf(first.id)).toMatchObject({ status: 'approved', resolvedByUserId: ID.full });
    const log = await db.webhookDeliveryLog.findFirst({ where: { businessId: ID.bizA }, orderBy: { createdAt: 'desc' } });
    expect((log.headers as Record<string, unknown>)['x-twilio-signature']).toBe('[REDACTED]');
    expect(JSON.stringify(log.headers)).not.toContain(signature);
  });

  it('the same signed request, replayed, does not approve a later pending item', async () => {
    const second = await pendingItem(ID.posFull, 2);
    const res = await twilioPost(ID.bizA, params, signature);
    expect(res.status).toBe(201);
    expect(await statusOf(second.id)).toMatchObject({ status: 'pending', resolvedByUserId: null });
  });

  it('control: a new message (its own SmsMessageSid, freshly signed) approves it', async () => {
    const second = (await db.aiApprovalItem.findFirst({ where: { businessId: ID.bizA, approverAssignmentId: ID.posFull, status: 'pending' } }))!;
    await twilioPost(ID.bizA, { ...params, SmsMessageSid: 'SMv21bb3' });
    expect(await statusOf(second.id)).toMatchObject({ status: 'approved', resolvedByUserId: ID.full });
  });
});

/**
 * V1-21c review CR-2: since V1-21c, WhatsAppController claims a Twilio delivery by its signature,
 * so the Twilio cases above pass without the bridge's per-message claim. On the Meta routes (and
 * /communications/inbound/sms) that claim is the only replay guard: Meta signs the raw body, so a
 * replayed body carries the same wamid, and StaffChatBridgeService.claimMessage drops it.
 */
describe('WB-3 (Meta) — a Meta-signed staff message delivered again is acted on once (V1-21c review CR-2)', () => {
  const raw = JSON.stringify(metaBody(PNID_A, PHONE.meta, 'YES', 'wamid.v21c.replay'));

  it("the signed 'YES' approves the position's pending item", async () => {
    const first = await pendingItem(ID.posMeta, 3);
    const res = await metaPost(`/whatsapp/webhook/${ID.bizA}`, raw);
    expect(res.status).toBe(201);
    expect(await statusOf(first.id)).toMatchObject({ status: 'approved', resolvedBy: 'key_delegate' });
  });

  it('the same signed body (the same wamid), on the business route and on the shared one, leaves a later pending item pending', async () => {
    const second = await pendingItem(ID.posMeta, 3);
    const scoped = await metaPost(`/whatsapp/webhook/${ID.bizA}`, raw);
    expect(scoped.status).toBe(201);
    expect(await statusOf(second.id)).toMatchObject({ status: 'pending', resolvedBy: null });
    const shared = await metaPost('/whatsapp/webhook', raw);
    expect(shared.status).toBe(201);
    expect(await statusOf(second.id)).toMatchObject({ status: 'pending', resolvedBy: null });
  });

  it('control: a new message (its own wamid, freshly signed) approves it', async () => {
    const second = (await db.aiApprovalItem.findFirst({ where: { businessId: ID.bizA, approverAssignmentId: ID.posMeta, status: 'pending' } }))!;
    await metaPost(`/whatsapp/webhook/${ID.bizA}`, JSON.stringify(metaBody(PNID_A, PHONE.meta, 'YES', 'wamid.v21c.replay2')));
    expect(await statusOf(second.id)).toMatchObject({ status: 'approved', resolvedBy: 'key_delegate' });
  });
});

describe('V1-21c TW-SHA1 — the per-business route verifies X-Twilio-Signature as Twilio signs it', () => {
  it("a 'YES' signed with HMAC-SHA256 is refused (403) and decides nothing; the same message signed as Twilio signs (HMAC-SHA1) approves", async () => {
    const item = await pendingItem(ID.posCtl, 3);
    const params = { From: `whatsapp:${PHONE.ctl}`, Body: 'YES', MessageSid: 'SMv21csha1', SmsMessageSid: 'SMv21csha1' };
    const url = `http://${HOST}/whatsapp/webhook/${ID.bizA}`;
    const sha256 = await twilioPost(ID.bizA, params, twilioSignature(url, params, 'sha256'));
    expect(sha256.status).toBe(403);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
    const sha1 = await twilioPost(ID.bizA, params, twilioSignature(url, params, 'sha1'));
    expect(sha1.status).toBe(201);
    expect(await statusOf(item.id)).toMatchObject({ status: 'approved', resolvedBy: 'key_delegate' });
  });

  it('a field changed after signing is refused (403) and decides nothing', async () => {
    const item = await pendingItem(ID.posCtl, 3);
    const signed = { From: `whatsapp:${PHONE.ctl}`, Body: 'what is on today?', SmsMessageSid: 'SMv21ctamper' };
    const sig = twilioSignature(`http://${HOST}/whatsapp/webhook/${ID.bizA}`, signed);
    const res = await twilioPost(ID.bizA, { ...signed, Body: 'YES' }, sig);
    expect(res.status).toBe(403);
    expect(await statusOf(item.id)).toMatchObject({ status: 'pending' });
    await db.aiApprovalItem.delete({ where: { id: item.id } });
  });
});

describe('V1-21c WB3-SHIFT — a captured signature replayed with a key/value boundary moved is dropped', () => {
  const url = `http://${HOST}/whatsapp/webhook/${ID.bizA}`;
  // Twilio sends a message's id as both MessageSid and SmsMessageSid
  const original = { From: `whatsapp:${PHONE.full}`, Body: 'YES', MessageSid: 'SMv21cshift', SmsMessageSid: 'SMv21cshift' };
  // ...'MessageSidSMv21cshiftSmsMessageSidSMv21cshift' cut at another place: the signed string,
  // and so the signature, is unchanged; the message id (SmsMessageSid ?? MessageSid) is new
  const shifted = { From: `whatsapp:${PHONE.full}`, Body: 'YES', MessageSid: 'SMv21cshiftSmsMessageSidSMv21cshift' };
  let signature: string;

  it("the signed 'YES' approves the holder's pending item", async () => {
    const first = await pendingItem(ID.posFull, 2);
    signature = twilioSignature(url, original);
    expect(twilioSignature(url, shifted)).toBe(signature);
    const res = await twilioPost(ID.bizA, original, signature);
    expect(res.status).toBe(201);
    expect(await statusOf(first.id)).toMatchObject({ status: 'approved', resolvedByUserId: ID.full });
  });

  it('the same signature on the shifted fields does not approve a later pending item, and runs nothing', async () => {
    const second = await pendingItem(ID.posFull, 2);
    const res = await twilioPost(ID.bizA, shifted, signature);
    expect(res.status).toBe(201);
    expect(await statusOf(second.id)).toMatchObject({ status: 'pending', resolvedByUserId: null });
    // no claim row keeps a replayable copy of the signature
    const rows = await db.webhookEvent.findMany({ where: { businessId: ID.bizA } });
    expect(JSON.stringify(rows)).not.toContain(signature);
  });

  it('control: a new message (its own id, freshly signed) approves it', async () => {
    const second = (await db.aiApprovalItem.findFirst({ where: { businessId: ID.bizA, approverAssignmentId: ID.posFull, status: 'pending' } }))!;
    const next = { ...original, MessageSid: 'SMv21cshift2', SmsMessageSid: 'SMv21cshift2' };
    await twilioPost(ID.bizA, next);
    expect(await statusOf(second.id)).toMatchObject({ status: 'approved', resolvedByUserId: ID.full });
  });
});

// ─── The dispatcher, with no tenant context ──────────────────────────────────

describe("TD9-1 — projects_create_task writes only into the business's own project", () => {
  it("another business's project is refused, and nothing is written there", async () => {
    await expect(run(ID.bizA, 'projects_create_task', { projectId: ID.projectB, title: 'A-PLANTED-PTASK' })).rejects.toThrow(/Project not found/);
    expect(await db.projectTask.count({ where: { projectId: ID.projectB } })).toBe(0);
    const out = await run(ID.bizA, 'projects_list_tasks', { projectId: ID.projectB });
    expect(JSON.stringify(out)).not.toContain(SECRET.project);
  });

  it('control: its own project takes the task', async () => {
    const out = await run(ID.bizA, 'projects_create_task', { projectId: ID.projectA, title: 'A-OWN-PTASK' });
    expect(out.task).toMatchObject({ businessId: ID.bizA, projectId: ID.projectA, title: 'A-OWN-PTASK' });
  });
});

describe("TD9-2 — a call log names only the business's own contact, and B's script reads only B's tasks", () => {
  // W7-CALL-TASK-CALLER (D-73, D-88): call_create_task records the member the command runs for and
  // refuses a run with no member, so these dispatches name the member they run for (A's owner, the
  // caller they named before) as a member's chat turn does; the contact checks below are unchanged.
  const forOwnerA = () => ({ surface: 'CHAT', principalUserId: ID.ownerA });

  it("call_create_task refuses another business's contact, and no call log in A names it", async () => {
    await expect(run(ID.bizA, 'call_create_task', { contactId: ID.contactB, callerId: ID.ownerA }, forOwnerA())).rejects.toThrow(/Contact not found/);
    expect(await db.callLog.count({ where: { businessId: ID.bizA, contactId: ID.contactB } })).toBe(0);
    expect(await db.contactTask.count({ where: { businessId: ID.bizA, contactId: ID.contactB } })).toBe(0);
  });

  it("updateCallLog (PATCH .../calls/:id) refuses another business's contact on A's own call log", async () => {
    const own = await run(ID.bizA, 'call_create_task', { contactId: ID.contactA, callerId: ID.ownerA }, forOwnerA());
    await expect(callLogs.updateCallLog(ID.bizA, own.id, { contactId: ID.contactB })).rejects.toThrow(/Contact not found/);
    expect((await db.callLog.findUnique({ where: { id: own.id } })).contactId).toBe(ID.contactA);
    // control: the follow-up on its own log lands on its own contact
    const task = await run(ID.bizA, 'call_schedule_followup', { callLogId: own.id, title: 'own follow-up' });
    expect(await db.contactTask.findUnique({ where: { id: task.taskId } })).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA });
  });

  it("B's call script never reads a task another business put on B's contact (a row written before this repair)", async () => {
    await db.contactTask.create({ data: { id: `${P}legacy_task`, businessId: ID.bizA, contactId: ID.contactB, title: 'planted-via-own-log', status: 'OPEN' } });
    gateway.complete.mockClear();
    await callScripts.generateScript(ID.bizB, ID.callLogB, ID.contactB);
    expect(gateway.complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(gateway.complete.mock.calls)).not.toContain('planted-via-own-log');
  });
});

describe("TD9-3 — a booking names only the business's own service and staff member", () => {
  const start = () => new Date(Date.now() + 20 * 24 * 3600_000);
  const slot = (days: number) => {
    const s = new Date(start().getTime() + days * 24 * 3600_000);
    return { startTime: s.toISOString(), endTime: new Date(s.getTime() + 3600_000).toISOString() };
  };

  it("another business's service is refused, and its name is never read back", async () => {
    await expect(run(ID.bizA, 'bookings_create_booking', { contactId: ID.contactA, serviceId: ID.serviceB, ...slot(0) })).rejects.toThrow(/Service not found/);
    expect(await db.booking.count({ where: { businessId: ID.bizA, serviceId: ID.serviceB } })).toBe(0);
    const out = await run(ID.bizA, 'bookings_list_bookings', { limit: 50 });
    expect(JSON.stringify(out)).not.toContain(SECRET.service);
  });

  it("another business's staff member is refused", async () => {
    await expect(
      run(ID.bizA, 'bookings_create_booking', { contactId: ID.contactA, serviceId: ID.serviceA, staffId: ID.staffB, ...slot(2) }),
    ).rejects.toThrow(/Staff member not found/);
    expect(await db.booking.count({ where: { businessId: ID.bizA, staffId: ID.staffB } })).toBe(0);
  });

  it('control: its own service and staff member book', async () => {
    const out = await run(ID.bizA, 'bookings_create_booking', { contactId: ID.contactA, serviceId: ID.serviceA, staffId: ID.staffA, ...slot(4) });
    expect(out.booking).toMatchObject({ businessId: ID.bizA, serviceId: ID.serviceA, staffId: ID.staffA });
  });
});

describe("TD9-4 — an invoice or a quote names only the business's own contact (main base, without R0-27)", () => {
  const items = [{ description: 'x', quantity: 1, unitPrice: 1 }];

  it("commerce_create_invoice refuses another business's contact, writes nothing and echoes nothing", async () => {
    let out: unknown;
    await expect(
      (async () => {
        out = await run(ID.bizA, 'commerce_create_invoice', { contactId: ID.contactB, items });
      })(),
    ).rejects.toThrow(/Contact not found/);
    expect(JSON.stringify(out ?? null)).not.toContain(SECRET.contact);
    expect(await db.invoice.count({ where: { businessId: ID.bizA, contactId: ID.contactB } })).toBe(0);
  });

  it("commerce_create_quote refuses it before anything is written (no half-written quote)", async () => {
    await expect(run(ID.bizA, 'commerce_create_quote', { contactId: ID.contactB, items })).rejects.toThrow(/Contact not found/);
    expect(await db.quote.count({ where: { businessId: ID.bizA } })).toBe(0);
  });

  it('control: its own contact is invoiced and quoted', async () => {
    const inv = await run(ID.bizA, 'commerce_create_invoice', { contactId: ID.contactA, items });
    expect(inv.invoice).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA });
    const qt = await run(ID.bizA, 'commerce_create_quote', { contactId: ID.contactA, items });
    expect(qt.quote).toMatchObject({ businessId: ID.bizA, contactId: ID.contactA });
  });
});

// ─── V1-21c: relation includes, over rows written before the TD9 repairs ─────

describe("V1-21c — a project's task includes read only the business's own tasks (a cross-linked row written before TD9-1)", () => {
  const planted = `${P}planted_ptask`;
  const own = `${P}own_ptask_b`;

  beforeAll(async () => {
    // A's task filed on B's project, as ProjectsService.addTask wrote it before TD9-1 looked the project up
    await db.projectTask.create({ data: { id: planted, businessId: ID.bizA, projectId: ID.projectB, title: 'A-CROSSLINKED-PTASK', trackedHours: 99 } });
    await db.projectTask.create({ data: { id: own, businessId: ID.bizB, projectId: ID.projectB, title: 'B-OWN-PTASK', trackedHours: 2 } });
  });
  afterAll(async () => {
    // Raw SQL: ProjectTask is soft-deleted, so deleteMany would only set deletedAt and leave the rows.
    await db.$executeRaw`DELETE FROM project_tasks WHERE id IN (${planted}, ${own})`;
  });

  it('getProject, listProjects and updateProject return the project with its own tasks only', async () => {
    const one = await projects.getProject(ID.bizB, ID.projectB);
    expect(one.tasks.map((t: { id: string }) => t.id)).toEqual([own]);
    const all = await projects.listProjects(ID.bizB);
    expect(all.find((p: { id: string }) => p.id === ID.projectB).tasks.map((t: { id: string }) => t.id)).toEqual([own]);
    expect(JSON.stringify(all)).not.toContain('A-CROSSLINKED-PTASK');
    const updated = await projects.updateProject(ID.bizB, ID.projectB, { description: 'v21c' });
    expect(updated.tasks.map((t: { id: string }) => t.id)).toEqual([own]);
  });

  it("getProjectTimeline and getProjectBudget neither (the planted task's 99 tracked hours are not B's)", async () => {
    const timeline = await projects.getProjectTimeline(ID.projectB, ID.bizB);
    expect(timeline.tasks.map((t: { id: string }) => t.id)).toEqual([own]);
    const budget = await projects.getProjectBudget(ID.projectB, ID.bizB);
    expect(budget.trackedHours).toBe(2);
  });

  // The KEY dispatcher reads these with its own queries (FlowOrchestratorService.executeToolAction,
  // src/modules/ai/flow-orchestrator.service.ts), which V1-21c's write set does not include. Over
  // rows written before the TD9 repairs (V1-21c review ST-1, confirmed by running):
  //   projects_list_tasks for A returns B's project name through the task's to-one project include
  //     (a row like `planted`);
  //   bookings_list_bookings for A returns B's service name AND B's contact (firstName, lastName,
  //     email) through a booking's to-one service and contact includes (an A booking that names
  //     serviceB and contactB);
  //   projects_list for B counts A's task in projectB's taskCount (its _count's where names no
  //     business).
  // A to-one include cannot be filtered, and binding the booking's where on one relation
  // ({ service: { businessId } }) would leave the other leaking: each to-one relation has to be
  // read with its businessId and dropped when it is not the caller's (or the row left out by a
  // where on every relation it includes), and the _count's where has to name businessId.
  it.todo("projects_list_tasks does not read another business's project through a task's project include (dispatcher outside the V1-21c write set, ST-1)");
  it.todo("bookings_list_bookings does not read another business's service through a booking's service include (dispatcher outside the V1-21c write set, ST-1)");
  it.todo("bookings_list_bookings does not read another business's contact through a booking's contact include (dispatcher outside the V1-21c write set, ST-1)");
  it.todo("projects_list does not count another business's task in a project's taskCount (dispatcher outside the V1-21c write set, ST-1)");
});

// ─── V1-21c review ST-2: a project's goal, written and read ──────────────────

describe("V1-21c review ST-2 — a project names, and reads back, only the business's own goal", () => {
  const goalA = `${P}goalA`;
  const goalB = `${P}goalB`;
  const GOAL_SECRET = 'A-SECRET-GOAL';

  beforeAll(async () => {
    await db.businessGoal.create({ data: { id: goalA, businessId: ID.bizA, title: GOAL_SECRET, category: 'revenue', targetValue: 1234567 } });
    await db.businessGoal.create({ data: { id: goalB, businessId: ID.bizB, title: 'B-OWN-GOAL', category: 'leads' } });
  });
  afterAll(async () => {
    await db.project.updateMany({ where: { id: ID.projectB }, data: { goalId: null } });
  });

  it("createProject refuses another business's goal and writes no project", async () => {
    await expect(projects.createProject(ID.bizB, { name: 'v21c-foreign-goal', goalId: goalA })).rejects.toThrow(/Goal not found/);
    expect(await db.project.count({ where: { businessId: ID.bizB, name: 'v21c-foreign-goal' } })).toBe(0);
  });

  it("updateProject refuses it and leaves the project's goal as it was", async () => {
    await expect(projects.updateProject(ID.bizB, ID.projectB, { goalId: goalA })).rejects.toThrow(/Goal not found/);
    expect((await db.project.findUnique({ where: { id: ID.projectB } })).goalId).toBeNull();
  });

  it("a project linked to another business's goal before this check reads no goal (getProject, listProjects)", async () => {
    await db.project.update({ where: { id: ID.projectB }, data: { goalId: goalA } });
    const one = await projects.getProject(ID.bizB, ID.projectB);
    expect(one.goal).toBeNull();
    const all = await projects.listProjects(ID.bizB);
    expect(all.find((p: { id: string }) => p.id === ID.projectB).goal).toBeNull();
    expect(JSON.stringify([one, all])).not.toContain(GOAL_SECRET);
    await db.project.update({ where: { id: ID.projectB }, data: { goalId: null } });
  });

  it('control: its own goal is linked and read back, and null unlinks it', async () => {
    const created = await projects.createProject(ID.bizB, { name: 'v21c-own-goal', goalId: goalB });
    expect(created.goal).toMatchObject({ id: goalB, title: 'B-OWN-GOAL' });
    expect((await projects.getProject(ID.bizB, created.id)).goal).toMatchObject({ id: goalB, title: 'B-OWN-GOAL' });
    const listed = (await projects.listProjects(ID.bizB)).find((p: { id: string }) => p.id === created.id);
    expect(listed.goal).toEqual({ id: goalB, title: 'B-OWN-GOAL', category: 'leads' });
    expect((await projects.updateProject(ID.bizB, ID.projectB, { goalId: goalB })).goalId).toBe(goalB);
    expect((await projects.updateProject(ID.bizB, ID.projectB, { goalId: null })).goalId).toBeNull();
  });
});
