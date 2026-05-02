import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
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
  };
  protected readonly platformKey = 'TIKTOK';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
