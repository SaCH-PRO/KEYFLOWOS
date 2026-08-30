/**
 * A Redis outage must not log everybody out.
 *
 * `resolveLocalUser` asks two questions before attaching a user to the request:
 * has this token been revoked (Redis), and is this account deleted or banned
 * (Postgres). Both lived inside one try/catch that returned null — "reject" —
 * for any error, described in the code as "fail closed".
 *
 * Measured by stopping the container rather than reasoned about:
 *
 *   Redis up    GET /identity/me -> 200
 *   Redis down  GET /identity/me -> 401     (the same, still-valid token)
 *   Redis down  signup issues a token, then bootstrap -> 401
 *
 * So a cache being unavailable took the entire product down and stranded every
 * new account mid-signup. That last part is the same failure the long comment
 * in auth.middleware.ts describes and fixes — reached by a different route,
 * because the fix for "no local row yet" is never consulted when the step
 * before it throws.
 *
 * THE TRADE, STATED PLAINLY. Proceeding without the revocation check means a
 * user who logged out keeps a working access token until it expires on its own,
 * roughly an hour. The alternative is that every user is signed out and no new
 * account can be created for as long as Redis is unavailable. The authoritative
 * checks — deleted, banned — live in Postgres and still run.
 *
 * Postgres is different and still fails closed: it holds the checks that decide
 * whether the account may be here at all, and the app cannot serve anything
 * meaningful without it.
 */
import { describe, it, expect, vi } from 'vitest';
import { AuthMiddleware } from './auth.middleware';

type Resolver = (userId: string) => Promise<{ role: string } | null>;

/**
 * Reaches the private resolver directly. The alternative — driving `use()` —
 * would need a Supabase token to verify first, which is a second dependency
 * with its own failure modes and would obscure which one the test is about.
 */
function resolverFor(over: { redis?: unknown; user?: unknown } = {}): Resolver {
  const redis = over.redis ?? { get: vi.fn(async () => null) };
  const prisma = {
    client: {
      user: {
        findUnique:
          typeof over.user === 'function'
            ? (over.user as () => unknown)
            : vi.fn(async () => (over.user === undefined ? { role: 'USER', deletedAt: null, bannedAt: null } : over.user)),
      },
    },
  };
  // Constructor order is (supabaseAuth, prisma, redis).
  const mw = new AuthMiddleware({} as never, prisma as never, redis as never);
  return (userId: string) =>
    (mw as unknown as { resolveLocalUser: Resolver }).resolveLocalUser(userId);
}

const REDIS_DOWN = { get: vi.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:6379'); }) };

describe('auth middleware under partial outage', () => {
  it('attaches a user when both stores are healthy', async () => {
    await expect(resolverFor()('u1')).resolves.toEqual({ role: 'USER' });
  });

  it('still attaches when REDIS is unavailable', async () => {
    // The whole point. Before this, a cache outage returned null and every
    // request in the product answered 401.
    await expect(resolverFor({ redis: REDIS_DOWN })('u1')).resolves.toEqual({ role: 'USER' });
  });

  it('still lets a brand-new account bootstrap when Redis is unavailable', async () => {
    // No local row AND no Redis — signup's exact state. This combination is
    // what stranded new users on the form with an account they could not reach.
    const resolve = resolverFor({ redis: REDIS_DOWN, user: null });
    await expect(resolve('brand-new')).resolves.toEqual({ role: 'USER' });
  });

  it('honours a revocation marker when Redis IS reachable', async () => {
    // Degrading on failure must not weaken the check when it actually answers.
    const resolve = resolverFor({ redis: { get: vi.fn(async () => '1') } });
    await expect(resolve('logged-out')).resolves.toBeNull();
  });

  it('rejects a deleted account even with Redis down', async () => {
    // Postgres carries the authoritative checks, and they still run.
    const resolve = resolverFor({ redis: REDIS_DOWN, user: { role: 'USER', deletedAt: new Date(), bannedAt: null } });
    await expect(resolve('deleted')).resolves.toBeNull();
  });

  it('rejects a banned account even with Redis down', async () => {
    const resolve = resolverFor({ redis: REDIS_DOWN, user: { role: 'USER', deletedAt: null, bannedAt: new Date() } });
    await expect(resolve('banned')).resolves.toBeNull();
  });

  it('still fails closed when POSTGRES is unavailable', async () => {
    // The deliberate asymmetry: without the database we cannot establish that
    // this account is allowed to be here at all.
    const resolve = resolverFor({
      redis: { get: vi.fn(async () => null) },
      user: () => { throw new Error('Connection terminated unexpectedly'); },
    });
    await expect(resolve('u1')).resolves.toBeNull();
  });
});
