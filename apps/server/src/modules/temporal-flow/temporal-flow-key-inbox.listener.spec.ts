import { describe, expect, it, vi } from 'vitest';
import { TemporalFlowKeyInboxListener } from './temporal-flow-key-inbox.listener';
import type { TemporalFlowService } from './temporal-flow.service';

describe('TemporalFlowKeyInboxListener', () => {
  function makeListener() {
    const emitted: any[] = [];
    const temporalFlow = {
      emit: vi.fn(async (input: any) => {
        emitted.push(input);
        return { id: 'tf_1' };
      }),
    } as unknown as TemporalFlowService;

    const prisma = {
      client: {
        keyInboxThread: {
          findUnique: vi.fn().mockResolvedValue({ id: 'thread_1', channel: 'whatsapp', contactId: 'contact_1' }),
        },
      },
    } as any;

    const listener = new TemporalFlowKeyInboxListener(temporalFlow, prisma);
    return { listener, temporalFlow, prisma, emitted };
  }

  it('emits a temporal event when a KEYInbox message is received', async () => {
    const { listener, temporalFlow } = makeListener();
    await listener.onMessageReceived({
      businessId: 'biz_1',
      messageId: 'msg_1',
      threadId: 'thread_1',
      channel: 'whatsapp',
      direction: 'INBOUND',
    });

    expect(temporalFlow.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        source: 'whatsapp',
        type: 'key_inbox.message_received',
        threadId: 'thread_1',
        messageId: 'msg_1',
        contactId: 'contact_1',
      }),
    );
  });

  it('marks high-value intents as genome-impact potential', async () => {
    const { listener, temporalFlow } = makeListener();
    await listener.onMessageAnalyzed({
      businessId: 'biz_1',
      threadId: 'thread_1',
      intent: 'lead_inquiry',
      urgency: 'HIGH',
      confidence: 0.9,
    });

    expect(temporalFlow.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        genomeImpactPotential: true,
        importance: 'HIGH',
      }),
    );
  });

  it('emits opportunity events with genome impact', async () => {
    const { listener, temporalFlow } = makeListener();
    await listener.onOpportunityDetected({
      businessId: 'biz_1',
      insightId: 'ins_1',
      scope: 'WEEKLY',
      periodStart: new Date(),
      periodEnd: new Date(),
      insight: { title: 'Upsell opportunity', severity: 'HIGH', type: 'revenue', description: 'Customer ready to upgrade' },
    });

    expect(temporalFlow.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'key_inbox.opportunity_detected',
        genomeImpactPotential: true,
      }),
    );
  });
});
