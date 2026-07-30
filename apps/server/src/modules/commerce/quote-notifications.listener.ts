import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { appUrl } from '../../core/config/runtime-urls';
import type {
  QuoteAcceptedPayload,
  QuoteRejectedPayload,
  QuoteViewedPayload,
} from '../../core/event-bus/events.types';

@Injectable()
export class QuoteNotificationsListener {
  private readonly logger = new Logger(QuoteNotificationsListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionalEmailService)
    private readonly email: TransactionalEmailService,
  ) {}

  private buildQuoteUrl(viewToken: string | null | undefined): string | undefined {
    if (!viewToken) return undefined;
    return `${appUrl()}/quote/${viewToken}`;
  }

  private contactDisplayName(contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null | undefined): string {
    if (!contact) return 'Customer';
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    return full || contact.email || 'Customer';
  }

  /**
   * Resolve the email address that should receive owner-facing alerts for
   * a business. Prefers the business's configured contact email; falls
   * back to the owner's user email so brand-new businesses still get
   * notified.
   */
  private async resolveOwnerEmail(businessId: string): Promise<{
    email: string;
    name: string;
  } | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, email: true, ownerId: true },
    });
    if (!business) return null;
    if (business.email && business.email.trim()) {
      return { email: business.email.trim(), name: business.name };
    }
    const owner = await this.prisma.client.user.findUnique({
      where: { id: business.ownerId },
      select: { email: true, name: true },
    });
    if (owner?.email) {
      return { email: owner.email, name: owner.name || business.name };
    }
    return null;
  }

  @OnEvent('quote.viewed', { async: true })
  async onQuoteViewed(payload: QuoteViewedPayload): Promise<void> {
    if (!payload || payload.source !== 'public') return;
    const { quote, businessId, viewedAt } = payload;
    try {
      const owner = await this.resolveOwnerEmail(businessId);
      if (!owner) {
        this.logger.debug(`No owner email resolvable for business ${businessId}; skipping quote.viewed alert`);
        return;
      }
      await this.email.send({
        businessId,
        type: 'quote_viewed_owner',
        recipientEmail: owner.email,
        recipientName: owner.name,
        dedupeKey: `quote-viewed-owner:${quote.id}`,
        templateData: {
          quoteNumber: quote.quoteNumber,
          contactDisplayName: this.contactDisplayName(quote.contact),
          total: quote.total,
          currency: quote.currency,
          viewedAt,
          quoteUrl: this.buildQuoteUrl(quote.viewToken),
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `quote.viewed notification failed for quote=${quote.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('quote.accepted', { async: true })
  async onQuoteAccepted(payload: QuoteAcceptedPayload): Promise<void> {
    if (!payload) return;
    const { quote, businessId, acceptedAt, source } = payload;
    if (source !== 'public') return;

    const quoteUrl = this.buildQuoteUrl(quote.viewToken);
    const contactName = this.contactDisplayName(quote.contact);

    try {
      const owner = await this.resolveOwnerEmail(businessId);
      if (owner) {
        await this.email.send({
          businessId,
          type: 'quote_accepted_owner',
          recipientEmail: owner.email,
          recipientName: owner.name,
          dedupeKey: `quote-accepted-owner:${quote.id}`,
          templateData: {
            quoteNumber: quote.quoteNumber,
            contactDisplayName: contactName,
            total: quote.total,
            currency: quote.currency,
            acceptedAt,
            quoteUrl,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `quote.accepted owner notification failed for quote=${quote.id}: ${(err as Error).message}`,
      );
    }

    const contactEmail = quote.contact?.email;
    if (contactEmail) {
      try {
        await this.email.send({
          businessId,
          type: 'quote_accepted_customer',
          recipientEmail: contactEmail,
          recipientName: contactName,
          contactId: quote.contactId ?? undefined,
          dedupeKey: `quote-accepted-customer:${quote.id}`,
          templateData: {
            quoteNumber: quote.quoteNumber,
            total: quote.total,
            currency: quote.currency,
            acceptedAt,
            quoteUrl,
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `quote.accepted customer notification failed for quote=${quote.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  @OnEvent('quote.rejected', { async: true })
  async onQuoteRejected(payload: QuoteRejectedPayload): Promise<void> {
    if (!payload) return;
    const { quote, businessId, rejectedAt, source, reason } = payload;
    if (source !== 'public') return;

    const quoteUrl = this.buildQuoteUrl(quote.viewToken);
    const contactName = this.contactDisplayName(quote.contact);

    try {
      const owner = await this.resolveOwnerEmail(businessId);
      if (owner) {
        await this.email.send({
          businessId,
          type: 'quote_rejected_owner',
          recipientEmail: owner.email,
          recipientName: owner.name,
          dedupeKey: `quote-rejected-owner:${quote.id}`,
          templateData: {
            quoteNumber: quote.quoteNumber,
            contactDisplayName: contactName,
            total: quote.total,
            currency: quote.currency,
            rejectedAt,
            reason: reason ?? null,
            quoteUrl,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `quote.rejected owner notification failed for quote=${quote.id}: ${(err as Error).message}`,
      );
    }

    const contactEmail = quote.contact?.email;
    if (contactEmail) {
      try {
        await this.email.send({
          businessId,
          type: 'quote_rejected_customer',
          recipientEmail: contactEmail,
          recipientName: contactName,
          contactId: quote.contactId ?? undefined,
          dedupeKey: `quote-rejected-customer:${quote.id}`,
          templateData: {
            quoteNumber: quote.quoteNumber,
            total: quote.total,
            currency: quote.currency,
            rejectedAt,
            reason: reason ?? null,
            quoteUrl,
          },
        });
      } catch (err: any) {
        this.logger.warn(
          `quote.rejected customer notification failed for quote=${quote.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
