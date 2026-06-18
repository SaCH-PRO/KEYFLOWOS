import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhatsAppController } from '../src/modules/whatsapp/whatsapp.controller';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';

describe('WhatsApp KEYInbox webhook smoke (B.5)', () => {
  let app: INestApplication;
  let receiveInbound: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
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
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: 'user_smoke', role: 'USER' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    receiveInbound.mockClear();
  });

  it('parses a Twilio inbound webhook payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .send({
        From: 'whatsapp:+18681234567',
        Body: 'Twilio smoke message',
        ProfileName: 'Smoke User',
        SmsMessageSid: 'SMsmoke001',
      })
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
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .send({
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
      })
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
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook/biz_smoke')
      .send({ unknown: 'payload' })
      .expect(201);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Unrecognized WhatsApp webhook payload');
    expect(receiveInbound).not.toHaveBeenCalled();
  });
});
