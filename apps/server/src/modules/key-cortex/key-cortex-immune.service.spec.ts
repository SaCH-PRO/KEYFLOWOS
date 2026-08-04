/**
 * The immune centre — the two thirds that were missing.
 *
 * Detection already existed and already worked. What did not exist was anything
 * that KEPT a detection or REACTED to one. An anomaly was emitted, and the only
 * listener was an SSE broadcast beginning `if (!set || set.size === 0) return;`
 * — so with no dashboard open the detection was discarded. That is the property
 * most of this file is about: a detection must survive nobody watching.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexImmuneService } from './key-cortex-immune.service';

const BIZ = 'biz_1';
const ACTOR = 'user_9';
const T0 = new Date('2026-08-03T12:00:00Z');

function at(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** In-memory KeyCortexMemory that behaves like the real table. */
function makeStore() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    prisma: {
      client: {
        keyCortexMemory: {
          findMany: vi.fn(async ({ where }: any) =>
            rows.filter((r) => r.businessId === where.businessId && r.type === where.type),
          ),
          findFirst: vi.fn(async ({ where }: any) =>
            rows.find(
              (r) =>
                r.businessId === where.businessId &&
                r.type === where.type &&
                (where.key === undefined || r.key === where.key),
            ) ?? null,
          ),
          create: vi.fn(async ({ data }: any) => {
            const row = { id: `m_${++seq}`, ...data };
            rows.push(row);
            return row;
          }),
          update: vi.fn(async ({ where, data }: any) => {
            const row = rows.find((r) => r.id === where.id);
            Object.assign(row, data);
            return row;
          }),
        },
      },
    } as never,
  };
}

function makeEndocrine() {
  const released: any[] = [];
  return { released, endocrine: { release: vi.fn((b, s) => released.push({ b, s })) } as never };
}

function makeService() {
  const { rows, prisma } = makeStore();
  const { released, endocrine } = makeEndocrine();
  return { rows, released, service: new KeyCortexImmuneService(prisma, endocrine) };
}

describe('a detection survives nobody watching', () => {
  it('persists an incident with no dashboard, no user, no request', async () => {
    const { rows, service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', { count: 44 }, T0);

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('immune_incident');
    expect(rows[0].businessId).toBe(BIZ);
  });

  it('records the incident against the business, not a user', async () => {
    // A security signal scoped to whoever happened to be chatting would be
    // invisible to everyone else — the wrong failure direction.
    const { rows, service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);

    expect(rows[0].userId).toBeUndefined();
  });

  it('the event handler cannot throw into the emitter', async () => {
    // EventEmitter2 does not await handlers, so a rejection here would surface
    // as an unhandled rejection in the process.
    const { service } = makeService();
    (service as any).record = () => Promise.reject(new Error('db down'));

    await expect(
      service.onAnomalyDetected({ businessId: BIZ, actorId: ACTOR, anomalyType: 'mass_deletion' }),
    ).resolves.toBeUndefined();
  });
});

describe('memory: the second encounter is not treated as the first', () => {
  it('counts encounters of the same strain', async () => {
    const { service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);
    const second = await service.record(BIZ, ACTOR, 'mass_deletion', {}, at(T0, 1));

    expect(second.encounters).toBe(2);
  });

  it('reacts more strongly the second time', async () => {
    const { service } = makeService();
    const first = await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);
    const second = await service.record(BIZ, ACTOR, 'mass_deletion', {}, at(T0, 1));

    expect(second.severity).toBeGreaterThan(first.severity);
  });

  it('keeps severity bounded no matter how many encounters', async () => {
    const { service } = makeService();
    let last = await service.record(BIZ, ACTOR, 'entity_cycle', {}, T0);
    for (let i = 1; i < 12; i++) {
      last = await service.record(BIZ, ACTOR, 'entity_cycle', {}, at(T0, i));
    }
    expect(last.severity).toBeLessThanOrEqual(1);
  });

  it('treats a different actor as a different strain', async () => {
    const { service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);
    const other = await service.record(BIZ, 'user_other', 'mass_deletion', {}, T0);

    expect(other.encounters).toBe(1);
  });

  it('forgets a strain once it is outside the window', async () => {
    // Adaptive immunity fades. Otherwise one bad week makes a business
    // permanently jumpy, which is drift rather than memory.
    const { service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);
    const muchLater = await service.record(BIZ, ACTOR, 'mass_deletion', {}, at(T0, 40));

    expect(muchLater.encounters).toBe(1);
  });

  it('refreshes one row per strain rather than accumulating', async () => {
    const { rows, service } = makeService();
    for (let i = 0; i < 5; i++) await service.record(BIZ, ACTOR, 'mass_update', {}, at(T0, i));

    expect(rows).toHaveLength(1);
  });
});

describe('response: it reaches KEY disposition', () => {
  it('doses cortisol, with a reason', async () => {
    const { released, service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);

    expect(released).toHaveLength(1);
    expect(released[0].s[0].hormone).toBe('cortisol');
    // An unexplained hormone is refused by the endocrine service outright.
    expect(released[0].s[0].reason).toBeTruthy();
  });

  it('pre-scales magnitude into the endocrine clamp', async () => {
    // release() clamps at 0.35. Passing raw 0-1 severity would flatten
    // everything above the clamp to one dose and destroy the ordering.
    const { released, service } = makeService();
    await service.record(BIZ, ACTOR, 'entity_cycle', {}, T0);

    expect(released[0].s[0].magnitude).toBeLessThanOrEqual(0.35);
  });

  it('works with the endocrine system absent', async () => {
    const { prisma } = makeStore();
    const service = new KeyCortexImmuneService(prisma, undefined);
    await expect(service.record(BIZ, ACTOR, 'mass_deletion', {}, T0)).resolves.toBeTruthy();
  });
});

describe('what it tells the user', () => {
  it('says nothing when the business is healthy', async () => {
    const { service } = makeService();
    await service.hydrate(BIZ);
    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
  });

  it('reports the observation without accusing anyone', async () => {
    const { service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);

    const text = service.describeForPrompt(BIZ, T0)!;
    expect(text).toMatch(/mass deletion/);
    // The threshold is 20 deletes in an hour. A bulk import clears that.
    expect(text).toMatch(/not proof of intent/i);
    expect(text).toMatch(/rather than an accusation/i);
  });

  it('drops an incident once it ages out', async () => {
    const { service } = makeService();
    await service.record(BIZ, ACTOR, 'mass_deletion', {}, T0);
    expect(service.describeForPrompt(BIZ, at(T0, 40))).toBeNull();
  });

  it('is synchronous, because the chat path that reads it is', () => {
    const { service } = makeService();
    // Returning a Promise here would render as "[object Promise]" in the prompt.
    expect(service.describeForPrompt(BIZ, T0)).not.toBeInstanceOf(Promise);
  });
});

describe('tenancy', () => {
  it('never returns another business incidents', async () => {
    const { service } = makeService();
    await service.record('biz_other', ACTOR, 'mass_deletion', {}, T0);
    await service.hydrate(BIZ);

    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
    expect(await service.activeIncidents(BIZ, T0)).toEqual([]);
  });

  it('scopes and bounds every read', () => {
    const src = readFileSync(join(__dirname, 'key-cortex-immune.service.ts'), 'utf8');
    const findMany = src.slice(src.indexOf('.findMany('), src.indexOf('.catch(() => [] as any[])'));
    expect(findMany).toMatch(/businessId/);
    expect(findMany).toMatch(/take:\s*\d+/);
  });
});

describe('it has no hands', () => {
  const code = readFileSync(join(__dirname, 'key-cortex-immune.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
    .join('\n');

  it('never executes a tool or mutates the business', () => {
    // The response is neuroendocrine and evidentiary, never a business action.
    // Suspension needs a schema field that does not exist across 430 models, and
    // the one containment primitive in the repo (SafetyShellService.rollback)
    // returns success:true without reverting anything.
    expect(code).not.toMatch(/executeTool|toolRegistry|executeToolDirectly/);
    expect(code).not.toMatch(/\.delete\(|\.deleteMany\(|suspend|revoke|ban\(/);
  });

  it('only ever writes its own memory type', () => {
    const writes = code.match(/this\.prisma\.client\.(\w+)\./g) ?? [];
    expect(new Set(writes)).toEqual(new Set(['this.prisma.client.keyCortexMemory.']));
  });
});

describe('corrupt stored state cannot break a chat turn', () => {
  it('ignores an unparseable row', async () => {
    const { rows, service } = makeService();
    rows.push({ id: 'x', businessId: BIZ, type: 'immune_incident', key: 'k', value: 'not json' });

    await service.hydrate(BIZ);
    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
  });

  it('ignores a row with a NaN severity', async () => {
    const { rows, service } = makeService();
    rows.push({
      id: 'x', businessId: BIZ, type: 'immune_incident', key: 'k',
      value: JSON.stringify({ anomalyType: 'mass_deletion', actorId: ACTOR, encounters: 1, lastSeen: T0.toISOString(), severity: 'oops' }),
    });

    await service.hydrate(BIZ);
    expect(service.describeForPrompt(BIZ, T0)).toBeNull();
  });
});

describe('it is actually wired, not merely written', () => {
  // The defect this repo keeps reproducing is a service that is complete,
  // registered, and called by nothing. Three separate ones were found today.
  // These assertions read the OTHER files, because a service cannot prove its
  // own reachability.
  const triage = readFileSync(join(__dirname, 'cognitive-triage.service.ts'), 'utf8');
  const module = readFileSync(join(__dirname, 'key-cortex.module.ts'), 'utf8');

  const triageCode = triage
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .join('\n');

  it('is registered in providers AND exports', () => {
    // exports is not bookkeeping: AiModule reaches into this module with
    // moduleRef.get(X, { strict: false }), which only resolves exported things.
    expect((module.match(/KeyCortexImmuneService,/g) ?? []).length).toBe(2);
  });

  it('is injected into the thalamus', () => {
    expect(triageCode).toMatch(/immune\?:\s*KeyCortexImmuneService/);
  });

  it('reaches the system prompt through standingContext', () => {
    const block = triageCode.slice(triageCode.indexOf('private standingContext('));
    const body = block.slice(0, block.indexOf('\n  private '));
    expect(body).toMatch(/this\.immune\?\.describeForPrompt\(businessId\)/);
    expect(body).toMatch(/parts\.push\(threats\)/);
  });

  it('subscribes to the anomaly event that previously went nowhere', () => {
    const src = readFileSync(join(__dirname, 'key-cortex-immune.service.ts'), 'utf8');
    expect(src).toMatch(/@OnEvent\('business_event\.anomaly_detected'\)/);
  });
});
