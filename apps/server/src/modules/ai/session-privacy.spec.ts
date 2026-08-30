/**
 * A conversation belongs to the person who had it.
 *
 * Chat sessions were scoped to the BUSINESS and nothing else. `FlowSession` had
 * no `userId` column at all, and `listSessions(businessId)` returned every
 * session in the business — so any team member could open the owner's
 * conversations with KEY. An owner asking whether to let someone go, or about
 * their own cash position, was readable by the person they were discussing.
 *
 * Tenancy in this repo is `businessId`, and that is correct for business DATA:
 * an invoice belongs to the company. A conversation does not. It is the closest
 * thing KEY has to a private thought, and the default has to be private —
 * you can always choose to share, and you can never un-leak.
 *
 * The failure modes pinned here are the ones a scoping change actually has:
 *
 *   LEAK       one user reading another's sessions
 *   WIDENING   a missing userId silently meaning "all sessions"
 *   THEFT      whoever writes last taking ownership of someone else's session
 *   BREAKAGE   sessions created ownerless and therefore invisible to everyone
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { id: string; businessId: string; userId: string | null; messages: unknown[] };

/** A stub that HONOURS its where-clause — one that does not cannot test scoping. */
class PrismaStub {
  rows: Row[] = [];

  private match(where: Record<string, unknown>) {
    return this.rows.filter((r) =>
      Object.entries(where).every(([k, v]) => {
        const actual = (r as Record<string, unknown>)[k];
        // `{ id: { in: [...] } }` — the scoped key and the pre-fix one. A stub
        // that ignored this would silently match everything and turn the
        // scoping tests below green on any implementation at all.
        if (v && typeof v === 'object' && Array.isArray((v as { in?: unknown[] }).in)) {
          return ((v as { in: unknown[] }).in).includes(actual);
        }
        return actual === v;
      }),
    );
  }

  client = {
    flowSession: {
      findFirst: vi.fn((q: { where: Record<string, unknown> }) =>
        Promise.resolve(this.match(q.where)[0] ?? null),
      ),
      findMany: vi.fn((q: { where: Record<string, unknown> }) =>
        Promise.resolve(this.match(q.where)),
      ),
      upsert: vi.fn((q: { where: { id: string }; create: Row; update: Partial<Row> }) => {
        const existing = this.rows.find((r) => r.id === q.where.id);
        if (existing) Object.assign(existing, q.update);
        else this.rows.push(q.create as Row);
        return Promise.resolve({});
      }),
      updateMany: vi.fn((q: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = this.match(q.where);
        hit.forEach((r) => Object.assign(r, q.data));
        return Promise.resolve({ count: hit.length });
      }),
      deleteMany: vi.fn((q: { where: Record<string, unknown> }) => {
        const hit = this.match(q.where);
        this.rows = this.rows.filter((r) => !hit.includes(r));
        return Promise.resolve({ count: hit.length });
      }),
    },
  };
}

/** Exercises the real methods without constructing ~30 injected services. */
function makeService(prisma: PrismaStub) {
  const proto = FlowOrchestratorService.prototype as unknown as Record<string, unknown>;
  const instance = { prisma } as Record<string, unknown>;
  for (const name of [
    'sessionScope',
    'storageId',
    'clientSessionId',
    'resolveSessionRowId',
    'getConversationHistory',
    'saveConversationHistory',
    'listSessions',
    'clearSession',
    'deleteSession',
  ]) {
    instance[name] = (proto[name] as (...a: unknown[]) => unknown).bind(instance);
  }
  return instance as unknown as {
    getConversationHistory(b: string, s: string, u?: string): Promise<unknown[]>;
    saveConversationHistory(b: string, s: string, m: unknown[], u?: string): Promise<void>;
    listSessions(b: string, u?: string): Promise<Row[]>;
    clearSession(b: string, s: string, u?: string): Promise<void>;
    deleteSession(b: string, s: string, u?: string): Promise<void>;
  };
}

const BIZ = 'biz_1';

describe('one user cannot read another’s conversations', () => {
  let prisma: PrismaStub;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    prisma = new PrismaStub();
    svc = makeService(prisma);
    prisma.rows = [
      { id: 's_owner', businessId: BIZ, userId: 'owner', messages: ['should we let Ana go'] },
      { id: 's_ana', businessId: BIZ, userId: 'ana', messages: ['what is my schedule'] },
    ];
  });

  it('lists only your own sessions', async () => {
    const mine = await svc.listSessions(BIZ, 'ana');
    expect(mine.map((s) => s.id)).toEqual(['s_ana']);
  });

  it('cannot read another user’s history by guessing the session id', async () => {
    // Same business, real session id, wrong user.
    const stolen = await svc.getConversationHistory(BIZ, 's_owner', 'ana');
    expect(stolen).toEqual([]);
  });

  it('cannot clear another user’s session', async () => {
    await svc.clearSession(BIZ, 's_owner', 'ana');
    expect(prisma.rows.find((r) => r.id === 's_owner')!.messages).toHaveLength(1);
  });

  it('cannot delete another user’s session', async () => {
    await svc.deleteSession(BIZ, 's_owner', 'ana');
    expect(prisma.rows.some((r) => r.id === 's_owner')).toBe(true);
  });

  it('can still do all of that to its own', async () => {
    expect(await svc.getConversationHistory(BIZ, 's_ana', 'ana')).toHaveLength(1);
    await svc.clearSession(BIZ, 's_ana', 'ana');
    expect(prisma.rows.find((r) => r.id === 's_ana')!.messages).toHaveLength(0);
    await svc.deleteSession(BIZ, 's_ana', 'ana');
    expect(prisma.rows.some((r) => r.id === 's_ana')).toBe(false);
  });
});

describe('a missing user never widens the query', () => {
  it('an absent userId lists nothing, rather than everything', async () => {
    // THE dangerous failure. If `userId: undefined` reached Prisma the clause
    // would be dropped and every session in the business returned — the exact
    // leak this change exists to close, reintroduced by an optional parameter.
    const prisma = new PrismaStub();
    prisma.rows = [
      { id: 's1', businessId: BIZ, userId: 'owner', messages: [] },
      { id: 's2', businessId: BIZ, userId: 'ana', messages: [] },
    ];

    const sessions = await makeService(prisma).listSessions(BIZ);
    expect(sessions, 'an anonymous caller saw other people’s sessions').toEqual([]);
  });

  it('the scope helper always produces an explicit null, never undefined', () => {
    const scope = (
      FlowOrchestratorService.prototype as unknown as Record<
        string,
        (b: string, u?: string) => { businessId: string; userId: string | null }
      >
    ).sessionScope;

    expect(scope.call({}, BIZ, undefined).userId).toBeNull();
    expect(scope.call({}, BIZ, 'ana').userId).toBe('ana');
  });
});

describe('ownership cannot be stolen or lost', () => {
  it('saving does not reassign an existing session’s owner', async () => {
    // Without this, whoever writes last owns the conversation.
    const prisma = new PrismaStub();
    prisma.rows = [{ id: 's1', businessId: BIZ, userId: 'owner', messages: [] }];
    const svc = makeService(prisma);

    await svc.saveConversationHistory(BIZ, 's1', ['hello'], 'ana');

    expect(prisma.rows[0].userId, 'ownership was transferred by a write').toBe('owner');
  });

  it('a new session records its owner, so it is not invisible', async () => {
    // The breakage failure: if chat created sessions without a userId, every
    // new conversation would vanish from the user's own list.
    const prisma = new PrismaStub();
    const svc = makeService(prisma);

    await svc.saveConversationHistory(BIZ, 's_new', ['hi'], 'ana');

    expect(prisma.rows[0].userId).toBe('ana');
    expect(await svc.listSessions(BIZ, 'ana')).toHaveLength(1);
  });
});

describe('the identity actually reaches the query', () => {
  // Scoping the service and not passing the caller would be decorative — the
  // compute-and-discard shape this repo produces repeatedly.
  const controller = readFileSync(join(__dirname, 'flow.controller.ts'), 'utf8');

  it('every session route passes the caller through', () => {
    for (const call of [
      'listSessions(businessId, user?.id)',
      'clearSession(businessId, sessionId, user?.id)',
      'deleteSession(businessId, sessionId, user?.id)',
    ]) {
      expect(controller, `route does not scope: ${call}`).toContain(call);
    }
  });

  it('both chat entry points record the owner on the session they create', () => {
    expect(controller).toMatch(/streamChat\([^)]*user\?\.id\)/);
    expect(controller).toMatch(/user\?\.id,\s*\);/);
  });
});

/**
 * ONE ROW, SHARED BY EVERYONE.
 *
 * `saveConversationHistory` upserted on `{ id: sessionId }` — the primary key
 * alone, with no businessId and no userId. The client picks that id, and every
 * client that pins a conversation sends a fixed string; both places in the web
 * app send the same literal `"onboarding"`.
 *
 * So `flow_sessions.id = 'onboarding'` was one row shared by every user in
 * every business. Reproduced against the running stack before this was written:
 * a brand-new user in a brand-new business sent one onboarding message and it
 * landed in the row owned by an unrelated business and an unrelated user.
 *
 * The reads were already scoped correctly, which is what made it quiet — the
 * victim keeps reading their own (now overwritten) row, and everyone else's
 * onboarding chat simply never persists and comes back empty on reload.
 */
describe('a client-chosen session id cannot address another tenant row', () => {
  let prisma: PrismaStub;

  const ONBOARDING = 'onboarding';
  const A = { biz: 'biz_a', user: 'user_a' };
  const B = { biz: 'biz_b', user: 'user_b' };

  beforeEach(() => {
    prisma = new PrismaStub();
  });

  it('two businesses using the same session name do not share a row', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: my bakery is Rise and Crumb'], A.user);
    await svc.saveConversationHistory(B.biz, ONBOARDING, ['B: my garage is Ace Motors'], B.user);

    expect(prisma.rows).toHaveLength(2);
    expect(await svc.getConversationHistory(A.biz, ONBOARDING, A.user)).toEqual([
      'A: my bakery is Rise and Crumb',
    ]);
    expect(await svc.getConversationHistory(B.biz, ONBOARDING, B.user)).toEqual([
      'B: my garage is Ace Motors',
    ]);
  });

  it('two users in the SAME business do not share a row either', async () => {
    // A conversation is private to the person, not the company — the property
    // the rest of this file exists to protect.
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['owner: cash is tight'], 'owner');
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['ana: what is my schedule'], 'ana');

    expect(prisma.rows).toHaveLength(2);
    expect(await svc.getConversationHistory(A.biz, ONBOARDING, 'ana')).toEqual([
      'ana: what is my schedule',
    ]);
  });

  it('writing does not overwrite a row belonging to someone else', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: private'], A.user);
    const before = JSON.stringify(prisma.rows.find((r) => r.businessId === A.biz));

    await svc.saveConversationHistory(B.biz, ONBOARDING, ['B: unrelated'], B.user);

    expect(JSON.stringify(prisma.rows.find((r) => r.businessId === A.biz))).toEqual(before);
  });

  it('a second user cannot read the first onboarding by using the same name', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: private'], A.user);
    expect(await svc.getConversationHistory(B.biz, ONBOARDING, B.user)).toEqual([]);
  });

  it('the conversation survives, which is the whole point for onboarding', async () => {
    // The user-visible failure was not the leak but the amnesia: reload the
    // onboarding page and the chat was empty, so the user re-told everything.
    const svc = makeService(prisma);
    await svc.saveConversationHistory(B.biz, ONBOARDING, ['B: turn one'], B.user);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: turn one'], A.user);

    expect(await svc.getConversationHistory(A.biz, ONBOARDING, A.user)).toEqual(['A: turn one']);
  });

  it('listSessions hands back the name the client sent, not the storage key', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: turn one'], A.user);

    const listed = await svc.listSessions(A.biz, A.user);
    expect(listed.map((r) => r.id)).toEqual([ONBOARDING]);
  });

  it('clear and delete still reach the caller own scoped row', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: turn one'], A.user);

    await svc.clearSession(A.biz, ONBOARDING, A.user);
    expect(await svc.getConversationHistory(A.biz, ONBOARDING, A.user)).toEqual([]);

    await svc.deleteSession(A.biz, ONBOARDING, A.user);
    expect(prisma.rows).toHaveLength(0);
  });

  it('and still cannot reach anybody else', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(A.biz, ONBOARDING, ['A: private'], A.user);

    await svc.clearSession(B.biz, ONBOARDING, B.user);
    await svc.deleteSession(B.biz, ONBOARDING, B.user);

    expect(await svc.getConversationHistory(A.biz, ONBOARDING, A.user)).toEqual(['A: private']);
  });
});

/**
 * Rows written before the scoped key must keep working, or the fix trades a
 * leak for silently orphaning every conversation anyone already had.
 */
describe('sessions created before the scoped key', () => {
  const BIZ_L = 'biz_legacy';
  const USER_L = 'user_legacy';
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = new PrismaStub();
    prisma.rows = [
      { id: 'onboarding', businessId: BIZ_L, userId: USER_L, messages: ['said before the fix'] },
    ];
  });

  it('are still readable by their owner', async () => {
    const svc = makeService(prisma);
    expect(await svc.getConversationHistory(BIZ_L, 'onboarding', USER_L)).toEqual([
      'said before the fix',
    ]);
  });

  it('are appended to rather than forked into a second row', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory(BIZ_L, 'onboarding', ['said before the fix', 'and after'], USER_L);

    expect(prisma.rows).toHaveLength(1);
    expect(await svc.getConversationHistory(BIZ_L, 'onboarding', USER_L)).toHaveLength(2);
  });

  it('are NOT readable by anyone else, bare id or not', async () => {
    const svc = makeService(prisma);
    expect(await svc.getConversationHistory('biz_other', 'onboarding', 'user_other')).toEqual([]);
    expect(await svc.getConversationHistory(BIZ_L, 'onboarding', 'someone_else')).toEqual([]);
  });

  it('are not overwritten by another tenant using the same name', async () => {
    const svc = makeService(prisma);
    await svc.saveConversationHistory('biz_other', 'onboarding', ['mine'], 'user_other');

    expect(prisma.rows).toHaveLength(2);
    expect(await svc.getConversationHistory(BIZ_L, 'onboarding', USER_L)).toEqual([
      'said before the fix',
    ]);
  });
});
