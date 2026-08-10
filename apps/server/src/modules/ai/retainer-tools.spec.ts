/**
 * Recurring agreements, and the hours that bill against them.
 *
 * RetainerService has eight methods, a controller and a writable 157-line
 * screen, and no tools. KEY could not say who is on retainer, how much of this
 * month's allowance is gone, or which periods are still unbilled — the
 * questions that decide whether a retainer is worth having.
 *
 * (The standing queue said the periods loop "exists in no service" and should
 * be deferred as a real build. Measured: createPeriod and updatePeriod are both
 * there, fully scoped. That entry was wrong.)
 *
 * WHAT THESE TESTS GUARD
 *
 * The service itself is well built — create() cross-checks contactId against
 * the business, and updatePeriod() does the same for invoiceId, both of which
 * matter because RetainerAgreement.contactId is a bare String column with no
 * Prisma relation and therefore no FK to fall back on. The handlers lean on
 * that rather than repeating it.
 *
 * What the service cannot check is a DATE, because by the time it receives one
 * it is already a Date object. `new Date('next month')` is Invalid Date, and it
 * arrives silently: Prisma stores NULL or throws depending on the column, and
 * either way a billing period exists that nothing can total or sort.
 *
 * And one arithmetic defect, found while wiring this and fixed in the service:
 * amountBilled divided by includedHours with a `?? 1` fallback that only fires
 * on null. Zero is not null. A retainer with includedHours: 0 divided by zero
 * and wrote Infinity to a billing column.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';
import { RetainerService } from '../retainers/retainer.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

const BIZ = 'biz_retainer_spec';

const RETAINER_TOOLS = [
  'retainers_list',
  'retainers_get',
  'retainers_summary',
  'retainers_create',
  'retainers_update',
  'retainers_log_period',
  'retainers_update_period',
] as const;

function makeRetainerStub() {
  return {
    list: vi.fn(async () => [{ id: 'r1' }]),
    findById: vi.fn(async (id: string) => ({ id, name: 'Monthly SEO' })),
    getSummary: vi.fn(async () => ({ total: 2, active: 1, totalRevenue: 5000 })),
    create: vi.fn(async () => ({ id: 'ret_new', name: 'Stored Name', monthlyAmount: 1000 })),
    update: vi.fn(async () => ({ id: 'r1', status: 'PAUSED' })),
    createPeriod: vi.fn(async () => ({ id: 'p1', hoursUsed: 12, hoursBilled: 10, amountBilled: 250 })),
    updatePeriod: vi.fn(async () => ({ id: 'p1', hoursUsed: 14, invoiceId: 'inv1' })),
    delete: vi.fn(async () => ({ deleted: true })),
  };
}

let retainers: ReturnType<typeof makeRetainerStub>;
let svc: FlowOrchestratorService;

function run(tool: string, args: Record<string, unknown>) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

/** Writes across the service, so "refused" can be told from "wrote then threw". */
const writeCount = () =>
  retainers.create.mock.calls.length +
  retainers.update.mock.calls.length +
  retainers.createPeriod.mock.calls.length +
  retainers.updatePeriod.mock.calls.length +
  retainers.delete.mock.calls.length;

beforeEach(() => {
  retainers = makeRetainerStub();
  svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    moduleRef: { get: () => retainers },
  }) as FlowOrchestratorService;
});

describe('the retainer book is reachable', () => {
  it('every tool is registered', () => {
    for (const name of RETAINER_TOOLS) {
      expect(getToolByName(name), `${name} is missing`).toBeDefined();
    }
  });

  it('KEY can read the book and keep it', () => {
    const tools = RETAINER_TOOLS.map((n) => getToolByName(n)!);
    expect(tools.filter((t) => t.family === 'read').length).toBe(3);
    expect(tools.filter((t) => ['crud', 'organize'].includes(t.family ?? '')).length).toBe(4);
  });

  it('there is no delete tool, and ending a retainer is a status', () => {
    // delete() is a hard delete of a revenue agreement and takes its periods
    // with it. The billing history is the part worth keeping.
    expect(FLOW_TOOLS.filter((t) => /^retainers_.*delete/.test(t.name))).toEqual([]);
    expect(getToolByName('retainers_update')!.description).toMatch(/never deleted/i);
  });

  it('no handler calls the service delete', () => {
    const orchestrator = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');
    const block = orchestrator.slice(
      orchestrator.indexOf("case 'retainers_list'"),
      orchestrator.indexOf('── Governance'),
    );
    expect(block.includes('.delete(')).toBe(false);
  });

  it('does not let the caller supply the billing amount', () => {
    // createPeriod derives amountBilled from the agreement. Accepting it as a
    // parameter would let KEY invent a figure and have the record agree with
    // it — an invoice backed by nothing but the model's arithmetic.
    const tool = getToolByName('retainers_log_period')!;
    expect(Object.keys(tool.parameters.properties)).not.toContain('amountBilled');
    expect(Object.keys(tool.parameters.properties)).not.toContain('hoursBilled');
  });
});

describe('an unreadable date is refused before anything is written', () => {
  it('rejects a startDate it cannot parse', async () => {
    await expect(
      run('retainers_create', {
        contactId: 'c1',
        name: 'X',
        monthlyAmount: 100,
        startDate: 'next month',
      }),
    ).rejects.toThrow(/startDate is not a date I can read/i);
    expect(writeCount(), 'an invalid date reached the database').toBe(0);
  });

  it('rejects an agreement that ends before it begins', async () => {
    await expect(
      run('retainers_create', {
        contactId: 'c1',
        name: 'X',
        monthlyAmount: 100,
        startDate: '2026-06-01',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow(/end before it began/i);
    expect(writeCount()).toBe(0);
  });

  it('rejects an unreadable periodStart', async () => {
    await expect(
      run('retainers_log_period', { retainerId: 'r1', periodStart: 'soon', periodEnd: '2026-02-01' }),
    ).rejects.toThrow(/periodStart is not a date I can read/i);
    expect(writeCount()).toBe(0);
  });

  it('rejects a period that covers no time at all', async () => {
    await expect(
      run('retainers_log_period', {
        retainerId: 'r1',
        periodStart: '2026-03-01',
        periodEnd: '2026-02-01',
      }),
    ).rejects.toThrow(/covers no time at all/i);
    expect(writeCount()).toBe(0);
  });

  // Negative controls, or every test above would pass against a handler that
  // refused every date it was ever given.
  it('accepts a real agreement and passes real Dates down', async () => {
    await run('retainers_create', {
      contactId: 'c1',
      name: 'Monthly SEO',
      monthlyAmount: 1000,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const [input] = retainers.create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(input.businessId).toBe(BIZ);
    expect(input.startDate, 'startDate arrived as something other than a Date').toBeInstanceOf(Date);
    expect(input.endDate).toBeInstanceOf(Date);
  });

  it('accepts a real period', async () => {
    await run('retainers_log_period', {
      retainerId: 'r1',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      hoursUsed: 12,
    });
    expect(retainers.createPeriod).toHaveBeenCalledTimes(1);
    const [retainerId, businessId, data] = retainers.createPeriod.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(retainerId).toBe('r1');
    expect(businessId).toBe(BIZ);
    expect(data.periodStart).toBeInstanceOf(Date);
  });
});

describe('patches carry only what was asked for', () => {
  it('update does not forward retainerId or invented keys', async () => {
    await run('retainers_update', { retainerId: 'r1', status: 'PAUSED', madeUp: 'x' });
    const [, , patch] = retainers.update.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(patch)).toEqual(['status']);
  });

  it('update refuses when there is nothing to change', async () => {
    await expect(run('retainers_update', { retainerId: 'r1' })).rejects.toThrow(
      /nothing to change/i,
    );
    expect(writeCount()).toBe(0);
  });

  it('update_period refuses when there is nothing to change', async () => {
    await expect(
      run('retainers_update_period', { retainerId: 'r1', periodId: 'p1' }),
    ).rejects.toThrow(/nothing to change/i);
    expect(writeCount()).toBe(0);
  });

  it('update_period passes ids in the order the service expects', async () => {
    // updatePeriod(periodId, retainerId, businessId, data) — three string
    // arguments in a row, so a transposition compiles, runs, and scopes the
    // lookup to the wrong row.
    await run('retainers_update_period', { retainerId: 'r1', periodId: 'p1', hoursUsed: 14 });
    const [periodId, retainerId, businessId] = retainers.updatePeriod.mock
      .calls[0] as unknown as [string, string, string];
    expect(periodId).toBe('p1');
    expect(retainerId).toBe('r1');
    expect(businessId).toBe(BIZ);
  });

  it('get passes id and business in the order findById expects', async () => {
    // findById(id, businessId) — the reverse of most of this service.
    await run('retainers_get', { retainerId: 'r9' });
    expect(retainers.findById).toHaveBeenCalledWith('r9', BIZ);
  });
});

describe('overage arithmetic on a retainer with no included hours', () => {
  /**
   * Against the REAL service, with only Prisma stubbed. The defect was in the
   * calculation, so a stubbed service would assert nothing.
   */
  function realService(includedHours: number | null, monthlyAmount = 1000) {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      client: {
        retainerAgreement: {
          findFirst: async () => ({ id: 'r1', businessId: BIZ, includedHours, monthlyAmount }),
        },
        retainerPeriod: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: 'p1', ...data };
          },
        },
      },
    } as unknown as PrismaService;
    return { service: new RetainerService(prisma), created };
  }

  it('includedHours: 0 does not produce Infinity', async () => {
    // `retainer.includedHours ?? 1` only substitutes when includedHours is
    // null or undefined. Zero is neither, so this divided by zero and wrote
    // Infinity to a BILLING column.
    const { service, created } = realService(0);
    await service.createPeriod('r1', BIZ, {
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-28'),
      hoursUsed: 10,
    });
    const amount = created[0].amountBilled as number;
    expect(Number.isFinite(amount), `amountBilled was ${amount}`).toBe(true);
    // No hours included means every hour is overage at the full monthly rate.
    expect(amount).toBe(10 * 1000);
  });

  it('null includedHours behaves the same way, since it means the same thing', async () => {
    const { service, created } = realService(null);
    await service.createPeriod('r1', BIZ, {
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-28'),
      hoursUsed: 10,
    });
    expect(created[0].amountBilled).toBe(10 * 1000);
  });

  it('an ordinary retainer still bills overage at the per-hour rate', async () => {
    // Negative control: 10 included hours at 1000/month is 100/hour, and 12
    // hours used is 2 hours of overage.
    const { service, created } = realService(10);
    await service.createPeriod('r1', BIZ, {
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-28'),
      hoursUsed: 12,
    });
    expect(created[0].amountBilled).toBe(2 * 100);
    expect(created[0].hoursBilled).toBe(10);
  });

  it('and bills nothing when the allowance was not exceeded', async () => {
    const { service, created } = realService(10);
    await service.createPeriod('r1', BIZ, {
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-28'),
      hoursUsed: 8,
    });
    expect(created[0].amountBilled).toBe(0);
  });
});
