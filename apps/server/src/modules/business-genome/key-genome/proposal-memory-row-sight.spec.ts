/**
 * FU-PROPOSAL-REVENUE-SIGHT round 3 (security M3; owner ruling D-238): the genome memory REST routes and the governance
 * counts classify a KEY_ACTION_PROPOSAL memory event by its underlying proposal row (sourceEntityId), not by the event's
 * own metadata alone. A financial row, or one that cannot be read, withholds the event (fail closed).
 */
import { describe, it, expect, vi } from 'vitest';
import { readableMemoryEvents } from './genome-finance-scope';

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  sourceType: 'KEY_ACTION_PROPOSAL',
  eventType: 'ACTION_EXECUTED',
  sourceEntityId: `kap_${id}`,
  domain: null,
  section: null,
  title: 'KEY action executed: Call back',
  metadata: { actionType: 'CREATE_TASK', module: 'crm' },
  ...extra,
});
const OPS = { id: 'ops', sourceType: 'OPERATIONS_GENOME', eventType: 'OPERATIONS_SNAPSHOT_COMPUTED', domain: 'OPERATIONS', section: 'OPERATIONS', title: 'ops' };

function prismaWith(rows: Array<Record<string, unknown>>) {
  return {
    client: {
      keyActionProposal: { findMany: vi.fn(async () => rows) },
      genomeRecommendation: { findFirst: vi.fn(async () => null) },
    },
  } as any;
}

describe('readableMemoryEvents (D-238, round-3 security M3)', () => {
  it('RED-BEFORE: a proposal event whose own metadata reads non-financial is withheld when its proposal row is financial', async () => {
    const prisma = prismaWith([{ id: 'kap_a', actionType: 'CREATE_TASK', module: 'crm', title: 'Chase the $4,000 invoice' }]);
    expect((await readableMemoryEvents(prisma, 'biz_1', [event('a'), OPS])).map((e) => e.id)).toEqual(['ops']);
  });

  it('a proposal event whose row cannot be found is withheld; one whose row is non-financial is kept', async () => {
    const prisma = prismaWith([{ id: 'kap_b', actionType: 'CREATE_TASK', module: 'crm', title: 'Call Kerry back' }]);
    expect((await readableMemoryEvents(prisma, 'biz_1', [event('a'), event('b'), OPS])).map((e) => e.id)).toEqual(['b', 'ops']);
  });

  it('the rows are read in this business only, and a failed read withholds every proposal event', async () => {
    const prisma = prismaWith([]);
    await readableMemoryEvents(prisma, 'biz_1', [event('a')]);
    expect(prisma.client.keyActionProposal.findMany.mock.calls[0][0].where).toMatchObject({ businessId: 'biz_1', id: { in: ['kap_a'] } });
    prisma.client.keyActionProposal.findMany.mockRejectedValueOnce(new Error('down'));
    expect((await readableMemoryEvents(prisma, 'biz_1', [event('a'), OPS])).map((e) => e.id)).toEqual(['ops']);
  });

  it('a money memory event stays withheld whatever its row', async () => {
    const money = { id: 'm', sourceType: 'FINANCE_GENOME', eventType: 'FINANCE_SNAPSHOT_COMPUTED', domain: 'FINANCIAL', section: 'FINANCIAL', title: 'finance' };
    expect(await readableMemoryEvents(prismaWith([]), 'biz_1', [money])).toEqual([]);
  });
});
