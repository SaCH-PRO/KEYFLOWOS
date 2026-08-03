/**
 * cognitive_events had a live reader and no writer.
 *
 * UnifiedMemoryRetrievalService queries `cognitiveEvent.findMany` when
 * assembling prompt context, and that service is wired in via
 * key-cortex-memory-retrieval.service.ts. But the only `cognitiveEvent.create`
 * in the entire server sat inside CognitiveEventBusService, which nothing
 * injected — so that branch of KEY's memory fan-out returned nothing on every
 * single query, silently.
 *
 * KeyCortexEventBusService.publish is the perception boundary every organ
 * adapter already goes through, so it is where those rows should originate.
 *
 * Note this is NOT a duplicate of the existing audit write: BusinessEvent is
 * the audit ledger, CognitiveEvent carries a `confidence` column BusinessEvent
 * has no equivalent for, which is precisely why memory retrieval reads it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';

class CognitiveStub {
  emitted: Array<Record<string, unknown>> = [];
  emit = vi.fn((input: Record<string, unknown>) => {
    this.emitted.push(input);
    return Promise.resolve('cog_1');
  });
}

function makePrisma() {
  return {
    client: {
      businessEvent: { create: vi.fn(() => Promise.resolve({ id: 'be_1' })) },
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const EVENT = {
  source: 'key_inbox',
  type: 'message.received',
  businessId: 'biz_1',
  payload: { subject: 'late invoice' },
};

describe('cognitive event write', () => {
  let cognitive: CognitiveStub;
  let bus: KeyCortexEventBusService;

  beforeEach(() => {
    cognitive = new CognitiveStub();
    bus = new KeyCortexEventBusService(makePrisma() as never, cognitive as never);
  });

  it('publishing writes a cognitive event', async () => {
    await bus.publish(EVENT as never);
    await flush();

    expect(cognitive.emit).toHaveBeenCalledTimes(1);
  });

  it('carries the tenant, source and type through', async () => {
    await bus.publish(EVENT as never);
    await flush();

    const [written] = cognitive.emitted;
    expect(written.businessId).toBe('biz_1');
    expect(written.sourceType).toBe('key_inbox');
    expect(written.eventType).toBe('message.received');
  });

  it('carries the payload, which is what memory retrieval reads', async () => {
    await bus.publish(EVENT as never);
    await flush();

    expect(cognitive.emitted[0].payload).toEqual({ subject: 'late invoice' });
  });

  it('respects a confidence the event already declared', async () => {
    // A signal that knows how sure it is should not be flattened to the default.
    await bus.publish({ ...EVENT, metadata: { confidence: 0.35 } } as never);
    await flush();

    expect(cognitive.emitted[0].confidence).toBe(0.35);
  });

  it('leaves confidence undefined when none was declared, so the store default applies', async () => {
    await bus.publish(EVENT as never);
    await flush();

    expect(cognitive.emitted[0].confidence).toBeUndefined();
  });

  it('ignores a non-numeric confidence rather than writing garbage', async () => {
    await bus.publish({ ...EVENT, metadata: { confidence: 'high' } } as never);
    await flush();

    expect(cognitive.emitted[0].confidence).toBeUndefined();
  });

  it('a cognitive-store failure does not fail the publish', async () => {
    // Recording a perception must never fail the perception.
    cognitive.emit.mockRejectedValue(new Error('table locked'));

    await expect(bus.publish(EVENT as never)).resolves.toBeDefined();
    await flush();
  });

  it('works with no cognitive store registered at all', async () => {
    // @Optional — the bus must keep working for consumers that omit it.
    const plain = new KeyCortexEventBusService(makePrisma() as never);
    await expect(plain.publish(EVENT as never)).resolves.toBeDefined();
    await flush();
  });

  it('still writes the audit ledger — this ADDS a store, it does not replace one', async () => {
    const prisma = makePrisma();
    const b = new KeyCortexEventBusService(prisma as never, cognitive as never);

    await b.publish(EVENT as never);
    await flush();

    expect(prisma.client.businessEvent.create).toHaveBeenCalled();
    expect(cognitive.emit).toHaveBeenCalled();
  });
});
