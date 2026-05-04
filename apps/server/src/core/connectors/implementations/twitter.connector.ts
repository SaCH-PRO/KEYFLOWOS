import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta, ConnectorSmokeResult } from '../connector.interface';
import { SocialPlatformConnector } from './social-platform.base';

@Injectable()
export class TwitterConnector extends SocialPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'twitter',
    name: 'Twitter / X',
    description: 'Schedule tweets, track engagement, and sync DMs with Twitter / X',
    category: 'social',
    group: 'social',
    icon: 'twitter',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
    connectMode: 'oauth',
    oauthStartPath: '/social/businesses/{businessId}/connections/twitter/oauth/start',
    connectInstructions: 'You will be redirected to X to grant access for posting and engagement tracking.',
    externalUrl: 'https://x.com/home',
  };
  protected readonly platformKey = 'TWITTER';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }

  protected async pingProvider(token: string): Promise<ConnectorSmokeResult> {
    const res = await fetch('https://api.twitter.com/2/users/me?user.fields=username,name,verified', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `X API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
    }
    const data = (await res.json()) as { data?: { id?: string; username?: string; name?: string; verified?: boolean } };
    return {
      success: true,
      action: 'Fetched X /users/me',
      account: data.data?.username ? `@${data.data.username}` : data.data?.name ?? undefined,
      detail: data.data?.id ? `User ID ${data.data.id}${data.data.verified ? ' • verified' : ''}` : undefined,
    };
  }
}
