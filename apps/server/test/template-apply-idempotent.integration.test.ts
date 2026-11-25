/**
 * P78 — V1-64 (CATALOG-1 server half: SWP-TEMPLATE-APPLY-ONCE, P0, BUG-075,
 * Journey B) — Applying a business template twice (sequentially or
 * concurrently) adds nothing twice: products, services, expense categories,
 * and template usage are recorded once per business, and pre-existing active
 * products/services with matching names are not duplicated.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v64d_` prefix and is
 * hard-deleted by raw SQL (`sqlLikePrefix`) in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64d_';
const ID = {
  ownerA: `${P}ownerA`,
  staffA: `${P}staffA`,
  ownerB: `${P}ownerB`,
  ownerRace: `${P}ownerRace`,
  ownerPre: `${P}ownerPre`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizRace: `${P}bizRace`,
  bizPre: `${P}bizPre`,
  tpl1: `${P}tpl_salon`,
};

let db: any;
let app: any;
const emittedEvents: Array<{ name: string; payload: unknown }> = [];

function applyTemplate(actorId: string, businessId: string, templateId: string = ID.tpl1) {
  return request(app.getHttpServer())
    .post(`/businesses/${businessId}/templates/${templateId}/apply`)
    .set('x-test-user', actorId)
    .send({});
}

async function countsFor(businessId: string) {
  const [products, services, categories, usages] = await Promise.all([
    db.product.count({ where: { businessId, deletedAt: null } }),
    db.service.count({ where: { businessId, deletedAt: null } }),
    db.expenseCategory.count({ where: { businessId } }),
    db.businessTemplateUsage.count({ where: { businessId } }),
  ]);
  return { products, services, categories, usages };
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_template_usages WHERE business_id LIKE ${sqlLikePrefix(P)} OR template_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_templates WHERE id LIKE ${sqlLikePrefix(P)} OR name LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TemplatesController } = await import('../src/modules/templates/templates.controller');
  const { TemplatesService } = await import('../src/modules/templates/templates.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [TemplatesController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CatalogService,
      TemplatesService,
      {
        provide: EventEmitter2,
        useValue: {
          emit: (name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
            return true;
          },
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const [userId, bizId, email, bizName] of [
    [ID.ownerA, ID.bizA, `${P}a@example.test`, 'Template Biz A'],
    [ID.ownerB, ID.bizB, `${P}b@example.test`, 'Template Biz B'],
    [ID.ownerRace, ID.bizRace, `${P}race@example.test`, 'Template Biz Race'],
    [ID.ownerPre, ID.bizPre, `${P}pre@example.test`, 'Template Biz Pre'],
  ] as const) {
    await db.user.create({ data: { id: userId, email, role: 'USER' } });
    await db.business.create({ data: { id: bizId, name: bizName, ownerId: userId, currency: 'TTD' } });
    await db.membership.create({ data: { userId, businessId: bizId, role: 'OWNER' } });
  }

  await db.user.create({ data: { id: ID.staffA, email: `${P}staff@example.test`, role: 'USER' } });
  await db.membership.create({ data: { userId: ID.staffA, businessId: ID.bizA, role: 'STAFF' } });

  await db.businessTemplate.create({
    data: {
      id: ID.tpl1,
      name: `${P}salon_starter`,
      displayName: 'Salon Starter',
      description: 'Test template with products, services, and expense categories',
      icon: '💇',
      industry: 'Beauty',
      archetype: 'LOCAL_SERVICE',
      isPublished: true,
      config: {
        products: [
          { name: 'Hair Care Bundle', description: 'Shampoo & conditioner', price: 65, category: 'PRODUCT' },
          { name: 'Styling Oil', description: 'Argan oil', price: 45, category: 'PRODUCT' },
        ],
        services: [
          { name: 'Haircut', description: 'Classic cut', price: 80, duration: 45 },
          { name: 'Color', description: 'Full color', price: 180, duration: 90 },
        ],
        expenseCategories: [
          { name: 'Supplies', icon: '🧴' },
          { name: 'Rent', icon: '🏠' },
        ],
      },
    },
  });
});

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P78 — V1-64 (CATALOG-1 server half: SWP-TEMPLATE-APPLY-ONCE, P0, BUG-075)', () => {
  it('[TA-01] RED-BEFORE: applying the same template twice sequentially creates products, services, and categories once and does not overwrite later Business edits', async () => {
    emittedEvents.length = 0;

    const first = await applyTemplate(ID.ownerA, ID.bizA).expect(201);
    expect(first.body).toMatchObject({ success: true, templateName: 'Salon Starter' });
    expect(await countsFor(ID.bizA)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });
    const eventsAfterFirst = emittedEvents.length;
    expect(eventsAfterFirst).toBeGreaterThan(0);

    // Owner edits industry after template apply
    await db.business.update({ where: { id: ID.bizA }, data: { industry: 'Custom Wellness' } });

    // Second apply is a clean idempotent no-op
    const second = await applyTemplate(ID.ownerA, ID.bizA).expect(201);
    expect(await countsFor(ID.bizA)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });
    expect(first.body.alreadyApplied).toBe(false);
    expect(second.body).toMatchObject({ success: true, templateName: 'Salon Starter', alreadyApplied: true });
    expect(emittedEvents.length).toBe(eventsAfterFirst);

    const biz = await db.business.findUnique({ where: { id: ID.bizA }, select: { industry: true, archetype: true } });
    expect(biz?.industry).toBe('Custom Wellness');
  });

  it('[TA-02] RED-BEFORE (concurrency): two concurrent apply calls for the same business and template create every item exactly once', async () => {
    const [r1, r2] = await Promise.all([
      applyTemplate(ID.ownerRace, ID.bizRace),
      applyTemplate(ID.ownerRace, ID.bizRace),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await countsFor(ID.bizRace)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });

    const flags = [r1.body.alreadyApplied, r2.body.alreadyApplied].sort();
    expect(flags).toEqual([false, true]);
  });

  it('[TA-03] RED-BEFORE: pre-existing active product/service with matching name (case/whitespace-insensitive) is not duplicated on first apply', async () => {
    await db.product.create({
      data: { businessId: ID.bizPre, name: '  hair care bundle  ', price: 99, currency: 'TTD', category: 'PRODUCT' },
    });
    await db.service.create({
      data: { businessId: ID.bizPre, name: 'HAIRCUT', price: 120, duration: 60 },
    });

    const res = await applyTemplate(ID.ownerPre, ID.bizPre).expect(201);
    // Still only 2 products (pre-existing Hair Care Bundle + new Styling Oil) and 2 services (pre-existing Haircut + new Color)
    expect(await countsFor(ID.bizPre)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });
    expect(res.body).toMatchObject({ success: true, templateName: 'Salon Starter', alreadyApplied: false });
  });

  it('[TA-04] RBAC & tenant isolation: STAFF is refused 403 and tenant B can still apply the same template once independently', async () => {
    const staffRes = await applyTemplate(ID.staffA, ID.bizA).expect(403);
    expect(staffRes.body.code).toBe('BUSINESS_PROFILE_OWNER_ONLY');

    await applyTemplate(ID.ownerB, ID.bizA).expect(403);

    const bizBFirst = await applyTemplate(ID.ownerB, ID.bizB).expect(201);
    expect(bizBFirst.body).toMatchObject({ success: true, templateName: 'Salon Starter', alreadyApplied: false });
    expect(await countsFor(ID.bizB)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });

    const bizBSecond = await applyTemplate(ID.ownerB, ID.bizB).expect(201);
    expect(bizBSecond.body).toMatchObject({ success: true, templateName: 'Salon Starter', alreadyApplied: true });
    expect(await countsFor(ID.bizB)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });
  });

  it('[TA-05] unknown template returns 404 without writing anything', async () => {
    await applyTemplate(ID.ownerB, ID.bizB, `${P}does_not_exist`).expect(404);
    expect(await countsFor(ID.bizB)).toEqual({ products: 2, services: 2, categories: 2, usages: 1 });
  });
});
