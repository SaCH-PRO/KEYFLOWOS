/**
 * FU-NESTED-CREDENTIAL-READS (P149, V1-91) — P0 stop-the-line security proof
 * against a REAL PostgreSQL database and real NestJS HTTP app:
 *
 * Findings #2 & #3 from P143 SWP-READ-SCOPE-CENSUS:
 *   Part A (SupplierController / SupplierService):
 *     - NCR-SUP-01: GET /supplier/businesses/:businessId/supplier-products/:supplierProductId
 *       must return non-secret supplierConnection fields and ZERO credentials
 *       (key absent, not even undefined; no ciphertext or secret canary in JSON).
 *     - NCR-SUP-02: GET /supplier/businesses/:businessId/products/:productId/source-links
 *       must return non-secret nested supplierProduct.supplierConnection fields and ZERO credentials.
 *     - NCR-SUP-03: GET /supplier/businesses/:businessId/connections,
 *       GET /supplier/businesses/:businessId/connections/:connectionId,
 *       POST /supplier/businesses/:businessId/connections, and
 *       PATCH /supplier/businesses/:businessId/connections/:connectionId
 *       (plus direct SupplierService read calls) must NEVER expose credentials
 *       (key absent even in JS objects; no ciphertext or secret canary in JSON).
 *
 *   Part B (CommunicationsController / ChannelConnectionService / OutboundContentService):
 *     - NCR-COM-01: GET /communications/businesses/:businessId/content/:id
 *       must preserve safe destinationMeta fields (pageId, pageName, igUserId, username)
 *       while recursively stripping accessToken, pageAccessToken, refreshToken,
 *       other secret keys, nested secret objects, and enc:v1: ciphertext values
 *       from deliveries[].destination.destinationMeta.
 *     - NCR-COM-02: GET /communications/businesses/:businessId/connections,
 *       GET /communications/businesses/:businessId/connections/:id, and
 *       POST /communications/businesses/:businessId/connections/:id/health-check
 *       must strip BOTH top-level connection token/refreshToken AND nested
 *       destinations[].destinationMeta secrets while preserving safe metadata.
 *     - NCR-COM-03: Direct DB and internal credential reads STILL see intact raw
 *       ChannelDestination.destinationMeta.accessToken and decrypted
 *       SupplierConnection.credentials (reads never mutate stored DB rows).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v91q_` prefix and is
 * hard-deleted via raw SQL using sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91q_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staff: `${P}staff`,
  bizA: `${P}bizA`,
  supConn: `${P}supConn`,
  supProd: `${P}supProd`,
  product: `${P}product`,
  srcLink: `${P}srcLink`,
  chConn: `${P}chConn`,
  chDest: `${P}chDest`,
  content: `${P}content`,
  delivery: `${P}delivery`,
};

const CANARY_SUP_API_KEY = `${P}SUPPLIER_API_KEY_CANARY_9001`;
const CANARY_SUP_API_SECRET = `${P}SUPPLIER_API_SECRET_CANARY_9002`;
const CANARY_SUP_CREATE_KEY = `${P}SUPPLIER_CREATE_KEY_CANARY_9003`;
const CANARY_SUP_UPDATE_KEY = `${P}SUPPLIER_UPDATE_KEY_CANARY_9004`;

const CANARY_CONN_TOKEN = `${P}CHANNEL_CONN_TOKEN_CANARY_8001`;
const CANARY_CONN_REFRESH = `${P}CHANNEL_CONN_REFRESH_CANARY_8002`;

const CANARY_PAGE_ACCESS_TOKEN = `${P}DEST_ACCESS_TOKEN_CANARY_7001`;
const CANARY_PAGE_TOKEN = `${P}DEST_PAGE_ACCESS_TOKEN_CANARY_7002`;
const CANARY_DEST_REFRESH = `${P}DEST_REFRESH_TOKEN_CANARY_7003`;
const CANARY_CLIENT_SECRET = `${P}DEST_CLIENT_SECRET_CANARY_7004`;
const CANARY_WEBHOOK_SECRET = `${P}DEST_WEBHOOK_SECRET_CANARY_7005`;
const CANARY_DEST_API_KEY = `${P}DEST_API_KEY_CANARY_7006`;
const CANARY_DEST_API_SECRET = `${P}DEST_API_SECRET_CANARY_7007`;
const CANARY_DEST_PASSWORD = `${P}DEST_PASSWORD_CANARY_7008`;
const CANARY_DEST_CREDENTIALS = `${P}DEST_CREDENTIALS_CANARY_7009`;
const CANARY_DEST_PRIVATE_KEY = `${P}DEST_PRIVATE_KEY_CANARY_7010`;
const CANARY_DEST_AUTH_DATA = `${P}DEST_AUTH_DATA_CANARY_7011`;
const CANARY_DEST_AUTH_REF = `${P}DEST_AUTH_REF_CANARY_7012`;
const CANARY_NESTED_TOKEN = `${P}DEST_NESTED_TOKEN_CANARY_7013`;
const CANARY_NESTED_SECRET = `${P}DEST_NESTED_SECRET_CANARY_7014`;
const CANARY_ARRAY_API_KEY = `${P}DEST_ARRAY_API_KEY_CANARY_7015`;
const CANARY_OPAQUE_ENC = `enc:v1:${P}OPAQUE_CIPHERTEXT_CANARY_7016`;

const ALL_DEST_CANARIES = [
  CANARY_CONN_TOKEN,
  CANARY_CONN_REFRESH,
  CANARY_PAGE_ACCESS_TOKEN,
  CANARY_PAGE_TOKEN,
  CANARY_DEST_REFRESH,
  CANARY_CLIENT_SECRET,
  CANARY_WEBHOOK_SECRET,
  CANARY_DEST_API_KEY,
  CANARY_DEST_API_SECRET,
  CANARY_DEST_PASSWORD,
  CANARY_DEST_CREDENTIALS,
  CANARY_DEST_PRIVATE_KEY,
  CANARY_DEST_AUTH_DATA,
  CANARY_DEST_AUTH_REF,
  CANARY_NESTED_TOKEN,
  CANARY_NESTED_SECRET,
  CANARY_ARRAY_API_KEY,
  CANARY_OPAQUE_ENC,
  'enc:v1:',
];

const SECRET_META_KEYS = [
  'accessToken',
  'pageAccessToken',
  'refreshToken',
  'clientSecret',
  'webhookSecret',
  'apiKey',
  'apiSecret',
  'password',
  'credentials',
  'privateKey',
  'authData',
  'authDataRef',
  'opaqueCiphertext',
] as const;

let db: any;
let app: any;
let supplierService: any;
let encryptedSupplierCreds = '';

async function cleanup() {
  for (const sql of [
    `DELETE FROM delivery_events WHERE delivery_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM product_source_links WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM supplier_products WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM supplier_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

type Verb = 'get' | 'post' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string, body?: unknown) {
  let req = (request(app.getHttpServer()) as any)[verb](url).set(HEADER, actor);
  return body === undefined ? req : req.send(body);
}

function assertNoSupplierCredentials(conn: Record<string, unknown>, fullBody: unknown, extraCanaries: string[] = []) {
  expect(conn).toBeTruthy();
  expect('credentials' in conn).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(conn, 'credentials')).toBe(false);

  const serialized = JSON.stringify(fullBody);
  expect(serialized).not.toContain(encryptedSupplierCreds);
  expect(serialized).not.toContain('enc:v1:');
  expect(serialized).not.toContain(CANARY_SUP_API_KEY);
  expect(serialized).not.toContain(CANARY_SUP_API_SECRET);
  for (const canary of extraCanaries) {
    expect(serialized).not.toContain(canary);
  }
}

function assertSanitizedDestinationMeta(dest: Record<string, unknown>, fullBody: unknown) {
  expect(dest).toBeTruthy();
  const meta = dest.destinationMeta as Record<string, unknown>;
  expect(meta).toBeTruthy();

  // Safe non-secret metadata fields MUST remain intact for UI consumers
  expect(meta.pageId).toBe('page_v91q_safe_123');
  expect(meta.pageName).toBe('V91Q Safe Page');
  expect(meta.igUserId).toBe('ig_v91q_safe_456');
  expect(meta.username).toBe('v91q_safe_handle');

  const nested = meta.nested as Record<string, unknown>;
  expect(nested).toBeTruthy();
  expect(nested.pageName).toBe('V91Q Nested Safe');
  expect('accessToken' in nested).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(nested, 'accessToken')).toBe(false);
  expect('secret' in nested).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(nested, 'secret')).toBe(false);

  const items = meta.items as Array<Record<string, unknown>>;
  expect(Array.isArray(items)).toBe(true);
  expect(items).toHaveLength(1);
  expect(items[0].label).toBe('safe-item');
  expect('apiKey' in items[0]).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(items[0], 'apiKey')).toBe(false);

  // Every secret key MUST be absent (neither present nor undefined property)
  for (const key of SECRET_META_KEYS) {
    expect(key in meta, `secret key "${key}" leaked in destinationMeta`).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, key), `own property "${key}" leaked in destinationMeta`).toBe(false);
  }

  // Serialized payload MUST contain ZERO secret canaries or enc:v1: ciphertext
  const serialized = JSON.stringify(fullBody);
  for (const canary of ALL_DEST_CANARIES) {
    expect(serialized).not.toContain(canary);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');

  const { SupplierController } = await import('../src/modules/supplier/supplier.controller');
  const { SupplierService } = await import('../src/modules/supplier/supplier.service');
  const { ProductNormalizationService } = await import('../src/modules/supplier/product-normalization.service');
  const { encryptCredentials } = await import('../src/modules/supplier/credentials.util');

  const { CommunicationsController } = await import('../src/modules/communications/communications.controller');
  const { ChannelConnectionService } = await import('../src/modules/communications/channel-connection.service');
  const { OutboundContentService } = await import('../src/modules/communications/outbound-content.service');
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const { ContentAiService } = await import('../src/modules/communications/content-ai.service');

  encryptedSupplierCreds = encryptCredentials({
    apiKey: CANARY_SUP_API_KEY,
    apiSecret: CANARY_SUP_API_SECRET,
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [SupplierController, CommunicationsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      SupplierService,
      ChannelConnectionService,
      OutboundContentService,
      { provide: ProductNormalizationService, useValue: {} },
      { provide: DeliveryQueueService, useValue: {} },
      { provide: ContentAiService, useValue: {} },
    ],
  }).compile();

  supplierService = moduleRef.get(SupplierService);

  app = moduleRef.createNestApplication({ logger: false });
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
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

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@example.test`, role: 'USER' },
      { id: ID.staff, email: `${P}staff@example.test`, role: 'USER' },
    ],
  });

  await db.business.create({
    data: { id: ID.bizA, name: 'V91Q Nested Creds Biz', slug: `${P}biz-a`, ownerId: ID.owner },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}mem_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}mem_staff`,
        userId: ID.staff,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { settings: 'none', storefront: 'read', content: 'read' },
      },
    ],
  });

  await db.supplierConnection.create({
    data: {
      id: ID.supConn,
      businessId: ID.bizA,
      providerType: 'custom_api',
      displayName: 'V91Q Primary Supplier',
      credentials: encryptedSupplierCreds,
      accountMeta: { region: 'TT', accountCode: 'SUP-91Q' },
      syncCapabilities: ['catalog', 'inventory'],
      connectionHealth: 'healthy',
    },
  });

  await db.supplierProduct.create({
    data: {
      id: ID.supProd,
      supplierConnectionId: ID.supConn,
      externalId: `${P}ext_sku_1`,
      rawData: { sku: 'SKU-91Q' },
      normalizedTitle: 'V91Q Widget',
      normalizedPrice: 120,
      normalizedImages: [],
      availability: 'in_stock',
      currency: 'TTD',
    },
  });

  await db.product.create({
    data: {
      id: ID.product,
      businessId: ID.bizA,
      name: 'V91Q Storefront Widget',
      price: 250,
      currency: 'TTD',
      category: 'PRODUCT',
    },
  });

  await db.productSourceLink.create({
    data: {
      id: ID.srcLink,
      productId: ID.product,
      supplierProductId: ID.supProd,
      sourceCost: 120,
      leadTimeDays: 5,
      priority: 1,
    },
  });

  await db.channelConnection.create({
    data: {
      id: ID.chConn,
      businessId: ID.bizA,
      provider: 'META',
      label: 'V91Q Meta Connection',
      token: CANARY_CONN_TOKEN,
      refreshToken: CANARY_CONN_REFRESH,
      healthState: 'Connected',
    },
  });

  await db.channelDestination.create({
    data: {
      id: ID.chDest,
      businessId: ID.bizA,
      connectionId: ID.chConn,
      platform: 'FACEBOOK_PAGE',
      platformId: 'page_v91q_safe_123',
      displayName: 'V91Q Meta Page',
      capabilities: ['text', 'image'],
      destinationMeta: {
        pageId: 'page_v91q_safe_123',
        pageName: 'V91Q Safe Page',
        igUserId: 'ig_v91q_safe_456',
        username: 'v91q_safe_handle',
        accessToken: CANARY_PAGE_ACCESS_TOKEN,
        pageAccessToken: CANARY_PAGE_TOKEN,
        refreshToken: CANARY_DEST_REFRESH,
        clientSecret: CANARY_CLIENT_SECRET,
        webhookSecret: CANARY_WEBHOOK_SECRET,
        apiKey: CANARY_DEST_API_KEY,
        apiSecret: CANARY_DEST_API_SECRET,
        password: CANARY_DEST_PASSWORD,
        credentials: CANARY_DEST_CREDENTIALS,
        privateKey: CANARY_DEST_PRIVATE_KEY,
        authData: CANARY_DEST_AUTH_DATA,
        authDataRef: CANARY_DEST_AUTH_REF,
        opaqueCiphertext: CANARY_OPAQUE_ENC,
        nested: {
          pageName: 'V91Q Nested Safe',
          accessToken: CANARY_NESTED_TOKEN,
          secret: CANARY_NESTED_SECRET,
        },
        items: [
          { label: 'safe-item', apiKey: CANARY_ARRAY_API_KEY },
          CANARY_OPAQUE_ENC,
        ],
      },
    },
  });

  await db.outboundContent.create({
    data: {
      id: ID.content,
      businessId: ID.bizA,
      contentType: 'social_post',
      subject: 'V91Q Campaign Post',
      body: 'Hello from V91Q',
      status: 'Published',
    },
  });

  await db.outboundDelivery.create({
    data: {
      id: ID.delivery,
      businessId: ID.bizA,
      contentId: ID.content,
      destinationId: ID.chDest,
      status: 'Published',
    },
  });
});

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('FU-NESTED-CREDENTIAL-READS (P149): Part A — SupplierConnection.credentials', () => {
  it('[NCR-SUP-01] GET supplier-products/:supplierProductId returns non-secret supplierConnection fields and ZERO credentials', async () => {
    for (const actor of [ID.staff, ID.owner]) {
      const res = await send('get', `/supplier/businesses/${ID.bizA}/supplier-products/${ID.supProd}`, actor);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ID.supProd);
      expect(res.body.supplierConnection.id).toBe(ID.supConn);
      expect(res.body.supplierConnection.providerType).toBe('custom_api');
      expect(res.body.supplierConnection.displayName).toBe('V91Q Primary Supplier');
      expect(res.body.supplierConnection.accountMeta).toEqual({ region: 'TT', accountCode: 'SUP-91Q' });
      assertNoSupplierCredentials(res.body.supplierConnection, res.body);
    }
  });

  it('[NCR-SUP-02] GET products/:productId/source-links returns non-secret nested supplierConnection fields and ZERO credentials', async () => {
    for (const actor of [ID.staff, ID.owner]) {
      const res = await send('get', `/supplier/businesses/${ID.bizA}/products/${ID.product}/source-links`, actor);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      const nestedConn = res.body[0].supplierProduct.supplierConnection;
      expect(nestedConn.id).toBe(ID.supConn);
      expect(nestedConn.providerType).toBe('custom_api');
      expect(nestedConn.displayName).toBe('V91Q Primary Supplier');
      assertNoSupplierCredentials(nestedConn, res.body);
    }
  });

  it('[NCR-SUP-03] supplier connections list/get/create/update return non-secret fields with ZERO credentials key or canary', async () => {
    for (const actor of [ID.staff, ID.owner]) {
      const listRes = await send('get', `/supplier/businesses/${ID.bizA}/connections`, actor);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
      const found = listRes.body.data.find((c: any) => c.id === ID.supConn);
      expect(found.displayName).toBe('V91Q Primary Supplier');
      assertNoSupplierCredentials(found, listRes.body);

      const getRes = await send('get', `/supplier/businesses/${ID.bizA}/connections/${ID.supConn}`, actor);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(ID.supConn);
      expect(getRes.body.displayName).toBe('V91Q Primary Supplier');
      assertNoSupplierCredentials(getRes.body, getRes.body);
    }

    // Direct service calls must omit the credentials property completely (not even credentials: undefined)
    const directList = await supplierService.getSupplierConnections(ID.bizA);
    const directRow = directList.data.find((c: any) => c.id === ID.supConn);
    assertNoSupplierCredentials(directRow, directList);

    const directGet = await supplierService.getSupplierConnection(ID.bizA, ID.supConn);
    assertNoSupplierCredentials(directGet, directGet);

    // POST & PATCH connection must NEVER return credentials ciphertext either
    const createRes = await send('post', `/supplier/businesses/${ID.bizA}/connections`, ID.owner, {
      providerType: 'custom_api',
      displayName: 'V91Q Created Supplier',
      credentials: { apiKey: CANARY_SUP_CREATE_KEY },
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.displayName).toBe('V91Q Created Supplier');
    assertNoSupplierCredentials(createRes.body, createRes.body, [CANARY_SUP_CREATE_KEY]);

    const patchRes = await send('patch', `/supplier/businesses/${ID.bizA}/connections/${createRes.body.id}`, ID.owner, {
      displayName: 'V91Q Updated Supplier',
      credentials: { apiKey: CANARY_SUP_UPDATE_KEY },
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.displayName).toBe('V91Q Updated Supplier');
    assertNoSupplierCredentials(patchRes.body, patchRes.body, [CANARY_SUP_CREATE_KEY, CANARY_SUP_UPDATE_KEY]);
  });
});

describe('FU-NESTED-CREDENTIAL-READS (P149): Part B — ChannelDestination.destinationMeta & ChannelConnection', () => {
  it('[NCR-COM-01] GET communications content/:id strips all nested destinationMeta secrets while preserving safe metadata', async () => {
    for (const actor of [ID.staff, ID.owner]) {
      const res = await send('get', `/communications/businesses/${ID.bizA}/content/${ID.content}`, actor);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ID.content);
      expect(Array.isArray(res.body.deliveries)).toBe(true);
      expect(res.body.deliveries).toHaveLength(1);
      assertSanitizedDestinationMeta(res.body.deliveries[0].destination, res.body);
    }
  });

  it('[NCR-COM-02] GET communications connections and connections/:id (and health-check) strip top-level tokens AND nested destinationMeta secrets', async () => {
    for (const actor of [ID.staff, ID.owner]) {
      const listRes = await send('get', `/communications/businesses/${ID.bizA}/connections`, actor);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      const conn = listRes.body.find((c: any) => c.id === ID.chConn);
      expect(conn).toBeTruthy();
      expect('token' in conn).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(conn, 'token')).toBe(false);
      expect('refreshToken' in conn).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(conn, 'refreshToken')).toBe(false);
      expect(conn.destinations).toHaveLength(1);
      assertSanitizedDestinationMeta(conn.destinations[0], listRes.body);

      const getRes = await send('get', `/communications/businesses/${ID.bizA}/connections/${ID.chConn}`, actor);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(ID.chConn);
      expect('token' in getRes.body).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(getRes.body, 'token')).toBe(false);
      expect('refreshToken' in getRes.body).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(getRes.body, 'refreshToken')).toBe(false);
      expect(getRes.body.destinations).toHaveLength(1);
      assertSanitizedDestinationMeta(getRes.body.destinations[0], getRes.body);
    }

    const hcRes = await send('post', `/communications/businesses/${ID.bizA}/connections/${ID.chConn}/health-check`, ID.owner);
    expect(hcRes.status).toBe(201);
    expect(hcRes.body.destinations).toHaveLength(1);
    assertSanitizedDestinationMeta(hcRes.body.destinations[0], hcRes.body);
  });

  it('[NCR-COM-03] internal DB/service credential reads remain intact after HTTP reads (no DB mutation on read)', async () => {
    const rawDest = await db.channelDestination.findUnique({ where: { id: ID.chDest } });
    expect(rawDest).toBeTruthy();
    const rawMeta = rawDest.destinationMeta as Record<string, unknown>;
    expect(rawMeta.accessToken).toBe(CANARY_PAGE_ACCESS_TOKEN);
    expect(rawMeta.pageAccessToken).toBe(CANARY_PAGE_TOKEN);
    expect(rawMeta.refreshToken).toBe(CANARY_DEST_REFRESH);
    expect(rawMeta.pageId).toBe('page_v91q_safe_123');
    expect((rawMeta.nested as Record<string, unknown>).accessToken).toBe(CANARY_NESTED_TOKEN);

    const decryptedSupplier = await supplierService.getDecryptedCredentials(ID.bizA, ID.supConn);
    expect(decryptedSupplier).toEqual({
      apiKey: CANARY_SUP_API_KEY,
      apiSecret: CANARY_SUP_API_SECRET,
    });
  });
});
