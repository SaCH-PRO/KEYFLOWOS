/**
 * Codex #226 census (RR-ERASURE-BUSINESS-EVENTS follow-up): KEY's observation
 * writer creates business_events rows directly, and its subject is a token
 * the caller names, so it can be a contact. It goes through the same
 * write-time check as BusinessEventService.emit.
 */
import { describe, expect, it, vi } from 'vitest';
import { BusinessEventType } from '@prisma/client';
import { KeyCortexEventService } from './key-cortex-event.service';

function prisma(forgotten: boolean) {
  const create = vi.fn(async (args: any) => ({ id: 'evt_1', ...args.data }));
  return { client: { $queryRaw: vi.fn(async () => [{ forgotten }]), businessEvent: { create } }, create };
}

describe('KeyCortexEventService.logEvent about a forgotten contact (Codex #226 census)', () => {
  it('runs the forgotten-contact check and writes no observation fields', async () => {
    const p = prisma(true);
    const svc = new KeyCortexEventService(p as never);
    await svc.logEvent({ businessId: 'biz_1', type: BusinessEventType.INSIGHT_GENERATED, subject: { type: 'contact', id: 'c_forgotten' }, payload: { status: 'v72w-churn-risk' } } as any);
    expect(p.client.$queryRaw).toHaveBeenCalled();
    expect(JSON.stringify(p.create.mock.calls[0][0].data)).not.toContain('v72w-churn-risk');
  });

  it('keeps them for a contact that is not forgotten', async () => {
    const p = prisma(false);
    const svc = new KeyCortexEventService(p as never);
    await svc.logEvent({ businessId: 'biz_1', type: BusinessEventType.INSIGHT_GENERATED, subject: { type: 'contact', id: 'c_live' }, payload: { status: 'v72w-churn-risk' } } as any);
    expect(JSON.stringify(p.create.mock.calls[0][0].data)).toContain('v72w-churn-risk');
  });
});
