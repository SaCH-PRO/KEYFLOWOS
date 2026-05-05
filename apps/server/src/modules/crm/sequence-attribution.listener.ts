import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrmSequenceAnalyticsService } from './crm-sequence-analytics.service';

interface ContactEventLoggedPayload {
  businessId: string;
  contactId: string;
  type: string;
  eventId?: string;
  data?: any;
}

@Injectable()
export class SequenceAttributionListener {
  private readonly logger = new Logger(SequenceAttributionListener.name);

  constructor(
    @Inject(CrmSequenceAnalyticsService)
    private readonly analytics: CrmSequenceAnalyticsService,
  ) {}

  @OnEvent('crm.contact_event.logged', { async: true })
  async onContactEvent(payload: ContactEventLoggedPayload): Promise<void> {
    if (!payload || payload.type !== 'deal.won') return;
    const dealId: string | undefined = payload.data?.dealId;
    if (!dealId) return;
    const wonAt = payload.data?.wonAt ? new Date(payload.data.wonAt) : new Date();
    try {
      await this.analytics.recordDealWonAttribution({
        businessId: payload.businessId,
        contactId: payload.contactId,
        dealId,
        wonAt,
      });
    } catch (err) {
      this.logger.warn(
        `sequence-attribution listener failed for deal=${dealId}: ${(err as Error).message}`,
      );
    }
  }
}
