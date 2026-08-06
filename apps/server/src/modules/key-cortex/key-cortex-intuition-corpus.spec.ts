/**
 * The linguistic detector's text corpus.
 *
 * collectTextCorpus had `const chats = []` and `const emails = []`, each with a
 * comment reading "model absent from schema.prisma". That comment was stale —
 * KeyInboxMessage, ConversationMessage and ContactNote all exist with usable
 * shapes and indexes. So the linguistic pipeline was running on support tickets
 * and event action names only.
 *
 * Two things are pinned here: that the real sources are read and correctly
 * tenant-scoped, and that every source is BOUNDED. scheduledIntuitionScan runs
 * every ten minutes for every active business, so an unbounded read is a
 * full-table scan per tenant per source, six times an hour. Two of the
 * pre-existing queries in this method had no `take` at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexIntuitionService } from './key-cortex-intuition.service';

type Query = { where: Record<string, unknown>; take?: number; orderBy?: unknown };

class PrismaStub {
  calls: Record<string, Query[]> = {};

  private table(name: string) {
    return {
      findMany: vi.fn((q: Query) => {
        (this.calls[name] ??= []).push(q);
        return Promise.resolve(this.rows[name] ?? []);
      }),
      count: vi.fn(() => Promise.resolve(0)),
      aggregate: vi.fn(() => Promise.resolve({})),
    };
  }

  rows: Record<string, unknown[]> = {};

  client = {
    supportTicket: this.table('supportTicket'),
    keyInboxMessage: this.table('keyInboxMessage'),
    conversationMessage: this.table('conversationMessage'),
    contactNote: this.table('contactNote'),
    businessEvent: this.table('businessEvent'),
  };
}

function makeService(prisma: PrismaStub) {
  const noop = new Proxy({}, { get: () => vi.fn() });
  return new KeyCortexIntuitionService(
    prisma as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
  );
}

type Internals = {
  collectTextCorpus(
    businessId: string,
    since: Date,
  ): Promise<Array<{ source: string; text: string; timestamp: Date }>>;
};

const SINCE = new Date('2026-08-01T00:00:00Z');

describe('collectTextCorpus sources', () => {
  let prisma: PrismaStub;
  let svc: KeyCortexIntuitionService & Internals;

  beforeEach(() => {
    prisma = new PrismaStub();
    svc = makeService(prisma) as KeyCortexIntuitionService & Internals;
  });

  it('reads the sources that used to be stubbed out', async () => {
    await svc.collectTextCorpus('biz_1', SINCE);

    expect(prisma.calls.keyInboxMessage, 'inbox never queried').toBeDefined();
    expect(prisma.calls.contactNote, 'notes never queried').toBeDefined();
  });

  it('does NOT read a second message store', async () => {
    // There was one: conversation_messages, queried here as a separate corpus
    // source. Both omnichannel inboxes were merged into key_inbox_* on
    // 2026-08-06, so that traffic now arrives through the inbox query above.
    // Reading it twice would double-count every phrase and inflate every
    // keyword frequency this detector computes — the corpus is the input to
    // "this word is appearing 3x more than baseline".
    await svc.collectTextCorpus('biz_1', SINCE);

    expect(prisma.calls.conversationMessage, 'the retired store is queried again').toBeUndefined();
  });

  it('scopes inbox and notes by businessId directly', async () => {
    await svc.collectTextCorpus('biz_1', SINCE);

    expect(prisma.calls.keyInboxMessage[0].where.businessId).toBe('biz_1');
    expect(prisma.calls.contactNote[0].where.businessId).toBe('biz_1');
  });

  it('scopes the inbox by businessId directly, now that it is the only store', async () => {
    // This used to assert the conversation query was scoped THROUGH its thread,
    // because ConversationMessage carried no tenant column of its own.
    // KeyInboxMessage does, which is one of the reasons it won the merge: the
    // tenant boundary is on the row rather than one join away.
    await svc.collectTextCorpus('biz_1', SINCE);

    expect(prisma.calls.keyInboxMessage[0].where.businessId).toBe('biz_1');
  });

  it('applies the time window to every source', async () => {
    await svc.collectTextCorpus('biz_1', SINCE);

    for (const table of Object.keys(prisma.calls)) {
      const where = prisma.calls[table][0].where as { createdAt?: { gte?: Date } };
      expect(where.createdAt?.gte, `${table} not time-bounded`).toEqual(SINCE);
    }
  });

  it('BOUNDS every source, including the two that were previously unbounded', async () => {
    // supportTicket and businessEvent had no `take` before this change.
    await svc.collectTextCorpus('biz_1', SINCE);

    for (const table of Object.keys(prisma.calls)) {
      const take = prisma.calls[table][0].take;
      expect(take, `${table} is unbounded`).toBeGreaterThan(0);
      expect(take, `${table} bound is too loose`).toBeLessThanOrEqual(1000);
    }
  });

  it('takes the NEWEST rows, not an arbitrary page', async () => {
    // With a cap, ordering decides whether you get recent language or whatever
    // the planner happened to return first.
    await svc.collectTextCorpus('biz_1', SINCE);

    for (const table of Object.keys(prisma.calls)) {
      expect(prisma.calls[table][0].orderBy, `${table} unordered`).toEqual({
        createdAt: 'desc',
      });
    }
  });

  it('maps rows into the corpus with their source label', async () => {
    prisma.rows.keyInboxMessage = [
      { contentText: 'the invoice never arrived', createdAt: new Date('2026-08-02') },
    ];
    prisma.rows.contactNote = [{ body: 'client sounded frustrated', createdAt: new Date('2026-08-02') }];

    const corpus = await svc.collectTextCorpus('biz_1', SINCE);

    expect(corpus.find((c) => c.source === 'inbox')?.text).toBe('the invoice never arrived');
    expect(corpus.find((c) => c.source === 'note')?.text).toBe('client sounded frustrated');
    expect(corpus.find((c) => c.source === 'conversation'), 'the retired source still emits').toBeUndefined();
  });

  it('skips inbox rows with no text rather than pushing empty strings', async () => {
    prisma.rows.keyInboxMessage = [
      { contentText: null, createdAt: new Date('2026-08-02') },
      { contentText: 'real text', createdAt: new Date('2026-08-02') },
    ];

    const corpus = await svc.collectTextCorpus('biz_1', SINCE);
    const inbox = corpus.filter((c) => c.source === 'inbox');

    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toBe('real text');
  });

  it('one failing source does not lose the whole corpus', async () => {
    // Each source has its own .catch(() => []).
    prisma.client.keyInboxMessage.findMany.mockRejectedValue(new Error('table locked'));
    prisma.rows.contactNote = [{ body: 'still collected', createdAt: new Date('2026-08-02') }];

    const corpus = await svc.collectTextCorpus('biz_1', SINCE);

    expect(corpus.some((c) => c.text === 'still collected')).toBe(true);
  });

  it('has no empty-array stub left in the corpus builder', async () => {
    // Asserts the stub SHAPE, not the phrase. An earlier version of this test
    // grepped for "model absent from schema" and failed on the comment
    // explaining that the old claim was stale — flagging its own documentation.
    //
    // The real defect was `const chats: Array<Record<string, unknown>> = [];`
    // standing in for a query. Matching every `Array<...> = []` is too broad —
    // it also catches the legitimate `corpus` accumulator on the method's first
    // line, which is what a first attempt at this assertion did.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex-intuition.service.ts'), 'utf8');

    const fn = src.slice(src.indexOf('private async collectTextCorpus'));
    const body = fn.slice(0, fn.indexOf('\n  private '));

    expect(body).not.toMatch(/Array<Record<string, unknown>> = \[\]/);
  });
});
