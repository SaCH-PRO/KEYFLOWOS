import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';

describe('WebhooksController', () => {
  let app: INestApplication;
  const markInvoicePaid = vi.fn().mockResolvedValue({ id: 'inv_1', status: 'PAID' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: CommerceService, useValue: { markInvoicePaid } }],
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
