import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta, ConnectorSmokeResult } from '../connector.interface';
import { SocialPlatformConnector } from './social-platform.base';

@Injectable()
export class LinkedInConnector extends SocialPlatformConnector {
  readonly meta: ConnectorMeta = {
    type: 'linkedin',
    name: 'LinkedIn',
    description: 'Schedule posts, track engagement, and sync messages with LinkedIn',
    category: 'social',
    group: 'social',
    icon: 'linkedin',
    supportsSync: true,
    supportsWebhook: true,
    authType: 'oauth2',
    connectMode: 'oauth',
    oauthStartPath: '/social/businesses/{businessId}/connections/linkedin/oauth/start',
    connectInstructions: 'You will be redirected to LinkedIn to grant access for posting and analytics.',
    externalUrl: 'https://www.linkedin.com/company/setup/new/',
  };
  protected readonly platformKey = 'LINKEDIN';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }

  protected async pingProvider(token: string): Promise<ConnectorSmokeResult> {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, error: `LinkedIn API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
    }
    const data = (await res.json()) as { name?: string; email?: string; sub?: string };
    return {
      success: true,
      action: 'Fetched LinkedIn /userinfo',
      account: data.name ?? data.email ?? undefined,
      detail: data.sub ? `Subject ${data.sub}` : undefined,
    };
  }
}
