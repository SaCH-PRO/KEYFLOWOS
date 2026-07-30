import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CalendarProjectionService } from '../calendar-projection.service';
import {
  mapEmailCampaign,
  mapSocialPost,
  SourceEmailCampaign,
  SourceSocialPost,
} from '../projection-mappers';

interface SocialPostPayload {
  businessId: string;
  post: SourceSocialPost;
}
interface SocialPostDeletedPayload {
  businessId: string;
  postId: string;
}
interface CampaignPayload {
  businessId: string;
  campaign: SourceEmailCampaign;
}
interface CampaignDeletedPayload {
  businessId: string;
  campaignId: string;
}

@Injectable()
export class CalendarMarketingListener {
  private readonly logger = new Logger(CalendarMarketingListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
  ) {}

  // ---- Social posts ----

  @OnEvent('social_post.created', { async: true })
  @OnEvent('social_post.updated', { async: true })
  @OnEvent('social_post.scheduled', { async: true })
  @OnEvent('post.published', { async: true })
  async onSocialPostChanged(payload: SocialPostPayload): Promise<void> {
    if (!payload?.businessId || !payload?.post) return;
    const input = mapSocialPost(payload.post, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'social_post',
          sourceId: payload.post.id,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `social_post projection failed id=${payload.post.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('social_post.deleted', { async: true })
  async onSocialPostDeleted(payload: SocialPostDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.postId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'social_post',
        sourceId: payload.postId,
      })
      .catch((err: Error) =>
        this.logger.warn(`social_post delete projection failed: ${err.message}`),
      );
  }

  // ---- Email campaigns ----

  @OnEvent('email_campaign.created', { async: true })
  @OnEvent('email_campaign.updated', { async: true })
  @OnEvent('email_campaign.scheduled', { async: true })
  @OnEvent('email_campaign.cancelled', { async: true })
  @OnEvent('campaign.created', { async: true })
  @OnEvent('campaign.sent', { async: true })
  async onCampaignChanged(payload: CampaignPayload): Promise<void> {
    if (!payload?.businessId || !payload?.campaign) return;
    const input = mapEmailCampaign(payload.campaign, payload.businessId);
    if (!input) {
      await this.projection
        .removeForSource({
          businessId: payload.businessId,
          sourceType: 'email_campaign',
          sourceId: payload.campaign.id,
        })
        .catch(() => {});
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `email_campaign projection failed id=${payload.campaign.id}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('email_campaign.deleted', { async: true })
  async onCampaignDeleted(payload: CampaignDeletedPayload): Promise<void> {
    if (!payload?.businessId || !payload?.campaignId) return;
    await this.projection
      .removeForSource({
        businessId: payload.businessId,
        sourceType: 'email_campaign',
        sourceId: payload.campaignId,
      })
      .catch((err: Error) =>
        this.logger.warn(`email_campaign delete projection failed: ${err.message}`),
      );
  }
}
