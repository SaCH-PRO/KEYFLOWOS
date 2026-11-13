import { describe, expect, it, vi } from 'vitest';
import { HelpdeskService } from './helpdesk.service';

describe('HelpdeskService.replyToTicket', () => {
  function makeStubs(initialStatus: string) {
    const update = vi.fn(async ({ data }: any) => ({ id: 't_1', status: data.status }));
    const prisma = {
      client: {
        supportTicket: {
          findFirst: vi.fn(async () => ({
            id: 't_1',
            businessId: 'biz_1',
            status: initialStatus,
            deletedAt: null,
          })),
          update,
        },
        supportTicketMessage: {
          create: vi.fn(async ({ data }: any) => ({ id: 'msg_1', ...data })),
        },
      },
    } as any;
    const events = { emit: vi.fn() } as any;
    return { prisma, update, svc: new HelpdeskService(prisma, events) };
  }

  it('reopens an uppercase RESOLVED ticket to OPEN when a reply is posted', async () => {
    const { svc, update } = makeStubs('RESOLVED');
    await svc.replyToTicket('biz_1', 't_1', 'Following up on this issue');
    expect(update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { status: 'OPEN' },
    });
  });

  it('reopens a lowercase resolved or closed ticket to uppercase OPEN', async () => {
    const { svc, update } = makeStubs('closed');
    await svc.replyToTicket('biz_1', 't_1', 'Reopening');
    expect(update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { status: 'OPEN' },
    });
  });

  it('does not redundantly update status when ticket is already OPEN', async () => {
    const { svc, update } = makeStubs('OPEN');
    await svc.replyToTicket('biz_1', 't_1', 'Additional details');
    expect(update).not.toHaveBeenCalled();
  });
});
