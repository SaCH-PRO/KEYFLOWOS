/**
 * SWEEP-P0-SCOPES (browser sweep 2026-11-13, BUG-015 major) — stock levels, warehouses and the
 * store's configuration need the storefront module's write scope, against a REAL database through
 * the HTTP routes.
 *
 * BUG-015 (re-checked 2026-11-13): a STAFF member on role defaults (read everywhere) adjusted a
 * stock level (POST .../inventory/adjust 201) and created a warehouse (POST .../warehouses 201),
 * while POST products answered the same member 403. MarketplaceController ran AuthGuard,
 * BusinessGuard and CrmRateLimitGuard only: a business membership was the whole check.
 *
 * The module: the head files inventory under 'storefront'. KEY's member authority map
 * (GRAPH_ACTION_TOOL_MODULES in ai/graph-actions.controller.ts) maps inventory_*, store_*,
 * marketplace_* and suppliers_* to storefront, so the web routes follow it: write for every
 * warehouse, stock (set, adjust, transfer, Excel import), listing, shipping-zone and delivery-config
 * write. Role defaults: OWNER and ADMIN storefront admin, STAFF read.
 *
 * Left as they were, and pinned so here: the purchase-order routes (another packet,
 * pkt/PR195-JOURNAL-SCOPE, gates their receipt under expenses), and the order fulfilment routes,
 * which owner ruling D-112 keeps open to every member ("Fulfilment status changes stay open as
 * today"; marking PAID has its own revenue door).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, CrmRateLimitGuard, ModuleScopeGuard, MarketplaceController and MarketplaceService
 * are real against DATABASE_URL. The stand-ins: identity attachment (`x-test-user`, as
 * AuthMiddleware attaches it), an EventEmitter2 that records, and empty collaborators no case
 * reaches (TransactionalEmailService, FulfillmentRoutingService, ExpensePostingService,
 * CommerceIntegrationService). Every request carries its own x-forwarded-for address, so
 * CrmRateLimitGuard's per-address buckets never cap the case count.
 *
 * The REST scope census (docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md) found the same defect
 * at the other doors that move stock: the continental-ops stock counts (adjust), goods receipts (post)
 * and delivery notes (fulfil) write InventoryStock, and the Google Drive inventory sheet's apply
 * writes it from a pulled sheet; every one ran AuthGuard and BusinessGuard only. Their writes, and
 * the inventory-sheet sync configuration (create, link, unlink, push), need storefront write too
 * (cases INV-C03, INV-10, INV-11; the drive service is a recorder there: the claim is that the
 * refusal comes before it).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99i_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99i_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (storefront read): the sweep member
  staffNone: `${P}staffNone`, // STAFF of bizA, explicit storefront 'none'
  storeWrite: `${P}storeWrite`, // STAFF of bizA, explicit storefront 'write'
  outsider: `${P}outsider`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  product: `${P}product`,
  whMain: `${P}wh_main`,
  whBack: `${P}wh_back`,
  stock: `${P}stock_main`,
  zone: `${P}zone`,
  listing: `${P}listing`,
};

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
let MarketplaceControllerClass: any;
const stockControllers: Record<string, any> = {};
const commerceIntegration = { createProjectForBundleOrder: vi.fn(async () => ({ id: `${P}bundle_project` })) };
const driveCalls: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_counts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM goods_receipts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM delivery_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_listings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM shipping_zones WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `10.99.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string, body?: unknown) {
  const r = (request(app.getHttpServer()) as any)[verb](url).set('x-forwarded-for', nextIp()).set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const base = (biz: string = ID.bizA) => `/marketplace/businesses/${biz}`;

/** Every row these routes may write (this suite's tenants), whole: what "nothing written" compares. */
async function writableState() {
  const rows = (table: string) =>
    db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
  const meta = await db.$queryRawUnsafe(`SELECT meta_data::text AS meta FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
  return {
    warehouses: await rows('warehouses'),
    stocks: await rows('inventory_stocks'),
    movements: await rows('stock_movements'),
    listings: await rows('marketplace_listings'),
    zones: await rows('shipping_zones'),
    stockCounts: await rows('stock_counts'),
    goodsReceipts: await rows('goods_receipts'),
    deliveryNotes: await rows('delivery_notes'),
    meta,
  };
}

function census(cls: any) {
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const fn = cls.prototype[name];
      const routePath = Reflect.getMetadata(PATH_METADATA, fn);
      if (routePath === undefined) return [];
      const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      return [{
        key: `${cls.name}.${name}`,
        handler: name,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)] as string,
        path: routePath as string,
        guards: [...classGuards, ...methodGuards].map((g) => g.name as string),
        scope: Reflect.getMetadata(MODULE_SCOPE_KEY, fn) as { module: string; minLevel: string } | undefined,
      }];
    });
}

/** The storefront writes this packet gates (BUG-015 and the storefront configuration family). */
const STOREFRONT_WRITES = [
  'createWarehouse', 'updateWarehouse', 'deleteWarehouse',
  'upsertInventory', 'adjustInventory', 'transferInventory', 'importInventoryExcel',
  'createListing', 'updateListing', 'deleteListing',
  'createShippingZone', 'updateShippingZone', 'deleteShippingZone',
  'updateDeliveryConfig',
];
/** Not this packet's: the purchase-order routes (pkt/PR195-JOURNAL-SCOPE gates their receipt under expenses). */
const PURCHASE_ORDER_ROUTES = ['getPurchaseOrders', 'createPurchaseOrder', 'updatePurchaseOrder', 'advancePurchaseOrderStatus'];

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  MarketplaceControllerClass = MarketplaceController;
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { StockCountController } = await import('../src/modules/continental-ops/stock-count.controller');
  const { StockCountService } = await import('../src/modules/continental-ops/stock-count.service');
  const { GoodsReceiptController } = await import('../src/modules/continental-ops/goods-receipt.controller');
  const { GoodsReceiptService } = await import('../src/modules/continental-ops/goods-receipt.service');
  const { DeliveryNoteController } = await import('../src/modules/continental-ops/delivery-note.controller');
  const { DeliveryNoteService } = await import('../src/modules/continental-ops/delivery-note.service');
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { GeneratedDocumentService } = await import('../src/modules/google-drive/generated-document.service');
  Object.assign(stockControllers, { StockCountController, GoodsReceiptController, DeliveryNoteController, GoogleDriveController });
  /** The drive service as a recorder of the inventory-sheet calls (the claim: a refusal comes first). */
  const driveRecorder = Object.fromEntries(
    ['createInventorySheet', 'linkInventorySheet', 'unlinkInventorySheet', 'pushInventoryToSheet', 'applyPulledInventory', 'getInventorySheetSyncStatus'].map(
      (m) => [m, async (businessId: string) => { driveCalls.push(`${m}:${businessId}`); return { ok: true }; }],
    ),
  );

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController, StockCountController, GoodsReceiptController, DeliveryNoteController, GoogleDriveController],
    providers: [
      StockCountService,
      GoodsReceiptService,
      DeliveryNoteService,
      { provide: GoogleDriveService, useValue: driveRecorder },
      { provide: GeneratedDocumentService, useValue: {} },
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      scopeMod.ModuleScopeGuard,
      MarketplaceService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      // Review SEC-4: the bundle-order project door's service, recording (it creates a Project).
      { provide: CommerceIntegrationService, useValue: commerceIntegration },
      { provide: FulfillmentRoutingService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: ExpensePostingService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.staffDefault, ID.staffNone, ID.storeWrite, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99I Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99I Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.staffNone, ID.bizA, 'STAFF', { storefront: 'none', revenue: 'write' });
  await m(ID.storeWrite, ID.bizA, 'STAFF', { storefront: 'write' });
  await m(ID.outsider, ID.bizB, 'OWNER');

  await db.product.create({ data: { id: ID.product, businessId: ID.bizA, name: `${P}Widget`, price: 10 } });
  await db.warehouse.create({ data: { id: ID.whMain, businessId: ID.bizA, name: `${P}Main` } });
  await db.warehouse.create({ data: { id: ID.whBack, businessId: ID.bizA, name: `${P}Back room` } });
  await db.inventoryStock.create({ data: { id: ID.stock, businessId: ID.bizA, productId: ID.product, warehouseId: ID.whMain, quantity: 10 } });
  await db.shippingZone.create({ data: { id: ID.zone, businessId: ID.bizA, name: `${P}Local` } });
  await db.marketplaceListing.create({ data: { id: ID.listing, businessId: ID.bizA, productId: ID.product } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('route census: marketplace.controller.ts', () => {
  it("[INV-C01] RED-BEFORE: every warehouse, stock, listing, shipping-zone and delivery-config write runs AuthGuard, BusinessGuard, then ModuleScopeGuard and requires storefront write on its handler", () => {
    const routes = census(MarketplaceControllerClass);
    const byHandler = Object.fromEntries(routes.map((r) => [r.handler, r]));
    const problems: string[] = [];
    for (const handler of STOREFRONT_WRITES) {
      const r = byHandler[handler];
      if (!r) { problems.push(`${handler} is not a route`); continue; }
      for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
        if (!r.guards.includes(g)) problems.push(`${r.key} does not run ${g}`);
      }
      if (r.guards.indexOf('ModuleScopeGuard') >= 0 && r.guards.indexOf('ModuleScopeGuard') < r.guards.indexOf('BusinessGuard')) {
        problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
      }
      if (r.scope?.module !== 'storefront' || r.scope?.minLevel !== 'write') {
        problems.push(`${r.key} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not storefront:write`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[INV-C02] the purchase-order routes take no storefront requirement from this packet (their gate is pkt/PR195-JOURNAL-SCOPE\'s)', () => {
    const routes = census(MarketplaceControllerClass);
    for (const handler of PURCHASE_ORDER_ROUTES) {
      const r = routes.find((x) => x.handler === handler);
      expect(r, handler).toBeTruthy();
      expect(r!.scope?.module, handler).not.toBe('storefront');
    }
  });
});

describe('BUG-015: a read-only or no-access member cannot change stock or warehouses', () => {
  it('[INV-01] RED-BEFORE: STAFF on role defaults (storefront read) is refused 403 adjusting a stock level; the quantity and the movement log are unchanged', async () => {
    const before = await writableState();
    const res = await send('post', `${base()}/inventory/adjust`, ID.staffDefault, { stockId: ID.stock, quantityChange: -2, reasonCode: 'DAMAGE' });
    expect(res.status).toBe(403);
    expect(String(res.body?.message ?? '')).toMatch(/storefront requires write access \(you have read\)/);
    expect(await writableState()).toEqual(before);
  });

  it('[INV-02] RED-BEFORE: STAFF on role defaults is refused 403 creating a warehouse, and nothing is written', async () => {
    const before = await writableState();
    const res = await send('post', `${base()}/warehouses`, ID.staffDefault, { name: `${P}Jada warehouse` });
    expect(res.status).toBe(403);
    expect(await writableState()).toEqual(before);
  });

  it('[INV-03] RED-BEFORE: every stock and warehouse write refuses a storefront-read member and a storefront-none member, and writes nothing', async () => {
    const before = await writableState();
    const writes: Array<[Verb, string, unknown?]> = [
      ['post', `${base()}/inventory`, { productId: ID.product, warehouseId: ID.whMain, quantity: 99 }],
      ['post', `${base()}/inventory/adjust`, { stockId: ID.stock, quantityChange: 5, reasonCode: 'COUNT_CORRECTION' }],
      ['post', `${base()}/inventory/transfer`, { productId: ID.product, fromWarehouseId: ID.whMain, toWarehouseId: ID.whBack, quantity: 1 }],
      ['patch', `${base()}/warehouses/${ID.whMain}`, { name: `${P}renamed` }],
      ['delete', `${base()}/warehouses/${ID.whBack}`],
      ['post', `${base()}/warehouses`, { name: `${P}another` }],
    ];
    for (const actor of [ID.staffDefault, ID.staffNone]) {
      for (const [verb, url, body] of writes) {
        const res = await send(verb, url, actor, body);
        expect(res.status, `${actor} ${verb.toUpperCase()} ${url}`).toBe(403);
      }
    }
    expect(await writableState()).toEqual(before);
  });

  it('[INV-04] RED-BEFORE: the Excel stock import refuses a storefront-read member before the file is read', async () => {
    const before = await writableState();
    const res = await (request(app.getHttpServer()) as any)
      .post(`${base()}/inventory/import-excel`)
      .set('x-forwarded-for', nextIp())
      .set('x-test-user', ID.staffDefault)
      .attach('file', Buffer.from('not a workbook'), 'stock.xlsx');
    expect(res.status).toBe(403);
    expect(await writableState()).toEqual(before);
  });

  it('[INV-05] storefront write admits: a storefront:write STAFF member and the owner adjust stock and create a warehouse', async () => {
    for (const actor of [ID.storeWrite, ID.owner]) {
      const adj = await send('post', `${base()}/inventory/adjust`, actor, { stockId: ID.stock, quantityChange: 1, reasonCode: 'COUNT_CORRECTION' });
      expect(adj.status, actor).toBe(201);
      const wh = await send('post', `${base()}/warehouses`, actor, { name: `${P}by ${actor}` });
      expect(wh.status, actor).toBe(201);
    }
  });

  it('[INV-06] a storefront-read member still reads stock and warehouses', async () => {
    expect((await send('get', `${base()}/inventory`, ID.staffDefault)).status).toBe(200);
    expect((await send('get', `${base()}/warehouses`, ID.staffDefault)).status).toBe(200);
  });

  it('[INV-07] a member of another business is refused (BusinessGuard, unchanged)', async () => {
    expect((await send('post', `${base()}/inventory/adjust`, ID.outsider, { stockId: ID.stock, quantityChange: -1, reasonCode: 'DAMAGE' })).status).toBe(403);
  });
});

describe('census family: the store configuration writes need storefront write', () => {
  it('[INV-08] RED-BEFORE: listing, shipping-zone and delivery-config writes refuse a storefront-read member with 403 and write nothing', async () => {
    const before = await writableState();
    const writes: Array<[Verb, string, unknown?]> = [
      ['post', `${base()}/listings`, { productId: ID.product }],
      ['patch', `${base()}/listings/${ID.listing}`, { marketReach: 'GLOBAL' }],
      ['delete', `${base()}/listings/${ID.listing}`],
      ['post', `${base()}/shipping-zones`, { name: `${P}zone2` }],
      ['patch', `${base()}/shipping-zones/${ID.zone}`, { baseFee: 99 }],
      ['delete', `${base()}/shipping-zones/${ID.zone}`],
      ['put', `${base()}/delivery-config`, { pickup: true }],
    ];
    for (const [verb, url, body] of writes) {
      const res = await send(verb, url, ID.staffDefault, body);
      expect(res.status, `${verb.toUpperCase()} ${url}`).toBe(403);
    }
    expect(await writableState()).toEqual(before);
  });

  it('[INV-09] the owner still configures the store', async () => {
    expect((await send('post', `${base()}/shipping-zones`, ID.owner, { name: `${P}zone3` })).status).toBe(201);
    expect((await send('put', `${base()}/delivery-config`, ID.owner, { pickup: true })).status).toBe(200);
  });
});

describe('BUG-015 family (REST scope census): the other doors that move stock need storefront write', () => {
  const STOCK_DOORS: Record<string, string[]> = {
    StockCountController: ['create', 'update', 'adjust', 'remove'],
    GoodsReceiptController: ['create', 'update', 'post', 'remove'],
    DeliveryNoteController: ['create', 'update', 'fulfill', 'cancel', 'remove'],
    GoogleDriveController: ['createInventorySheet', 'linkInventorySheet', 'unlinkInventorySheet', 'pushInventoryToSheet', 'applyPulledInventory'],
  };

  it('[INV-C03] RED-BEFORE: every stock-count, goods-receipt and delivery-note write and every inventory-sheet write runs AuthGuard, BusinessGuard, then ModuleScopeGuard and requires storefront write', () => {
    const problems: string[] = [];
    for (const [cls, handlers] of Object.entries(STOCK_DOORS)) {
      const routes = census(stockControllers[cls]);
      for (const handler of handlers) {
        const r = routes.find((x) => x.handler === handler);
        if (!r) { problems.push(`${cls}.${handler} is not a route`); continue; }
        for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) if (!r.guards.includes(g)) problems.push(`${r.key} does not run ${g}`);
        if (r.guards.indexOf('ModuleScopeGuard') >= 0 && r.guards.indexOf('ModuleScopeGuard') < r.guards.indexOf('BusinessGuard')) problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
        if (r.scope?.module !== 'storefront' || r.scope?.minLevel !== 'write') problems.push(`${r.key} requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not storefront:write`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('[INV-10] RED-BEFORE: a storefront-read member is refused 403 creating, adjusting, posting or fulfilling a stock count, goods receipt or delivery note; nothing is written', async () => {
    const before = await writableState();
    const ops = `/continental-ops/businesses/${ID.bizA}`;
    const writes: Array<[Verb, string, unknown?]> = [
      ['post', `${ops}/stock-counts`, { countNumber: `${P}SC-1`, items: [{ productId: ID.product, description: 'Widget', systemQty: 10, countedQty: 2 }] }],
      ['post', `${ops}/stock-counts/${P}sc_any/adjust`],
      ['post', `${ops}/goods-receipts`, { grNumber: `${P}GR-1`, items: [] }],
      ['post', `${ops}/goods-receipts/${P}gr_any/post`],
      ['post', `${ops}/delivery-notes`, { dnNumber: `${P}DN-1`, items: [] }],
      ['post', `${ops}/delivery-notes/${P}dn_any/fulfill`],
    ];
    for (const [verb, url, body] of writes) {
      const res = await send(verb, url, ID.staffDefault, body);
      expect(res.status, `${verb.toUpperCase()} ${url}`).toBe(403);
    }
    expect(await writableState()).toEqual(before);
  });

  it('[INV-11] RED-BEFORE: a storefront-read member is refused applying a pulled inventory sheet (and the sheet sync setup) before the drive service is reached', async () => {
    driveCalls.length = 0;
    const drive = `/drive/businesses/${ID.bizA}/inventory-sheet`;
    const writes: Array<[Verb, string, unknown?]> = [
      ['post', `${drive}/apply`, { rows: [{ SKU: 'W-1', 'Quantity On Hand': '999' }] }],
      ['post', `${drive}/push`],
      ['post', `${drive}/create`, { title: 'Stock' }],
      ['post', `${drive}/link`, { sheetId: 's', sheetName: 'n' }],
      ['delete', `${drive}/unlink`],
    ];
    for (const [verb, url, body] of writes) {
      const res = await send(verb, url, ID.staffDefault, body);
      expect(res.status, `${verb.toUpperCase()} ${url}`).toBe(403);
    }
    expect(driveCalls).toEqual([]);
    // the status read stays open to members
    expect((await send('get', `${drive}/status`, ID.staffDefault)).status).toBe(200);
  });

  it('[INV-12] storefront write admits: the owner records a stock count and applies a sheet', async () => {
    const sc = await send('post', `/continental-ops/businesses/${ID.bizA}/stock-counts`, ID.owner, { countNumber: `${P}SC-OWNER`, items: [] });
    expect(sc.status).toBe(201);
    driveCalls.length = 0;
    expect((await send('post', `/drive/businesses/${ID.bizA}/inventory-sheet/apply`, ID.storeWrite, { rows: [] })).status).toBe(201);
    expect(driveCalls).toEqual([`applyPulledInventory:${ID.bizA}`]);
  });
});

describe('review SEC-4: the bundle-order project door needs projects write (the BUG-014 rule)', () => {
  it('[INV-SEC4-01] RED-BEFORE: POST .../orders/:orderId/create-project runs ModuleScopeGuard with projects write on its handler', () => {
    const r = census(MarketplaceControllerClass).find((x) => x.handler === 'createProjectForBundleOrder');
    expect(r).toBeTruthy();
    expect(r!.guards).toEqual(expect.arrayContaining(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']));
    expect(r!.scope).toEqual({ module: 'projects', minLevel: 'write' });
  });

  it('[INV-SEC4-02] RED-BEFORE: STAFF on role defaults (projects read) and a storefront-write member without projects are refused 403 before a project is created; the owner is admitted', async () => {
    commerceIntegration.createProjectForBundleOrder.mockClear();
    for (const actor of [ID.staffDefault, ID.storeWrite]) {
      const res = await send('post', `${base()}/orders/${P}order_1/create-project`, actor, { name: `${P}Jada project` });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/projects requires write access/);
    }
    expect(commerceIntegration.createProjectForBundleOrder).not.toHaveBeenCalled();
    const ok = await send('post', `${base()}/orders/${P}order_1/create-project`, ID.owner, { name: `${P}Owner project` });
    expect(ok.status).toBe(201);
    expect(commerceIntegration.createProjectForBundleOrder).toHaveBeenCalledTimes(1);
  });
});
