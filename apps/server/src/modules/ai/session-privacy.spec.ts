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
      Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
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
