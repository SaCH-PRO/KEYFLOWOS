/**
 * P114 — FU-CONTACTID-WRITER-VALIDATION (D-25 / D-261):
 * Writers that store a caller-chosen `contactId` validate it against a live
 * (`deletedAt: null`) Contact of the same `businessId`, refusing with 404
 * (`NotFoundException`) and zero DB rows written otherwise — matching
 * `CallLogService.assertContactInBusiness`.
 *
 * Audited & covered writers (real Postgres via DATABASE_URL):
 *   1. TimeCostService.create / update (POST/PATCH /commerce/businesses/:b/time-cost)
 *   2. RevenueAttributionService.update (PATCH /commerce/businesses/:b/revenue-attributions/:t/:id,
 *      both existing-row update and synthesize-on-patch) & RevenueAttributionService.record
 *   3. CommandService.create (POST /command/businesses/:b/items)
 *   4. ContractsService.createContract / updateContract (POST/PATCH /contracts/businesses/:b)
 *      & applyExtractionResult (parties[].contactId)
 *   5. KeystoreService.createOrder (POST /keystore/orders)
 *   6. SignalsService.createSignal / upsertSignal
 *
 * Fixture isolation: prefix `v83c_` registered in test/helpers/fixture-prefixes.json.
 * Teardown uses raw SQL ONLY with `sqlLikePrefix(P)` — zero `.deleteMany(` on
 * soft-deleted models.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v83c_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactLiveA: `${P}cLiveA`,
  contactLiveA2: `${P}cLiveA2`,
  contactDeletedA: `${P}cDelA`,
  contactLiveB: `${P}cLiveB`,
  contactMissing: `${P}cMissing`,
  invoiceA: `${P}invA`,
  invoiceA2: `${P}invA2`,
  invoiceA3: `${P}invA3`,
  invoiceA4: `${P}invA4`,
  timeCostBase: `${P}tcBase`,
  revAttrBase: `${P}raBase`,
  contractBase: `${P}ctrBase`,
  keystoreCategory: `${P}ksCat`,
  keystoreListing: `${P}ksList`,
};

const emailOf = (id: string) => `${id}@v83c.test.local`;

let db: any;
let app: any;
let revenueAttributionService: any;
let contractsService: any;
let signalsService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM time_cost_entries WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contract_alerts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contract_versions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contract_terms WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contract_parties WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contracts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM keystore_service_order_messages WHERE order_id IN (SELECT id FROM keystore_service_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM keystore_service_orders WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM keystore_service_listings WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM keystore_service_categories WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_signals WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

const api = () => request(app.getHttpServer());
const asOwnerA = (req: request.Test) => req.set('x-test-user', ID.ownerA);

const INVALID_CONTACTS = [
  ['cross-tenant live contact in bizB', ID.contactLiveB],
  ['soft-deleted / purged contact in bizA', ID.contactDeletedA],
  ['non-existent contact id', ID.contactMissing],
] as const;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { LeverageController } = await import('../src/modules/commerce/leverage.controller');
  const { TimeCostService } = await import('../src/modules/commerce/time-cost.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');

  const { CommandController } = await import('../src/modules/command/command.controller');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { CommandGeneratorService } = await import('../src/modules/command/command-generator.service');
  const { CommandSchedulerService } = await import('../src/modules/command/command-scheduler.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');

  const { ContractsController } = await import('../src/modules/contracts/contracts.controller');
  const { ContractsService } = await import('../src/modules/contracts/contracts.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  const { KeystoreController } = await import('../src/modules/keystore/keystore.controller');
  const { KeystoreService } = await import('../src/modules/keystore/keystore.service');

  const { SignalsService } = await import('../src/modules/intelligence/signals.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [
      LeverageController,
      CommandController,
      ContractsController,
      KeystoreController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TimeCostService,
      RevenueAttributionService,
      CommandService,
      ContractsService,
      KeystoreService,
      SignalsService,
      { provide: EventEmitter2, useValue: { emit: () => false } },
      { provide: CommandGeneratorService, useValue: {} },
      { provide: CommandSchedulerService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: NotificationsService, useValue: { create: async () => undefined } },
      { provide: RealtimeService, useValue: { emit: () => undefined } },
      { provide: DocumentIntelligenceService, useValue: { extractFromDocument: async () => null } },
    ],
  }).compile();

  revenueAttributionService = moduleRef.get(RevenueAttributionService);
  contractsService = moduleRef.get(ContractsService);
  signalsService = moduleRef.get(SignalsService);

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: emailOf(ID.ownerA), name: 'V83C Owner A', role: 'USER' },
      { id: ID.ownerB, email: emailOf(ID.ownerB), name: 'V83C Owner B', role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V83C Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'V83C Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}memA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}memB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.contact.createMany({
    data: [
      { id: ID.contactLiveA, businessId: ID.bizA, firstName: 'Live', lastName: 'Alpha', email: `${P}livea@v83c.test.local` },
      { id: ID.contactLiveA2, businessId: ID.bizA, firstName: 'Live', lastName: 'Beta', email: `${P}livea2@v83c.test.local` },
      {
        id: ID.contactDeletedA,
        businessId: ID.bizA,
        firstName: 'Purged',
        lastName: 'Contact',
        email: `${P}dela@v83c.test.local`,
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      { id: ID.contactLiveB, businessId: ID.bizB, firstName: 'Tenant', lastName: 'B', email: `${P}liveb@v83c.test.local` },
    ],
  });

  await db.invoice.createMany({
    data: [
      {
        id: ID.invoiceA,
        businessId: ID.bizA,
        contactId: ID.contactLiveA,
        invoiceNumber: `${P}INV-1`,
        status: 'SENT',
        subtotal: 200,
        total: 200,
        currency: 'TTD',
      },
      {
        id: ID.invoiceA2,
        businessId: ID.bizA,
        contactId: ID.contactLiveA,
        invoiceNumber: `${P}INV-2`,
        status: 'SENT',
        subtotal: 300,
        total: 300,
        currency: 'TTD',
      },
      {
        id: ID.invoiceA3,
        businessId: ID.bizA,
        contactId: ID.contactLiveA,
        invoiceNumber: `${P}INV-3`,
        status: 'SENT',
        subtotal: 400,
        total: 400,
        currency: 'TTD',
      },
      {
        id: ID.invoiceA4,
        businessId: ID.bizA,
        contactId: ID.contactLiveA,
        invoiceNumber: `${P}INV-4`,
        status: 'SENT',
        subtotal: 500,
        total: 500,
        currency: 'TTD',
      },
    ],
  });

  await db.timeCostEntry.create({
    data: {
      id: ID.timeCostBase,
      businessId: ID.bizA,
      refType: 'INVOICE',
      refId: ID.invoiceA,
      contactId: ID.contactLiveA,
      minutes: 30,
      currency: 'TTD',
    },
  });

  await db.revenueAttribution.create({
    data: {
      id: ID.revAttrBase,
      businessId: ID.bizA,
      source: 'manual',
      revenueType: 'INVOICE',
      revenueId: ID.invoiceA,
      contactId: ID.contactLiveA,
      amount: 200,
      currency: 'TTD',
    },
  });

  await db.contract.create({
    data: {
      id: ID.contractBase,
      businessId: ID.bizA,
      title: `${P}Base Contract`,
      status: 'DRAFT',
      parties: {
        create: [
          {
            businessId: ID.bizA,
            role: 'client',
            name: 'Original Party',
            contactId: ID.contactLiveA,
          },
        ],
      },
    },
  });

  await db.keystoreServiceCategory.create({
    data: {
      id: ID.keystoreCategory,
      businessId: ID.bizA,
      name: 'V83C Services',
      slug: `${P}ks-cat`,
    },
  });

  await db.keystoreServiceListing.create({
    data: {
      id: ID.keystoreListing,
      businessId: ID.bizA,
      categoryId: ID.keystoreCategory,
      name: 'V83C Logo Pack',
      slug: `${P}ks-list`,
      description: 'Test listing for P114',
      pricingTiers: [{ name: 'Standard', price: 150 }],
      status: 'ACTIVE',
    },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
}, 30_000);

describe('P114 — TimeCostService contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'POST /time-cost rejects %s with 404 and writes zero rows',
    async (_label, badContactId) => {
      const before = await db.timeCostEntry.count({ where: { businessId: ID.bizA } });
      const res = await asOwnerA(api().post(`/commerce/businesses/${ID.bizA}/time-cost`)).send({
        refType: 'INVOICE',
        refId: ID.invoiceA,
        minutes: 45,
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const after = await db.timeCostEntry.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('POST /time-cost succeeds with a live bizA contact and with omitted/null contactId', async () => {
    const withLive = await asOwnerA(api().post(`/commerce/businesses/${ID.bizA}/time-cost`)).send({
      refType: 'INVOICE',
      refId: ID.invoiceA,
      minutes: 20,
      contactId: ID.contactLiveA2,
    });
    expect(withLive.status).toBe(201);
    expect(withLive.body.contactId).toBe(ID.contactLiveA2);

    const omitted = await asOwnerA(api().post(`/commerce/businesses/${ID.bizA}/time-cost`)).send({
      refType: 'INVOICE',
      refId: ID.invoiceA,
      minutes: 15,
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.contactId).toBe(ID.contactLiveA);

    const withNull = await asOwnerA(api().post(`/commerce/businesses/${ID.bizA}/time-cost`)).send({
      refType: 'INVOICE',
      refId: ID.invoiceA,
      minutes: 10,
      contactId: null,
    });
    expect(withNull.status).toBe(201);
    expect(withNull.body.contactId).toBe(ID.contactLiveA);
  });

  it.each(INVALID_CONTACTS)(
    'PATCH /time-cost/:id rejects %s with 404 and leaves the row unchanged',
    async (_label, badContactId) => {
      const res = await asOwnerA(
        api().patch(`/commerce/businesses/${ID.bizA}/time-cost/${ID.timeCostBase}`),
      ).send({
        minutes: 99,
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const row = await db.timeCostEntry.findUnique({ where: { id: ID.timeCostBase } });
      expect(row?.contactId).toBe(ID.contactLiveA);
      expect(row?.minutes).toBe(30);
    },
  );

  it('PATCH /time-cost/:id succeeds with live contact, omitted contactId, and null (clearing)', async () => {
    const updated = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/time-cost/${ID.timeCostBase}`),
    ).send({ contactId: ID.contactLiveA2 });
    expect(updated.status).toBe(200);
    expect(updated.body.contactId).toBe(ID.contactLiveA2);

    const omitted = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/time-cost/${ID.timeCostBase}`),
    ).send({ notes: 'unchanged contact' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.contactId).toBe(ID.contactLiveA2);

    const cleared = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/time-cost/${ID.timeCostBase}`),
    ).send({ contactId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.contactId).toBeNull();

    // Restore base state
    const restored = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/time-cost/${ID.timeCostBase}`),
    ).send({ contactId: ID.contactLiveA });
    expect(restored.status).toBe(200);
  });
});

describe('P114 — RevenueAttributionService contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'PATCH /revenue-attributions (existing row) rejects %s with 404 and leaves row unchanged',
    async (_label, badContactId) => {
      const res = await asOwnerA(
        api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA}`),
      ).send({
        source: 'referral',
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const row = await db.revenueAttribution.findUnique({ where: { id: ID.revAttrBase } });
      expect(row?.contactId).toBe(ID.contactLiveA);
      expect(row?.source).toBe('manual');
    },
  );

  it('PATCH /revenue-attributions (existing row) succeeds with live contact, omitted contactId, and null', async () => {
    const updated = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA}`),
    ).send({ contactId: ID.contactLiveA2 });
    expect(updated.status).toBe(200);
    expect(updated.body.contactId).toBe(ID.contactLiveA2);

    const omitted = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA}`),
    ).send({ sourceDetail: 'kept' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.contactId).toBe(ID.contactLiveA2);

    const cleared = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA}`),
    ).send({ contactId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.contactId).toBeNull();

    const restored = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA}`),
    ).send({ contactId: ID.contactLiveA });
    expect(restored.status).toBe(200);
  });

  it.each(INVALID_CONTACTS)(
    'PATCH /revenue-attributions (synthesize path) rejects %s with 404 and writes zero rows',
    async (_label, badContactId) => {
      const res = await asOwnerA(
        api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA2}`),
      ).send({
        source: 'manual',
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const row = await db.revenueAttribution.findFirst({
        where: { businessId: ID.bizA, revenueType: 'INVOICE', revenueId: ID.invoiceA2 },
      });
      expect(row).toBeNull();
    },
  );

  it('PATCH /revenue-attributions (synthesize path) persists valid live contactId', async () => {
    const res = await asOwnerA(
      api().patch(`/commerce/businesses/${ID.bizA}/revenue-attributions/INVOICE/${ID.invoiceA2}`),
    ).send({
      source: 'manual',
      contactId: ID.contactLiveA2,
    });
    expect(res.status).toBe(200);
    expect(res.body.contactId).toBe(ID.contactLiveA2);
  });

  it.each(INVALID_CONTACTS)(
    'RevenueAttributionService.record rejects %s with NotFoundException and writes zero rows',
    async (_label, badContactId) => {
      await expect(
        revenueAttributionService.record({
          businessId: ID.bizA,
          source: 'manual',
          revenueType: 'INVOICE',
          revenueId: ID.invoiceA3,
          amount: 400,
          currency: 'TTD',
          contactId: badContactId,
        }),
      ).rejects.toThrow(NotFoundException);

      const row = await db.revenueAttribution.findFirst({
        where: { businessId: ID.bizA, revenueType: 'INVOICE', revenueId: ID.invoiceA3 },
      });
      expect(row).toBeNull();
    },
  );

  it('RevenueAttributionService.record succeeds with valid live contact and omitted/null contactId', async () => {
    await revenueAttributionService.record({
      businessId: ID.bizA,
      source: 'manual',
      revenueType: 'INVOICE',
      revenueId: ID.invoiceA3,
      amount: 400,
      currency: 'TTD',
      contactId: ID.contactLiveA,
    });
    const rowLive = await db.revenueAttribution.findFirst({
      where: { businessId: ID.bizA, revenueType: 'INVOICE', revenueId: ID.invoiceA3 },
    });
    expect(rowLive?.contactId).toBe(ID.contactLiveA);

    await revenueAttributionService.record({
      businessId: ID.bizA,
      source: 'manual',
      revenueType: 'INVOICE',
      revenueId: ID.invoiceA4,
      amount: 500,
      currency: 'TTD',
      contactId: null,
    });
    const rowNull = await db.revenueAttribution.findFirst({
      where: { businessId: ID.bizA, revenueType: 'INVOICE', revenueId: ID.invoiceA4 },
    });
    expect(rowNull?.contactId).toBeNull();
  });
});

describe('P114 — CommandService.create contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'POST /command/businesses/:b/items rejects %s with 404 and writes zero rows',
    async (_label, badContactId) => {
      const before = await db.commandItem.count({ where: { businessId: ID.bizA } });
      const res = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
        sourceModule: 'crm',
        title: 'Follow up',
        category: 'PEOPLE',
        actionType: 'FOLLOW_UP',
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const after = await db.commandItem.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('POST /command/businesses/:b/items succeeds with live bizA contact and with omitted contactId', async () => {
    const withLive = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'crm',
      title: 'Call valid contact',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      contactId: ID.contactLiveA,
    });
    expect(withLive.status).toBe(201);
    expect(withLive.body.contactId).toBe(ID.contactLiveA);

    const omitted = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'finance',
      title: 'Review monthly close',
      category: 'MONEY',
      actionType: 'REVIEW',
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.contactId).toBeNull();
  });
});

describe('P114 — ContractsService parties[].contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'POST /contracts/businesses/:b rejects party with %s with 404 and writes zero rows',
    async (_label, badContactId) => {
      const before = await db.contract.count({ where: { businessId: ID.bizA } });
      const res = await asOwnerA(api().post(`/contracts/businesses/${ID.bizA}`)).send({
        title: 'Invalid Party Contract',
        parties: [
          { role: 'client', name: 'Bad Party', contactId: badContactId },
        ],
      });
      expect(res.status).toBe(404);
      const after = await db.contract.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('POST /contracts/businesses/:b succeeds with live bizA contact and with omitted party contactId', async () => {
    const withLive = await asOwnerA(api().post(`/contracts/businesses/${ID.bizA}`)).send({
      title: 'Valid Party Contract',
      parties: [
        { role: 'client', name: 'Live Alpha', contactId: ID.contactLiveA },
        { role: 'vendor', name: 'External Party' },
      ],
    });
    expect(withLive.status).toBe(201);
    expect(withLive.body.parties).toHaveLength(2);
    expect(withLive.body.parties.find((p: any) => p.role === 'client')?.contactId).toBe(ID.contactLiveA);
    expect(withLive.body.parties.find((p: any) => p.role === 'vendor')?.contactId).toBeNull();
  });

  it.each(INVALID_CONTACTS)(
    'PATCH /contracts/businesses/:b/:id rejects party with %s with 404 and leaves existing parties intact',
    async (_label, badContactId) => {
      const res = await asOwnerA(
        api().patch(`/contracts/businesses/${ID.bizA}/${ID.contractBase}`),
      ).send({
        title: 'Should Not Apply',
        parties: [
          { role: 'client', name: 'Replacement Bad Party', contactId: badContactId },
        ],
      });
      expect(res.status).toBe(404);
      const contract = await db.contract.findUnique({
        where: { id: ID.contractBase },
        include: { parties: true },
      });
      expect(contract?.title).toBe(`${P}Base Contract`);
      expect(contract?.parties).toHaveLength(1);
      expect(contract?.parties[0]?.contactId).toBe(ID.contactLiveA);
    },
  );

  it('PATCH /contracts/businesses/:b/:id succeeds with live contact and omitted contactId', async () => {
    const updated = await asOwnerA(
      api().patch(`/contracts/businesses/${ID.bizA}/${ID.contractBase}`),
    ).send({
      parties: [
        { role: 'client', name: 'Live Beta', contactId: ID.contactLiveA2 },
        { role: 'witness', name: 'Witness Party' },
      ],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.parties).toHaveLength(2);
    expect(updated.body.parties.find((p: any) => p.role === 'client')?.contactId).toBe(ID.contactLiveA2);
    expect(updated.body.parties.find((p: any) => p.role === 'witness')?.contactId).toBeNull();
  });

  it.each(INVALID_CONTACTS)(
    'ContractsService.applyExtractionResult rejects extracted party with %s with NotFoundException',
    async (_label, badContactId) => {
      const beforeVersions = await db.contractVersion.count({ where: { contractId: ID.contractBase } });
      await expect(
        contractsService.applyExtractionResult(ID.bizA, ID.contractBase, {
          documentType: 'contract',
          confidence: 0.9,
          filename: 'bad.pdf',
          rawText: 'raw',
          suggestedActions: [],
          contractData: {
            contractType: 'NDA',
            confidence: 0.9,
            parties: [{ role: 'client', name: 'Bad Extracted', contactId: badContactId }],
          },
        }),
      ).rejects.toThrow(NotFoundException);

      const afterVersions = await db.contractVersion.count({ where: { contractId: ID.contractBase } });
      expect(afterVersions).toBe(beforeVersions);
    },
  );
});

describe('P114 — KeystoreService.createOrder contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'POST /keystore/orders rejects %s with 404 and writes zero orders',
    async (_label, badContactId) => {
      const before = await db.keystoreServiceOrder.count({ where: { businessId: ID.bizA } });
      const res = await asOwnerA(api().post('/keystore/orders')).send({
        businessId: ID.bizA,
        listingId: ID.keystoreListing,
        pricingTier: 'Standard',
        contactId: badContactId,
      });
      expect(res.status).toBe(404);
      const after = await db.keystoreServiceOrder.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('POST /keystore/orders succeeds with live bizA contact and with omitted contactId', async () => {
    const withLive = await asOwnerA(api().post('/keystore/orders')).send({
      businessId: ID.bizA,
      listingId: ID.keystoreListing,
      pricingTier: 'Standard',
      contactId: ID.contactLiveA,
    });
    expect(withLive.status).toBe(201);
    expect(withLive.body.contactId).toBe(ID.contactLiveA);

    const omitted = await asOwnerA(api().post('/keystore/orders')).send({
      businessId: ID.bizA,
      listingId: ID.keystoreListing,
      pricingTier: 'Standard',
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.contactId).toBeNull();
  });
});

describe('P114 — SignalsService contactId validation', () => {
  it.each(INVALID_CONTACTS)(
    'SignalsService.createSignal rejects %s with NotFoundException and writes zero rows',
    async (_label, badContactId) => {
      const before = await db.businessSignal.count({ where: { businessId: ID.bizA } });
      await expect(
        signalsService.createSignal(ID.bizA, {
          module: 'crm',
          type: 'RISK',
          severity: 'WARN',
          title: 'Invalid contact signal',
          contactId: badContactId,
        }),
      ).rejects.toThrow(NotFoundException);
      const after = await db.businessSignal.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('SignalsService.createSignal succeeds with live bizA contact and with omitted contactId', async () => {
    const withLive = await signalsService.createSignal(ID.bizA, {
      module: 'crm',
      type: 'HEALTH',
      severity: 'INFO',
      title: 'Valid live contact signal',
      contactId: ID.contactLiveA,
    });
    expect(withLive.contactId).toBe(ID.contactLiveA);

    const omitted = await signalsService.createSignal(ID.bizA, {
      module: 'finance',
      type: 'CASH',
      severity: 'INFO',
      title: 'Signal without contact',
    });
    expect(omitted.contactId).toBeNull();
  });

  it.each(INVALID_CONTACTS)(
    'SignalsService.upsertSignal rejects %s with NotFoundException and writes zero rows',
    async (_label, badContactId) => {
      const before = await db.businessSignal.count({ where: { businessId: ID.bizA } });
      await expect(
        signalsService.upsertSignal(
          ID.bizA,
          { module: 'commerce', type: 'OVERDUE', entityType: 'invoice', entityId: ID.invoiceA },
          {
            module: 'commerce',
            type: 'OVERDUE',
            severity: 'WARN',
            title: 'Upsert bad contact',
            entityType: 'invoice',
            entityId: ID.invoiceA,
            contactId: badContactId,
          },
        ),
      ).rejects.toThrow(NotFoundException);
      const after = await db.businessSignal.count({ where: { businessId: ID.bizA } });
      expect(after).toBe(before);
    },
  );

  it('SignalsService.upsertSignal succeeds with live bizA contact and with omitted contactId', async () => {
    const withLive = await signalsService.upsertSignal(
      ID.bizA,
      { module: 'commerce', type: 'OVERDUE', entityType: 'invoice', entityId: ID.invoiceA },
      {
        module: 'commerce',
        type: 'OVERDUE',
        severity: 'WARN',
        title: 'Upsert valid contact',
        entityType: 'invoice',
        entityId: ID.invoiceA,
        contactId: ID.contactLiveA,
      },
    );
    expect(withLive.contactId).toBe(ID.contactLiveA);

    const omitted = await signalsService.upsertSignal(
      ID.bizA,
      { module: 'storefront', type: 'NO_PRODUCTS' },
      {
        module: 'storefront',
        type: 'NO_PRODUCTS',
        severity: 'INFO',
        title: 'Upsert without contact',
      },
    );
    expect(omitted.contactId).toBeNull();
  });
});

describe('P114 R1 regressions — CommandService columns/visibility, Contracts empty/orphan, TimeCost inference, and internal callers', () => {
  const R1 = {
    staffOwned: `${P}staffOwned`,
    contactPrivateA: `${P}cPrivA`,
    invDelContact: `${P}invDelC`,
    bookingDelContact: `${P}bkDelC`,
    serviceA: `${P}svcA`,
    plainCmd: `${P}cmdPlain`,
    contactOwnerCmd: `${P}cmdContactOwner`,
  };

  let commandService: any;
  let prismaService: any;

  beforeAll(async () => {
    const { CommandService } = await import('../src/modules/command/command.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    commandService = app.get(CommandService);
    prismaService = app.get(PrismaService);

    await db.user.create({
      data: { id: R1.staffOwned, email: emailOf(R1.staffOwned), name: 'V83C Staff Owned', role: 'USER' },
    });
    await db.membership.create({
      data: {
        id: `${P}memStaffOwned`,
        userId: R1.staffOwned,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { operations: 'write', crm: 'read', crm_view: 'owned' },
      },
    });
    await db.contact.create({
      data: {
        id: R1.contactPrivateA,
        businessId: ID.bizA,
        firstName: 'Private',
        lastName: 'OwnerOnly',
        email: `${P}priva@v83c.test.local`,
        visibility: 'PRIVATE',
        ownerId: ID.ownerA,
      },
    });
    await db.service.create({
      data: {
        id: R1.serviceA,
        businessId: ID.bizA,
        name: 'V83C Service',
        duration: 30,
        price: 120,
      },
    });
    await db.invoice.create({
      data: {
        id: R1.invDelContact,
        businessId: ID.bizA,
        contactId: ID.contactDeletedA,
        invoiceNumber: `${P}INV-DEL`,
        status: 'SENT',
        subtotal: 120,
        total: 120,
        currency: 'TTD',
        dueDate: new Date('2025-01-01T00:00:00.000Z'),
      },
    });
    await db.booking.create({
      data: {
        id: R1.bookingDelContact,
        businessId: ID.bizA,
        contactId: ID.contactDeletedA,
        serviceId: R1.serviceA,
        invoiceId: R1.invDelContact,
        startTime: new Date('2025-01-01T10:00:00.000Z'),
        endTime: new Date('2025-01-01T10:30:00.000Z'),
        status: 'CONFIRMED',
      },
    });
    await db.commandItem.createMany({
      data: [
        {
          id: R1.plainCmd,
          businessId: ID.bizA,
          sourceModule: 'operations',
          title: 'Plain item',
          category: 'WORK',
          actionType: 'REVIEW',
          status: 'OPEN',
        },
        {
          id: R1.contactOwnerCmd,
          businessId: ID.bizA,
          sourceModule: 'crm',
          title: 'Contact-owned item',
          category: 'PEOPLE',
          actionType: 'FOLLOW_UP',
          ownerType: 'CONTACT',
          ownerId: ID.contactLiveA,
          status: 'OPEN',
        },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    for (const sql of [
      `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    ]) {
      await db.$executeRawUnsafe(sql);
    }
  }, 30_000);

  it('[R1-SEC-01] CommandService.create validates entityType=contact entityId and ownerType=CONTACT ownerId', async () => {
    for (const badId of [ID.contactLiveB, ID.contactDeletedA, '']) {
      const before = await db.commandItem.count({ where: { businessId: ID.bizA } });
      const res = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
        sourceModule: 'crm',
        title: 'Entity contact check',
        category: 'PEOPLE',
        actionType: 'FOLLOW_UP',
        entityType: 'contact',
        entityId: badId,
      });
      expect(res.status).toBe(404);
      expect(await db.commandItem.count({ where: { businessId: ID.bizA } })).toBe(before);

      await expect(
        commandService.create(ID.bizA, {
          sourceModule: 'crm',
          title: 'Owner contact check',
          category: 'PEOPLE',
          actionType: 'FOLLOW_UP',
          ownerType: 'CONTACT',
          ownerId: badId,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(await db.commandItem.count({ where: { businessId: ID.bizA } })).toBe(before);
    }

    const okEntity = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'crm',
      title: 'Valid entity contact',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      entityType: 'contact',
      entityId: ID.contactLiveA,
    });
    expect(okEntity.status).toBe(201);

    const okOwner = await commandService.create(ID.bizA, {
      sourceModule: 'crm',
      title: 'Valid owner contact',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      ownerType: 'CONTACT',
      ownerId: ID.contactLiveA,
    });
    expect(okOwner.ownerId).toBe(ID.contactLiveA);
  });

  it('[R1-SEC-01] CommandService.assign and update validate CONTACT ownerId', async () => {
    for (const badId of [ID.contactLiveB, ID.contactDeletedA, '   ']) {
      const assignRes = await asOwnerA(
        api().post(`/command/businesses/${ID.bizA}/items/${R1.plainCmd}/assign`),
      ).send({ ownerType: 'CONTACT', ownerId: badId });
      expect(assignRes.status).toBe(404);
      const plain = await db.commandItem.findUnique({ where: { id: R1.plainCmd } });
      expect(plain?.ownerId).toBeNull();

      const patchRes = await asOwnerA(
        api().patch(`/command/businesses/${ID.bizA}/items/${R1.contactOwnerCmd}`),
      ).send({ ownerId: badId });
      expect(patchRes.status).toBe(404);
      const owned = await db.commandItem.findUnique({ where: { id: R1.contactOwnerCmd } });
      expect(owned?.ownerId).toBe(ID.contactLiveA);
    }

    const okAssign = await asOwnerA(
      api().post(`/command/businesses/${ID.bizA}/items/${R1.plainCmd}/assign`),
    ).send({ ownerType: 'CONTACT', ownerId: ID.contactLiveA });
    expect(okAssign.status).toBe(201);
    expect(okAssign.body.ownerId).toBe(ID.contactLiveA);

    const okPatch = await asOwnerA(
      api().patch(`/command/businesses/${ID.bizA}/items/${R1.contactOwnerCmd}`),
    ).send({ ownerId: ID.contactLiveA2 });
    expect(okPatch.status).toBe(200);
    expect(okPatch.body.ownerId).toBe(ID.contactLiveA2);
  });

  it('[R1-SEC-02] restricted STAFF (crm_view: owned) naming OWNER PRIVATE contact on create/assign gets 404 with zero writes', async () => {
    const asStaff = (req: request.Test) => req.set('x-test-user', R1.staffOwned);
    const before = await db.commandItem.count({ where: { businessId: ID.bizA } });

    const createByContactId = await asStaff(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'crm',
      title: 'Oracle probe',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      contactId: R1.contactPrivateA,
    });
    expect(createByContactId.status).toBe(404);

    const createByEntity = await asStaff(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'crm',
      title: 'Entity oracle probe',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      entityType: 'contact',
      entityId: R1.contactPrivateA,
    });
    expect(createByEntity.status).toBe(404);
    expect(await db.commandItem.count({ where: { businessId: ID.bizA } })).toBe(before);

    // Seed a plain item staff can open and try assigning it to OWNER's PRIVATE contact
    const staffPlain = await asStaff(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'operations',
      title: 'Staff visible plain item',
      category: 'WORK',
      actionType: 'REVIEW',
    });
    expect(staffPlain.status).toBe(201);

    const assignPriv = await asStaff(
      api().post(`/command/businesses/${ID.bizA}/items/${staffPlain.body.id}/assign`),
    ).send({ ownerType: 'CONTACT', ownerId: R1.contactPrivateA });
    expect(assignPriv.status).toBe(404);
    const reloaded = await db.commandItem.findUnique({ where: { id: staffPlain.body.id } });
    expect(reloaded?.ownerId).toBeNull();

    // Control: OWNER can still create against their own PRIVATE contact
    const ownerCreate = await asOwnerA(api().post(`/command/businesses/${ID.bizA}/items`)).send({
      sourceModule: 'crm',
      title: 'Owner private item',
      category: 'PEOPLE',
      actionType: 'FOLLOW_UP',
      contactId: R1.contactPrivateA,
    });
    expect(ownerCreate.status).toBe(201);
  });

  it('[R1-COR-01][R1-SEC-03] ContractsService normalizes empty contactId to null, rejects whitespace, and leaves zero orphan DRAFT contracts on handleDocumentExtracted', async () => {
    const unlinked = await asOwnerA(
      api().patch(`/contracts/businesses/${ID.bizA}/${ID.contractBase}`),
    ).send({
      parties: [{ role: 'client', name: 'Unlinked', contactId: '' }],
    });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.parties).toHaveLength(1);
    expect(unlinked.body.parties[0].contactId).toBeNull();

    const whitespace = await asOwnerA(
      api().patch(`/contracts/businesses/${ID.bizA}/${ID.contractBase}`),
    ).send({
      parties: [{ role: 'client', name: 'Whitespace', contactId: '   ' }],
    });
    expect(whitespace.status).toBe(404);

    const beforeContracts = await db.contract.count({ where: { businessId: ID.bizA } });
    await expect(
      contractsService.handleDocumentExtracted({
        businessId: ID.bizA,
        source: 'asset',
        filename: `${P}orphan-check.pdf`,
        result: {
          documentType: 'contract',
          sourceId: `${P}src_orphan`,
          confidence: 0.9,
          filename: `${P}orphan-check.pdf`,
          rawText: 'raw',
          suggestedActions: [],
          contractData: {
            contractType: 'NDA',
            confidence: 0.9,
            parties: [{ role: 'client', name: 'Foreign Party', contactId: ID.contactLiveB }],
          },
        },
      }),
    ).rejects.toThrow(NotFoundException);
    expect(await db.contract.count({ where: { businessId: ID.bizA } })).toBe(beforeContracts);
  });

  it('[R1-COR-02] TimeCostService.create with omitted contactId against invoice of soft-deleted contact returns 201 with contactId: null', async () => {
    const res = await asOwnerA(api().post(`/commerce/businesses/${ID.bizA}/time-cost`)).send({
      refType: 'INVOICE',
      refId: R1.invDelContact,
      minutes: 25,
    });
    expect(res.status).toBe(201);
    expect(res.body.contactId).toBeNull();
  });

  it('[R1-COR-03] StorefrontInvoiceAttributionListener and ScheduledScansService tolerate invoices referencing a soft-deleted contact', async () => {
    const { StorefrontInvoiceAttributionListener } = await import(
      '../src/modules/commerce/storefront-invoice-attribution.listener'
    );
    const { ScheduledScansService } = await import(
      '../src/modules/intelligence/scheduled-scans.service'
    );

    const listener = new StorefrontInvoiceAttributionListener(prismaService, revenueAttributionService);
    await listener.handleInvoicePaid({
      businessId: ID.bizA,
      invoice: {
        id: R1.invDelContact,
        businessId: ID.bizA,
        total: 120,
        currency: 'TTD',
        contactId: ID.contactDeletedA,
      },
    });
    const attrRow = await db.revenueAttribution.findFirst({
      where: { businessId: ID.bizA, revenueType: 'INVOICE', revenueId: R1.invDelContact },
    });
    expect(attrRow).not.toBeNull();
    expect(attrRow?.contactId).toBeNull();

    const bridged: Array<{ sourceId?: string; contactId?: string }> = [];
    const scans: any = new ScheduledScansService(
      prismaService,
      {} as any,
      signalsService,
      { bridge: async (input: any) => { bridged.push(input); return null; } } as any,
      { calculateAll: async () => [], saveSnapshot: async () => undefined } as any,
    );
    await scans.evaluateRules(ID.bizA);
    const sigRow = await db.businessSignal.findFirst({
      where: { businessId: ID.bizA, type: 'OVERDUE_INVOICE', entityId: R1.invDelContact },
    });
    expect(sigRow).not.toBeNull();
    expect(sigRow?.contactId).toBeNull();
    const bridgedInv = bridged.find((b) => b.sourceId === R1.invDelContact);
    expect(bridgedInv).toBeDefined();
    expect(bridgedInv?.contactId).toBeUndefined();
  });
});
