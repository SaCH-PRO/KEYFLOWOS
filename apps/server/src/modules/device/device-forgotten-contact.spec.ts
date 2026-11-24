/**
 * Codex P1 on PR #226 (RR-ERASURE-BUSINESS-EVENTS follow-up): the device
 * business-card flow writes a contact_created_from_capture business_events
 * row (subject the new contact, metadata.name the person's name) with a
 * direct create. If the contact is forgotten and purged while that call is
 * still completing, the row lands after the erasure with the name in it. It
 * goes through the same write-time check as BusinessEventService.emit.
 */
import { describe, expect, it, vi } from 'vitest';
import { DeviceService } from './device.service';

const NAME = 'V72W Ada Capture';

function deps(forgotten: boolean) {
  const create = vi.fn(async (args: any) => ({ id: 'evt_1', ...args.data }));
  const prisma: any = {
    client: {
      $queryRaw: vi.fn(async () => [{ forgotten }]),
      visualIntake: {
        findFirst: vi.fn(async () => ({ id: 'intake_1', mediaAssetId: 'asset_1' })),
        update: vi.fn(async () => ({})),
      },
      contact: { create: vi.fn(async ({ data }: any) => ({ id: 'c_card', ...data })) },
      mediaAsset: { update: vi.fn(async () => ({})) },
      extractedEntity: { updateMany: vi.fn(async () => ({ count: 1 })) },
      businessEvent: { create },
    },
  };
  const commands = { create: vi.fn(async () => ({ id: 'cmd_1' })) };
  const service = new DeviceService(prisma, {} as any, commands as any, {} as any);
  return { service, prisma, create };
}

describe('DeviceService.createContactFromCard: the capture event of a forgotten contact holds no personal data (Codex #226)', () => {
  it('writes contact_created_from_capture without the name once the contact is forgotten', async () => {
    const { service, prisma, create } = deps(true);
    await service.createContactFromCard('biz_1', 'u1', { visualIntakeId: 'intake_1', name: NAME } as any);
    expect(prisma.client.$queryRaw).toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ eventType: 'contact_created_from_capture', subjectType: 'contact', subjectId: 'c_card' });
    expect(JSON.stringify(data)).not.toContain(NAME);
  });

  it('keeps the name for a contact that is not forgotten', async () => {
    const { service, create } = deps(false);
    await service.createContactFromCard('biz_1', 'u1', { visualIntakeId: 'intake_1', name: NAME } as any);
    expect(create.mock.calls[0][0].data.metadata).toEqual({ visualIntakeId: 'intake_1', name: NAME });
  });
});
