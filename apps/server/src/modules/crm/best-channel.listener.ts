import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BestChannelService } from './best-channel.service';
import { getContactEventCategory } from '@keyflow/shared';

interface ContactEventLoggedPayload {
  businessId: string;
  contactId: string;
  type: string;
  eventId?: string;
  source?: string;
  actorType?: string;
  actorId?: string;
  data?: unknown;
}

@Injectable()
export class BestChannelListener {
  private readonly logger = new Logger(BestChannelListener.name);

  constructor(@Inject(BestChannelService) private readonly bestChannel: BestChannelService) {}

  @OnEvent('crm.contact_event.logged', { async: true })
  async onContactEventLogged(payload: ContactEventLoggedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.contactId || !payload?.type) return;
    const category = getContactEventCategory(payload.type);
    const isCommunication = category === 'communication';
    const isCampaign = payload.type === 'campaign.sent' || payload.type === 'campaign.opened';
    if (!isCommunication && !isCampaign) return;
    try {
      await this.bestChannel.recordEvent({
        businessId: payload.businessId,
        contactId: payload.contactId,
        type: payload.type,
        data: payload.data,
      });
    } catch (err: any) {
      this.logger.warn(
        `Best-channel rollup failed for contact=${payload.contactId} type=${payload.type}: ${(err as Error).message}`,
      );
    }
  }
}
