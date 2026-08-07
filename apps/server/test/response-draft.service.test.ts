import { describe, expect, it, vi } from 'vitest';
import { ResponseDraftService } from '../src/modules/communications/response-draft.service';

function makePrismaMock(initialStatus = 'PENDING_APPROVAL') {
  let stored: any = {
    id: 'draft_1',
    businessId: 'biz_1',
    status: initialStatus,
    body: 'original',
    evidence: { source: 'ai' },
  };
  return {
    client: {
      responseDraft: {
        // findFirst, not findUnique: updateDraftBody resolves the draft with
        // { id, businessId } so a caller cannot reach another tenant's row.
        findFirst: vi.fn(async () => stored),
        findUnique: vi.fn(async () => stored),
        update: vi.fn(async ({ data }: any) => {
          stored = { ...stored, ...data };
          return stored;
        }),
      },
    },
  };
}

class SenderMock {
  async sendMessage(_input: any) {
    return { success: true, messageId: 'msg_1' };
  }
}

describe('ResponseDraftService.updateDraftBody', () => {
  it('updates the body and evidence metadata', async () => {
    const prisma = makePrismaMock('PENDING_APPROVAL') as any;
    const service = new ResponseDraftService(prisma, new SenderMock() as any);

    const updated = await service.updateDraftBody('biz_1', 'draft_1', 'edited body', 'user_1');

    expect(updated.body).toBe('edited body');
    expect(updated.evidence).toMatchObject({
      source: 'ai',
      lastEditedBy: 'user_1',
    });
    expect(prisma.client.responseDraft.update).toHaveBeenCalled();
  });

  it('reverts APPROVED drafts back to PENDING_APPROVAL', async () => {
    const prisma = makePrismaMock('APPROVED') as any;
    const service = new ResponseDraftService(prisma, new SenderMock() as any);

    const updated = await service.updateDraftBody('biz_1', 'draft_1', 'edited after approval');

    expect(updated.status).toBe('PENDING_APPROVAL');
  });

  it('preserves non-APPROVED statuses', async () => {
    const prisma = makePrismaMock('REJECTED') as any;
    const service = new ResponseDraftService(prisma, new SenderMock() as any);

    const updated = await service.updateDraftBody('biz_1', 'draft_1', 'edited after rejection');

    expect(updated.status).toBe('REJECTED');
  });

  it('throws when draft is not found', async () => {
    const prisma = {
      client: {
        responseDraft: {
          findFirst: vi.fn(async () => null),
          findUnique: vi.fn(async () => null),
        },
      },
    } as any;
    const service = new ResponseDraftService(prisma, new SenderMock() as any);

    await expect(service.updateDraftBody('biz_1', 'missing', 'body')).rejects.toThrow('Draft not found');
  });
});
