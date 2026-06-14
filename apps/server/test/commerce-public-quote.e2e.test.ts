import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { CommerceController } from '../src/modules/commerce/commerce.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { RecurringInvoiceService } from '../src/modules/commerce/recurring-invoice.service';
import { ReceiptService } from '../src/modules/commerce/receipt.service';
import { GmailService } from '../src/modules/commerce/gmail.service';
import { CommerceVisionService } from '../src/modules/commerce/commerce-vision.service';
import { StoreReadinessService } from '../src/modules/commerce/store-readiness.service';
import { CommerceStatsService } from '../src/modules/commerce/commerce-stats.service';
import { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import { PaymentEvidenceService } from '../src/modules/commerce/payment-evidence.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PublicEventsService } from '../src/modules/public-events/public-events.service';
import { RevenuePostingService } from '../src/modules/finance/revenue-posting.service';
import { CrmService } from '../src/modules/crm/crm.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { PublicRateLimitGuard } from '../src/core/guards/public-rate-limit.guard';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';

interface QuoteRow {
  id: string;
  businessId: string;
  contactId: string | null;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
  viewToken: string | null;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  sentAt: Date | null;
  invoiceId: string | null;
  expiryDate: Date | null;
  deletedAt: Date | null;
  total: number;
  currency: string;
}

class CommercePrismaMock {
  quotes: QuoteRow[] = [];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      quote: {
        findUnique: vi.fn(({ where, include, select }: any) => {
          const match = self.quotes.find((q) => {
            if (where.id) return q.id === where.id;
            if (where.viewToken) return q.viewToken === where.viewToken;
            return false;
          });
          if (!match) return Promise.resolve(null);
          if (include) {
            return Promise.resolve({
              ...match,
              contact: match.contactId
                ? { firstName: 'Test', lastName: 'User', email: 'user@example.com' }
                : null,
              items: [],
              invoice: match.invoiceId
                ? { id: match.invoiceId, invoiceNumber: 'INV-1', status: 'DRAFT', total: match.total }
                : null,
              business: {
                id: match.businessId,
                name: 'Acme',
                logoUrl: null,
                address: null,
                phone: null,
                email: null,
                website: null,
                primaryColor: null,
              },
            });
          }
          // Apply select projection (best-effort) — return the row as-is.
          return Promise.resolve({ ...match });
        }),
        update: vi.fn(({ where, data, include }: any) => {
          const idx = self.quotes.findIndex((q) => q.id === where.id);
          if (idx === -1) return Promise.resolve(null);
          self.quotes[idx] = { ...self.quotes[idx], ...data };
          const updated = self.quotes[idx];
          if (include) {
            return Promise.resolve({
              ...updated,
              contact: updated.contactId
                ? { id: updated.contactId, firstName: 'Test', lastName: 'User', email: 'user@example.com' }
                : null,
            });
          }
          return Promise.resolve(updated);
        }),
      },
      membership: {
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
    };
  }
}

const noopGuard = { canActivate: () => true };

describe('Commerce public quote e2e', () => {
  let app: INestApplication;
  let prisma: CommercePrismaMock;
  let events: EventEmitter2;
  let emitSpy: MockInstance<(event: string, ...args: any[]) => boolean>;
  let crm: { logContactEvent: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    prisma = new CommercePrismaMock();
    events = new EventEmitter2();
    crm = { logContactEvent: vi.fn().mockResolvedValue(undefined) };

    const statsCache = { invalidateCache: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [CommerceController],
      providers: [
        ModuleScopeGuard,
        PlanLimitGuard,
        TeamAuditInterceptor,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: CrmService, useValue: crm },
        { provide: SubscriptionsService, useValue: { checkLimit: vi.fn() } },
        { provide: CommerceStatsService, useValue: statsCache },
        { provide: InvoiceWorkflowService, useValue: {} },
        { provide: CatalogService, useValue: {} },
        { provide: PublicEventsService, useValue: {} },
        { provide: RevenuePostingService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: { get: vi.fn(), set: vi.fn(), del: vi.fn() } },
        CommerceService,
        { provide: RecurringInvoiceService, useValue: {} },
        { provide: ReceiptService, useValue: {} },
        { provide: GmailService, useValue: {} },
        { provide: CommerceVisionService, useValue: {} },
        { provide: StoreReadinessService, useValue: {} },
        { provide: PaymentEvidenceService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(noopGuard)
      .overrideGuard(BusinessGuard)
      .useValue(noopGuard)
      .overrideGuard(PublicRateLimitGuard)
      .useValue(noopGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.quotes = [];
    crm.logContactEvent.mockClear();
    emitSpy = vi.spyOn(events, 'emit');
  });

  function seedQuote(overrides: Partial<QuoteRow> = {}): QuoteRow {
    const quote: QuoteRow = {
      id: 'quote_1',
      businessId: 'biz_1',
      contactId: 'contact_1',
      status: 'SENT',
      viewToken: 'tok_active',
      viewedAt: null,
      acceptedAt: null,
      rejectedAt: null,
      sentAt: new Date(),
      invoiceId: null,
      expiryDate: null,
      deletedAt: null,
      total: 100,
      currency: 'TTD',
      ...overrides,
    };
    prisma.quotes.push(quote);
    return quote;
  }

  it('GET /commerce/public/quotes/:token marks the quote viewed once and emits quote.viewed', async () => {
    seedQuote();
    const agent = request(app.getHttpServer());

    const first = await agent.get('/commerce/public/quotes/tok_active').expect(200);
    expect(first.body.id).toBe('quote_1');
    expect(first.body.viewedAt).toBeTruthy();

    const viewedEvents = emitSpy.mock.calls.filter((c) => c[0] === 'quote.viewed');
    expect(viewedEvents).toHaveLength(1);
    expect(viewedEvents[0][1]).toMatchObject({ businessId: 'biz_1', source: 'public' });

    expect(crm.logContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'quote.viewed', contactId: 'contact_1', businessId: 'biz_1' }),
    );

    // Second view must be a no-op for events / CRM logging.
    emitSpy.mockClear();
    crm.logContactEvent.mockClear();
    await agent.get('/commerce/public/quotes/tok_active').expect(200);
    expect(emitSpy.mock.calls.filter((c) => c[0] === 'quote.viewed')).toHaveLength(0);
    expect(crm.logContactEvent).not.toHaveBeenCalled();
  });

  it('POST /commerce/public/quotes/:token/accept transitions to ACCEPTED and emits quote.accepted', async () => {
    seedQuote();
    const res = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/accept')
      .expect(201);

    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.acceptedAt).toBeTruthy();
    expect(prisma.quotes[0].status).toBe('ACCEPTED');

    const acceptedEvents = emitSpy.mock.calls.filter((c) => c[0] === 'quote.accepted');
    expect(acceptedEvents).toHaveLength(1);
    expect(acceptedEvents[0][1]).toMatchObject({
      businessId: 'biz_1',
      source: 'public',
      quote: expect.objectContaining({ id: 'quote_1', status: 'ACCEPTED' }),
    });

    expect(crm.logContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quote.accepted',
        contactId: 'contact_1',
        actorType: 'SYSTEM',
        data: expect.objectContaining({ source: 'public' }),
      }),
    );
  });

  it('POST /commerce/public/quotes/:token/reject captures the reason and emits quote.rejected', async () => {
    seedQuote();
    const res = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/reject')
      .send({ reason: 'Too expensive for our budget' })
      .expect(201);

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.rejectedAt).toBeTruthy();
    expect(prisma.quotes[0].status).toBe('REJECTED');

    const rejectedEvents = emitSpy.mock.calls.filter((c) => c[0] === 'quote.rejected');
    expect(rejectedEvents).toHaveLength(1);
    expect(rejectedEvents[0][1]).toMatchObject({
      businessId: 'biz_1',
      source: 'public',
      reason: 'Too expensive for our budget',
    });

    expect(crm.logContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quote.rejected',
        data: expect.objectContaining({
          source: 'public',
          reason: 'Too expensive for our budget',
        }),
      }),
    );
  });

  it('rejects responses on an expired quote with 4xx and does not emit decision events', async () => {
    seedQuote({ expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000) });

    const accept = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/accept')
      .send();
    expect(accept.status).toBe(400);
    expect(accept.body.message).toMatch(/expired/i);

    const reject = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/reject')
      .send({ reason: 'late' });
    expect(reject.status).toBe(400);

    expect(emitSpy.mock.calls.some((c) => c[0] === 'quote.accepted')).toBe(false);
    expect(emitSpy.mock.calls.some((c) => c[0] === 'quote.rejected')).toBe(false);
    expect(prisma.quotes[0].status).toBe('SENT');
  });

  it('rejects responses on a converted quote (already linked to invoice) with 4xx', async () => {
    seedQuote({ invoiceId: 'inv_1' });

    const res = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/accept')
      .send();
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/converted/i);
    expect(emitSpy.mock.calls.some((c) => c[0] === 'quote.accepted')).toBe(false);
  });

  it('rejects responses when the quote has already been accepted (terminal state)', async () => {
    seedQuote({ status: 'ACCEPTED', acceptedAt: new Date() });

    const res = await request(app.getHttpServer())
      .post('/commerce/public/quotes/tok_active/reject')
      .send({ reason: 'changed mind' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been accepted/i);
    expect(emitSpy.mock.calls.some((c) => c[0] === 'quote.rejected')).toBe(false);
  });

  it('returns 404 when the token does not match any quote', async () => {
    const res = await request(app.getHttpServer())
      .post('/commerce/public/quotes/does-not-exist/accept')
      .send();
    expect(res.status).toBe(404);
  });

  it('GET on an unknown token returns 403 (Forbidden) without leaking quote existence', async () => {
    const res = await request(app.getHttpServer()).get('/commerce/public/quotes/missing-token');
    expect(res.status).toBe(403);
    expect(emitSpy.mock.calls.some((c) => c[0] === 'quote.viewed')).toBe(false);
  });
});
