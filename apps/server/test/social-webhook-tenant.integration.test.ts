/**
 * P117 / RR-WEBHOOK-INGRESS-CENSUS (D-261 / D-262 / D-56) —
 * POST /social/webhook/:businessId MUST bind the signed Meta payload's page/recipient IDs
 * to a live SocialConnection.platformId owned by :businessId (REAL database, REAL HTTP).
 *
 * Meta signs every business's Messenger and Instagram deliveries with the single app secret
 * (META_APP_SECRET), so a valid x-hub-signature-256 proves Meta sent the body, NOT which
 * business owns the page or Instagram account named inside it. Without verifying that every
 * entry/recipient ID belongs to :businessId's SocialConnection rows, a signed delivery for
 * business A replayed to POST /social/webhook/B lands in business B's KEY Inbox.
 *
 * Fixtures: prefix `v72d_` (registered in apps/server/test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL using sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72d_';
const APP_SECRET = `${P}meta_app_secret`;

const ID = {
  userA: `${P}userA`,
  userB: `${P}userB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  pageA: `${P}page_a`,
  pageB: `${P}page_b`,
  igA: `${P}ig_a`,
  pageUnknown: `${P}page_unknown`,
};

let db: any;
let app: any;
const prevMetaAppSecret = process.env.META_APP_SECRET;

function metaSignature(raw: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

function makeMetaDmBody(opts: {
  object?: 'page' | 'instagram';
  entryId?: string;
  recipientId?: string;
  senderId: string;
  mid: string;
  text: string;
}) {
  return {
    object: opts.object ?? 'page',
    entry: [
      {
        ...(opts.entryId !== undefined ? { id: opts.entryId } : {}),
        time: 1700000000000,
        messaging: [
          {
            sender: { id: opts.senderId },
            ...(opts.recipientId !== undefined ? { recipient: { id: opts.recipientId } } : {}),
            timestamp: 1700000000000,
            message: { mid: opts.mid, text: opts.text },
          },
        ],
      },
    ],
  };
}

async function postWebhook(businessId: string, body: unknown, signatureOverride?: string) {
  const raw = JSON.stringify(body);
  const sig = signatureOverride ?? metaSignature(raw);
  return request(app.getHttpServer())
    .post(`/social/webhook/${businessId}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw);
}

async function cleanup() {
  const tables = [
    `DELETE FROM webhook_delivery_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_threads WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM social_engagements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM social_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ];
  for (const sql of tables) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function clearInboxMessages() {
  for (const sql of [
    `DELETE FROM webhook_delivery_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_messages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_inbox_threads WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM social_engagements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function countInboxMessages(businessId: string): Promise<number> {
  return db.keyInboxMessage.count({ where: { businessId } });
}

beforeAll(async () => {
  process.env.META_APP_SECRET = APP_SECRET;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { KeyInboxService } = await import('../src/modules/key-inbox/key-inbox.service');
  const { KeyInboxAnalysisService } = await import('../src/modules/key-inbox/key-inbox-analysis.service');
  const { KeyInboxActionService } = await import('../src/modules/key-inbox/key-inbox-action.service');
  const { KeyInboxTemporalEmitterService } = await import('../src/modules/key-inbox/key-inbox-temporal-emitter.service');
  const { KeyInboxReplySenderService } = await import('../src/modules/key-inbox/key-inbox-reply-sender.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { SocialController } = await import('../src/modules/social/social.controller');
  const { SocialService } = await import('../src/modules/social/social.service');
  const { SocialConnectionsService } = await import('../src/modules/social/social-connections.service');
  const { SocialAnalyticsService } = await import('../src/modules/social/social-analytics.service');
  const { MetaSocialIngestionService } = await import('../src/modules/social/meta-social-ingestion.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [SocialController],
    providers: [
      PrismaService,
      WebhookIngressLoggerService,
      EntityResolutionService,
      KeyInboxService,
      MetaSocialIngestionService,
      {
        provide: EventEmitter2,
        useValue: { emit: () => true },
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
        provide: KeyInboxAnalysisService,
        useValue: {
          analyzeMessage: async () => ({
            entities: {},
            confidence: 0,
            intent: 'GENERAL',
            sentiment: 'NEUTRAL',
            urgency: 'LOW',
            summary: '',
            suggestedReplies: [],
          }),
          analyzeThread: async () => ({
            intent: 'GENERAL',
            sentiment: 'NEUTRAL',
            urgency: 'LOW',
            summary: '',
          }),
        },
      },
      {
        provide: KeyInboxActionService,
        useValue: { buildActions: async () => [] },
      },
      {
        provide: KeyInboxTemporalEmitterService,
        useValue: { emitMessageReceived: async () => undefined },
      },
      {
        provide: AiUsageService,
        useValue: {},
      },
      {
        provide: KeyInboxReplySenderService,
        useValue: {},
      },
      {
        provide: AuthGuard,
        useValue: { canActivate: () => true },
      },
      {
        provide: BusinessGuard,
        useValue: { canActivate: () => true },
      },
      {
        provide: ModuleScopeGuard,
        useValue: { canActivate: () => true },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.userA, email: `${P}a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'Biz A', slug: `${P}biz-a`, ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'Biz B', slug: `${P}biz-b`, ownerId: ID.userB } });

  await db.socialConnection.create({
    data: {
      id: `${P}conn_a_fb`,
      businessId: ID.bizA,
      platform: 'FACEBOOK',
      platformId: ID.pageA,
      accountName: 'Page A',
      token: `${P}token_a_fb`,
      status: 'CONNECTED',
    },
  });
  await db.socialConnection.create({
    data: {
      id: `${P}conn_a_ig`,
      businessId: ID.bizA,
      platform: 'INSTAGRAM',
      platformId: ID.igA,
      accountName: '@biz_a',
      token: `${P}token_a_ig`,
      status: 'CONNECTED',
    },
  });
  await db.socialConnection.create({
    data: {
      id: `${P}conn_b_fb`,
      businessId: ID.bizB,
      platform: 'FACEBOOK',
      platformId: ID.pageB,
      accountName: 'Page B',
      token: `${P}token_b_fb`,
      status: 'CONNECTED',
    },
  });
}, 60_000);

beforeEach(async () => {
  await clearInboxMessages();
});

afterAll(async () => {
  if (prevMetaAppSecret === undefined) {
    delete process.env.META_APP_SECRET;
  } else {
    process.env.META_APP_SECRET = prevMetaAppSecret;
  }
  if (app) await app.close();
  if (db) await cleanup();
});

describe('POST /social/webhook/:businessId tenant binding (RR-WEBHOOK-INGRESS-CENSUS)', () => {
  it('refuses with 403 and ingests nothing when business A page is POSTed to /social/webhook/B', async () => {
    const body = makeMetaDmBody({
      object: 'page',
      entryId: ID.pageA,
      recipientId: ID.pageA,
      senderId: `${P}sender_cross`,
      mid: `${P}mid_cross_1`,
      text: 'DM intended for business A',
    });

    const res = await postWebhook(ID.bizB, body);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 and ingests nothing on multi-entry smuggling (entry[0]=B, entry[1]=A) POSTed to B', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: ID.pageB,
          time: 1700000000001,
          messaging: [
            {
              sender: { id: `${P}sender_smuggle_0` },
              recipient: { id: ID.pageB },
              timestamp: 1700000000001,
              message: { mid: `${P}mid_smuggle_0`, text: 'Decoy for B' },
            },
          ],
        },
        {
          id: ID.pageA,
          time: 1700000000002,
          messaging: [
            {
              sender: { id: `${P}sender_smuggle_1` },
              recipient: { id: ID.pageA },
              timestamp: 1700000000002,
              message: { mid: `${P}mid_smuggle_1`, text: 'Smuggled entry for A' },
            },
          ],
        },
      ],
    };

    const res = await postWebhook(ID.bizB, body);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 when entry.id is B but messaging[].recipient.id belongs to A', async () => {
    const body = makeMetaDmBody({
      object: 'page',
      entryId: ID.pageB,
      recipientId: ID.pageA,
      senderId: `${P}sender_recip_mismatch`,
      mid: `${P}mid_recip_mismatch`,
      text: 'Recipient mismatch smuggling',
    });

    const res = await postWebhook(ID.bizB, body);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 and ingests nothing when page ID is unknown or missing', async () => {
    const unknownPageBody = makeMetaDmBody({
      object: 'page',
      entryId: ID.pageUnknown,
      recipientId: ID.pageUnknown,
      senderId: `${P}sender_unknown`,
      mid: `${P}mid_unknown`,
      text: 'Unknown page DM',
    });
    const unknownRes = await postWebhook(ID.bizB, unknownPageBody);
    expect(unknownRes.status).toBe(403);

    const emptyEntryRes = await postWebhook(ID.bizB, { object: 'page', entry: [] });
    expect(emptyEntryRes.status).toBe(403);

    const legacyUnattributedRes = await postWebhook(ID.bizB, {
      type: 'DM',
      platform: 'facebook',
      from: { id: `${P}sender_legacy`, name: 'Legacy Sender' },
      message: 'Unattributed legacy DM',
      externalId: `${P}mid_legacy`,
    });
    expect(legacyUnattributedRes.status).toBe(403);

    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('still rejects invalid Meta signature with 403 and ingests nothing', async () => {
    const body = makeMetaDmBody({
      object: 'page',
      entryId: ID.pageA,
      recipientId: ID.pageA,
      senderId: `${P}sender_badsig`,
      mid: `${P}mid_badsig`,
      text: 'Tampered payload',
    });

    const res = await postWebhook(ID.bizA, body, metaSignature(JSON.stringify(body), 'wrong_secret'));

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 and ingests nothing when business A Instagram account is POSTed to /social/webhook/B', async () => {
    const igBody = makeMetaDmBody({
      object: 'instagram',
      entryId: ID.igA,
      recipientId: ID.igA,
      senderId: `${P}sender_cross_ig`,
      mid: `${P}mid_cross_ig`,
      text: 'Instagram DM intended for business A',
    });

    const res = await postWebhook(ID.bizB, igBody);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('negative control: exact same signed body for business A page POSTed to /social/webhook/A ingests cleanly for A', async () => {
    const fbBody = makeMetaDmBody({
      object: 'page',
      entryId: ID.pageA,
      recipientId: ID.pageA,
      senderId: `${P}sender_legit_fb`,
      mid: `${P}mid_legit_fb`,
      text: 'Legitimate Messenger DM for A',
    });

    const fbRes = await postWebhook(ID.bizA, fbBody);

    expect(fbRes.status).toBe(201);
    expect(fbRes.body.success).toBe(true);
    expect(await countInboxMessages(ID.bizA)).toBe(1);
    expect(await countInboxMessages(ID.bizB)).toBe(0);

    const igBody = makeMetaDmBody({
      object: 'instagram',
      entryId: ID.igA,
      recipientId: ID.igA,
      senderId: `${P}sender_legit_ig`,
      mid: `${P}mid_legit_ig`,
      text: 'Legitimate Instagram DM for A',
    });

    const igOwnRes = await postWebhook(ID.bizA, igBody);
    expect(igOwnRes.status).toBe(201);
    expect(igOwnRes.body.success).toBe(true);
    expect(await countInboxMessages(ID.bizA)).toBe(2);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('accepts batched delivery for business A containing inbound DM plus outbound is_echo for page A', async () => {
    const batchedBody = {
      object: 'page',
      entry: [
        {
          id: ID.pageA,
          time: 1700000000100,
          messaging: [
            {
              sender: { id: `${P}customer_psid_1` },
              recipient: { id: ID.pageA },
              timestamp: 1700000000100,
              message: { mid: `${P}mid_batch_inbound`, text: 'Customer DM in batch' },
            },
            {
              sender: { id: ID.pageA },
              recipient: { id: `${P}customer_psid_1` },
              timestamp: 1700000000101,
              message: {
                is_echo: true,
                mid: `${P}mid_batch_echo`,
                text: 'Outbound echo from business A page',
              },
            },
          ],
        },
      ],
    };

    const res = await postWebhook(ID.bizA, batchedBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(await countInboxMessages(ID.bizA)).toBe(1);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 and ingests nothing when business A outbound is_echo is POSTed to /social/webhook/B', async () => {
    const echoCrossBody = {
      object: 'page',
      entry: [
        {
          id: ID.pageA,
          time: 1700000000200,
          messaging: [
            {
              sender: { id: ID.pageA },
              recipient: { id: `${P}customer_psid_2` },
              timestamp: 1700000000200,
              message: {
                is_echo: true,
                mid: `${P}mid_cross_echo`,
                text: 'Cross-tenant echo from business A',
              },
            },
          ],
        },
      ],
    };

    const res = await postWebhook(ID.bizB, echoCrossBody);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });

  it('refuses with 403 and ingests nothing on smuggled is_echo (entry.id=B, sender.id=A) POSTed to /social/webhook/B', async () => {
    const smuggledEchoBody = {
      object: 'page',
      entry: [
        {
          id: ID.pageB,
          time: 1700000000300,
          messaging: [
            {
              sender: { id: ID.pageA },
              recipient: { id: `${P}customer_psid_3` },
              timestamp: 1700000000300,
              message: {
                is_echo: true,
                mid: `${P}mid_smuggled_echo`,
                text: 'Smuggled echo claiming entry.id=B with sender.id=A',
              },
            },
          ],
        },
      ],
    };

    const res = await postWebhook(ID.bizB, smuggledEchoBody);

    expect(res.status).toBe(403);
    expect(await countInboxMessages(ID.bizA)).toBe(0);
    expect(await countInboxMessages(ID.bizB)).toBe(0);
  });
});
