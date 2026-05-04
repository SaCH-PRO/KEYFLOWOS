import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta, ConnectorSmokeResult } from '../connector.interface';
import { SocialPlatformConnector } from './social-platform.base';

@Injectable()
export class TikTokConnector extends SocialPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'tiktok',
    name: 'TikTok',
    description: 'Schedule videos, track engagement, and sync DMs with TikTok',
    category: 'social',
    group: 'social',
    icon: 'video',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
    connectMode: 'oauth',
    oauthStartPath: '/social/businesses/{businessId}/connections/tiktok/oauth/start',
    connectInstructions: 'You will be redirected to TikTok to grant access for posting and analytics.',
    externalUrl: 'https://www.tiktok.com/business/',
  };
  protected readonly platformKey = 'TIKTOK';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }

  protected async pingProvider(token: string): Promise<ConnectorSmokeResult> {
    const res = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `TikTok API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
    }
    const data = (await res.json()) as { data?: { user?: { display_name?: string; open_id?: string } }; error?: { message?: string; code?: string } };
    if (data.error?.code && data.error.code !== 'ok') {
      return { success: false, error: data.error.message ?? data.error.code };
    }
    return {
      success: true,
      action: 'Fetched TikTok /user/info',
      account: data.data?.user?.display_name ?? undefined,
      detail: data.data?.user?.open_id ? `Open ID ${data.data.user.open_id}` : undefined,
    };
  }
}
