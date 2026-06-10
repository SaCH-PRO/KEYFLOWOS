import { describe, expect, it } from 'vitest';
import { CommandService } from '../src/modules/command/command.service';

class PrismaServiceMock {
  client = {
    commandItem: {
      create: async (args: any) => ({ id: 'cmd_1', ...args.data }),
      findMany: async () => [
        { id: 'cmd_1', title: 'Test', status: 'OPEN', priority: 50, category: 'MONEY' },
      ],
      count: async () => 1,
      findFirst: async (args: any) => {
        if (args.where.id === 'cmd_1') return { id: 'cmd_1', title: 'Test', status: 'OPEN' };
        return null;
      },
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      delete: async (args: any) => ({ id: args.where.id }),
    },
  };
}

class TimelineServiceMock {
  async recordEvent(_input: any) { return { id: 'evt_1' }; }
}

class NotificationsServiceMock {
  async create(_input: any) { return { id: 'notif_1' }; }
}

describe('CommandService', () => {
  const service = new CommandService(new PrismaServiceMock() as any, new TimelineServiceMock() as any, new NotificationsServiceMock() as any, { emit: () => {} } as any);

  it('creates a command item', async () => {
    const item = await service.create('biz_1', {
      sourceModule: 'finance',
      title: 'Chase invoice',
      category: 'MONEY',
      actionType: 'COLLECT',
    } as any);
    expect(item.title).toBe('Chase invoice');
    expect(item.status).toBe('OPEN');
  });

  it('lists command items', async () => {
    const res = await service.findMany('biz_1', {});
    expect(res.items.length).toBe(1);
    expect(res.total).toBe(1);
  });

  it('throws when item not found', async () => {
    await expect(service.findOne('biz_1', 'missing')).rejects.toThrow('Command item not found');
  });

  it('dismisses an item', async () => {
    const item = await service.dismiss('biz_1', 'cmd_1');
    expect(item.status).toBe('DISMISSED');
  });
});
