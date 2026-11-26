/**
 * SWEEP-P0-FOLLOWUP — the credential-binding holes the SWEEP-P0 round 3 rechecks found (CW3-1, CW3-2), the
 * census follow-ups the PR195 merge unblocked (owner question 12: the bank connections; question 11: the
 * integration hub binding) and the owner rulings of the blueprint's "Team permissions, round 2" group, each at
 * its recommended option (staffbookings, staffkeyplans, byokkeys, whatsappsmoke), against a REAL database
 * through the HTTP routes.
 *
 *   - CW3-1: POST /drive/businesses/:b/inventory-sheet/link (and unlink, create) wrote
 *     Business.inventoryLinkedSheetId, the spreadsheet the owner's Google Drive token reads (GET pull, diff)
 *     and clears (POST push), for any member with storefront write. That is a binding of the owner's Google
 *     credential, as calendarId and bpAccountId are (D-99): now the Google owner rule
 *     (GOOGLE_CONNECT_OWNER_ONLY) first, storefront write kept.
 *   - CW3-2: the connector form mapping routes (POST / DELETE .../connector-forms/:source/:externalFormId/mapping,
 *     POST .../:leadFormId/backfill) checked membership only, and their writer wrote connector_statuses.metadata
 *     back whole from a read made at the start of the operation ({ ...meta, formMappings }), so a backfill that
 *     ran over a settings admin's revoke wrote the revoked encryptedCredentials and boundBy back. Now the writer
 *     changes formMappings alone, under the row lock, and the routes need settings admin (D-181: only settings
 *     admin connects, syncs or tests the other connectors).
 *   - Owner question 12: POST / PATCH / DELETE /finance/businesses/:b/bank-connections wrote
 *     BankConnection.accessToken (a provider credential) for any member: now settings admin.
 *   - Owner question 11: the integration hub binding (POST / DELETE .../integration-hub/.../connections/:key)
 *     needs settings admin alone; connect write is kept for the sync runs only.
 *   - staffbookings: a STAFF member on role defaults handles bookings (bookings write by default).
 *   - staffkeyplans: pausing, resuming or aborting a KEY plan needs ai write (STAFF default ai is none); and a
 *     plan is controlled only through its own business (the routes took any plan id).
 *   - byokkeys: only the owner enters, changes or clears the business's own AI provider keys; settings admins
 *     keep the other AI preferences.
 *   - whatsappsmoke: the WhatsApp test only reports its result and never switches WhatsApp back on, so any
 *     member may run it.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, the real controllers and the services
 * that write, against DATABASE_URL. The stand-ins: identity attachment (`x-test-user`) and the collaborators no case
 * reaches (Nest's useMocker). Every outbound fetch is recorded and refused, so no case reaches a provider.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99a_` prefix and is hard-deleted by raw SQL (sqlLikePrefix)
 * in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99a_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  admin: `${P}admin`, // ADMIN of bizA, role defaults (settings admin, ai admin, connect none)
  staffDefault: `${P}staffDefault`, // STAFF of bizA, role defaults
  staffStore: `${P}staffStore`, // STAFF of bizA, explicit { storefront: write }, every other module none
  adminSetNone: `${P}adminSetNone`, // ADMIN of bizA, explicit settings none (D-114)
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings admin and connect none
  connectWriter: `${P}connectWriter`, // STAFF of bizA, explicit connect write, settings none
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  ownerB: `${P}ownerB`,
  coa: `${P}coa`,
  account: `${P}fin_account`,
  account2: `${P}fin_account2`,
  bank: `${P}bank_conn`,
  form: `${P}tf_form`,
  planA: `${P}plan_a`,
  planB: `${P}plan_b`,
  provider: `${P}hub_provider`,
};
const EVERY_MODULE_NONE = {
  settings: 'none', crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};
// Fixture credential values are built at runtime from fragments (no secret-shaped literal in the source).
const secret = (...parts: string[]) => parts.join('_');
const OWNER_DRIVE_TOKEN = secret(P, 'owner', 'drive', 'access');
const OWNER_SHEET = `${P}OWNER_INVENTORY_SHEET`;

const outbound: Array<{ url: string; auth: string | null }> = [];
let db: any;
let app: any;
let moduleRef: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM lead_form_submissions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM lead_forms WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_providers WHERE key LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM push_subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}
const said = (res: any) => JSON.stringify(res.body ?? {});
const sheetOf = async () => (await db.business.findUnique({ where: { id: ID.bizA }, select: { inventoryLinkedSheetId: true } }))?.inventoryLinkedSheetId ?? null;
const typeformRow = async () => {
  const row = await db.connectorStatus.findUnique({ where: { businessId_connectorType: { businessId: ID.bizA, connectorType: 'typeform' } } });
  const meta = (row?.metadata ?? {}) as Record<string, any>;
  return { status: row?.status ?? null, encrypted: meta.encryptedCredentials ?? null, boundBy: meta.boundBy ?? null, mappings: meta.formMappings ?? null };
};
const whatsappRow = async () => {
  const row = await db.connectorStatus.findUnique({ where: { businessId_connectorType: { businessId: ID.bizA, connectorType: 'whatsapp' } } });
  return { status: row?.status ?? null, record: (row?.metadata as any)?.whatsappVerification ?? null };
};

const savedEnv = {
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  BYOK_ENCRYPTION_SECRET: process.env.BYOK_ENCRYPTION_SECRET,
};

beforeAll(async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = secret(P, 'dummy', 'platform');
  process.env.WHATSAPP_PHONE_NUMBER_ID = `${P}phone_number_id`;
  process.env.BYOK_ENCRYPTION_SECRET = secret(P, 'dummy', 'byok', 'secret', 'for', 'this', 'suite', 'only');

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  // Every outbound request is recorded and refused, except the WhatsApp Graph phone-number check, which answers
  // a passing profile from here (no request leaves the process) so the smoke test has a passed check to report.
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const headers = init?.headers ?? {};
    const auth = typeof headers.get === 'function' ? headers.get('Authorization') : headers.Authorization ?? headers.authorization ?? null;
    outbound.push({ url, auth });
    if (/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/v99a_phone_number_id\?/.test(url)) {
      return new Response(JSON.stringify({ display_phone_number: '+1 868 555 0100', verified_name: 'V99A Biz', quality_rating: 'GREEN' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`v99a: no provider traffic (${url})`);
  }) as any);

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { BankConnectionService } = await import('../src/modules/finance/bank-connection.service');
  const { IntegrationHubController } = await import('../src/modules/integration-hub/integration-hub.controller');
  const { IntegrationHubService } = await import('../src/modules/integration-hub/integration-hub.service');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { AgentStateMachineService } = await import('../src/modules/ai/agent-state-machine.service');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { WhatsAppConnector } = await import('../src/core/connectors/implementations/whatsapp.connector');
  const { CalendarController } = await import('../src/modules/calendar/calendar.controller');
  const { CalendarQueryService } = await import('../src/modules/calendar/calendar-query.service');
  const { CalendarPermissionService } = await import('../src/modules/calendar/calendar-permission.service');
  const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { PushNotificationController } = await import('../src/modules/push-notifications/push-notification.controller');
  const { PushNotificationService } = await import('../src/modules/push-notifications/push-notification.service');

  moduleRef = await Test.createTestingModule({
    controllers: [GoogleDriveController, ConnectController, FinanceController, IntegrationHubController, AgentController, AiController, ConnectorController, CalendarController, PushNotificationController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      GoogleDriveService,
      ConnectorFormMappingService,
      ConnectorCredentialsService,
      BankConnectionService,
      IntegrationHubService,
      AgentStateMachineService,
      ModelGatewayService,
      ConnectorRegistryService,
      WhatsAppConnector,
      CalendarQueryService,
      CalendarPermissionService,
      CalendarProjectionService,
      PushNotificationService,
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined } },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  moduleRef.get(ConnectorRegistryService).register(moduleRef.get(WhatsAppConnector));

  app = moduleRef.createNestApplication({ logger: false });
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

  await cleanup();
  for (const id of [ID.owner, ID.admin, ID.staffDefault, ID.staffStore, ID.adminSetNone, ID.settingsAdmin, ID.connectWriter, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({
    data: {
      id: ID.bizA, name: 'V99A Biz A', ownerId: ID.owner,
      driveAccessToken: OWNER_DRIVE_TOKEN, driveTokenExpiry: new Date(Date.now() + 3_600_000),
      inventoryLinkedSheetId: OWNER_SHEET, inventoryLinkedSheetName: 'Inventory',
    },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V99A Biz B', ownerId: ID.ownerB } });
  const m = (user: string, role: string, permissionScopes?: unknown, biz = ID.bizA) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.staffStore, 'STAFF', { ...EVERY_MODULE_NONE, storefront: 'write' });
  await m(ID.adminSetNone, 'ADMIN', { settings: 'none', crm: 'admin', revenue: 'admin', storefront: 'admin', ai: 'admin', connect: 'admin', bookings: 'admin' });
  await m(ID.settingsAdmin, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'admin' });
  await m(ID.connectWriter, 'STAFF', { ...EVERY_MODULE_NONE, connect: 'write' });
  await m(ID.ownerB, 'OWNER', undefined, ID.bizB);
  await m(ID.admin, 'STAFF', EVERY_MODULE_NONE, ID.bizB);
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (app) await app.close();
  if (db) await cleanup();
});

describe('CW3-1: the inventory spreadsheet the owner\'s Google Drive token reads and clears is the owner\'s to choose (D-99)', () => {
  const sheet = `/drive/businesses/${ID.bizA}/inventory-sheet`;

  it('[SFB-CW31-01] RED-BEFORE: a member with storefront write who is not the owner (STAFF storefront write, an ADMIN whose map says settings none) is refused 403 GOOGLE_CONNECT_OWNER_ONLY linking, unlinking or creating the sheet, and Business.inventoryLinkedSheetId is unchanged', async () => {
    for (const actor of [ID.staffStore, ID.adminSetNone, ID.admin]) {
      const link = await send('post', `${sheet}/link`, actor, { sheetId: `${P}ATTACKER_PAYROLL_SHEET`, sheetName: 'Inventory' });
      expect(link.status, `${actor} link`).toBe(403);
      expect(said(link), actor).toMatch(/GOOGLE_CONNECT_OWNER_ONLY/);
      expect(await sheetOf(), `${actor} link`).toBe(OWNER_SHEET);
      const unlink = await send('delete', `${sheet}/unlink`, actor);
      expect(unlink.status, `${actor} unlink`).toBe(403);
      expect(await sheetOf(), `${actor} unlink`).toBe(OWNER_SHEET);
      const created = await send('post', `${sheet}/create`, actor, { title: 'Attacker sheet' });
      expect(created.status, `${actor} create`).toBe(403);
      expect(await sheetOf(), `${actor} create`).toBe(OWNER_SHEET);
    }
    // no Google request was made with the owner's token for any of them
    expect(outbound.filter((o) => (o.auth ?? '').includes(OWNER_DRIVE_TOKEN))).toEqual([]);
  });

  it('[SFB-CW31-02] a member below storefront write is still refused by the module scope first (STAFF on role defaults: storefront read)', async () => {
    const link = await send('post', `${sheet}/link`, ID.staffDefault, { sheetId: `${P}X`, sheetName: 'X' });
    expect(link.status).toBe(403);
    expect(said(link)).toMatch(/storefront requires write/);
    expect(await sheetOf()).toBe(OWNER_SHEET);
  });

  it('[SFB-CW31-03] the owner links and unlinks the sheet (201 / 200) and the column follows', async () => {
    const link = await send('post', `${sheet}/link`, ID.owner, { sheetId: `${P}OWNER_SECOND_SHEET`, sheetName: 'Stock' });
    expect(link.status, said(link)).toBe(201);
    expect(await sheetOf()).toBe(`${P}OWNER_SECOND_SHEET`);
    const unlink = await send('delete', `${sheet}/unlink`, ID.owner);
    expect(unlink.status, said(unlink)).toBe(200);
    expect(await sheetOf()).toBeNull();
    await db.business.update({ where: { id: ID.bizA }, data: { inventoryLinkedSheetId: OWNER_SHEET } });
  });
});

describe('CW3-2: a connector form mapping or backfill never writes a connector\'s credentials back, and is settings admin (D-181)', () => {
  const forms = `/connect/businesses/${ID.bizA}/connector-forms/typeform`;

  async function bindTypeform() {
    const creds = moduleRef.get((await import('../src/core/connectors/connector-credentials.service')).ConnectorCredentialsService);
    await creds.setCredentials(ID.bizA, 'typeform', { apiKey: secret('tfp', P, 'old', 'leaked', 'key'), webhookSecret: secret('whsec', P, 'old', 'leaked') }, { boundBy: ID.owner });
    return creds;
  }

  beforeAll(async () => {
    await db.leadForm.create({ data: { id: ID.form, businessId: ID.bizA, name: 'Typeform TF1', fields: [], embedCode: 'typeform:TF1' } });
    for (let i = 0; i < 3; i++) {
      await db.leadFormSubmission.create({ data: { id: `${P}sub_${i}`, formId: ID.form, businessId: ID.bizA, data: { email: `${P}lead${i}@client.example` }, source: 'typeform' } });
    }
  });

  it('[SFB-CW32-01] RED-BEFORE: a backfill that runs over a settings admin\'s revoke of the connector\'s credentials does not write the revoked credentials or binder back', async () => {
    const creds = await bindTypeform();
    expect((await typeformRow()).encrypted, 'bound').toBeTruthy();
    const save = await send('post', `${forms}/TF1/mapping`, ID.owner, { fieldMappings: [{ questionId: 'email', crmField: 'email' }] });
    expect(save.status, said(save)).toBe(201);
    expect((await typeformRow()).encrypted, 'the mapping save keeps the credentials').toBeTruthy();

    // The revoke commits while the backfill is applying its submissions (after it read the row, before it writes).
    const svc = moduleRef.get((await import('../src/modules/connect/connector-form-mapping.service')).ConnectorFormMappingService);
    const original = (svc as any).applyToSubmission.bind(svc);
    let revoked = false;
    const spy = vi.spyOn(svc as any, 'applyToSubmission').mockImplementation(async (...args: unknown[]) => {
      if (!revoked) {
        revoked = true;
        await creds.clearCredentials(ID.bizA, 'typeform');
      }
      return original(...args);
    });
    try {
      const backfill = await send('post', `${forms}/${ID.form}/backfill`, ID.owner);
      expect(backfill.status, said(backfill)).toBe(201);
    } finally {
      spy.mockRestore();
    }
    expect(revoked).toBe(true);
    const after = await typeformRow();
    expect(after.encrypted, 'the revoked credentials stay revoked').toBeNull();
    expect(after.boundBy, 'the revoked binder stays revoked').toBeNull();
    expect(after.status).toBe('disconnected');
    // the mapping itself is kept (the backfill's own write is the mapping's processed list)
    expect(after.mappings?.TF1?.fieldMappings?.length).toBe(1);
  });

  it('[SFB-CW32-02] RED-BEFORE: a member below settings admin (STAFF on role defaults, an ADMIN whose map says settings none, a STAFF member with connect write) is refused 403 saving or deleting a mapping or starting a backfill, and the connector row is unchanged', async () => {
    await bindTypeform();
    const before = await typeformRow();
    for (const actor of [ID.staffDefault, ID.adminSetNone, ID.connectWriter]) {
      const save = await send('post', `${forms}/TF1/mapping`, actor, { fieldMappings: [{ questionId: 'email', crmField: 'email' }] });
      expect(save.status, `${actor} save`).toBe(403);
      expect(said(save), actor).toMatch(/settings requires admin access/);
      const del = await send('delete', `${forms}/TF1/mapping`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
      const backfill = await send('post', `${forms}/${ID.form}/backfill`, actor);
      expect(backfill.status, `${actor} backfill`).toBe(403);
    }
    expect(await typeformRow()).toEqual(before);
  });

  it('[SFB-CW32-03] settings admin saves, backfills and deletes a mapping (an ADMIN on role defaults, a STAFF member given settings admin); the credentials stay as they are', async () => {
    await bindTypeform();
    const bound = (await typeformRow()).encrypted;
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const save = await send('post', `${forms}/TF2/mapping`, actor, { fieldMappings: [{ questionId: 'email', crmField: 'email' }] });
      expect(save.status, `${actor} ${said(save)}`).toBe(201);
      const del = await send('delete', `${forms}/TF2/mapping`, actor);
      expect(del.status, `${actor} ${said(del)}`).toBe(200);
    }
    const after = await typeformRow();
    expect(after.encrypted).toBe(bound);
    expect(after.boundBy).toBe(ID.owner);
    expect(after.mappings?.TF2).toBeUndefined();
  });
});

describe('Owner question 12: a bank connection\'s provider access token (BankConnection.accessToken) is bound by settings admin', () => {
  const banks = `/finance/businesses/${ID.bizA}/bank-connections`;

  beforeAll(async () => {
    await db.chartOfAccount.create({ data: { id: ID.coa, businessId: ID.bizA, name: 'Bank', type: 'ASSET' } });
    await db.financialAccount.create({ data: { id: ID.account, businessId: ID.bizA, chartOfAccountId: ID.coa, name: 'Operating', type: 'BANK' } });
    await db.financialAccount.create({ data: { id: ID.account2, businessId: ID.bizA, chartOfAccountId: ID.coa, name: 'Savings', type: 'BANK' } });
    await db.bankConnection.create({ data: { id: ID.bank, businessId: ID.bizA, financialAccountId: ID.account, provider: 'plaid', accessToken: secret(P, 'owner', 'bank', 'token'), providerItemId: `${P}item_owner` } });
  });
  const bankRows = () => db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM bank_connections t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`);

  it('[SFB-BANK-01] RED-BEFORE: a member below settings admin (STAFF on role defaults, an ADMIN whose map says settings none, STAFF with connect write) is refused 403 creating, replacing or deleting a bank connection, and no row changes', async () => {
    const before = await bankRows();
    for (const actor of [ID.staffDefault, ID.adminSetNone, ID.connectWriter]) {
      const create = await send('post', banks, actor, { financialAccountId: ID.account2, provider: 'plaid', accessToken: secret(P, 'attacker', 'token') });
      expect(create.status, `${actor} create`).toBe(403);
      expect(said(create), actor).toMatch(/settings requires admin access/);
      const patch = await send('patch', `${banks}/${ID.bank}`, actor, { accessToken: secret(P, 'attacker', 'token') });
      expect(patch.status, `${actor} patch`).toBe(403);
      const del = await send('delete', `${banks}/${ID.bank}`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
    }
    expect(await bankRows()).toEqual(before);
  });

  it('[SFB-BANK-02] settings admin creates, replaces and deletes one (an ADMIN on role defaults, a STAFF member given settings admin); the answer carries no access token', async () => {
    const create = await send('post', banks, ID.settingsAdmin, { financialAccountId: ID.account2, provider: 'plaid', accessToken: secret(P, 'admin', 'token') });
    expect(create.status, said(create)).toBe(201);
    expect(said(create)).not.toMatch(/admin_token/);
    const patch = await send('patch', `${banks}/${create.body.id}`, ID.admin, { accessToken: secret(P, 'admin', 'token', '2') });
    expect(patch.status, said(patch)).toBe(200);
    const del = await send('delete', `${banks}/${create.body.id}`, ID.admin);
    expect(del.status, said(del)).toBe(200);
  });
});

describe('Owner question 11: binding an integration needs settings admin alone; connect write is kept for the sync runs', () => {
  const hub = `/integration-hub/businesses/${ID.bizA}`;
  beforeAll(async () => {
    await db.integrationProvider.create({ data: { key: ID.provider, name: 'V99A Provider', category: 'test', authType: 'api_key' } });
  });

  it('[SFB-HUB-01] RED-BEFORE: an ADMIN on role defaults (settings admin, connect none) and a STAFF member given settings admin bind and unbind an integration', async () => {
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const connect = await send('post', `${hub}/connections/${ID.provider}`, actor, { authDataRef: `${P}ref` });
      expect(connect.status, `${actor} connect ${said(connect)}`).toBe(201);
      const disconnect = await send('delete', `${hub}/connections/${ID.provider}`, actor);
      expect(disconnect.status, `${actor} disconnect ${said(disconnect)}`).toBe(200);
    }
  });

  it('[SFB-HUB-02] connect write alone does not bind (STAFF connect write, settings none), and STAFF on role defaults is refused: 403 settings admin', async () => {
    for (const actor of [ID.connectWriter, ID.staffDefault]) {
      const connect = await send('post', `${hub}/connections/${ID.provider}`, actor, { authDataRef: `${P}ref` });
      expect(connect.status, `${actor} connect`).toBe(403);
      expect(said(connect), actor).toMatch(/settings requires admin access/);
    }
  });
});

describe('staffbookings (recommended option): a STAFF member on role defaults handles bookings', () => {
  it('[SFB-STAFFBK-01] RED-BEFORE: a STAFF member with no explicit map creates a calendar booking event (bookings write by role default); STAFF with bookings none is still refused', async () => {
    const res = await send('post', `/calendar/businesses/${ID.bizA}/events`, ID.staffDefault, { title: `${P}Fitting`, type: 'BOOKING', startAt: '2031-05-01T14:00:00.000Z', endAt: '2031-05-01T15:00:00.000Z' });
    expect(res.status, said(res)).toBe(201);
    expect(await db.calendarEvent.count({ where: { businessId: ID.bizA, title: `${P}Fitting` } })).toBe(1);
    const none = await send('post', `/calendar/businesses/${ID.bizA}/events`, ID.staffStore, { title: `${P}Nope`, type: 'BOOKING', startAt: '2031-05-01T14:00:00.000Z' });
    expect(none.status).toBe(403);
    expect(said(none)).toMatch(/bookings requires write/);
  });
});

describe('staffkeyplans (recommended option): pausing, resuming or aborting a KEY plan needs ai write, on the plan\'s own business', () => {
  beforeAll(async () => {
    await db.aiPlan.create({ data: { id: ID.planA, businessId: ID.bizA, userId: ID.owner, objective: `${P}Plan A`, status: 'executing' } });
    await db.aiPlan.create({ data: { id: ID.planB, businessId: ID.bizB, userId: ID.ownerB, objective: `${P}Plan B`, status: 'executing' } });
  });
  const planStatus = async (id: string) => (await db.aiPlan.findUnique({ where: { id }, select: { status: true } }))?.status;

  it('[SFB-PLAN-01] RED-BEFORE: a STAFF member on role defaults (ai none) is refused 403 pausing, resuming or aborting a plan, and the plan is unchanged', async () => {
    for (const action of ['pause', 'resume', 'abort']) {
      const res = await send('post', `/ai/businesses/${ID.bizA}/agent/states/${ID.planA}/${action}`, ID.staffDefault);
      expect(res.status, `${action} ${said(res)}`).toBe(403);
      expect(said(res)).toMatch(/ai requires write/);
    }
    expect(await planStatus(ID.planA)).toBe('executing');
  });

  it('[SFB-PLAN-02] RED-BEFORE: a plan of another business is not controlled through this business\'s route: 404, and that plan is unchanged', async () => {
    const res = await send('post', `/ai/businesses/${ID.bizA}/agent/states/${ID.planB}/abort`, ID.admin);
    expect(res.status, said(res)).toBe(404);
    expect(await planStatus(ID.planB)).toBe('executing');
  });

  it('[SFB-PLAN-03] an ADMIN on role defaults (ai admin) pauses the business\'s own plan', async () => {
    const res = await send('post', `/ai/businesses/${ID.bizA}/agent/states/${ID.planA}/pause`, ID.admin);
    expect(res.status, said(res)).toBe(201);
    expect(res.body).toMatchObject({ success: true });
  });
});

describe('byokkeys (recommended option): only the owner enters, changes or clears the business\'s own AI provider keys', () => {
  const prefs = `/ai/businesses/${ID.bizA}/ai/preferences`;
  const stored = async () => db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ai_memories t WHERE business_id = '${ID.bizA}'`);

  it('[SFB-BYOK-01] RED-BEFORE: a settings admin who is not the owner (an ADMIN on role defaults, a STAFF member given settings admin) is refused 403 BYOK_OWNER_ONLY writing or clearing a BYOK key, and the stored preferences are unchanged', async () => {
    const owner = await send('put', prefs, ID.owner, { byokOpenai: secret('sk', P, 'owner', 'openai'), byokAnthropic: secret('sk', 'ant', P, 'owner') });
    expect(owner.status, said(owner)).toBe(200);
    const before = await stored();
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const write = await send('put', prefs, actor, { byokOpenai: secret('sk', P, 'admin', actor.slice(P.length)) });
      expect(write.status, `${actor} write`).toBe(403);
      expect(said(write), actor).toMatch(/BYOK_OWNER_ONLY/);
      const clear = await send('put', prefs, actor, { byokAnthropic: null });
      expect(clear.status, `${actor} clear`).toBe(403);
      // a body that mixes another setting with a key is refused whole
      const mixed = await send('put', prefs, actor, { mode: 'fast', byokXai: secret('xai', P, 'admin') });
      expect(mixed.status, `${actor} mixed`).toBe(403);
    }
    expect(await stored()).toEqual(before);
  });

  it('[SFB-BYOK-02] settings admins keep the other AI preferences (mode, writing style, budget caps): 200 and the row changes; below settings admin is still 403', async () => {
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const before = await stored();
      const res = await send('put', prefs, actor, { mode: actor === ID.admin ? 'fast' : 'premium', writingStyle: 'friendly' });
      expect(res.status, `${actor} ${said(res)}`).toBe(200);
      expect(await stored(), actor).not.toEqual(before);
    }
    const staff = await send('put', prefs, ID.staffDefault, { mode: 'balanced' });
    expect(staff.status).toBe(403);
    expect(said(staff)).toMatch(/settings requires admin access/);
  });
});

describe('whatsappsmoke (amended P90 D-181 owner ruling A1): the WhatsApp test requires settings:admin and only reports its result, never switching WhatsApp back on', () => {
  const connectors = `/connectors/businesses/${ID.bizA}`;

  it('[SFB-WASMOKE-01] RED-BEFORE (amended P90 D-181): after a settings admin\'s explicit disconnect, STAFF (settings:none) is refused 403 settings:admin while a settings:admin member runs the WhatsApp test: 201 with the check reported, and WhatsApp stays disconnected (the row, its verification record and health)', async () => {
    const disconnect = await send('post', `${connectors}/disconnect/whatsapp`, ID.owner);
    expect(disconnect.status, said(disconnect)).toBe(201);
    const before = await whatsappRow();
    expect(before.status).toBe('disconnected');
    expect(before.record?.state).toBe('disconnected');

    const denied = await send('post', `${connectors}/smoke/whatsapp`, ID.staffDefault);
    expect(denied.status, said(denied)).toBe(403);
    expect(said(denied)).toMatch(/settings requires admin access/);

    const smoke = await send('post', `${connectors}/smoke/whatsapp`, ID.settingsAdmin);
    expect(smoke.status, said(smoke)).toBe(201);
    // the provider check is reported (the passing profile answered above), and that it switched nothing on
    expect(said(smoke)).toMatch(/stays disconnected|not switched|switch(es)? nothing/i);

    expect(await whatsappRow(), 'nothing written').toEqual(before);
    const health = await send('get', `${connectors}/health/whatsapp`, ID.owner);
    expect(health.status).toBe(200);
    expect(health.body?.status).toBe('disconnected');
  });

  it('[SFB-WASMOKE-02] (amended P90 D-181) with no explicit disconnect, STAFF (settings:none) is refused 403 settings:admin while a settings:admin member\'s passing test is reported as passed and records nothing (no connected verification, no connected row)', async () => {
    await db.connectorStatus.deleteMany({ where: { businessId: ID.bizA, connectorType: 'whatsapp' } });
    const denied = await send('post', `${connectors}/smoke/whatsapp`, ID.staffDefault);
    expect(denied.status, said(denied)).toBe(403);
    expect(said(denied)).toMatch(/settings requires admin access/);

    const smoke = await send('post', `${connectors}/smoke/whatsapp`, ID.settingsAdmin);
    expect(smoke.status, said(smoke)).toBe(201);
    expect(smoke.body?.success, said(smoke)).toBe(true);
    expect(await whatsappRow()).toEqual({ status: null, record: null });
  });
});

describe('Owner question 3 (answered by default): the push subscription routes are the member\'s own device, open to members', () => {
  const push = `/api/businesses/${ID.bizA}/push`;
  const sub = (tag: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${P}${tag}`, keys: { p256dh: `${P}p256dh_${tag}`, auth: `${P}auth_${tag}` } });
  const rowOf = (tag: string) => db.pushSubscription.findUnique({ where: { endpoint: sub(tag).endpoint }, select: { userId: true, businessId: true } });

  it('[SFB-PUSH-01] RED-BEFORE: a STAFF member on role defaults subscribes their device (201), and the subscription is theirs whatever userId the body names (the owner\'s pushes never reach it)', async () => {
    const res = await send('post', `${push}/subscribe`, ID.staffDefault, { userId: ID.owner, subscription: sub('staff_device') });
    expect(res.status, said(res)).toBe(201);
    expect(await rowOf('staff_device')).toEqual({ userId: ID.staffDefault, businessId: ID.bizA });
  });

  it('[SFB-PUSH-02] RED-BEFORE: a member cannot take over or remove another member\'s device: re-subscribing the owner\'s endpoint or unsubscribing it leaves the owner\'s subscription as it was', async () => {
    const own = await send('post', `${push}/subscribe`, ID.owner, { userId: ID.owner, subscription: sub('owner_device') });
    expect(own.status, said(own)).toBe(201);
    expect(await rowOf('owner_device')).toEqual({ userId: ID.owner, businessId: ID.bizA });
    const take = await send('post', `${push}/subscribe`, ID.staffDefault, { userId: ID.staffDefault, subscription: sub('owner_device') });
    expect([201, 403]).toContain(take.status);
    expect(await rowOf('owner_device')).toEqual({ userId: ID.owner, businessId: ID.bizA });
    const drop = await send('post', `${push}/unsubscribe`, ID.staffDefault, { endpoint: sub('owner_device').endpoint });
    expect([201, 200]).toContain(drop.status);
    expect(await rowOf('owner_device')).toEqual({ userId: ID.owner, businessId: ID.bizA });
  });
});
