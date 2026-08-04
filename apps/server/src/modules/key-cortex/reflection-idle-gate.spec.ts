/**
 * The gate that decides whether KEY spends money.
 *
 * KeyCortexReflectionService runs every 30 minutes and makes PAID model calls
 * per business. It is supposed to only reflect on tenants nobody is using, which
 * is what makes a background job of that cost defensible.
 *
 * The gate was a no-op. findIdleBusinesses() contained:
 *
 *     const activeSessions: Array<{ businessId: string }> = [];
 *     // model absent from schema.prisma; call short-circuited to undefined
 *
 * so the "active" set was always empty, the filter kept EVERY business, and
 * `idleThreshold` was computed and never read. Reflection ran on the whole
 * estate every half hour — and because it is per-business, the bill scaled with
 * how many customers you have and landed hardest on the ones actually working.
 *
 * These tests are about spend, so they are strict in one direction: when the
 * gate is unsure, it must NOT spend.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';

/** Runs the real method against a stub instance. */
function findIdle(instance: unknown): Promise<string[]> {
  const impl = (
    KeyCortexReflectionService.prototype as unknown as Record<string, () => Promise<string[]>>
  ).findIdleBusinesses;
  return impl.call(instance);
}

function makeInstance(opts: {
  all?: string[];
  chatting?: string[];
  working?: string[];
  fail?: boolean;
}) {
  const instance = Object.assign(Object.create(KeyCortexReflectionService.prototype), {
    prisma: {
      client: {
        flowSession: {
          findMany: vi.fn(async () =>
            opts.fail
              ? Promise.reject(new Error('db down'))
              : (opts.chatting ?? []).map((businessId) => ({ businessId })),
          ),
        },
        teamActivityLog: {
          findMany: vi.fn(async () => (opts.working ?? []).map((businessId) => ({ businessId }))),
        },
      },
    },
    logger: { debug: vi.fn(), warn: vi.fn(), log: vi.fn() },
  });
  instance.findAllActiveBusinesses = vi.fn(async () => opts.all ?? []);
  return instance;
}

describe('it only reflects on businesses nobody is using', () => {
  it('excludes a business with a live conversation', async () => {
    const idle = await findIdle(
      makeInstance({ all: ['a', 'b', 'c'], chatting: ['b'] }),
    );

    expect(idle).toEqual(['a', 'c']);
  });

  it('excludes a business doing ordinary work, not just chatting', async () => {
    // "Active" means someone is using the product, not only that someone is
    // talking to KEY. A team working in the CRM should not be reflected on.
    const idle = await findIdle(
      makeInstance({ all: ['a', 'b', 'c'], working: ['c'] }),
    );

    expect(idle).toEqual(['a', 'b']);
  });

  it('excludes a business active on either signal', async () => {
    const idle = await findIdle(
      makeInstance({ all: ['a', 'b', 'c'], chatting: ['a'], working: ['c'] }),
    );

    expect(idle).toEqual(['b']);
  });

  it('spends nothing when the whole estate is busy', async () => {
    const idle = await findIdle(
      makeInstance({ all: ['a', 'b'], chatting: ['a'], working: ['b'] }),
    );

    expect(idle).toEqual([]);
  });

  it('reflects on everyone when nobody is around', async () => {
    const idle = await findIdle(makeInstance({ all: ['a', 'b'] }));
    expect(idle).toEqual(['a', 'b']);
  });
});

describe('when unsure, it does not spend', () => {
  it('returns nothing if the activity lookup fails', async () => {
    // Fails CLOSED. The failure mode of this gate is money, so skipping a cycle
    // is the safe direction — reflection is a background nicety and nothing
    // breaks if it waits thirty minutes. Failing open would bill the estate
    // every half hour during a database wobble.
    const idle = await findIdle(makeInstance({ all: ['a', 'b', 'c'], fail: true }));

    expect(idle).toEqual([]);
  });
});

describe('the gate is real, not decorative', () => {
  const src = readFileSync(join(__dirname, 'key-cortex-reflection.service.ts'), 'utf8');
  const fn = src.slice(src.indexOf('private async findIdleBusinesses('));
  const body = fn.slice(0, fn.indexOf('\n  private '));

  it('no longer hard-codes an empty activity set', () => {
    // The original defect, in one assertion.
    expect(body).not.toMatch(/const activeSessions[^=]*=\s*\[\]/);
  });

  it('actually uses the threshold it computes', () => {
    // idleThreshold was calculated and never referenced.
    const uses = (body.match(/idleThreshold/g) ?? []).length;
    expect(uses).toBeGreaterThan(1);
  });

  it('queries both activity signals', () => {
    expect(body).toMatch(/flowSession\.findMany/);
    expect(body).toMatch(/teamActivityLog\.findMany/);
  });

  it('asks once per signal, not once per business', () => {
    // A lookup inside the per-business loop would cost more than the work it
    // saves. Two distinct queries, bounded.
    expect(body).toMatch(/distinct: \['businessId'\]/);
    expect(body).toMatch(/take: \d+/);
    expect(body).not.toMatch(/for \(|\.map\(async/);
  });
});
