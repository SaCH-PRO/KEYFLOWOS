import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WhatsAppController, WhatsAppOperationsScopeGuard } from '../src/modules/whatsapp/whatsapp.controller';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../src/core/auth/module-scope.guard';

function metaSignature(body: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${sig}`;
}

/**
 * X-Twilio-Signature as Twilio computes it: HMAC-SHA1 under the account's auth token over the full
 * URL followed by every POST parameter's name and value, sorted by name, base64-encoded
 * (https://www.twilio.com/docs/usage/security#validating-requests). Before V1-21c this helper, and
 * the controller, used HMAC-SHA256, so a genuine Twilio delivery was refused.
 */
function twilioSignature(url: string, params: Record<string, string>, authToken: string, algorithm: 'sha1' | 'sha256' = 'sha1'): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac(algorithm, authToken).update(payload).digest('base64');
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
  // V1-21b review 9 WB-2: a Meta body is taken on /whatsapp/webhook/:businessId only for a number
  // that business connected
  // webhook_events: @@unique([provider, providerEventId]), as the real table refuses a second claim
  const claimed = new Set<string>();
  const prisma: any = {
    client: {
      business: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.id === 'biz_1' && where.metaData?.equals === 'pn_biz_1' ? { id: 'biz_1' } : null,
        ),
      },
      webhookEvent: {
        create: vi.fn(async ({ data }: any) => {
          const key = `${data.provider}|${data.providerEventId}`;
          if (claimed.has(key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          claimed.add(key);
          return { id: `we_${claimed.size}`, ...data };
        }),
      },
    },
  };
  const controller = new WhatsAppController(service, webhookLogger, prisma);

  beforeEach(() => {
    vi.clearAllMocks();
    claimed.clear();
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
    const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn_biz_1' }, messages: [{ from: '123', id: 'm1', timestamp: '1700000000', text: { body: 'hi' } }] } }] }] };
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

  it("refuses a validly signed Meta payload for a number the business has not connected (V1-21b review 9 WB-2)", async () => {
    for (const metadata of [{ phone_number_id: 'pn_biz_2' }, {}]) {
      const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata, messages: [{ from: '123', id: 'm2', text: { body: 'YES' } }] } }] }] };
      const raw = JSON.stringify(body);
      await expect(
        controller.webhook('biz_1', body as any, undefined, undefined, undefined, makeReq({ headers: { 'x-hub-signature-256': metaSignature(raw, SECRET) }, rawBody: raw })),
      ).rejects.toThrow(/not connected to this business|names no phone_number_id/);
    }
    expect(service.receiveInbound).not.toHaveBeenCalled();
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

  // ─── V1-21c TW-SHA1: the scheme Twilio signs with ─────────────────────────

  it("[TW-1] Twilio's published test vector is accepted (auth token '12345', HMAC-SHA1 over the URL and the sorted params)", async () => {
    // The request of Twilio's security documentation and twilio-node's validateRequest spec.
    process.env.TWILIO_AUTH_TOKEN = '12345';
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
    const req = makeReq({
      headers: { host: 'mycompany.com', 'x-twilio-signature': 'RSOYDt4T1cUTdK1PDd93/VVr8B8=' },
      originalUrl: '/myapp.php?foo=1&bar=2',
    });
    // premise: the vector is this file's helper's output (so the helper signs as Twilio does)
    expect(twilioSignature('https://mycompany.com/myapp.php?foo=1&bar=2', params, '12345')).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    const res = await controller.webhook('biz_1', params as any, undefined, undefined, undefined, req);
    expect(res).toMatchObject({ success: true });
    expect(service.receiveInbound).toHaveBeenCalledWith('biz_1', expect.objectContaining({ from: '+14158675309', provider: 'twilio' }));
  });

  it('[TW-2] the same request signed with HMAC-SHA256 is refused, and reaches no service', async () => {
    const body = { From: 'whatsapp:+123', Body: 'YES', SmsMessageSid: 'SM2', ProfileName: 'Test' };
    const url = 'https://api.keyflow.test/whatsapp/webhook/biz_1';
    const sha256 = twilioSignature(url, body, TOKEN, 'sha256');
    await expect(
      controller.webhook('biz_1', body as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': sha256 } })),
    ).rejects.toThrow(/Invalid Twilio webhook signature/);
    expect(service.receiveInbound).not.toHaveBeenCalled();
  });

  it('[TW-3] a tampered request (a field changed after signing, or another business\'s URL) is refused', async () => {
    const body = { From: 'whatsapp:+123', Body: 'hello', SmsMessageSid: 'SM3' };
    const sig = twilioSignature('https://api.keyflow.test/whatsapp/webhook/biz_1', body, TOKEN);
    await expect(
      controller.webhook('biz_1', { ...body, Body: 'YES' } as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': sig } })),
    ).rejects.toThrow(/Invalid Twilio webhook signature/);
    await expect(
      controller.webhook('biz_2', body as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': sig }, originalUrl: '/whatsapp/webhook/biz_2' })),
    ).rejects.toThrow(/Invalid Twilio webhook signature/);
    expect(service.receiveInbound).not.toHaveBeenCalled();
  });

  // ─── V1-21c WB3-SHIFT: a signed request is acted on once, however its fields are cut ──

  it('[WB3-SHIFT] a captured signature replayed with a key/value boundary moved (a new message id) is dropped before the service', async () => {
    const url = 'https://api.keyflow.test/whatsapp/webhook/biz_1';
    const original = { From: 'whatsapp:+123', Body: 'YES', MessageSid: 'SMshift1', SmsMessageSid: 'SMshift1' };
    const sig = twilioSignature(url, original, TOKEN);
    const first = await controller.webhook('biz_1', original as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': sig } }));
    expect(first).toMatchObject({ success: true });
    expect(service.receiveInbound).toHaveBeenCalledTimes(1);
    expect(service.receiveInbound).toHaveBeenLastCalledWith('biz_1', expect.objectContaining({ externalId: 'SMshift1' }));

    // 'MessageSidSMshift1SmsMessageSidSMshift1' cut as MessageSid='SMshift1SmsMessageSidSMshift1':
    // the signed string is unchanged, so the captured signature is still valid, and the message
    // id the per-message dedupe keys on is new.
    const shifted = { From: 'whatsapp:+123', Body: 'YES', MessageSid: 'SMshift1SmsMessageSidSMshift1' };
    expect(twilioSignature(url, shifted, TOKEN)).toBe(sig);
    const replay = await controller.webhook('biz_1', shifted as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': sig } }));
    expect(replay).toMatchObject({ success: true, duplicate: true });
    expect(service.receiveInbound).toHaveBeenCalledTimes(1);

    // the claim keeps no replayable copy of the signature
    expect(JSON.stringify(prisma.client.webhookEvent.create.mock.calls)).not.toContain(sig);

    // control: a new message, freshly signed, is taken
    const next = { From: 'whatsapp:+123', Body: 'YES', MessageSid: 'SMshift2', SmsMessageSid: 'SMshift2' };
    await controller.webhook('biz_1', next as any, undefined, undefined, undefined, makeReq({ headers: { 'x-twilio-signature': twilioSignature(url, next, TOKEN) } }));
    expect(service.receiveInbound).toHaveBeenCalledTimes(2);
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
