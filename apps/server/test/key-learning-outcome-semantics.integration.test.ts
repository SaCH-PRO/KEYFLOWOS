/**
 * RR-LEARNING-OUTCOME-SEMANTICS (V1-72, D-261 / D-262 / D-257 / D-254).
 * REAL database (two tenants, prefix `v72k_`).
 *
 * Proves:
 *  1. KeyCortexLearningService.recordOutcome writes `userResponse: 'no_action'`
 *     with execution status in `metadata` (`category: 'execution_patterns'`,
 *     `success`, `error`), so tool execution outcomes never impersonate user
 *     acceptance/rejection.
 *  2. `getAcceptanceRate` excludes rows with `metadata.category === 'execution_patterns'`
 *     (including pre-existing legacy rows whose `userResponse` was written as
 *     `'accepted'` or `'rejected'`), while STILL counting real user feedback rows
 *     whose `metadata` is SQL `NULL` (`Prisma.DbNull`) or a non-execution object.
 *  3. Negative control: real user `'rejected'` feedback rows still lower
 *     `calibrateConfidence`.
 *  4. Tenant isolation: tenant B's feedback rows never affect tenant A's
 *     `getAcceptanceRate` or `calibrateConfidence`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v72k_';
const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

let db: any;
let PrismaNs: any;
let learning: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM cognition_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  PrismaNs = dbMod.Prisma;

  const { KeyCortexLearningService } = await import(
    '../src/modules/key-cortex/key-cortex-learning.service'
  );
  learning = new KeyCortexLearningService({ client: db } as never, undefined);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'V72k Owner A', role: 'USER' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'V72k Owner B', role: 'USER' },
    ],
  });
  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V72k Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA },
      { id: ID.bizB, name: 'V72k Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB },
    ],
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    `DELETE FROM cognition_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  );
});

afterAll(async () => {
  await cleanup();
});

describe('RR-LEARNING-OUTCOME-SEMANTICS (real Postgres, two tenants)', () => {
  it('recordOutcome writes no_action with execution metadata; legacy execution_patterns rows are excluded while NULL-metadata user feedback still counts', async () => {
    // 1. New tool outcomes (both success and failure) write userResponse: 'no_action'
    await learning.recordOutcome({
      businessId: ID.bizA,
      sessionId: `${P}sess_ok`,
      toolName: 'crm_create_contact',
      success: true,
      durationMs: 85,
    });
    await learning.recordOutcome({
      businessId: ID.bizA,
      sessionId: `${P}sess_err`,
      toolName: 'commerce_send_invoice',
      success: false,
      error: 'provider 503',
      durationMs: 40,
    });

    const written = await db.cognitionMemory.findMany({
      where: { businessId: ID.bizA },
      orderBy: { createdAt: 'asc' },
    });
    expect(written).toHaveLength(2);
    for (const row of written) {
      expect(row.userResponse).toBe('no_action');
      expect((row.metadata as Record<string, unknown>)?.category).toBe('execution_patterns');
    }
    expect((written[0].metadata as Record<string, unknown>)?.success).toBe(true);
    expect((written[1].metadata as Record<string, unknown>)?.success).toBe(false);
    expect((written[1].metadata as Record<string, unknown>)?.error).toBe('provider 503');

    // 2. Seed pre-existing legacy tool rows written BEFORE this fix (accepted/rejected + execution_patterns)
    await db.cognitionMemory.createMany({
      data: [
        {
          businessId: ID.bizA,
          query: 'Tool execution: legacy_ok',
          recommendation: 'Executed successfully',
          userResponse: 'accepted',
          confidence: 0.85,
          metadata: { category: 'execution_patterns', toolName: 'legacy_ok', success: true },
        },
        {
          businessId: ID.bizA,
          query: 'Tool execution: legacy_fail',
          recommendation: 'Failed: timeout',
          userResponse: 'rejected',
          confidence: 0.4,
          metadata: { category: 'execution_patterns', toolName: 'legacy_fail', success: false },
        },
      ],
    });

    // Neither new nor legacy execution_patterns rows may enter getAcceptanceRate
    const beforeFeedback = await learning.getAcceptanceRate(ID.bizA);
    expect(beforeFeedback).toEqual({ accepted: 0, rejected: 0, modified: 0, total: 0, rate: 0 });

    // 3. Real user feedback rows — across EVERY JSONB metadata edge shape — MUST count
    await db.cognitionMemory.createMany({
      data: [
        {
          businessId: ID.bizA,
          query: 'Should I raise prices?',
          recommendation: 'Test a 10% increase on new quotes.',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: PrismaNs.DbNull,
        },
        {
          businessId: ID.bizA,
          query: 'JSON null metadata',
          recommendation: 'Rec',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: PrismaNs.JsonNull,
        },
        {
          businessId: ID.bizA,
          query: 'Empty object metadata',
          recommendation: 'Rec',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: {},
        },
        {
          businessId: ID.bizA,
          query: 'Explicit null category',
          recommendation: 'Rec',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: { category: null },
        },
        {
          businessId: ID.bizA,
          query: 'Non-string category',
          recommendation: 'Rec',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: { category: 123 },
        },
        {
          businessId: ID.bizA,
          query: 'JSON array metadata',
          recommendation: 'Rec',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: [],
        },
        {
          businessId: ID.bizA,
          query: 'Draft welcome note',
          recommendation: 'Welcome aboard!',
          userResponse: 'accepted',
          confidence: 0.8,
          metadata: { category: 'user_feedback' },
        },
      ],
    });

    // 4. Tenant B rows must NEVER leak into Tenant A's rate
    await db.cognitionMemory.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        businessId: ID.bizB,
        query: `Tenant B query ${i}`,
        recommendation: 'Rec',
        userResponse: 'rejected',
        confidence: 0.9,
        metadata: { category: 'user_feedback' },
      })),
    });

    const afterFeedback = await learning.getAcceptanceRate(ID.bizA);
    expect(afterFeedback).toEqual({ accepted: 7, rejected: 0, modified: 0, total: 7, rate: 1 });
  });

  it('negative control: real user rejected feedback rows still lower calibrateConfidence, and tenant isolation holds', async () => {
    // 5 failed tool outcomes on Tenant A must NOT lower calibration
    for (let i = 0; i < 5; i++) {
      await learning.recordOutcome({
        businessId: ID.bizA,
        sessionId: `${P}tool_fail_${i}`,
        toolName: 'commerce_send_invoice',
        success: false,
        error: '503',
        durationMs: 12,
      });
    }
    const calToolsOnly = await learning.calibrateConfidence(0.9, ID.bizA);
    expect(calToolsOnly.reliable).toBe(false);
    expect(calToolsOnly.calibrated).toBe(0.9);

    // 5 real user 'rejected' feedback rows on Tenant A DO lower calibration
    await db.cognitionMemory.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        businessId: ID.bizA,
        query: `User question ${i}`,
        recommendation: 'Unhelpful suggestion',
        userResponse: 'rejected',
        confidence: 0.9,
        metadata: i === 0 ? PrismaNs.DbNull : { source: 'chat' },
      })),
    });

    const calRealRejects = await learning.calibrateConfidence(0.9, ID.bizA);
    expect(calRealRejects.reliable).toBe(true);
    expect(calRealRejects.calibrated).toBeLessThan(0.9);

    // Tenant B still has 0 samples (Tenant A's rejections never leak to Tenant B)
    const calBizB = await learning.calibrateConfidence(0.9, ID.bizB);
    expect(calBizB.reliable).toBe(false);
    expect(calBizB.calibrated).toBe(0.9);
  });
});
