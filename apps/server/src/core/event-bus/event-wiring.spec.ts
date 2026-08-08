/**
 * No NEW listener may be added with nothing to trigger it.
 *
 * A listener with no emitter is an automation the product offers and never
 * performs. The handler is written, typed and often unit-tested; the event
 * simply never arrives. Nothing throws, nothing logs, and the feature is
 * "shipped". It is the silent-zero failure again, one layer up from the
 * statement sweep.
 *
 * ELEVEN ALREADY EXIST. They are listed below rather than fixed here, because
 * each one is a product decision — emit the event, or delete the listener and
 * stop advertising the automation — and making eleven of those decisions is
 * not the same task as stopping the twelfth from appearing.
 *
 * WHY THE COUNT IS NOT THE ONE ANYONE QUOTED BEFORE
 * -------------------------------------------------
 * Three different sweeps of this codebase produced three different numbers,
 * all wrong, in both directions:
 *
 *   30  a grep for emit('x.y') — missed this.emitEvent(id, 'x.y', row) and
 *       emit(`content_request.${status}`), so it condemned working listeners
 *   16  required the callee to say "emit" — missed the local wrapper
 *         const queue = (name, p) => ... this.events.emit(name, p)
 *       and so condemned invoice.sent, which is how EVERY invoice is sent
 *    2  counted any mention at all as proof, so a listener whose @OnEvent had
 *       a second argument slipped past the strip and proved ITSELF alive
 *
 * A false death is worse than a missed one: it sends someone to "fix" working
 * code, and the fix is a duplicate emit. So the analyser reports UNVERIFIED
 * separately and only calls an event dead when its name appears NOWHERE in the
 * codebase except the @OnEvent waiting for it. That is the one claim static
 * analysis can make safely here, because absence of the string really does
 * imply absence of the emit.
 */
import { describe, it, expect } from 'vitest';
import { analyseEventWiring } from '../../../scripts/event-wiring';

/**
 * Listeners known to have no emitter, verified by hand on 2026-08-08.
 *
 * Each was checked by listing every occurrence of the name in src/ and
 * confirming the only one is the @OnEvent itself.
 *
 * This list may SHRINK — that is the point. It must never grow.
 */
const KNOWN_DEAD = [
  // Bookings can be created and completed but deletion emits nothing, so a
  // deleted booking never reaches the calendar listener that would tidy up.
  'booking.deleted',

  // The deal pipeline has no won-event. crm-sequence-scheduler waits on it to
  // stop sequences against a customer who has already bought — so a won deal
  // keeps being nurtured.
  'crm.deal.won',

  // The realtime layer. Seven listeners in key-cortex-realtime.service push
  // these to the browser, and nothing on the server raises them. Note the
  // near-miss that makes it look wired: the gateway emits 'key:suggestion'
  // with a COLON to socket.io clients, which is a different bus entirely.
  'key.alert',
  'key.approval.requested',
  'key.approval.resolved',
  'key.health.update',
  'key.insight.generated',
  'key.reasoning.chunk',
  'key.stats.requested',
  'key.suggestion',

  // storelink-adapter waits for a storefront order to reach the organ layer.
  // The store emits its own order events under different names.
  'storefront.order_created',
];

/**
 * Mentioned in the codebase but not inside anything the analyser recognises as
 * an emit. Not necessarily dead — possibly a wrapper shape not modelled — so
 * these are reported and NOT failed. Worth a human pass.
 */
const KNOWN_UNVERIFIED = ['recurring_invoice.deleted', 'relationship_health.changed'];

describe('every listener has something that can trigger it', () => {
  const wiring = analyseEventWiring();

  it('adds no new listener with no emitter', () => {
    const unexpected = wiring.dead.filter((e) => !KNOWN_DEAD.includes(e));

    expect(
      unexpected,
      'A new @OnEvent was added for an event nothing emits. The handler will ' +
        'never run and nothing will report that. Emit the event, or do not ' +
        'advertise the automation.',
    ).toEqual([]);
  });

  it('the known-dead list does not outlive the problem', () => {
    // If an event here starts being emitted, the entry is stale and the next
    // person reads it as a live defect. Shrinking this list is progress and
    // must be recorded.
    const fixed = KNOWN_DEAD.filter((e) => !wiring.dead.includes(e));

    expect(
      fixed,
      'These are now emitted — remove them from KNOWN_DEAD so the list keeps ' +
        'meaning what it says.',
    ).toEqual([]);
  });

  it('reports what it could not verify rather than guessing', () => {
    // The category exists so the analyser never has to choose between a false
    // accusation and silence.
    const surprises = wiring.unverified.filter((e) => !KNOWN_UNVERIFIED.includes(e));
    expect(surprises, 'a new unverifiable listener appeared — look at it by hand').toEqual([]);
  });

  it('resolves the wrapper and template emit shapes, not just the literal one', () => {
    // Guards the analyser itself. Each of these is emitted through a shape a
    // naive sweep misses, and each was wrongly condemned by an earlier version:
    //
    //   invoice.sent               const queue = (name, p) => ...emit(name, p)
    //   content_request.submitted  emitEvent(id, `content_request.${status}`)
    //   purchaseOrder.received     a plain emit 1000 lines from the listener
    //
    // If this test fails, the analyser has regressed and its dead-list is
    // about to accuse working code.
    const resolved = new Set([...wiring.live, ...wiring.dynamic.map((d) => d.event)]);
    for (const event of ['invoice.sent', 'invoice.void', 'content_request.submitted', 'purchaseOrder.received']) {
      expect(resolved.has(event), `${event} is emitted, but the analyser lost it`).toBe(true);
    }
  });

  it('a listener never counts as its own emitter', () => {
    // `@OnEvent('crm.deal.won', { async: true })` survived a strip that
    // required the closing paren immediately after the string, so the listener
    // proved itself alive and the whole exercise reported 2 dead instead of 11.
    expect(wiring.dead).toContain('crm.deal.won');
  });
});
