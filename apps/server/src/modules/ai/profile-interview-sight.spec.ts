/**
 * FU-PATTERNS-ROUTES-SIGHT (security review round 7 F-1, correctness COR-R6-5): a member's cached profile interview
 * is kept only under the sight it was built with: revenue read AND expenses read. A turn under another sight starts a
 * fresh interview, so KEY's earlier replies (which may restate an expense row the earlier prompt carried) are not
 * replayed once expenses read is gone. Pure: the stores and the model are stand-ins.
 */
import { describe, it, expect } from 'vitest';
import { ProfileIntelligenceService } from './profile-intelligence.service';

function service() {
  const memory = { getAll: async () => [], upsert: async () => undefined };
  const graph = { getSnapshot: async () => ({ business: { name: 'B', currency: 'TTD' }, contacts: { total: 0 }, storefront: { activeProductCount: 0 } }) };
  const usage = { trackAndComplete: async () => ({ content: 'Your rent of TTD 4,000 is noted.', toolCalls: [], usage: {} }) };
  return new ProfileIntelligenceService({} as any, memory as any, graph as any, {} as any, usage as any);
}

describe('the profile interview cache follows the caller\'s whole sight (FU-PATTERNS-ROUTES-SIGHT round 7)', () => {
  it('a turn after expenses read is withdrawn starts a fresh interview: the earlier reply is not in its state', async () => {
    const profile = service();
    const first = await profile.chat('biz', 'u1', 'hello', { documentExtractions: true, expensesSight: true } as any);
    expect(first.state.messages.map((m: any) => m.content)).toContain('Your rent of TTD 4,000 is noted.');
    const second = await profile.chat('biz', 'u1', 'again', { documentExtractions: true, expensesSight: false } as any);
    expect(second.state.messages.map((m: any) => m.content)).toEqual(['again', 'Your rent of TTD 4,000 is noted.']);
    const status = await profile.getCompletionSummary('biz', 'u1', { documentExtractions: true, expensesSight: true } as any);
    expect(status.completedTopics).toEqual([]);
  });

  it('the same sight keeps the interview (control)', async () => {
    const profile = service();
    await profile.chat('biz', 'u1', 'hello', { documentExtractions: true, expensesSight: true } as any);
    const second = await profile.chat('biz', 'u1', 'again', { documentExtractions: true, expensesSight: true } as any);
    expect(second.state.messages).toHaveLength(4);
  });
});
