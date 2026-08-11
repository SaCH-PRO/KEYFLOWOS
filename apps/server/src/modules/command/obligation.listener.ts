/**
 * The one writer.
 *
 * Producers across the product know when this business has taken on an
 * obligation — a booking finished so a rebook is owed, a period closed so a
 * return is owed, an invoice went past due so a chase is owed. None of them
 * should know what a CommandItem is.
 *
 * Sixteen files across twelve modules call `commandItem.create` directly today.
 * That is how the table ended up with twelve opinions about its own status
 * vocabulary, and it is the same failure the seven task models were. This
 * listener is the alternative: producers emit `work.obligation.raised`, this
 * writes, and `command-write-boundary.spec.ts` holds the line at sixteen.
 *
 * UPSERT, NOT findFirst-THEN-create.
 *
 * `intelligence/command-bridge.service.ts:31-46` does a findFirst and then a
 * create, which is a check-then-act race against a unique index one table away.
 * Two events for the same obligation arriving together produce either two rows
 * or a P2002 nobody catches. The five-tuple
 *   @@unique([businessId, sourceModule, sourceType, sourceId, actionType])
 * already exists on CommandItem and is exactly an obligation key, so a single
 * upsert is both the fix and the whole implementation.
 *
 * RE-RAISING MUST NOT RESURRECT.
 *
 * This is the subtle one, and it is the reason `status` is absent from the
 * update clause below. A producer re-raises on every sweep — a nightly job does
 * not remember what it emitted yesterday, and should not have to. If the update
 * set `status: 'OPEN'`, then every obligation a human DISMISSED would come back
 * the next night, forever, and the dismiss button would look broken rather than
 * ignored. So an upsert refreshes the FACTS of an obligation (its due date, its
 * title, what it is worth) and never its DISPOSITION.
 *
 * The listener is deliberately not @Injectable-with-Prisma-magic: it holds no
 * state, so it is safe on N replicas. Nothing here is a timer.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WORK_OBLIGATION_RAISED,
  WORK_OBLIGATION_SETTLED,
  type ObligationRaisedPayload,
  type ObligationSettledPayload,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ObligationListener {
  private readonly logger = new Logger(ObligationListener.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @OnEvent(WORK_OBLIGATION_RAISED)
  async onRaised(payload: ObligationRaisedPayload): Promise<void> {
    if (!this.valid(payload)) return;

    // The facts an upsert may refresh. Status, completedAt, dismissedAt and
    // dischargedAt are all absent on purpose — see the note above.
    const facts = {
      title: payload.title,
      description: payload.description ?? null,
      category: payload.category,
      dueAt: payload.dueAt,
      owedToType: payload.owedToType ?? null,
      owedToId: payload.owedToId ?? null,
      owedToLabel: payload.owedToLabel ?? null,
      seriesId: payload.seriesId ?? null,
      contactId: payload.contactId ?? null,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      expectedValue: payload.expectedValue ?? null,
      currency: payload.currency ?? null,
      priority: payload.priority ?? 50,
      urgency: payload.urgency ?? 50,
      executionTool: payload.executionTool ?? null,
      executionPayload:
        (payload.executionPayload as Record<string, unknown> | undefined) ?? undefined,
      executableByKey: !!payload.executionTool,
      riskTier: payload.riskTier ?? 1,
      requiresApproval: payload.requiresApproval ?? false,
    };

    try {
      await this.prisma.client.commandItem.upsert({
        where: {
          businessId_sourceModule_sourceType_sourceId_actionType: {
            businessId: payload.businessId,
            sourceModule: payload.sourceModule,
            sourceType: payload.sourceType,
            sourceId: payload.sourceId,
            actionType: payload.actionType,
          },
        },
        update: facts,
        create: {
          businessId: payload.businessId,
          sourceModule: payload.sourceModule,
          sourceType: payload.sourceType,
          sourceId: payload.sourceId,
          actionType: payload.actionType,
          kind: 'OBLIGATION',
          status: 'OPEN',
          recommendedBy: 'SYSTEM',
          ...facts,
        },
      });
    } catch (err) {
      // A producer must never be able to take a request down. But a swallowed
      // rejection is the documented failure class in this repo, so it is logged
      // with the tuple that identifies it rather than counted.
      this.logger.error(
        `obligation.raised failed for ${payload.sourceModule}/${payload.sourceType}/${payload.sourceId}/${payload.actionType}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Settle by the five-tuple, when the producer knows exactly which obligation
   * it discharged.
   *
   * Not every producer does. A rebooking knows the CONTACT it is for, not the
   * id of the completed appointment that made a rebook owed — see
   * `onSettledForParty` below, which is the shape that case needs.
   */
  @OnEvent(WORK_OBLIGATION_SETTLED)
  async onSettled(payload: ObligationSettledPayload): Promise<void> {
    if (payload?.owedToId && !payload.sourceId) {
      await this.onSettledForParty(payload);
      return;
    }
    if (
      !payload?.businessId ||
      !payload.sourceModule ||
      !payload.sourceType ||
      !payload.sourceId ||
      !payload.actionType
    ) {
      return;
    }

    // updateMany, not update: settling something that was never raised is not
    // an error, it is a no-op. `update` would throw P2025 and turn an ordinary
    // race — the human ticked it off before the producer noticed — into noise.
    //
    // The businessId in the where is load-bearing and not decorative: this
    // runs on the event bus, off the HTTP path, where activeBusinessId() is
    // undefined and the tenant extension is inert. Nothing else scopes this.
    try {
      const now = new Date();
      await this.prisma.client.commandItem.updateMany({
        where: {
          businessId: payload.businessId,
          sourceModule: payload.sourceModule,
          sourceType: payload.sourceType,
          sourceId: payload.sourceId,
          actionType: payload.actionType,
          kind: 'OBLIGATION',
          dischargedAt: null,
        },
        data: {
          status: 'COMPLETED',
          dischargedAt: now,
          dischargeRef: payload.dischargeRef ?? null,
          completedAt: now,
        },
      });
    } catch (err) {
      this.logger.error(`obligation.settled failed: ${(err as Error).message}`);
    }
  }

  /**
   * Settle every open obligation of one kind owed to one party.
   *
   * THE CASE THIS EXISTS FOR, AND THE BUG IT CLOSES. A completed appointment
   * raises a REBOOK obligation keyed on THAT appointment's id. When the client
   * is actually rebooked, the new booking knows the contact but has no idea
   * which prior appointment made a rebook owed — so the five-tuple settle above
   * cannot express it, and without this the obligation stays open forever. The
   * due list would fill with rebooks that genuinely happened, which is worse
   * than not having the list: it teaches people the list is wrong.
   *
   * Found by auditing my own work, not by a test. Nothing emitted
   * work.obligation.settled at all, so `onSettled` was a dead listener — the
   * exact class this repo already tracks ten of — and the event-wiring gate did
   * not catch it because it does not cover `work.obligation.*`.
   *
   * Scoped by businessId AND owedToId AND actionType, and only OPEN,
   * undischarged rows. It deliberately does not touch obligations of another
   * kind owed to the same party: rebooking someone does not settle the invoice
   * you owe them a chase on.
   */
  private async onSettledForParty(payload: ObligationSettledPayload): Promise<void> {
    if (!payload.businessId || !payload.owedToId || !payload.actionType) return;
    try {
      const now = new Date();
      await this.prisma.client.commandItem.updateMany({
        where: {
          businessId: payload.businessId,
          kind: 'OBLIGATION',
          actionType: payload.actionType,
          owedToId: payload.owedToId,
          dischargedAt: null,
          status: { notIn: ['COMPLETED', 'DISMISSED', 'EXECUTED', 'FAILED'] },
        },
        data: {
          status: 'COMPLETED',
          dischargedAt: now,
          completedAt: now,
          dischargeRef: payload.dischargeRef ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`obligation.settled (by party) failed: ${(err as Error).message}`);
    }
  }

  /** Every field of the identity tuple, plus the clock that makes it an obligation. */
  private valid(p: ObligationRaisedPayload): boolean {
    const missing: string[] = [];
    if (!p?.businessId) missing.push('businessId');
    if (!p?.sourceModule) missing.push('sourceModule');
    if (!p?.sourceType) missing.push('sourceType');
    if (!p?.sourceId) missing.push('sourceId');
    if (!p?.actionType) missing.push('actionType');
    if (!p?.title) missing.push('title');
    if (!p?.category) missing.push('category');
    if (!(p?.dueAt instanceof Date) || Number.isNaN(p.dueAt.getTime())) missing.push('dueAt');

    if (missing.length) {
      // Refusing loudly. A partial tuple would land on a DIFFERENT five-tuple
      // than the settle event will later name, so the obligation could never be
      // discharged and would sit in "due this week" forever.
      this.logger.warn(`obligation.raised ignored — missing/invalid: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }
}
