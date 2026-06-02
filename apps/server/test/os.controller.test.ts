import { describe, expect, it } from 'vitest';
import { OsController } from '../src/modules/os/os.controller';
import { OsService } from '../src/modules/os/os.service';
import { CommandService } from '../src/modules/command/command.service';

class PrismaServiceMock {
  client = {
    business: {
      findUnique: async () => ({ id: 'biz_1', name: 'Test Biz', currency: 'TTD' }),
    },
    financialAccount: {
      findMany: async () => [{ currentBalance: 1000 }],
    },
    invoice: {
      aggregate: async () => ({ _sum: { total: 500 }, _count: 2 }),
    },
    expense: {
      aggregate: async () => ({ _sum: { amount: 100 } }),
    },
    chartOfAccount: {
      findFirst: async () => null,
    },
    ledgerEntry: {
      aggregate: async () => ({ _sum: { debit: 0, credit: 0 } }),
    },
    booking: {
      count: async () => 3,
    },
    projectTask: {
      count: async () => 1,
    },
    contact: {
      count: async () => 10,
    },
    deal: {
      count: async () => 2,
      aggregate: async () => ({ _sum: { value: 5000 } }),
    },
    quote: {
      count: async () => 1,
    },
    project: {
      count: async () => 2,
    },
    aiApprovalItem: {
      count: async () => 0,
    },
    commandItem: {
      count: async () => 5,
      groupBy: async () => [{ category: 'MONEY', _count: { category: 3 } }],
    },
  };
}

class TimelineServiceMock {
  async recordEvent(_input: any) { return { id: 'evt_1' }; }
}

describe('OsController command-center', () => {
  const commandService = new CommandService(new PrismaServiceMock() as any, new TimelineServiceMock() as any);
  const osService = new OsService(new PrismaServiceMock() as any, commandService as any);
  const controller = new OsController(osService as any);

  it('returns command center data', async () => {
    const result = await controller.commandCenter('biz_1');
    expect(result.business.id).toBe('biz_1');
    expect(result.health.overallScore).toBeDefined();
    expect(result.today.priorityCommands).toBeDefined();
    expect(result.flows.financial.cashBalance).toBe(1000);
  });
});
