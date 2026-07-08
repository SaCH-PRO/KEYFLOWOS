import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhatsAppController } from '../src/modules/whatsapp/whatsapp.controller';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookIngressLoggerService } from '../src/core/connectors/webhook-ingress-logger.service';

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

describe('WhatsApp KEYInbox webhook smoke (B.5)', () => {
  let app: INestApplication;
  let receiveInbound: ReturnType<typeof vi.fn>;
  const originalAppSecret = process.env.WHATSAPP_APP_SECRET;
  const originalTwilioToken = process.env.TWILIO_AUTH_TOKEN;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = 'whats_app_secret_smoke';
    process.env.TWILIO_AUTH_TOKEN = 'twilio_auth_token_smoke';

    receiveInbound = vi.fn().mockResolvedValue({
      contactId: 'contact_smoke',
      isNew: true,
      merged: false,
      matchedOn: 'phone',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        {
          provide: WhatsAppService,
          useValue: {
            receiveInbound,
          },
        },
        AuthGuard,
        BusinessGuard,
        {
          provide: PrismaService,
          useValue: {
            client: {
              business: {
                findFirst: vi.fn().mockResolvedValue({ id: 'biz_smoke' }),
              },
            },
          },
        },
        {
          provide: WebhookIngressLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (chunks.length > 0) {
          req.rawBody = Buffer.concat(chunks);
        }
      });
      next();
    });
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user_smoke', role: 'USER' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    process.env.WHATSAPP_APP_SECRET = originalAppSecret;
    process.env.TWILIO_AUTH_TOKEN = originalTwilioToken;
    await app.close();
  });

  beforeEach(() => {
    receiveInbound.mockClear();
  });

  it('parses a Twilio inbound webhook payload', async () => {
    const body = {
      From: 'whatsapp:+18681234567',
      Body: 'Twilio smoke message',
      ProfileName: 'Smoke User',
      SmsMessageSid: 'SMsmoke001',
    };
    const url = 'https://api.keyflow.test/whatsapp/webhook/biz_smoke';
    const sig = twilioSignature(url, body, process.env.TWILIO_AUTH_TOKEN!);
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .set('x-twilio-signature', sig)
      .set('x-forwarded-proto', 'https')
      .set('host', 'api.keyflow.test')
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(receiveInbound).toHaveBeenCalledWith(
      'biz_smoke',
      expect.objectContaining({
        from: 'whatsapp:+18681234567',
        body: 'Twilio smoke message',
        senderName: 'Smoke User',
        externalId: 'SMsmoke001',
        provider: 'twilio',
        rawPayload: expect.objectContaining({ From: 'whatsapp:+18681234567' }),
      }),
    );
  });

  it('parses a Meta Cloud API inbound webhook payload', async () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.smoke002',
                    from: '18681234567',
                    timestamp: '1893456000',
                    text: { body: 'Meta smoke message' },
                  },
                ],
                contacts: [{ profile: { name: 'Meta Smoke User' }, wa_id: '18681234567' }],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(body);
    const sig = metaSignature(raw, process.env.WHATSAPP_APP_SECRET!);
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .set('x-hub-signature-256', sig)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(receiveInbound).toHaveBeenCalledWith(
      'biz_smoke',
      expect.objectContaining({
        from: '18681234567',
        body: 'Meta smoke message',
        senderName: 'Meta Smoke User',
        externalId: 'wamid.smoke002',
        provider: 'meta',
        receivedAt: new Date(1893456000 * 1000),
      }),
    );
  });

  it('rejects unrecognized payloads', async () => {
    const body = { unknown: 'payload' };
    const raw = JSON.stringify(body);
    const sig = metaSignature(raw, process.env.WHATSAPP_APP_SECRET!);
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .set('x-hub-signature-256', sig)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Unrecognized WhatsApp webhook payload');
    expect(receiveInbound).not.toHaveBeenCalled();
  });
});
