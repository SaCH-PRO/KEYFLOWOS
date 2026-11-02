import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WhatsAppController, WhatsAppOperationsScopeGuard } from '../src/modules/whatsapp/whatsapp.controller';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../src/core/auth/module-scope.guard';

function metaSignature(body: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${sig}`;
}

function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha256', authToken).update(payload).digest('base64');
}

function makeReq(overrides: any = {}) {
  const { headers: headerOverrides, rawBody, ...rest } = overrides;
  return {
    protocol: 'https',
    headers: {
      host: 'api.keyflow.test',
      ...headerOverrides,
    },
    originalUrl: '/whatsapp/webhook/biz_1',
    rawBody: Buffer.from(rawBody ?? ''),
    ...rest,
  } as any;
}

describe('WhatsAppController webhook signatures', () => {
  const SECRET = 'app_secret_test';
  const TOKEN = 'twilio_auth_token_test';
  const service: any = {
    receiveInbound: vi.fn(async () => ({ contactId: 'c1', isNew: false })),
  };
  const webhookLogger: any = { log: vi.fn() };
  const controller = new WhatsAppController(service, webhookLogger);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_APP_SECRET = SECRET;
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
  });

  it('rejects a Meta payload with a bad signature', async () => {
    const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '123', id: 'm1', timestamp: '1700000000', text: { body: 'hi' } }] } }] }] };
    const raw = JSON.stringify(body);
    await expect(
      controller.webhook(
        'biz_1',
        body as any,
        undefined,
        undefined,
        undefined,
        makeReq({ headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody: raw }),
      ),
    ).rejects.toThrow(/signature/i);
  });

  it('accepts a Meta payload with a valid signature', async () => {
    const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '123', id: 'm1', timestamp: '1700000000', text: { body: 'hi' } }] } }] }] };
    const raw = JSON.stringify(body);
    const res = await controller.webhook(
      'biz_1',
      body as any,
      undefined,
      undefined,
      undefined,
      makeReq({ headers: { 'x-hub-signature-256': metaSignature(raw, SECRET) }, rawBody: raw }),
    );
    expect(res).toMatchObject({ success: true, contactId: 'c1', isNew: false });
  });

  it('rejects a Twilio payload with a bad signature', async () => {
    const body = { From: 'whatsapp:+123', Body: 'hi', SmsMessageSid: 'SM1', ProfileName: 'Test' };
    await expect(
      controller.webhook(
        'biz_1',
        body as any,
        undefined,
        undefined,
        undefined,
        makeReq({ headers: { 'x-twilio-signature': 'bad' }, rawBody: '' }),
      ),
    ).rejects.toThrow(/signature/i);
  });

  it('accepts a Twilio payload with a valid signature', async () => {
    const body = { From: 'whatsapp:+123', Body: 'hi', SmsMessageSid: 'SM1', ProfileName: 'Test' };
    const url = 'https://api.keyflow.test/whatsapp/webhook/biz_1';
    const sig = twilioSignature(url, body as unknown as Record<string, string>, TOKEN);
    const res = await controller.webhook(
      'biz_1',
      body as any,
      undefined,
      undefined,
      undefined,
      makeReq({ headers: { 'x-twilio-signature': sig }, rawBody: '' }),
    );
    expect(res).toMatchObject({ success: true, contactId: 'c1', isNew: false });
  });
});

/**
 * R0-SEC2-WHATSAPP-CONFIG-AUTHORITY: the guard set of every route, read from the
 * decorator metadata Nest enforces. The real-database proof is
 * test/whatsapp-config-authority.integration.test.ts; this pins the shape so a
 * new operator route cannot appear with AuthGuard and BusinessGuard alone.
 */
describe('WhatsAppController route guards (R0-SEC2)', () => {
  const OPERATOR: Record<string, { scope: { module: string; minLevel: string } | null }> = {
    // Any member reads the masked config; the write is OWNER only, checked in the handler.
    getConfig: { scope: null },
    saveConfig: { scope: null },
    sendMessage: { scope: { module: 'operations', minLevel: 'write' } },
    sendFromDrawer: { scope: { module: 'operations', minLevel: 'write' } },
    testConnection: { scope: { module: 'operations', minLevel: 'read' } },
    getStatus: { scope: { module: 'operations', minLevel: 'read' } },
    listConversations: { scope: { module: 'operations', minLevel: 'read' } },
    getConversation: { scope: { module: 'operations', minLevel: 'read' } },
    listTemplates: { scope: { module: 'operations', minLevel: 'read' } },
  };
  const WEBHOOKS = ['verifySharedWebhook', 'sharedWebhook', 'verifyWebhook', 'webhook'];
  const proto = WhatsAppController.prototype as unknown as Record<string, unknown>;
  const guardClasses = (name: string) =>
    (Reflect.getMetadata(GUARDS_METADATA, proto[name] as object) ?? []) as Array<{ name: string; prototype: object }>;
  const guardNames = (name: string) => guardClasses(name).map((g) => g.name);

  it('[SEC2-G01] every operator route runs AuthGuard and BusinessGuard, and each scoped one ModuleScopeGuard with its operations level', () => {
    for (const [name, { scope }] of Object.entries(OPERATOR)) {
      expect(typeof proto[name], `${name} exists`).toBe('function');
      const guards = guardNames(name);
      expect(guards.slice(0, 2), `${name}: ${guards.join(',')}`).toEqual(['AuthGuard', 'BusinessGuard']);
      expect(Reflect.getMetadata(MODULE_SCOPE_KEY, proto[name] as object) ?? null, `${name} scope`).toEqual(scope);
      // ModuleScopeGuard itself or WhatsAppOperationsScopeGuard, which extends it (review CR-SEC2-1).
      const scoped = guardClasses(name).filter((g) => g === (ModuleScopeGuard as unknown) || g.prototype instanceof ModuleScopeGuard);
      if (scope) expect(scoped.length, `${name}: ${guards.join(',')}`).toBe(1);
      else expect(scoped, `${name}: ${guards.join(',')}`).toEqual([]);
    }
  });

  it('[SEC2-G04] WhatsAppOperationsScopeGuard admits the config owner of the route\'s business without a membership row, and gives everyone else ModuleScopeGuard\'s answer (review CR-SEC2-1)', async () => {
    const requirement = { module: 'operations', minLevel: 'write' };
    const reflector = { get: vi.fn((key: string) => (key === MODULE_SCOPE_KEY ? requirement : undefined)) };
    const membership = { findUnique: vi.fn(async () => null) };
    const prisma = { client: { membership } };
    const isConfigOwner = vi.fn(async (businessId: string, actor?: { id?: string }) => businessId === 'bizL' && actor?.id === 'legacy');
    const guard = new WhatsAppOperationsScopeGuard(prisma as any, reflector as any, { isConfigOwner } as any);
    expect(guard).toBeInstanceOf(ModuleScopeGuard);
    const ctx = (req: Record<string, unknown>) =>
      ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}) }) as any;

    // The owner of the route's business: admitted, no membership read.
    await expect(guard.canActivate(ctx({ user: { id: 'legacy' }, params: { businessId: 'bizL' } }))).resolves.toBe(true);
    expect(isConfigOwner).toHaveBeenLastCalledWith('bizL', { id: 'legacy' });
    expect(membership.findUnique).not.toHaveBeenCalled();

    // Bound to the route's business: naming bizL in the body or query does not admit on bizW.
    await expect(
      guard.canActivate(ctx({ user: { id: 'legacy' }, params: { businessId: 'bizW' }, body: { businessId: 'bizL' }, query: { businessId: 'bizL' } })),
    ).rejects.toThrow('Not a member of this business');
    expect(isConfigOwner).toHaveBeenLastCalledWith('bizW', { id: 'legacy' });

    // Anyone else: ModuleScopeGuard's own answer (here a STAFF member on role defaults, operations: read < write).
    membership.findUnique.mockResolvedValueOnce({ role: 'STAFF', permissionScopes: null } as any);
    await expect(guard.canActivate(ctx({ user: { id: 'staff' }, params: { businessId: 'bizW' } }))).rejects.toThrow(
      /operations requires write access/,
    );
  });

  it('[SEC2-G02] the webhooks stay unauthenticated (no guards: the provider handshake and signature are their checks)', () => {
    for (const name of WEBHOOKS) {
      expect(typeof proto[name], `${name} exists`).toBe('function');
      expect(guardNames(name), name).toEqual([]);
    }
  });

  it('[SEC2-G03] no other route exists unclassified', () => {
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor' && typeof proto[n] === 'function' && Reflect.getMetadata('path', proto[n] as object) !== undefined,
    );
    expect(handlers.sort()).toEqual([...Object.keys(OPERATOR), ...WEBHOOKS].sort());
  });
});
