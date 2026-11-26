/**
 * P92 — MEM-EXPIRED-NOT-SERVED (server, P1 launch-track, S):
 *
 * Real Postgres integration proof over `UnifiedMemoryRetrievalService` and
 * `KeyCortexPromptContextService.buildMemoryContext`:
 *
 *   - [MENS-01] RED-BEFORE: An `AiMemory` row with `expiresAt` in the past is
 *               excluded from both `retrieveContext` and `buildMemoryContext`,
 *               while an unexpired (`expiresAt` in the future) row and a
 *               permanent (`expiresAt: null`) row are served unchanged.
 *   - [MENS-02] RED-BEFORE: A `confidence: 0` row scores strictly below an
 *               unscored (`confidence: null`) row (0.5) and below every
 *               positive-confidence row, ranking last among equal-age rows
 *               while preserving positive-confidence order (`0.9 > 0.2 > unscored > 0`).
 *   - [MENS-03] Control: Tenant isolation — unexpired `AiMemory` rows of `bizB`
 *               never appear in `bizA`'s retrieval or `buildMemoryContext`.
 *
 * Fixtures use prefix `v92m_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92m_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  memExpired: `${P}memExpired`,
  memFuture: `${P}memFuture`,
  memPermanent: `${P}memPermanent`,
  memBizB: `${P}memBizB`,
  memZero: `${P}memZero`,
  memLow: `${P}memLow`,
  memHigh: `${P}memHigh`,
  tfUnscored: `${P}tfUnscored`,
  tfZero: `${P}tfZero`,
  tfLow: `${P}tfLow`,
  tfHigh: `${P}tfHigh`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let retrieval: any;
let promptContext: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_memories WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_memories WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

beforeAll(async () => {
  Logger.overrideLogger(false);

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;
  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `${P}Biz A`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: `${P}Biz B`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  const now = new Date();
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await db.aiMemory.createMany({
    data: [
      {
        id: ID.memExpired,
        businessId: ID.bizA,
        category: 'corrections',
        key: 'stale_rule',
        value: 'EXPIRED_STALE_CORRECTION_NEVER_SERVE',
        confidence: 1.0,
        source: 'cerebellum',
        expiresAt: past,
        createdAt: now,
      },
      {
        id: ID.memFuture,
        businessId: ID.bizA,
        category: 'corrections',
        key: 'fresh_rule',
        value: 'ACTIVE_FUTURE_TTL_CORRECTION',
        confidence: 0.9,
        source: 'cerebellum',
        expiresAt: future,
        createdAt: now,
      },
      {
        id: ID.memPermanent,
        businessId: ID.bizA,
        category: 'preferences',
        key: 'tone',
        value: 'PERMANENT_NULL_EXPIRY_PREFERENCE',
        confidence: 0.8,
        source: 'user',
        expiresAt: null,
        createdAt: now,
      },
      {
        id: ID.memBizB,
        businessId: ID.bizB,
        category: 'preferences',
        key: 'secret_b',
        value: 'TENANT_B_SECRET_MEMORY',
        confidence: 1.0,
        source: 'user',
        expiresAt: null,
        createdAt: now,
      },
      {
        id: ID.memZero,
        businessId: ID.bizA,
        category: 'facts',
        key: 'zero_fact',
        value: 'ZERO_CONFIDENCE_AI_MEMORY',
        confidence: 0,
        source: 'inferred',
        expiresAt: null,
        createdAt: now,
      },
      {
        id: ID.memLow,
        businessId: ID.bizA,
        category: 'facts',
        key: 'low_fact',
        value: 'LOW_CONFIDENCE_AI_MEMORY',
        confidence: 0.2,
        source: 'inferred',
        expiresAt: null,
        createdAt: now,
      },
      {
        id: ID.memHigh,
        businessId: ID.bizA,
        category: 'facts',
        key: 'high_fact',
        value: 'HIGH_CONFIDENCE_AI_MEMORY',
        confidence: 0.9,
        source: 'inferred',
        expiresAt: null,
        createdAt: now,
      },
    ],
  });

  await db.temporalFlowMemory.createMany({
    data: [
      {
        id: ID.tfZero,
        businessId: ID.bizA,
        entityType: 'business',
        entityId: ID.bizA,
        type: 'pattern',
        sourceModule: 'crm',
        content: 'TF_ZERO_CONFIDENCE',
        confidence: 0,
        createdAt: now,
      },
      {
        id: ID.tfLow,
        businessId: ID.bizA,
        entityType: 'business',
        entityId: ID.bizA,
        type: 'pattern',
        sourceModule: 'crm',
        content: 'TF_LOW_CONFIDENCE',
        confidence: 0.2,
        createdAt: now,
      },
      {
        id: ID.tfHigh,
        businessId: ID.bizA,
        entityType: 'business',
        entityId: ID.bizA,
        type: 'pattern',
        sourceModule: 'crm',
        content: 'TF_HIGH_CONFIDENCE',
        confidence: 0.9,
        createdAt: now,
      },
    ],
  });

  const semanticStub = { search: vi.fn().mockResolvedValue([]) };
  retrieval = new UnifiedMemoryRetrievalService(prismaService, semanticStub as any);
  promptContext = new KeyCortexPromptContextService({} as any, retrieval, undefined, prismaService);
});

afterAll(async () => {
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('P92 — MEM-EXPIRED-NOT-SERVED (real Postgres)', () => {
  it('[MENS-01] RED-BEFORE: expired AiMemory row is excluded from retrieveContext and buildMemoryContext while unexpired and null-expiry rows remain', async () => {
    const fragments = await retrieval.retrieveContext(ID.bizA, { sourceTypes: ['ai_memory'], limit: 50 });
    const ids = fragments.map((f: any) => f.id);
    expect(ids).not.toContain(ID.memExpired);
    expect(ids).toContain(ID.memFuture);
    expect(ids).toContain(ID.memPermanent);

    const ctx = await promptContext.buildMemoryContext(
      ID.bizA,
      { id: `${P}sess1`, businessId: ID.bizA, userId: ID.ownerA, messages: [{ role: 'user', content: 'hello' }] },
      ID.ownerA,
    );
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain('EXPIRED_STALE_CORRECTION_NEVER_SERVE');
    expect(serialized).toContain('ACTIVE_FUTURE_TTL_CORRECTION');
    expect(serialized).toContain('PERMANENT_NULL_EXPIRY_PREFERENCE');
  });

  it('[MENS-02] RED-BEFORE: confidence-0 row scores strictly below unscored (0.5) and below every positive-confidence row, leaving positive order unchanged', async () => {
    const tfFragments = await retrieval.retrieveContext(ID.bizA, { sourceTypes: ['temporal_flow_memory'], limit: 20 });
    expect(tfFragments.map((f: any) => f.id)).toEqual([ID.tfHigh, ID.tfLow, ID.tfZero]);

    const byId = Object.fromEntries(tfFragments.map((f: any) => [f.id, f]));
    expect(byId[ID.tfZero].relevanceScore).toBeLessThan(0.5);
    expect(byId[ID.tfZero].relevanceScore).toBeLessThan(byId[ID.tfLow].relevanceScore);
    expect(byId[ID.tfLow].relevanceScore).toBeCloseTo(0.6, 6);
    expect(byId[ID.tfHigh].relevanceScore).toBeCloseTo(0.95, 6);

    const aiFragments = await retrieval.retrieveContext(ID.bizA, { sourceTypes: ['ai_memory'], limit: 20 });
    const aiById = Object.fromEntries(aiFragments.map((f: any) => [f.id, f]));
    expect(aiById[ID.memZero].relevanceScore).toBeLessThan(0.5);
    expect(aiById[ID.memZero].relevanceScore).toBeLessThan(aiById[ID.memLow].relevanceScore);
    expect(aiById[ID.memLow].relevanceScore).toBeLessThan(aiById[ID.memHigh].relevanceScore);
  });

  it('[MENS-03] Control: tenant B unexpired memories never leak into tenant A retrieval or buildMemoryContext', async () => {
    const fragments = await retrieval.retrieveContext(ID.bizA, { sourceTypes: ['ai_memory'], limit: 50 });
    expect(fragments.map((f: any) => f.id)).not.toContain(ID.memBizB);

    const ctx = await promptContext.buildMemoryContext(
      ID.bizA,
      { id: `${P}sess2`, businessId: ID.bizA, userId: ID.ownerA, messages: [{ role: 'user', content: 'hello' }] },
      ID.ownerA,
    );
    expect(JSON.stringify(ctx)).not.toContain('TENANT_B_SECRET_MEMORY');
  });
});
