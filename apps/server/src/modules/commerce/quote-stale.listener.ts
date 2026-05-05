import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QuoteStalePayload } from '../../core/event-bus/events.types';

export const STALE_QUOTE_TOOL = 'commerce_send_quote_reminder';

/**
 * R3: turns each `quote.stale` event into a "Follow up on stale quote"
 * card in the Action Queue (`AiApprovalItem`). Dedupes per-quote: if an
 * earlier card for the same quote is still pending we skip rather than
 * pile up duplicates as the daily scan re-runs.
 */
@Injectable()
export class QuoteStaleListener {
  private readonly logger = new Logger(QuoteStaleListener.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @OnEvent('quote.stale')
  async handleQuoteStale(payload: QuoteStalePayload) {
    try {
      const quote = payload.quote;
      const quoteId = quote.id;
      // Dedupe: skip if a pending card for the same quote already exists.
      const existing = await this.prisma.client.aiApprovalItem.findFirst({
        where: {
          businessId: payload.businessId,
          status: 'pending',
          toolName: STALE_QUOTE_TOOL,
        },
        select: { id: true, inputPayload: true },
      });
      if (existing) {
        const payloadObj = (existing.inputPayload as Record<string, unknown> | null) ?? {};
        if (payloadObj.quoteId === quoteId) return;
        // Different quote — fall through and check more rows.
        const others = await this.prisma.client.aiApprovalItem.findMany({
          where: {
            businessId: payload.businessId,
            status: 'pending',
            toolName: STALE_QUOTE_TOOL,
          },
          select: { id: true, inputPayload: true },
        });
        if (others.some((o) => (o.inputPayload as Record<string, unknown> | null)?.quoteId === quoteId)) {
          return;
        }
      }

      const contact = (quote as unknown as { contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null }).contact;
      const contactName = contact
        ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email || 'Customer'
        : 'Customer';
      const quoteNumber = (quote as unknown as { quoteNumber?: string }).quoteNumber ?? quoteId.slice(0, 8);

      await this.prisma.client.aiApprovalItem.create({
        data: {
          businessId: payload.businessId,
          riskTier: 1,
          status: 'pending',
          toolName: STALE_QUOTE_TOOL,
          module: 'commerce',
          title: `Follow up on stale quote #${quoteNumber}`,
          description: `${contactName} hasn't viewed quote #${quoteNumber} in ${payload.daysSinceSent} day${payload.daysSinceSent === 1 ? '' : 's'}.`,
          rationale: `Quote was sent on ${new Date(payload.sentAt).toLocaleDateString()} and has not been viewed, accepted, or rejected. A friendly nudge often unblocks the deal.`,
          expectedBenefit: 'Recover potentially lost revenue with a one-click reminder.',
          inputPayload: {
            quoteId,
            quoteNumber,
            contactEmail: contact?.email ?? null,
            daysSinceSent: payload.daysSinceSent,
          },
          affectedEntities: [{ type: 'quote', id: quoteId }],
        },
      });
      this.logger.log(`Created stale-quote Action Queue card for quote ${quoteId} (business ${payload.businessId})`);
    } catch (e) {
      this.logger.error(`Failed to create stale-quote approval item: ${(e as Error).message}`);
    }
  }
}
