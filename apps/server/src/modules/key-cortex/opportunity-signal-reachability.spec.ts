/**
 * Does the momentum half of the amygdala actually receive anything?
 *
 * KeyCortexSalienceService declares OPPORTUNITY_SIGNALS — invoice.paid,
 * payment.received, booking.created, booking.completed, contact.created — and
 * counts BusinessEvent rows with those exact event types. If nothing writes
 * them, rankOpportunities() always returns [], the dopamine branch never fires,
 * and KEY's disposition becomes one-directional: it can grow more cautious and
 * never bolder, however well the business is doing.
 *
 * An audit asserted exactly that. This file checks it against the running
 * chain rather than taking either side on trust, because the answer decides
 * whether the fix is a one-word rename or a missing sensor.
 *
 * The chain under test:
 *   service emits on EventEmitter2
 *     -> EventEmitterFlowBridgeService.onAny
 *     -> shouldForward(name) pattern allowlist
 *     -> normalizeEventName strips a module prefix
 *     -> extractBusinessId finds a tenant, or the event is dropped
 *     -> eventBus.publish({ type })
 *     -> persisted as BusinessEvent.eventType
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitterFlowBridgeService } from './event-emitter-flow-bridge.service';

const BIZ = 'biz_1';

/** The five keys salience counts, read from the service rather than retyped. */
function opportunitySignals(): string[] {
  const src = readFileSync(join(__dirname, 'key-cortex-salience.service.ts'), 'utf8');
  const block = src.slice(
    src.indexOf('const OPPORTUNITY_SIGNALS'),
    src.indexOf('};', src.indexOf('const OPPORTUNITY_SIGNALS')),
  );
  return [...block.matchAll(/'([a-z_.]+)':/g)].map((m) => m[1]);
}

function makeBridge() {
  const published: Array<{ type: string; businessId: string }> = [];
  const events = new EventEmitter2({ wildcard: false });
  const eventBus = { publish: vi.fn(async (e: any) => { published.push(e); }) };
  const bridge = new EventEmitterFlowBridgeService(events, eventBus as never);
  bridge.onModuleInit();
  return { events, published, bridge };
}

/** Waits for the bridge's fire-and-forget handler to settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the five signals salience waits for', () => {
  it('names exactly the five the service declares', () => {
    expect(opportunitySignals()).toEqual([
      'invoice.paid',
      'payment.received',
      'booking.created',
      'booking.completed',
      'contact.created',
    ]);
  });

  for (const signal of [
    'invoice.paid',
    'payment.received',
    'booking.created',
    'booking.completed',
    'contact.created',
  ]) {
    it(`"${signal}" survives the bridge with its name intact`, async () => {
      const { events, published } = makeBridge();
      events.emit(signal, { businessId: BIZ, eventName: signal });
      await settle();

      const match = published.find((p) => p.type === signal);
      expect(
        match,
        `nothing reaches BusinessEvent as "${signal}" — salience counts this exact ` +
          `string, so rankOpportunities() can never see it`,
      ).toBeDefined();
      expect(match!.businessId).toBe(BIZ);
    });
  }
});

describe('what the bridge drops, and why it matters', () => {
  it('drops an event carrying no businessId', async () => {
    // Correct behaviour — an untenanted event cannot be attributed — but it
    // means a producer that omits businessId is silently invisible.
    const { events, published } = makeBridge();
    events.emit('invoice.paid', { invoiceId: 'inv_1' });
    await settle();

    expect(published).toHaveLength(0);
  });

  it('drops an event whose name matches no pattern', async () => {
    const { events, published } = makeBridge();
    events.emit('something.unlisted', { businessId: BIZ });
    await settle();

    expect(published).toHaveLength(0);
  });
});

describe('the momentum arm is reachable end to end', () => {
  it('every OPPORTUNITY_SIGNAL survives the bridge', async () => {
    // The load-bearing assertion. Reads the keys from the service rather than
    // restating them, so adding a sixth signal without a matching bridge
    // pattern fails here instead of silently never firing.
    const { events, published } = makeBridge();

    for (const signal of opportunitySignals()) {
      events.emit(signal, { businessId: BIZ, eventName: signal });
    }
    await settle();

    const reached = new Set(published.map((p) => p.type));
    const missing = opportunitySignals().filter((s) => !reached.has(s));

    expect(
      missing,
      'these are counted by salience and can never arrive — the dopamine arm ' +
        'is dead for each one, so KEY can only grow more cautious, never bolder',
    ).toEqual([]);
  });

  it('the payment connectors emit with a tenant, so the new pattern is usable', () => {
    // A pattern that forwards nothing is theatre. All five connectors emit
    // payment.received with a businessId; without one the bridge drops it.
    const connectors = [
      'paypal', 'quickbooks', 'stripe', 'wipay', 'xero',
    ].map((name) =>
      readFileSync(
        join(__dirname, '..', '..', 'core', 'connectors', 'implementations', `${name}.connector.ts`),
        'utf8',
      ),
    );

    for (const src of connectors) {
      const emit = src.slice(src.indexOf("emit('payment.received'"));
      expect(emit.slice(0, 300)).toMatch(/businessId/);
    }
  });
});
