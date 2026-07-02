import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { WhatsAppController } from '../src/modules/whatsapp/whatsapp.controller';

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
  const controller = new WhatsAppController(service);

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
