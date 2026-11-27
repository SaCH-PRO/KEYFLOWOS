/**
 * P133 (MEM-CLASS-BACKFILL) R1 Security & Correctness Regression Suite:
 * Covers orphaned/cross-tenant `action` embedding fail-closed UNCLASSIFIED,
 * non-financial vs financial resolved `action` proposal classification, and
 * whitespace-only `--business-id` / `--after-id` / option rejection.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  runMemoryClassBackfill,
  type BackfillDb,
} from '../../../scripts/memory-class-backfill';

describe('P133 R1 regressions (MEM-CLASS-BACKFILL)', () => {
  it('rejects whitespace-only separate flag values (--business-id "   ", --after-id "   ")', () => {
    expect(parseArgs(['--apply', '--business-id', '   '])).toEqual({
      error: '--business-id requires a value',
    });
    expect(parseArgs(['--table', 'ai_memories', '--after-id', '   '])).toEqual({
      error: '--after-id requires a value',
    });
    expect(parseArgs(['--business-id=   '])).toEqual({
      error: '--business-id requires a value',
    });
  });

  it('rejects empty or whitespace businessId / businessIds in runMemoryClassBackfill instead of widening to all tenants', async () => {
    const db: BackfillDb = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
    };
    await expect(runMemoryClassBackfill(db, { apply: true, businessId: '   ' })).rejects.toThrow(/businessId/i);
    await expect(runMemoryClassBackfill(db, { apply: true, businessIds: ['biz_1', '  '] })).rejects.toThrow(
      /businessIds/i,
    );
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('fails closed to UNCLASSIFIED on orphaned/cross-tenant action embeddings and classifies resolved proposals accurately', async () => {
    const updates: Array<{ id: string; data_class: string; module_scope: string[] }> = [];
    let embeddingBatches = 0;

    const db: BackfillDb = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes('FROM ai_memory_embeddings')) {
          if (embeddingBatches++ > 0) return [];
          return [
            {
              id: 'emb_orphan_action',
              business_id: 'biz_a',
              source_type: 'action',
              source_id: 'prop_missing_or_other_tenant',
              content: 'Confirm Tuesday appointment',
              metadata: { module: 'bookings' },
              module_scope: null,
            },
            {
              id: 'emb_nonmoney_action',
              business_id: 'biz_a',
              source_type: 'action',
              source_id: 'prop_booking',
              content: 'Confirm Tuesday appointment',
              metadata: { module: 'bookings' },
              module_scope: null,
            },
            {
              id: 'emb_money_action',
              business_id: 'biz_a',
              source_type: 'action',
              source_id: 'prop_invoice',
              content: 'Send invoice INV-100',
              metadata: { module: 'commerce' },
              module_scope: null,
            },
          ];
        }
        if (sql.includes('FROM key_action_proposals')) {
          return [
            {
              id: 'prop_booking',
              business_id: 'biz_a',
              module: 'bookings',
              tool_name: 'bookings_confirm',
              action_type: 'confirm_booking',
              title: 'Confirm appointment',
              summary: 'Confirm booking for Tuesday',
              description: null,
            },
            {
              id: 'prop_invoice',
              business_id: 'biz_a',
              module: 'commerce',
              tool_name: 'commerce_send_invoice',
              action_type: 'EXECUTE_TOOL',
              title: 'Send invoice',
              summary: 'Send invoice for $500',
              description: null,
            },
          ];
        }
        return [];
      }),
      $executeRawUnsafe: vi.fn(async (_sql: string, payloadJson: string) => {
        const parsed = JSON.parse(payloadJson) as Array<{ id: string; data_class: string; module_scope: string[] }>;
        updates.push(...parsed);
        return parsed.length;
      }),
    };

    const report = await runMemoryClassBackfill(db, {
      apply: true,
      tables: ['ai_memory_embeddings'],
      businessId: 'biz_a',
    });

    expect(report.totals.scanned).toBe(3);
    expect(report.totals.updated).toBe(3);
    const byId = new Map(updates.map((u) => [u.id, u]));
    expect(byId.get('emb_orphan_action')?.data_class).toBe('UNCLASSIFIED');
    expect(byId.get('emb_nonmoney_action')?.data_class).toBe('GENERAL');
    expect(byId.get('emb_nonmoney_action')?.module_scope).toEqual(['bookings']);
    expect(byId.get('emb_money_action')?.data_class).toBe('REVENUE');
    expect(byId.get('emb_money_action')?.module_scope).toContain('revenue');
  });
});
