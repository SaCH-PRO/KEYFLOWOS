import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookDispatcherService } from '../src/modules/webhooks/webhook-dispatcher.service';

describe('WebhooksController', () => {
  let app: INestApplication;
  const markInvoicePaid = vi.fn().mockResolvedValue({ id: 'inv_1', status: 'PAID' });
  const prismaMock = {
    client: {
      invoice: {
        findUnique: vi.fn().mockResolvedValue({
          businessId: 'biz_1',
          total: 100,
          currency: 'TTD',
        }),
      },
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: CommerceService, useValue: { markInvoicePaid } },
        { provide: PrismaService, useValue: prismaMock },
        { provide: WebhookDispatcherService, useValue: { sendTestEvent: vi.fn(), getDeliveryLogs: vi.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles stripe webhook and marks invoice paid', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .send({ invoiceId: 'inv_1' })
      .expect(201);

    expect(markInvoicePaid).toHaveBeenCalledWith('inv_1');
  });
});
