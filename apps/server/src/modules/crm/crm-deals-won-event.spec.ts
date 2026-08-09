/**
 * Winning a deal must announce itself on the bus, by every route.
 *
 * crm-sequence-scheduler.service.ts:564 has waited on `crm.deal.won` since it
 * was written, calling markConversionForContact — the thing that stops a
 * nurture sequence selling to someone who has already bought. Nothing emitted
 * it. Every won deal kept receiving its sequence, and no error was ever raised
 * because a listener with no emitter simply never runs.
 *
 * WHY THIS IS NOT COVERED BY "IT LOGS THE TIMELINE EVENT"
 * ------------------------------------------------------
 * Both win paths already wrote CONTACT_EVENT.DEAL_WON via timeline.logEvent.
 * That is a DATABASE ROW. It is not the event bus, nothing subscribes to it,
 * and its presence is exactly what made the gap look filled — the fact was
 * recorded twice over in the UI and never once delivered to the automation.
 *
 * TWO PATHS, AND THE ASYMMETRY IS THE RISK
 * ----------------------------------------
 * moveStage() transitions to WON when the target stage's category is WON;
 * winDeal() is the explicit "mark this won" action with a reason. bulkMoveStage
 * delegates to moveStage, so it is covered transitively — asserted below rather
 * than assumed, because "it delegates" is the kind of thing that stops being
 * true quietly.
 *
 * Emitting from one path and not the other is worse than emitting from neither:
 * conversions would be recorded for some wins and not others, and the gap would
 * look like data rather than like a bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CrmDealsService } from './crm-deals.service';

/**
 * The real service with its four dependencies stubbed.
 *
 * Queries are mocked to the shapes the code actually issues — getDeal does a
 * deal.findFirst with a stage include, moveStage does a dealStage.findFirst —
 * read from the source rather than imagined. A fixture describing a shape the
 * client cannot produce asserts that the broken thing is correct, which is how
 * the sibling context service's defect survived its own spec.
 */
function makeService(opts: { stageCategory: 'WON' | 'LOST' | 'OPEN' }) {
  const events = { emit: vi.fn() } as never as import('@nestjs/event-emitter').EventEmitter2;
  const fromStage = { id: 'stage_open', name: 'Proposal', slug: 'proposal', category: 'OPEN' };
  const target = {
    id: 'stage_target', businessId: 'biz_1', name: 'Won', slug: 'won',
    category: opts.stageCategory, position: 9, archivedAt: null,
  };
  const deal = {
    id: 'deal_1', businessId: 'biz_1', contactId: 'contact_1', title: 'Roof replacement',
    value: 12000, currency: 'TTD', status: 'OPEN', stageId: 'stage_open',
    wonAt: null, lostAt: null, stage: fromStage, contact: { id: 'contact_1' },
  };

  const prisma = {
    client: {
      deal: {
        findFirst: vi.fn(async () => deal),
        update: vi.fn(async ({ data }: any) => ({ ...deal, ...data, stage: target })),
      },
      dealStage: { findFirst: vi.fn(async () => target) },
    },
  } as never;

  const timeline = { logEvent: vi.fn(async () => ({})) } as never;
  const reasons = { resolveForUse: vi.fn(async () => ({ id: 'r1', label: 'Signed', slug: 'signed' })) } as never;

  return {
    service: new CrmDealsService(prisma, events, timeline, reasons),
    emit: (events as never as { emit: ReturnType<typeof vi.fn> }).emit,
  };
}

/** Every payload sent for a given event name. */
const payloadsFor = (emit: ReturnType<typeof vi.fn>, name: string) =>
  emit.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('a won deal reaches the bus', () => {
  it('moveStage into a WON stage emits crm.deal.won with the contactId', async () => {
    const { service, emit } = makeService({ stageCategory: 'WON' });

    await service.moveStage({ businessId: 'biz_1', dealId: 'deal_1', stageId: 'stage_target' });

    const won = payloadsFor(emit, 'crm.deal.won');
    expect(won, 'moveStage into a WON stage announced no win').toHaveLength(1);
    // contactId is the ONLY field the listener reads. An event that fires with
    // it missing satisfies "the event happened" and still does nothing at all.
    expect(won[0]).toMatchObject({ businessId: 'biz_1', dealId: 'deal_1', contactId: 'contact_1' });
  });

  it('winDeal emits it too, so the two paths cannot disagree', async () => {
    const { service, emit } = makeService({ stageCategory: 'WON' });

    await service.winDeal({ businessId: 'biz_1', dealId: 'deal_1', reasonNotes: 'Signed today' });

    const won = payloadsFor(emit, 'crm.deal.won');
    expect(won, 'the explicit win action announced no win').toHaveLength(1);
    expect(won[0]).toMatchObject({ contactId: 'contact_1' });
  });

  it('moving to a non-WON stage does not announce a win', async () => {
    const { service, emit } = makeService({ stageCategory: 'OPEN' });

    await service.moveStage({ businessId: 'biz_1', dealId: 'deal_1', stageId: 'stage_target' });

    expect(payloadsFor(emit, 'crm.deal.won')).toHaveLength(0);
  });

  it('crm.deal.stage_changed is still emitted and is not a substitute', async () => {
    // It fires for every stage move, so no listener can treat it as a
    // conversion. Both must be present: removing the older one would break
    // whatever already depends on it.
    const { service, emit } = makeService({ stageCategory: 'WON' });

    await service.moveStage({ businessId: 'biz_1', dealId: 'deal_1', stageId: 'stage_target' });

    expect(payloadsFor(emit, 'crm.deal.stage_changed')).toHaveLength(1);
    expect(payloadsFor(emit, 'crm.deal.won')).toHaveLength(1);
  });

  it('the sequence scheduler still listens for exactly this name', () => {
    // Emitting is pointless if the listener was renamed or removed, and these
    // two live in different files with nothing but this test connecting them.
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const scheduler: string = readFileSync(join(__dirname, 'crm-sequence-scheduler.service.ts'), 'utf8');

    expect(scheduler).toMatch(/@OnEvent\(\s*'crm\.deal\.won'/);
    expect(
      scheduler,
      'the handler no longer marks a conversion, so the event achieves nothing',
    ).toMatch(/markConversionForContact/);
  });

  it('bulkMoveStage delegates rather than being a third path that could forget', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const source: string = readFileSync(join(__dirname, 'crm-deals.service.ts'), 'utf8');
    const bulk = source.slice(source.indexOf('async bulkMoveStage'), source.indexOf('async winDeal'));

    expect(
      bulk,
      'bulkMoveStage no longer routes through moveStage, so bulk wins may now ' +
        'skip the event — give it its own emit or restore the delegation',
    ).toMatch(/this\.moveStage\(/);
  });
});
