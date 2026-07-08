import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialController } from '../src/modules/social/social.controller';
import { MetaSocialIngestionService } from '../src/modules/social/meta-social-ingestion.service';
import { SocialService } from '../src/modules/social/social.service';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialAnalyticsService } from '../src/modules/social/social-analytics.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookIngressLoggerService } from '../src/core/connectors/webhook-ingress-logger.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

function metaSignature(body: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${sig}`;
}

describe('Social KEYInbox webhook smoke (B.6)', () => {
  let app: INestApplication;
  let receiveInbound: ReturnType<typeof vi.fn>;
  const originalVerifyToken = process.env.META_SOCIAL_VERIFY_TOKEN;
  const originalAppSecret = process.env.META_APP_SECRET;

  beforeAll(async () => {
    process.env.META_SOCIAL_VERIFY_TOKEN = 'meta_verify_123';
    process.env.META_APP_SECRET = 'meta_app_secret_smoke';

    receiveInbound = vi.fn().mockResolvedValue({
      contactId: 'contact_smoke',
      isNew: true,
      threadId: 'thread_smoke',
      messageId: 'msg_smoke',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [
        {
          provide: MetaSocialIngestionService,
          useValue: { receiveInbound },
        },
        {
          provide: SocialService,
          useValue: {},
        },
        {
          provide: SocialConnectionsService,
          useValue: {},
        },
        {
          provide: SocialAnalyticsService,
          useValue: {},
        },
        {
          provide: EventEmitter2,
          useValue: { emit: vi.fn() },
        },
        AuthGuard,
        BusinessGuard,
        {
          provide: PrismaService,
          useValue: {
            client: {
              business: {
                findUnique: vi.fn().mockResolvedValue({ id: 'biz_smoke' }),
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
    process.env.META_SOCIAL_VERIFY_TOKEN = originalVerifyToken;
    process.env.META_APP_SECRET = originalAppSecret;
    await app.close();
  });

  beforeEach(() => {
    receiveInbound.mockClear();
  });

  it('verifies Meta webhook subscription', async () => {
    const res = await request(app.getHttpServer())
      .get('/social/webhook/biz_smoke?hub.mode=subscribe&hub.verify_token=meta_verify_123&hub.challenge=CHALLENGE_VALUE')
      .expect(200);

    expect(res.text).toBe('CHALLENGE_VALUE');
    expect(receiveInbound).not.toHaveBeenCalled();
  });

  it('parses a Messenger DM payload', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page_1',
          time: 1458692752478,
          messaging: [
            {
              sender: { id: 'user_123' },
              recipient: { id: 'page_1' },
              timestamp: 1458692752478,
              message: { mid: 'mid.messenger.smoke', text: 'Messenger smoke message' },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(body);
    const sig = metaSignature(raw, process.env.META_APP_SECRET!);
    const res = await request(app.getHttpServer())
      .post('/social/webhook/biz_smoke')
      .set('x-hub-signature-256', sig)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.contactId).toBe('contact_smoke');
    expect(receiveInbound).toHaveBeenCalledWith(
      'biz_smoke',
      expect.objectContaining({ object: 'page' }),
    );
  });

  it('parses an Instagram DM payload', async () => {
    const body = {
      object: 'instagram',
      entry: [
        {
          id: 'ig_1',
          time: 1458692752478,
          messaging: [
            {
              sender: { id: 'ig_user_456' },
              recipient: { id: 'ig_1' },
              timestamp: 1458692752478,
              message: { mid: 'mid.instagram.smoke', text: 'Instagram smoke message' },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(body);
    const sig = metaSignature(raw, process.env.META_APP_SECRET!);
    const res = await request(app.getHttpServer())
      .post('/social/webhook/biz_smoke')
      .set('x-hub-signature-256', sig)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(receiveInbound).toHaveBeenCalledWith(
      'biz_smoke',
      expect.objectContaining({ object: 'instagram' }),
    );
  });

  it('returns error when ingestion fails', async () => {
    receiveInbound.mockRejectedValueOnce(new Error('Unrecognized Meta social webhook payload'));

    const body = { unknown: 'payload' };
    const raw = JSON.stringify(body);
    const sig = metaSignature(raw, process.env.META_APP_SECRET!);
    const res = await request(app.getHttpServer())
      .post('/social/webhook/biz_smoke')
      .set('x-hub-signature-256', sig)
      .send(body)
      .expect(201);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Unrecognized Meta social webhook payload');
  });
});
