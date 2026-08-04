/**
 * Incentive signals — the per-person axis KEY did not have.
 *
 * All four existing hormones are addressed to KEY itself and keyed per BUSINESS.
 * For a system meant to plug into "any role, tier and level of staff", it had a
 * rich endocrine model of itself and no concept of the people doing the work.
 *
 * The risk in building this is not that it fails to compute — counting rows is
 * easy — it is that it computes something true and says something unfair. So
 * most of this file is about restraint: refusing to compare on thin evidence,
 * refusing to call a lone worker a hero, and refusing to turn an activity count
 * into a claim about a person's worth or their pay.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexIncentiveService } from './key-cortex-incentive.service';

const BIZ = 'biz_1';
const T0 = new Date('2026-08-03T12:00:00Z');

function ago(days: number): Date {
  return new Date(T0.getTime() - days * 24 * 60 * 60 * 1000);
}

/** n rows for a user, spread across the last `withinDays`. */
function rows(userId: string, n: number, withinDays = 2, module = 'crm') {
  return Array.from({ length: n }, (_, i) => ({
    userId,
    module,
    createdAt: ago((i % Math.max(withinDays, 1)) * 0.5),
  }));
}

function makeService(activity: any[] = []) {
  const seen: Record<string, any> = {};
  const prisma = {
    client: {
      teamActivityLog: {
        findMany: vi.fn(async ({ where, take }: any) => {
          seen.where = where;
          seen.take = take;
          return activity;
        }),
      },
    },
  } as never;
  return { seen, service: new KeyCortexIncentiveService(prisma) };
}

describe('it measures contribution from real recorded activity', () => {
  it('counts actions per person', async () => {
    const { service } = makeService([...rows('alice', 30), ...rows('bob', 10)]);
    const c = await service.measure(BIZ, T0);

    expect(c.contributors[0].userId).toBe('alice');
    expect(c.contributors[0].actions).toBe(30);
    expect(c.totalActions).toBe(40);
  });

  it('tracks breadth as a counterweight to raw volume', async () => {
    const { service } = makeService([
      ...rows('alice', 20, 2, 'crm'),
      ...rows('bob', 5, 2, 'crm'),
      ...rows('bob', 5, 2, 'invoicing'),
      ...rows('bob', 5, 2, 'bookings'),
    ]);
    const c = await service.measure(BIZ, T0);

    const bob = c.contributors.find((x) => x.userId === 'bob')!;
    expect(bob.modules).toBe(3);
    expect(c.contributors.find((x) => x.userId === 'alice')!.modules).toBe(1);
  });

  it('ignores rows with no user', async () => {
    const { service } = makeService([...rows('alice', 5), { userId: '', createdAt: T0 }]);
    const c = await service.measure(BIZ, T0);

    expect(c.totalActions).toBe(5);
  });

  it('survives the activity table being unreadable', async () => {
    const prisma = {
      client: { teamActivityLog: { findMany: () => Promise.reject(new Error('db down')) } },
    } as never;
    const service = new KeyCortexIncentiveService(prisma);

    await expect(service.measure(BIZ, T0)).resolves.toMatchObject({ totalActions: 0 });
  });
});

describe('it refuses to compare on thin evidence', () => {
  it('says nothing when the team is one person', async () => {
    // "alice did 100% of everything" is not an insight when alice is the only
    // person recorded.
    const { service } = makeService(rows('alice', 60));
    const c = await service.measure(BIZ, T0);

    expect(c.carrying).toBeNull();
    expect(service.render(c)).toBeNull();
  });

  it('says nothing on too few actions', async () => {
    const { service } = makeService([...rows('alice', 6), ...rows('bob', 1)]);
    const c = await service.measure(BIZ, T0);

    expect(c.carrying).toBeNull();
  });

  it('flags a genuine imbalance once there is enough to see', async () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const c = await service.measure(BIZ, T0);

    expect(c.carrying?.userId).toBe('alice');
  });

  it('does not flag an even split', async () => {
    const { service } = makeService([...rows('alice', 30), ...rows('bob', 30)]);
    const c = await service.measure(BIZ, T0);

    expect(c.carrying).toBeNull();
  });
});

describe('going quiet is a change in behaviour, not a low total', () => {
  it('notices someone who stopped', async () => {
    const { service } = makeService([
      ...rows('alice', 40),
      // bob worked at the start of the window and nothing since
      ...Array.from({ length: 8 }, () => ({ userId: 'bob', module: 'crm', createdAt: ago(12) })),
    ]);
    const c = await service.measure(BIZ, T0);

    expect(c.wentQuiet.map((q) => q.userId)).toContain('bob');
  });

  it('does not flag someone merely because they do less', async () => {
    const { service } = makeService([...rows('alice', 50), ...rows('bob', 8, 1)]);
    const c = await service.measure(BIZ, T0);

    expect(c.wentQuiet.map((q) => q.userId)).not.toContain('bob');
  });

  it('does not flag a single stray action from long ago', async () => {
    const { service } = makeService([
      ...rows('alice', 40),
      { userId: 'carol', module: 'crm', createdAt: ago(13) },
    ]);
    const c = await service.measure(BIZ, T0);

    expect(c.wentQuiet.map((q) => q.userId)).not.toContain('carol');
  });
});

describe('what it tells KEY about people', () => {
  it('names nobody', async () => {
    // standingContext takes only a businessId, so this text lands in the system
    // prompt of EVERY member of the business with no role check. Naming people
    // would put colleagues' relative output in a junior's assistant context on
    // every message, which no screen in the product would show them.
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).not.toMatch(/alice|bob/);
  });

  it('still gives the distribution, which is the useful part', async () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).toMatch(/86%/);
    expect(text).toMatch(/60 of 70 actions/);
  });

  it('admits it only sees the routes that log', async () => {
    // TeamActivityLog is written by an interceptor on routes carrying
    // @AuditAction - a subset of the product. Calling it "all team activity"
    // made the rendered percentage simply false for anyone working elsewhere.
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).toMatch(/subset of the product/i);
    expect(text).toMatch(/may simply work somewhere this cannot see/i);
  });

  it('states plainly that activity is not value', async () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).toMatch(/not value/i);
    expect(text).toMatch(/ten considered decisions/i);
  });

  it('forbids using it to judge a person or their pay', async () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).toMatch(/never as a verdict/i);
    expect(text).toMatch(/as grounds for pay/i);
    expect(text).toMatch(/do not name individuals/i);
  });

  it('offers the innocent explanation for silence', async () => {
    const { service } = makeService([
      ...rows('alice', 40),
      ...Array.from({ length: 8 }, () => ({ userId: 'bob', module: 'crm', createdAt: ago(12) })),
    ]);
    const text = service.render(await service.measure(BIZ, T0))!;

    expect(text).toMatch(/on leave/i);
    expect(text).not.toMatch(/bob/);
  });
});

describe('it does not invent money', () => {
  const code = readFileSync(join(__dirname, 'key-cortex-incentive.service.ts'), 'utf8');

  it('computes no commission, accrual or payout', () => {
    // There is no earnings model, and StaffMember carries hourlyRate with no
    // userId to join it to activity. Money owed to a person must be auditable
    // and exact; inferring it from an activity log would be neither.
    const body = code.slice(code.indexOf('@Injectable()'));
    expect(body).not.toMatch(/hourlyRate|commission|payout|accrual|earnings/i);
  });

  it('reads only the activity log', () => {
    const models = new Set(code.match(/this\.prisma\.client\.(\w+)/g) ?? []);
    expect(models).toEqual(new Set(['this.prisma.client.teamActivityLog']));
  });

  it('has no hands', () => {
    expect(code).not.toMatch(/executeTool|toolRegistry|executeToolDirectly/);
  });
});

describe('tenancy and bounds', () => {
  it('scopes to the business and bounds the read', async () => {
    const { seen, service } = makeService(rows('alice', 5));
    await service.measure(BIZ, T0);

    expect(seen.where.businessId).toBe(BIZ);
    expect(seen.where.createdAt.gte).toBeInstanceOf(Date);
    expect(seen.take).toBeGreaterThan(0);
  });
});

describe('the chat path is synchronous', () => {
  it('describeForPrompt does not return a Promise', () => {
    const { service } = makeService();
    expect(service.describeForPrompt(BIZ, T0)).not.toBeInstanceOf(Promise);
  });

  it('returns null before the first measurement completes', () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
  });

  it('serves the cached measurement once derived', async () => {
    const { service } = makeService([...rows('alice', 60), ...rows('bob', 10)]);
    await service.measure(BIZ, T0);

    expect(service.describeForPrompt(BIZ, T0)).toMatch(/86%/);
  });
});

describe('it is actually wired, not merely written', () => {
  const module = readFileSync(join(__dirname, 'key-cortex.module.ts'), 'utf8');
  const triage = readFileSync(join(__dirname, 'cognitive-triage.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .join('\n');

  it('is registered in providers AND exports', () => {
    expect((module.match(/KeyCortexIncentiveService,/g) ?? []).length).toBe(2);
  });

  it('reaches the system prompt through standingContext', () => {
    const block = triage.slice(triage.indexOf('private standingContext('));
    const body = block.slice(0, block.indexOf('\n  private '));
    expect(body).toMatch(/this\.incentive\?\.describeForPrompt\(businessId\)/);
    expect(body).toMatch(/parts\.push\(team\)/);
  });

  it('did not shift the pre-existing constructor positions', () => {
    // The specs construct triage positionally, so INSERTING a parameter feeds
    // every later stub into the wrong slot. That happened once today and the
    // only symptom was peekBody never being called.
    //
    // Asserting "mine is last" would be wrong tomorrow — it broke the moment the
    // next service was appended. The durable invariant is that the three
    // parameters the specs actually pass keep their positions.
    const ctor = triage.slice(triage.indexOf('constructor('), triage.indexOf(') {}'));
    const params = [...ctor.matchAll(/private readonly (\w+)\?/g)].map((m) => m[1]);
    expect(params.slice(0, 3)).toEqual(['router', 'endocrine', 'interoception']);
  });
});

describe('the standing context as a whole is bounded', () => {
  const triage = readFileSync(join(__dirname, 'cognitive-triage.service.ts'), 'utf8');

  it('has a ceiling on the combined block', () => {
    // Five sections concatenate now, several carrying operator free text.
    expect(triage).toMatch(/MAX_STANDING_CONTEXT_CHARS/);
  });

  it('drops whole sections rather than truncating one', () => {
    // Every section ends with the constraints on how it may be used ("not proof
    // of intent", "never as a verdict on a person"). Cutting mid-section would
    // reliably keep the accusation and discard the caveat.
    const fn = triage.slice(triage.indexOf('private withinBudget('));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    expect(body).toMatch(/break;/);
    expect(body).not.toMatch(/\.slice\(0,\s*MAX_STANDING_CONTEXT_CHARS/);
  });
});
