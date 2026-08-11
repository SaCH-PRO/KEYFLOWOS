/**
 * No NEW listener may be added with nothing to trigger it.
 *
 * A listener with no emitter is an automation the product offers and never
 * performs. The handler is written, typed and often unit-tested; the event
 * simply never arrives. Nothing throws, nothing logs, and the feature is
 * "shipped". It is the silent-zero failure again, one layer up from the
 * statement sweep.
 *
 * TEN REMAIN, down from eleven. They are listed below rather than fixed in one
 * go, because each is a product decision — emit the event, or delete the
 * listener and stop advertising the automation — and making ten of those is not
 * the same task as stopping the eleventh from appearing.
 *
 * crm.deal.won was the first removed: both win paths in crm-deals.service now
 * emit it, so a customer who has bought stops being chased by the sequence
 * that was selling to them.
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

  // crm.deal.won was here. Both win paths in crm-deals.service now emit it
  // (moveStage and winDeal, with bulkMoveStage delegating to the first), so the
  // sequence scheduler's conversion handler finally runs and a customer who has
  // bought stops being nurtured.

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

  it('every @OnEvent resolves to an event name the analyser can read', () => {
    // The blind spot that let a dead listener through.
    //
    // The listener scan matched `@OnEvent(` followed by a QUOTE, so
    // `@OnEvent(WORK_OBLIGATION_RAISED)` was not judged live — it was never
    // seen as a listener at all, and this file passed by measuring nothing.
    // Same shape as the honesty sweep that could not see a braceless handler
    // and the tenant gate that could not see an unscoped model: the check was
    // fine, its input was short.
    //
    // Constants are resolved now. One that CANNOT be resolved lands here rather
    // than being dropped, so the next unreadable form fails loudly instead of
    // silently shrinking what the gate covers.
    expect(
      wiring.unresolvedListeners,
      'These @OnEvent decorators name something this analyser cannot resolve to ' +
        'an event string, so their events are invisible to the dead-listener ' +
        'check and could never be reported. Declare the name as an exported ' +
        'string const (the @keyflow/shared pattern), or teach event-wiring.ts ' +
        'to read this form — do not leave it unseen.',
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
    // `@OnEvent('crm.deal.won', { async: true })` survived a strip that required
    // the closing paren immediately after the string, so the listener proved
    // itself alive and the whole exercise reported 2 dead instead of 11.
    //
    // That event is now emitted, so it can no longer serve as the canary — a
    // detector test pinned to a specific defect stops working the moment the
    // defect is fixed, which is a design flaw in the test rather than a reason
    // to leave the bug. The canary is now the PROPERTY: at least one listener
    // whose decorator carries trailing arguments must still be seen as dead.
    // Any of booking.deleted, key.alert or key.suggestion qualifies today.
    const withTrailingArgs = ['booking.deleted', 'key.alert', 'key.suggestion'];
    const stillDetected = withTrailingArgs.filter((e) => wiring.dead.includes(e));

    expect(
      stillDetected.length,
      'No listener declared as @OnEvent(name, { async: true }) is being reported ' +
        'dead. Either they were all fixed — in which case pick a new canary — or ' +
        'the decorator strip has regressed and every such listener is now ' +
        'silently proving itself alive.',
    ).toBeGreaterThan(0);
  });
});
