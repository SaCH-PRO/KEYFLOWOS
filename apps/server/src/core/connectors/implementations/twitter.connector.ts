import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { ConnectorMeta } from '../connector.interface';
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
  };
  protected readonly platformKey = 'TWITTER';

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(EventEmitter2) events: EventEmitter2,
    @Inject(EntityResolutionService) entityResolution: EntityResolutionService,
  ) {
    super(prisma, events, entityResolution);
  }
}
